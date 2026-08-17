const express = require("express");
const { db } = require("./db");
const { hashPassword, verifyPassword, publicUser, createSession, userByToken, deleteSession } = require("./auth");
const { PACK_TYPES, openPack, confirmPackPick, questsFor, claimQuest, grantWelcomeGift, todayBucket, exchangeForGuaranteed, exchangeForPurple, PURPLE_REQUIREMENTS, PURPLE_REWARD_RANGE, eventQuestsFor, claimEventQuest, INVENTORY_LIMIT, INVENTORY_WARN_AT, loginRewardStatus, claimLoginReward, packPurchasesInWindow, TOKEN_RATES, TOKEN_REWARD_COST, TOKEN_REWARD_RANGE, exchangeForTokens, redeemTokenReward } = require("./economy");
const { effectiveRating } = require("./ovr");
const { isOnline } = require("./presence");

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
    res.json({ token, user: publicUser(fresh), gift, loginReward: loginRewardStatus(fresh.id) });
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
    res.json({ token, user: publicUser(user), loginReward: loginRewardStatus(user.id) });
  } catch (error) {
    res.status(500).json({ error: "Could not sign in." });
  }
});

router.post("/auth/logout", (req, res) => {
  deleteSession(tokenFrom(req));
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user), loginReward: loginRewardStatus(req.user.id) }));

router.get("/login-reward", requireAuth, (req, res) => res.json({ loginReward: loginRewardStatus(req.user.id) }));

