const express = require("express");
const { db } = require("./db");
const { hashPassword, verifyPassword, publicUser, createSession, userByToken, deleteSession } = require("./auth");
const { PACK_TYPES, openPack, questsFor, claimQuest, grantWelcomeGift, todayBucket, exchangeForGuaranteed, INVENTORY_LIMIT, INVENTORY_WARN_AT } = require("./economy");
const { effectiveRating } = require("./ovr");

const router = express.Router();
const VALID_USERNAME = /^[a-zA-Z0-9_]{3,20}$/;
const SLOT_ORDER = ["GK", "LB", "CB1", "CB2", "RB", "CM1", "CM2", "CAM", "LW", "ST", "RW"];
const SLOT_CATEGORY = { GK:"GK", LB:"DEF", CB1:"DEF", CB2:"DEF", RB:"DEF", CM1:"MID", CM2:"MID", CAM:"MID", LW:"ATT", ST:"ATT", RW:"ATT" };

function squadOverall(rows) {
  if (!rows.length) return 0;
  return Number((rows.reduce((sum, row) => sum + effectiveRating(row.rating, row.category, SLOT_CATEGORY[row.slot]), 0) / rows.length).toFixed(1));
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = userByToken(token);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  next();
}

function tokenFrom(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

router.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!VALID_USERNAME.test(String(username || ""))) {
      return res.status(400).json({ error: "Username must be 3-20 letters, numbers, or underscores." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    if (db.prepare("SELECT id FROM users WHERE username = ?").get(username)) {
      return res.status(409).json({ error: "That username is already taken." });
    }
    const passwordHash = await hashPassword(password);
    const result = db.prepare("INSERT INTO users (username, password_hash, coins) VALUES (?, ?, 500)").run(username, passwordHash);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    const token = createSession(user.id);
    const gift = grantWelcomeGift(user.id);
    const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    res.json({ token, user: publicUser(fresh), gift });
  } catch (error) {
    res.status(500).json({ error: "Could not create account." });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = typeof username === "string" ? db.prepare("SELECT * FROM users WHERE username = ?").get(username) : null;
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    res.status(500).json({ error: "Could not sign in." });
  }
});

router.post("/auth/logout", (req, res) => {
  deleteSession(tokenFrom(req));
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.get("/cards", (req, res) => {
  const rows = db.prepare("SELECT * FROM cards ORDER BY category, base_rating DESC").all();
  res.json({ cards: rows });
});

const LEADERBOARD_TYPES = ["wins", "goals", "saves"];

router.get("/leaderboard", (req, res) => {
  const type = LEADERBOARD_TYPES.includes(req.query.type) ? req.query.type : "wins";
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const entries = db.prepare(`
    SELECT u.username, s.wins, s.goals, s.saves
    FROM user_stats s JOIN users u ON u.id = s.user_id
    WHERE s.${type} > 0
    ORDER BY s.${type} DESC, u.username ASC
    LIMIT ?
  `).all(limit);
  let me = null;
  const user = userByToken(tokenFrom(req));
  if (user) {
    const mine = db.prepare("SELECT * FROM user_stats WHERE user_id = ?").get(user.id);
    if (mine) {
      const ahead = db.prepare(`SELECT COUNT(*) AS c FROM user_stats WHERE ${type} > ?`).get(Number(mine[type]) || 0).c;
      me = { username: user.username, rank: Number(ahead) + 1, wins: Number(mine.wins), goals: Number(mine.goals), saves: Number(mine.saves) };
    }
  }
  res.json({ type, entries, me });
});

router.get("/inventory", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT oc.*, c.name, c.season, c.club, c.nation, c.position, c.category, c.base_rating, c.tier, c.image
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ?
    ORDER BY c.base_rating DESC, oc.id ASC
  `).all(req.user.id);
  res.json({ cards: rows, limit: INVENTORY_LIMIT, warnAt: INVENTORY_WARN_AT });
});

router.get("/team", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT oc.*, c.name, c.season, c.club, c.nation, c.position, c.category, c.base_rating, c.tier, c.image
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.is_in_xi = 1
  `).all(req.user.id);
  rows.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  res.json({ squad: rows, overall: squadOverall(rows) });
});

// Save the starting XI: a map of slot -> owned_cards id. Players must be owned
// by the user, and any player can fill any slot (playing out of position costs
// OVR: -3 for one step off, -5 for two or more). Saving partial squads is
// allowed, but the own-team match mode requires a full 11.
router.post("/team", requireAuth, (req, res) => {
  const slots = (req.body && typeof req.body.slots === "object" && req.body.slots !== null) ? req.body.slots : {};
  const entries = Object.entries(slots).filter(([, id]) => id !== null && id !== undefined && id !== "");
  if (entries.length > 11) return res.status(400).json({ error: "A squad can have at most 11 players." });
  const ids = entries.map(([, id]) => Number(id));
  if (new Set(ids).size !== ids.length) return res.status(400).json({ error: "The same player cannot fill two slots." });

  for (const [slot, id] of entries) {
    if (!SLOT_ORDER.includes(slot)) return res.status(400).json({ error: "Unknown slot." });
    const owned = db.prepare("SELECT oc.*, c.category FROM owned_cards oc JOIN cards c ON c.id = oc.card_id WHERE oc.id = ? AND oc.user_id = ?").get(Number(id), req.user.id);
    if (!owned) return res.status(404).json({ error: "You don't own that player." });
  }

  const clear = db.prepare("UPDATE owned_cards SET is_in_xi = 0, slot = NULL WHERE user_id = ?");
  const set = db.prepare("UPDATE owned_cards SET is_in_xi = 1, slot = ? WHERE id = ? AND user_id = ?");
  db.exec("BEGIN");
  try {
    clear.run(req.user.id);
    for (const [slot, id] of entries) set.run(slot, Number(id), req.user.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return res.status(500).json({ error: "Could not save your squad." });
  }

  const rows = db.prepare(`
    SELECT oc.*, c.name, c.season, c.club, c.position, c.category, c.base_rating, c.tier, c.image
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.is_in_xi = 1
  `).all(req.user.id);
  rows.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  res.json({ squad: rows, count: rows.length, overall: squadOverall(rows) });
});

router.get("/packs", requireAuth, (req, res) => {
  res.json({
    packs: PACK_TYPES.map((p) => ({ key: p.key, name: p.name, cost: p.cost, cardCount: p.cardCount, image: p.image, description: p.description })),
    daily: { claimed: req.user.last_claimed_daily === todayBucket(), streak: req.user.streak || 0 },
  });
});

router.post("/packs/open", requireAuth, (req, res) => {
  const result = openPack(req.user.id, req.body?.packKey);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get("/quests", requireAuth, (req, res) => res.json({ quests: questsFor(req.user.id) }));

router.post("/quests/claim", requireAuth, (req, res) => {
  const result = claimQuest(req.user.id, Number(req.body?.questId));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post("/exchange", requireAuth, (req, res) => {
  const result = exchangeForGuaranteed(req.user.id, req.body?.ids);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

module.exports = router;