router.post("/login-reward/claim", requireAuth, (req, res) => {
  const result = claimLoginReward(req.user.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get("/cards", (req, res) => {
  const rows = db.prepare("SELECT * FROM cards ORDER BY category, base_rating DESC").all();
  res.json({ cards: rows.map((c) => ({ ...c, version: c.variant === "laliga" ? "laliga" : c.version })) });
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
    SELECT oc.*, c.name, c.season, c.club, c.nation, c.position, c.category, c.base_rating, c.tier, c.image, c.variant
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ?
    ORDER BY c.base_rating DESC, oc.id ASC
  `).all(req.user.id);
  res.json({ cards: rows, limit: INVENTORY_LIMIT, warnAt: INVENTORY_WARN_AT });
});

router.get("/team", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT oc.*, c.name, c.season, c.club, c.nation, c.position, c.category, c.base_rating, c.tier, c.image, c.variant
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.is_in_xi = 1
  `).all(req.user.id);
  rows.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  res.json({ squad: rows, overall: squadOverall(rows) });
});

// Another manager's saved XI, so the pre-match screen can show both sides'
// clubs before kick-off. Same shape as /team so the client reuses its
// squad rendering.
router.get("/team/:userId", requireAuth, (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: "Invalid user id." });
  const rows = db.prepare(`
    SELECT oc.*, c.name, c.season, c.club, c.nation, c.position, c.category, c.base_rating, c.tier, c.image, c.variant
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.is_in_xi = 1
  `).all(userId);
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

  const seenNames = new Set();
  for (const [slot, id] of entries) {
    if (!SLOT_ORDER.includes(slot)) return res.status(400).json({ error: "Unknown slot." });
    const owned = db.prepare("SELECT oc.*, c.category, c.name FROM owned_cards oc JOIN cards c ON c.id = oc.card_id WHERE oc.id = ? AND oc.user_id = ?").get(Number(id), req.user.id);
    if (!owned) return res.status(404).json({ error: "You don't own that player." });
    const nameKey = String(owned.name || "").trim().toLowerCase();
    if (nameKey && seenNames.has(nameKey)) return res.status(400).json({ error: "You can only have one copy of each player in your starting XI." });
    seenNames.add(nameKey);
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
  const pool = db.prepare("SELECT * FROM cards WHERE variant = ''").all();
  const bronze = pool.filter((c) => c.base_rating < 70).length;
  const silver = pool.filter((c) => c.base_rating >= 70 && c.base_rating < 80).length;
  const total = bronze + silver || 1;
  const poolOdds = { bronze: Math.round((bronze / total) * 100), silver: Math.round((silver / total) * 100) };
  const toPercent = (odds) => Object.fromEntries(Object.entries(odds).map(([k, v]) => [k, Math.round(v * 100)]));
  res.json({
    packs: PACK_TYPES.map((p) => ({
      key: p.key, name: p.name, cost: p.cost, cardCount: p.cardCount || null, image: p.image, description: p.description,
      odds: p.ratings ? toPercent(p.ratings) : (p.odds ? toPercent(p.odds) : (p.pick ? null : poolOdds)),
      pick: p.pick ? { rounds: p.pick.rounds, optionsPerPick: p.pick.optionsPerPick, minRating: p.pick.minRating, maxRating: p.pick.maxRating } : null,
      limit: p.limit ? { max: p.limit.max, days: p.limit.days, used: packPurchasesInWindow(req.user.id, p.key, p.limit.days) } : null,
      reveal: p.reveal || null,
    })),
    daily: { claimed: req.user.last_claimed_daily === todayBucket(), streak: req.user.streak || 0 },
  });
});

router.post("/packs/open", requireAuth, (req, res) => {
  const result = openPack(req.user.id, req.body?.packKey);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post("/packs/pick", requireAuth, (req, res) => {
  const result = confirmPackPick(req.user.id, req.body?.pickId, req.body?.selections);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get("/quests", requireAuth, (req, res) => res.json({ quests: questsFor(req.user.id) }));

router.post("/quests/claim", requireAuth, (req, res) => {
  const result = claimQuest(req.user.id, Number(req.body?.questId));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// Curated events feed. Statuses are computed from timestamps so the feed
// genuinely shifts between upcoming / live / ending soon over time.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EVENT_CATALOG = [
  {
    id: "laliga-kickoff",
    icon: "⚽",
    title: "La Liga Kickoff",
    desc: "50 of Spain's best from the 2025-26 season land as limited La Liga cards rated up to 85. Quests and packs drop soon.",
    tag: "LALIGA 26/27",
    reward: "limited La Liga cards up to 85",
    startAt: Date.now() - 1 * HOUR,
    endAt: Date.now() + 30 * DAY,
  },
  {
    id: "new-beginnings",
    icon: "🌅",
    title: "New Beginnings",
    desc: "Season 1 is here — trade in your players for a guaranteed Ultimate Icons purple card rated 77-80.",
    tag: "SEASON 1",
    reward: "guaranteed 77-80 purple card",
    startAt: Date.now() - 1 * DAY,
    endAt: Date.now() + 30 * DAY,
  },
];

function eventStatus(ev) {
  const now = Date.now();
  if (now < ev.startAt) return "upcoming";
  if (now > ev.endAt) return "ended";
  return ev.endAt - now < 24 * HOUR ? "ending" : "ongoing";
}

const EVENT_TAGS = { ongoing: "LIVE", ending: "ENDING SOON" };

router.get("/events", requireAuth, (req, res) => {
  const now = Date.now();
  const events = EVENT_CATALOG
    .filter((ev) => {
      const status = eventStatus(ev);
      return status === "ongoing" || status === "ending";
    })
    .map((ev) => {
      const status = eventStatus(ev);
      let label;
      let tag;
      if (status === "ongoing") { label = `Live · ends in ${Math.ceil((ev.endAt - now) / DAY)}d`; tag = EVENT_TAGS.ongoing; }
      else { label = `Ends in ${Math.ceil((ev.endAt - now) / HOUR)}h`; tag = EVENT_TAGS.ending; }
      return { ...ev, status, tag, label };
    });
  const previewPool = db.prepare("SELECT * FROM cards WHERE base_rating BETWEEN ? AND ? AND variant = ''").all(PURPLE_REWARD_RANGE.min, PURPLE_REWARD_RANGE.max);
  const previews = previewPool
    .map((c) => ({ ...c, version: "purple" }))
    .sort(() => Math.random() - 0.5);
  res.json({
    events,
    quests: eventQuestsFor(req.user.id),
    exchange: {
      requirements: PURPLE_REQUIREMENTS,
      reward: { min: PURPLE_REWARD_RANGE.min, max: PURPLE_REWARD_RANGE.max },
      previews,
    },
  });
});

router.post("/events/quests/claim", requireAuth, (req, res) => {
  const result = claimEventQuest(req.user.id, Number(req.body?.questId));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post("/events/exchange", requireAuth, (req, res) => {
  const result = exchangeForPurple(req.user.id, req.body?.ids);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post("/exchange", requireAuth, (req, res) => {
  const result = exchangeForGuaranteed(req.user.id, req.body?.ids);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get("/exchange/tokens", requireAuth, (req, res) => {
  res.json({ rates: TOKEN_RATES, cost: TOKEN_REWARD_COST, reward: TOKEN_REWARD_RANGE, tokens: req.user.tokens || 0 });
});

router.post("/exchange/tokens", requireAuth, (req, res) => {
  const result = exchangeForTokens(req.user.id, req.body?.ids);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.post("/exchange/tokens/redeem", requireAuth, (req, res) => {
  const result = redeemTokenReward(req.user.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

// ----- Friends -----
// One row per friendship, stored in both directions once accepted (each side
// gets their own row, so a row can never reference itself and removal only
// needs to look at the two ids involved). Requests are a single row owned by
// the requester; accepting flips it to 'accepted' and writes the mirror row.
function friendUserId(row, me) { return row.user_id === me ? row.friend_id : row.user_id; }
function friendsList(userId) {
  const activeRows = db.prepare(`
    SELECT f.*, u.username, s.wins
    FROM friends f
    JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
    LEFT JOIN user_stats s ON s.user_id = u.id
    WHERE f.status = 'accepted' AND (f.user_id = ? OR f.friend_id = ?)
  `).all(userId, userId, userId);
  const seen = new Set();
  const active = activeRows
    .filter((row) => { const id = friendUserId(row, userId); if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((row) => {
      const id = friendUserId(row, userId);
      return { id, username: row.username, wins: Number(row.wins) || 0, online: isOnline(id), since: row.created_at };
    });
  const incoming = db.prepare(`
    SELECT f.*, u.username
    FROM friends f JOIN users u ON u.id = f.user_id
    WHERE f.status = 'pending' AND f.friend_id = ?
    ORDER BY f.id DESC
  `).all(userId);
  const outgoing = db.prepare(`
    SELECT f.*, u.username
    FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.status = 'pending' AND f.user_id = ?
    ORDER BY f.id DESC
  `).all(userId);
  return {
    friends: active,
    incoming: incoming.map((row) => ({ id: row.id, userId: row.user_id, username: row.username, online: isOnline(row.user_id) })),
    outgoing: outgoing.map((row) => ({ id: row.id, userId: row.friend_id, username: row.username })),
  };
}

router.get("/friends", requireAuth, (req, res) => res.json(friendsList(req.user.id)));

router.post("/friends/request", requireAuth, (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "Enter a manager's username." });
  const target = db.prepare("SELECT id, username FROM users WHERE LOWER(username) = LOWER(?)").get(username);
  if (!target) return res.status(404).json({ error: "No manager with that username." });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't add yourself." });
  const existing = db.prepare(`
    SELECT status FROM friends
    WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    LIMIT 1
  `).get(req.user.id, target.id, target.id, req.user.id);
  if (existing?.status === "accepted") return res.status(400).json({ error: "You're already friends." });
  if (existing?.status === "pending") return res.status(400).json({ error: "A request is already pending between you two." });
  db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')").run(req.user.id, target.id);
  res.json({ ok: true, list: friendsList(req.user.id) });
});

router.post("/friends/respond", requireAuth, (req, res) => {
  const requestId = Number(req.body?.requestId);
  const accept = req.body?.accept === true;
  const request = db.prepare("SELECT * FROM friends WHERE id = ? AND friend_id = ? AND status = 'pending'").get(requestId, req.user.id);
  if (!request) return res.status(400).json({ error: "That request no longer exists." });
  if (accept) {
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE friends SET status = 'accepted' WHERE id = ?").run(request.id);
      db.prepare("DELETE FROM friends WHERE user_id = ? AND friend_id = ?").run(req.user.id, request.user_id);
      db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'accepted')").run(req.user.id, request.user_id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      return res.status(500).json({ error: "Could not accept the request." });
    }
  } else {
    db.prepare("DELETE FROM friends WHERE id = ?").run(request.id);
  }
  res.json({ ok: true, list: friendsList(req.user.id) });
});

router.delete("/friends/:friendId", requireAuth, (req, res) => {
  const friendId = Number(req.params.friendId);
  if (!Number.isInteger(friendId) || friendId <= 0) return res.status(400).json({ error: "Invalid friend id." });
  db.prepare(`
    DELETE FROM friends
    WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
  `).run(req.user.id, friendId, friendId, req.user.id);
  res.json({ ok: true, list: friendsList(req.user.id) });
});

const AD_REWARD_DEFS = {
  gems: { required: 5, reward: { gems: 200 }, label: "200 Gems" },
  coins: { required: 10, reward: { coins: 50 }, label: "50 Coins per ad (500 total)" },
};

router.get("/free-resources", requireAuth, (req, res) => {
  const bucket = todayBucket();
  const rows = db.prepare("SELECT reward_key, COUNT(*) as cnt FROM ad_watches WHERE user_id = ? AND DATE(created_at) = ? GROUP BY reward_key").all(req.user.id, bucket);
  const counts = {};
  for (const r of rows) counts[r.reward_key] = r.cnt;
  const claimed = db.prepare("SELECT reward_key FROM ad_rewards WHERE user_id = ? AND DATE(claimed_at) = ?").all(req.user.id, bucket);
  const claimedKeys = new Set(claimed.map((r) => r.reward_key));
  const rewards = Object.entries(AD_REWARD_DEFS).map(([key, def]) => ({
    key,
    label: def.label,
    required: def.required,
    watched: counts[key] || 0,
    claimed: claimedKeys.has(key),
    ready: (counts[key] || 0) >= def.required && !claimedKeys.has(key),
  }));
  res.json({ ok: true, rewards });
});

router.post("/free-resources/watch", requireAuth, (req, res) => {
  const { rewardKey } = req.body || {};
  const def = AD_REWARD_DEFS[rewardKey];
  if (!def) return res.status(400).json({ error: "Invalid reward type." });
  const bucket = todayBucket();
  const claimed = db.prepare("SELECT 1 FROM ad_rewards WHERE user_id = ? AND reward_key = ? AND DATE(claimed_at) = ?").get(req.user.id, rewardKey, bucket);
  if (claimed) return res.status(400).json({ error: "Already claimed this reward today." });
  db.prepare("INSERT INTO ad_watches (user_id, reward_key) VALUES (?, ?)").run(req.user.id, rewardKey);
  const row = db.prepare("SELECT COUNT(*) as cnt FROM ad_watches WHERE user_id = ? AND reward_key = ? AND DATE(created_at) = ?").get(req.user.id, rewardKey, bucket);
  const watched = row.cnt;
  if (watched > def.required) return res.status(400).json({ error: "Already watched enough ads for this reward." });
  res.json({ ok: true, watched, required: def.required, ready: watched >= def.required });
});

router.post("/free-resources/claim", requireAuth, (req, res) => {
  const { rewardKey } = req.body || {};
  const def = AD_REWARD_DEFS[rewardKey];
  if (!def) return res.status(400).json({ error: "Invalid reward type." });
  const bucket = todayBucket();
  const claimed = db.prepare("SELECT 1 FROM ad_rewards WHERE user_id = ? AND reward_key = ? AND DATE(claimed_at) = ?").get(req.user.id, rewardKey, bucket);
  if (claimed) return res.status(400).json({ error: "Already claimed today." });
  const row = db.prepare("SELECT COUNT(*) as cnt FROM ad_watches WHERE user_id = ? AND reward_key = ? AND DATE(created_at) = ?").get(req.user.id, rewardKey, bucket);
  if (row.cnt < def.required) return res.status(400).json({ error: `Need ${def.required - row.cnt} more ads.` });
  db.prepare("INSERT INTO ad_rewards (user_id, reward_key) VALUES (?, ?)").run(req.user.id, rewardKey);
  if (def.reward.coins) db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(def.reward.coins, req.user.id);
  if (def.reward.gems) db.prepare("UPDATE users SET gems = gems + ? WHERE id = ?").run(def.reward.gems, req.user.id);
  const user = publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id));
  res.json({ ok: true, reward: def.reward, user });
});

module.exports = router;
