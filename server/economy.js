const { db } = require("./db");
const { publicUser } = require("./auth");
const { buildCardStats } = require("./ovr");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const TIER_RANGE = { bronze: [60, 69], silver: [70, 79], gold: [80, 99] };

const CLUB_DIR = path.join(__dirname, "..", "src", "data", "club");
const CLUB_FILES = { ATT: "attackers.json", MID: "midfielders.json", DEF: "defenders.json", GK: "goalkeepers.json" };

// The club JSON is the authoritative roster (it carries the real OVR and stats),
// so the welcome gift draws from it directly instead of depending on the DB
// being seeded. Rows are inserted into the cards table on demand when missing.
function loadClubCatalog() {
  const cards = [];
  for (const [category, file] of Object.entries(CLUB_FILES)) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(CLUB_DIR, file), "utf8")); } catch { /* missing file */ }
    if (!Array.isArray(list)) continue;
    for (const card of list) cards.push({ ...card, category });
  }
  return cards;
}

const INVENTORY_LIMIT = 80;
const INVENTORY_WARN_AT = 60;
const EXCHANGE_REQUIRE_COUNT = 10;
const EXCHANGE_MIN_RATING = 60;
const EXCHANGE_MAX_RATING = 69;
const EXCHANGE_REWARD_MIN_RATING = 72;

function ownedCount(userId) {
  return Number(db.prepare("SELECT COUNT(*) AS c FROM owned_cards WHERE user_id = ?").get(userId).c);
}

// Trade ten 60-69 rated players for one guaranteed 72+ card. The submitted
// players must be owned, not in the starting XI, and within the rating band;
// they are removed from the inventory and replaced by the reward card.
function exchangeForGuaranteed(userId, ids) {
  if (!Array.isArray(ids) || ids.length !== EXCHANGE_REQUIRE_COUNT) {
    return { error: `Select exactly ${EXCHANGE_REQUIRE_COUNT} players to exchange.` };
  }
  const numericIds = [...new Set(ids.map(Number))];
  if (numericIds.length !== EXCHANGE_REQUIRE_COUNT) return { error: "Duplicate players selected." };
  if (numericIds.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "Invalid player selection." };

  const placeholders = numericIds.map(() => "?").join(",");
  const owned = db.prepare(`
    SELECT oc.*, c.base_rating, c.name
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.id IN (${placeholders})
  `).all(userId, ...numericIds);
  if (owned.length !== EXCHANGE_REQUIRE_COUNT) return { error: "You don't own all the selected players." };
  const inXI = owned.find((row) => row.is_in_xi === 1);
  if (inXI) return { error: `Remove ${inXI.name} from your starting XI before exchanging.` };
  const bad = owned.find((row) => row.base_rating < EXCHANGE_MIN_RATING || row.base_rating > EXCHANGE_MAX_RATING);
  if (bad) return { error: `Only players rated ${EXCHANGE_MIN_RATING}-${EXCHANGE_MAX_RATING} can be exchanged (${bad.name} is ${bad.base_rating}).` };

  const pool = db.prepare("SELECT * FROM cards WHERE base_rating >= ? AND variant = ''").all(EXCHANGE_REWARD_MIN_RATING);
  if (!pool.length) return { error: "No exchangeable rewards right now." };
  const reward = pool[Math.floor(Math.random() * pool.length)];

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM owned_cards WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...numericIds);
    db.prepare("INSERT INTO owned_cards (user_id, card_id, rating, xp, is_in_xi, slot, acquired_from) VALUES (?, ?, ?, 0, 0, NULL, 'exchange')").run(userId, reward.id, reward.base_rating);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { error: "Could not complete the exchange." };
  }
  return { card: reward, count: ownedCount(userId) };
}

// Purple (event) exchange: trade a specific mix of owned players for one
// guaranteed purple Ultimate Icons card (rated 77-80). Each requirement group
// must be filled for the exchange to unlock.
const PURPLE_REQUIREMENTS = [
  { label: "5 × 60-69 rated", min: 60, max: 69, count: 5 },
  { label: "5 × 70-75 rated", min: 70, max: 75, count: 5 },
];
const PURPLE_REWARD_RANGE = { min: 77, max: 80 };

function exchangeForPurple(userId, ids) {
  const totalNeeded = PURPLE_REQUIREMENTS.reduce((sum, g) => sum + g.count, 0);
  if (!Array.isArray(ids) || ids.length !== totalNeeded) {
    return { error: `Select exactly ${totalNeeded} players to exchange.` };
  }
  const numericIds = [...new Set(ids.map(Number))];
  if (numericIds.length !== totalNeeded) return { error: "Duplicate players selected." };
  if (numericIds.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "Invalid player selection." };

  const placeholders = numericIds.map(() => "?").join(",");
  const owned = db.prepare(`
    SELECT oc.*, c.base_rating, c.name
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.id IN (${placeholders})
  `).all(userId, ...numericIds);
  if (owned.length !== totalNeeded) return { error: "You don't own all the selected players." };
  const inXI = owned.find((row) => row.is_in_xi === 1);
  if (inXI) return { error: `Remove ${inXI.name} from your starting XI before exchanging.` };

  for (const group of PURPLE_REQUIREMENTS) {
    const count = owned.filter((row) => row.base_rating >= group.min && row.base_rating <= group.max).length;
    if (count < group.count) {
      return { error: `Need ${group.count} ${group.label.replace("×", "×")} — selected ${count}.` };
    }
  }

  const pool = db.prepare("SELECT * FROM cards WHERE base_rating BETWEEN ? AND ? AND variant = ''").all(PURPLE_REWARD_RANGE.min, PURPLE_REWARD_RANGE.max);
  if (!pool.length) return { error: "No purple rewards available right now." };
  const reward = pool[Math.floor(Math.random() * pool.length)];

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM owned_cards WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...numericIds);
    db.prepare("INSERT INTO owned_cards (user_id, card_id, rating, xp, is_in_xi, slot, acquired_from, version) VALUES (?, ?, ?, 0, 0, NULL, 'purple_exchange', 'purple')").run(userId, reward.id, reward.base_rating);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { error: "Could not complete the exchange." };
  }
  return { card: { ...reward, version: "purple" }, count: ownedCount(userId) };
}

// Footyverse token economy: owned players can be traded in for tokens based on
// their rating band, then tokens can be spent in the token shop.
const TOKEN_RATES = [
  { min: 70, max: 75, tokens: 2 },
  { min: 76, max: 80, tokens: 3 },
  { min: 81, max: 85, tokens: 5 },
];
const TOKEN_REWARD_COST = 60;
const TOKEN_REWARD_RANGE = { min: 83, max: 85 };

function tokenRateFor(rating) {
  const band = TOKEN_RATES.find((b) => rating >= b.min && rating <= b.max);
  return band ? band.tokens : 0;
}

// Trade owned players in for Footyverse tokens. Every selected player must be
// owned, out of the starting XI, and rated within a token band (70-85).
function exchangeForTokens(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Select at least one player to exchange." };
  const numericIds = [...new Set(ids.map(Number))];
  if (numericIds.length !== ids.length) return { error: "Duplicate players selected." };
  if (numericIds.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "Invalid player selection." };

  const placeholders = numericIds.map(() => "?").join(",");
  const owned = db.prepare(`
    SELECT oc.*, c.base_rating, c.name
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ? AND oc.id IN (${placeholders})
  `).all(userId, ...numericIds);
  if (owned.length !== numericIds.length) return { error: "You don't own all the selected players." };
  const inXI = owned.find((row) => row.is_in_xi === 1);
  if (inXI) return { error: `Remove ${inXI.name} from your starting XI before exchanging.` };
  const invalid = owned.find((row) => tokenRateFor(row.base_rating) === 0);
  if (invalid) return { error: `Only players rated 70-85 earn tokens (${invalid.name} is ${invalid.base_rating}).` };

  let awarded = 0;
  for (const row of owned) awarded += tokenRateFor(row.base_rating);

  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM owned_cards WHERE user_id = ? AND id IN (${placeholders})`).run(userId, ...numericIds);
    db.prepare("UPDATE users SET tokens = tokens + ? WHERE id = ?").run(awarded, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { error: "Could not complete the exchange." };
  }
  const user = db.prepare("SELECT tokens FROM users WHERE id = ?").get(userId);
  return { tokens: Number(user.tokens), awarded, count: ownedCount(userId) };
}

// Spend Footyverse tokens on one guaranteed 83-85 rated card from the token shop.
function redeemTokenReward(userId) {
  const user = db.prepare("SELECT tokens FROM users WHERE id = ?").get(userId);
  const balance = Number(user?.tokens || 0);
  if (balance < TOKEN_REWARD_COST) return { error: `You need ${TOKEN_REWARD_COST} tokens — you have ${balance}.` };

  const pool = db.prepare("SELECT * FROM cards WHERE base_rating BETWEEN ? AND ?").all(TOKEN_REWARD_RANGE.min, TOKEN_REWARD_RANGE.max);
  if (!pool.length) return { error: "No token shop rewards available right now." };
  const reward = pool[Math.floor(Math.random() * pool.length)];

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET tokens = tokens - ? WHERE id = ?").run(TOKEN_REWARD_COST, userId);
    db.prepare("INSERT INTO owned_cards (user_id, card_id, rating, xp, is_in_xi, slot, acquired_from) VALUES (?, ?, ?, 0, 0, NULL, 'token_shop')").run(userId, reward.id, reward.base_rating);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { error: "Could not complete the redemption." };
  }
  const after = db.prepare("SELECT tokens FROM users WHERE id = ?").get(userId);
  return { card: reward, tokens: Number(after.tokens), count: ownedCount(userId) };
}

const PACK_TYPES = [
  { key: "daily", name: "Daily Free Pack", cost: { type: "free" }, cardCount: 3, image: "🎁", description: "Free every day. Streak bonus inside.", odds: { bronze: 0.8, silver: 0.2 } },
  { key: "basic", name: "100 Coins Pack", cost: { type: "coins", amount: 100 }, cardCount: 3, image: "📦", description: "Three players rated 60-69.", odds: { bronze: 1 } },
  { key: "gem50", name: "50 Gems Pick", cost: { type: "gems", amount: 50 }, image: "🎯", description: "Choose 1 of 3 players rated 70-75.", pick: { rounds: 1, optionsPerPick: 3, minRating: 70, maxRating: 75 } },
  { key: "gem100", name: "100 Gems Pick", cost: { type: "gems", amount: 100 }, image: "💎", description: "Choose 1 of 3 star players rated 73-75.", pick: { rounds: 1, optionsPerPick: 3, minRating: 73, maxRating: 75 } },
  { key: "gem1000", name: "1000 Coins Pick", cost: { type: "coins", amount: 1000 }, image: "👑", description: "Three picks — choose 1 of 3 players rated 70-75 each.", pick: { rounds: 3, optionsPerPick: 3, minRating: 70, maxRating: 75 } },
  { key: "star5000", name: "5000 Coins Star Pack", cost: { type: "coins", amount: 5000 }, cardCount: 1, image: "🌟", description: "One 77-80 rated star. Limited to 2 buys every 7 days.", ratings: { 77: 0.4, 78: 0.3, 79: 0.2, 80: 0.1 }, limit: { max: 2, days: 7 }, reveal: "walkout" },
  { key: "laliga50", name: "50 Gems La Liga Pack", cost: { type: "gems", amount: 50 }, cardCount: 1, image: "⚽", description: "One La Liga event player rated 75-85. Lower rated players are far more common — 83+ is a rare hit.", variant: "laliga", ratings: { 76: 0.21, 77: 0.18, 78: 0.16, 79: 0.14, 80: 0.12, 81: 0.1, 82: 0.05, 83: 0.02, 84: 0.01, 85: 0.01 } },
  { key: "laliga5000", name: "5000 Gems La Liga Pack", cost: { type: "gems", amount: 5000 }, cardCount: 1, image: "👑", description: "One guaranteed La Liga event player rated 83-85. Limited to 2 buys for the whole event.", variant: "laliga", ratings: { 83: 0.5, 84: 0.3, 85: 0.2 }, limit: { max: 2, days: 40 }, reveal: "walkout" },
];

const QUEST_SEEDS = [
  { key: "WIN_1", title: "Win a match", description: "Come out on top in a match.", type: "matches_won", requirement: 1, reward_coins: 300, reward_gems: 0, reward_pack: null, reset_daily: 1 },
  { key: "PLAY_3", title: "Play 3 matches", description: "Finish three matches, win or lose.", type: "matches_played", requirement: 3, reward_coins: 500, reward_gems: 0, reward_pack: null, reset_daily: 1 },
  { key: "OPEN_1", title: "Open a pack", description: "Open any pack once.", type: "packs_opened", requirement: 1, reward_coins: 0, reward_gems: 50, reward_pack: null, reset_daily: 1 },
  { key: "GOALS_5", title: "Score 5 goals", description: "Score five goals across matches.", type: "goals_scored", requirement: 5, reward_coins: 600, reward_gems: 0, reward_pack: null, reset_daily: 1 },
  { key: "WIN_5", title: "Win 5 matches", description: "Win five matches this week.", type: "matches_won", requirement: 5, reward_coins: 1500, reward_gems: 100, reward_pack: "gold", reset_daily: 0 },
  { key: "GOALS_15", title: "Score 15 goals", description: "Score fifteen goals this week.", type: "goals_scored", requirement: 15, reward_coins: 2000, reward_gems: 0, reward_pack: null, reset_daily: 0 },
];

// Event quests are claim-once per event season. Difficulty maps to a fixed
// reward so harder objectives pay more: easy 300 coins, medium 500 coins,
// hard 30 gems, epic 50 gems.
const EVENT_QUEST_SEEDS = [
  { key: "EV_WIN_1", title: "Win an event match", description: "Win any match during the event.", type: "matches_won", requirement: 1, reward_coins: 300, reward_gems: 0, difficulty: "easy" },
  { key: "EV_SCORE_3", title: "Score 3 goals", description: "Score three goals in event matches.", type: "goals_scored", requirement: 3, reward_coins: 300, reward_gems: 0, difficulty: "easy" },
  { key: "EV_PLAY_5", title: "Play 5 matches", description: "Finish five matches during the event.", type: "matches_played", requirement: 5, reward_coins: 300, reward_gems: 0, difficulty: "easy" },
  { key: "EV_WIN_3", title: "Win 3 matches", description: "Win three matches in the event window.", type: "matches_won", requirement: 3, reward_coins: 500, reward_gems: 0, difficulty: "medium" },
  { key: "EV_SCORE_10", title: "Score 10 goals", description: "Score ten goals during the event.", type: "goals_scored", requirement: 10, reward_coins: 500, reward_gems: 0, difficulty: "medium" },
  { key: "EV_OPEN_3", title: "Open 3 packs", description: "Open any three packs during the event.", type: "packs_opened", requirement: 3, reward_coins: 500, reward_gems: 0, difficulty: "medium" },
  { key: "EV_WIN_8", title: "Win 8 matches", description: "Win eight matches — a serious run.", type: "matches_won", requirement: 8, reward_coins: 0, reward_gems: 30, difficulty: "hard" },
  { key: "EV_SCORE_20", title: "Score 20 goals", description: "Score twenty goals in event matches.", type: "goals_scored", requirement: 20, reward_coins: 0, reward_gems: 30, difficulty: "hard" },
  { key: "EV_WIN_15", title: "Win 15 matches", description: "Win fifteen matches — an elite run.", type: "matches_won", requirement: 15, reward_coins: 0, reward_gems: 50, difficulty: "epic" },
  { key: "EV_SCORE_40", title: "Score 40 goals", description: "Score forty goals across the event.", type: "goals_scored", requirement: 40, reward_coins: 0, reward_gems: 50, difficulty: "epic" },
];

function todayBucket() { return new Date().toISOString().slice(0, 10); }

function weekBucket() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function bucketFor(resetDaily) { return resetDaily ? todayBucket() : weekBucket(); }

function seedQuests() {
  if (db.prepare("SELECT COUNT(*) AS c FROM quests").get().c > 0) return;
  const insert = db.prepare(`
    INSERT INTO quests (key, title, description, type, requirement, reward_coins, reward_gems, reward_pack, reset_daily)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const q of QUEST_SEEDS) {
    insert.run(q.key, q.title, q.description, q.type, q.requirement, q.reward_coins, q.reward_gems, q.reward_pack, q.reset_daily ? 1 : 0);
  }
}
seedQuests();
db.prepare("UPDATE quests SET reward_pack = 'gem100' WHERE key = 'WIN_5' AND reward_pack = 'gold'").run();

const EVENT_BUCKET = "event-s1";

function seedEventQuests() {
  if (db.prepare("SELECT COUNT(*) AS c FROM event_quests").get().c > 0) return;
  const insert = db.prepare(`
    INSERT INTO event_quests (key, title, description, type, requirement, reward_coins, reward_gems, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const q of EVENT_QUEST_SEEDS) {
    insert.run(q.key, q.title, q.description, q.type, q.requirement, q.reward_coins, q.reward_gems, q.difficulty);
  }
}
seedEventQuests();

function addCoins(userId, amount) { db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").run(amount, userId); }
function addGems(userId, amount) { db.prepare("UPDATE users SET gems = gems + ? WHERE id = ?").run(amount, userId); }

function addXp(userId, amount) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  let xp = user.xp + amount;
  let level = user.level;
  let bonusCoins = 0;
  while (xp >= level * 100) {
    xp -= level * 100;
    level += 1;
    bonusCoins += 100;
  }
  db.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").run(xp, level, userId);
  if (bonusCoins) addCoins(userId, bonusCoins);
  return { xp, level, leveledUp: bonusCoins > 0, bonusCoins };
}

function drawCards(pack, cardCount) {
  const pool = db.prepare("SELECT * FROM cards WHERE variant = ?").all(pack.variant || "");
  const odds = pack.odds;
  const ratings = pack.ratings;
  const selected = [];
  for (let i = 0; i < cardCount; i++) {
    let candidates = pool.filter((c) => !selected.includes(c.id));
    if (ratings) {
      let roll = Math.random();
      let rating = Object.keys(ratings)[0];
      for (const key of Object.keys(ratings)) {
        if (roll < ratings[key]) { rating = key; break; }
        roll -= ratings[key];
      }
      const rated = candidates.filter((c) => c.base_rating === Number(rating));
      if (rated.length) candidates = rated;
    } else if (odds) {
      let roll = Math.random();
      let tier = Object.keys(odds)[0];
      for (const key of Object.keys(odds)) {
        if (roll < odds[key]) { tier = key; break; }
        roll -= odds[key];
      }
      const [lo, hi] = TIER_RANGE[tier] || [0, 99];
      const tiered = candidates.filter((c) => c.base_rating >= lo && c.base_rating <= hi);
      if (tiered.length) candidates = tiered;
    }
    if (!candidates.length) break;
    selected.push(candidates[Math.floor(Math.random() * candidates.length)].id);
  }
  return pool.filter((c) => selected.includes(c.id));
}

const pendingPicks = new Map();

function packPurchasesInWindow(userId, packKey, days) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return Number(db.prepare("SELECT COUNT(*) AS c FROM pack_purchases WHERE user_id = ? AND pack_key = ? AND created_at >= ?").get(userId, packKey, cutoff).c);
}

function buildPickRounds(pool, pick) {
  const used = new Set();
  const rounds = [];
  for (let r = 0; r < pick.rounds; r++) {
    const candidates = pool.filter((c) => !used.has(c.id) && c.base_rating >= pick.minRating && c.base_rating <= pick.maxRating);
    const options = [];
    for (let i = 0; i < pick.optionsPerPick && candidates.length; i++) {
      options.push(candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0].id);
    }
    for (const id of options) used.add(id);
    rounds.push({ round: r + 1, options });
  }
  return rounds;
}

function prunePendingPicks() {
  if (pendingPicks.size <= 500) return;
  for (const key of pendingPicks.keys()) {
    pendingPicks.delete(key);
    if (pendingPicks.size <= 250) break;
  }
}

const WELCOME_CARDS = 15;
const WELCOME_COINS = 500;
const WELCOME_GEMS = 100;

function grantWelcomeGift(userId) {
  const pool = loadClubCatalog().filter((c) => c.rating >= 60 && c.rating <= 65);
  const gk = pool.filter((c) => c.category === "GK");
  const field = pool.filter((c) => c.category !== "GK");
  const gkCount = gk.length >= 2 && Math.random() < 0.5 ? 2 : 1;
  const chosen = [];
  const take = (arr, n) => {
    const bucket = [...arr];
    for (let i = 0; i < n && bucket.length; i++) {
      chosen.push(bucket.splice(Math.floor(Math.random() * bucket.length), 1)[0]);
    }
  };
  take(gk, Math.min(gkCount, gk.length));
  take(field, WELCOME_CARDS - chosen.length);

  const findCard = db.prepare("SELECT id FROM cards WHERE name = ? AND category = ? AND variant = ''");
  const insertCard = db.prepare(`
    INSERT INTO cards (name, season, club, nation, position, category, pace, shooting, passing, dribbling, defending, physicality, base_rating, tier, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOwned = db.prepare("INSERT INTO owned_cards (user_id, card_id, rating, xp, is_in_xi, slot, acquired_from) VALUES (?, ?, ?, 0, 0, NULL, ?)");
  const cards = [];
  for (const card of chosen) {
    const stats = buildCardStats(card);
    let row = findCard.get(card.name, card.category);
    let cardId;
    if (row) {
      cardId = row.id;
    } else {
      const result = insertCard.run(
        card.name || "Unknown",
        card.season || "",
        card.club || "",
        card.nation || "",
        card.category,
        card.category,
        stats.pace,
        stats.shooting,
        stats.passing,
        stats.dribbling,
        stats.defending,
        stats.physicality,
        stats.rating,
        stats.tier,
        card.image || null
      );
      cardId = result.lastInsertRowid;
    }
    insertOwned.run(userId, cardId, stats.rating, "welcome");
    cards.push({ id: `${card.category}-${card.id}`, name: card.name, nation: card.nation || "", position: card.role || card.category, category: card.category, rating: stats.rating, tier: stats.tier, image: card.image || null, ...stats });
  }
  addCoins(userId, WELCOME_COINS);
  addGems(userId, WELCOME_GEMS);

  return { cards, coins: WELCOME_COINS, gems: WELCOME_GEMS };
}

// 7-day login reward promo. Every account can claim 4000 coins + 500 gems
// once per day while the promo runs. The 7-day window is fixed from the first
// day it is enabled (stored in meta so server restarts don't extend it), the
// disclaimer counts down daily, and once the window closes the reward is gone
// for everyone.
const LOGIN_REWARD_DAYS = 7;
const LOGIN_REWARD_COINS = 4000;
const LOGIN_REWARD_GEMS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

function loginPromoInfo() {
  let start = db.prepare("SELECT value FROM meta WHERE key = 'login_reward_start'").get()?.value;
  if (!start) {
    start = todayBucket();
    db.prepare("INSERT INTO meta (key, value) VALUES ('login_reward_start', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(start);
  }
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = startMs + LOGIN_REWARD_DAYS * DAY_MS;
  const now = Date.now();
  if (now >= endMs) return { active: false, daysLeft: 0, endsAt: endMs };
  return { active: true, daysLeft: Math.ceil((endMs - now) / DAY_MS), endsAt: endMs };
}

function loginRewardStatus(userId) {
  const promo = loginPromoInfo();
  if (!promo.active) {
    return { available: false, claimedToday: false, daysLeft: 0, coins: LOGIN_REWARD_COINS, gems: LOGIN_REWARD_GEMS };
  }
  const user = db.prepare("SELECT last_login_reward FROM users WHERE id = ?").get(userId);
  const claimedToday = Boolean(user && user.last_login_reward === todayBucket());
  return { ...promo, available: !claimedToday, claimedToday, coins: LOGIN_REWARD_COINS, gems: LOGIN_REWARD_GEMS };
}

function claimLoginReward(userId) {
  const status = loginRewardStatus(userId);
  if (!status.available) {
    return { error: status.claimedToday ? "You already claimed today's login reward. Come back tomorrow." : "This login reward has ended." };
  }
  db.exec("BEGIN");
  try {
    addCoins(userId, LOGIN_REWARD_COINS);
    addGems(userId, LOGIN_REWARD_GEMS);
    db.prepare("UPDATE users SET last_login_reward = ? WHERE id = ?").run(todayBucket(), userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { error: "Could not claim your reward." };
  }
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return { reward: { coins: LOGIN_REWARD_COINS, gems: LOGIN_REWARD_GEMS }, user: publicUser(updated), loginReward: loginRewardStatus(userId) };
}

function openPack(userId, packKey, options = {}) {
  const free = Boolean(options.free);
  const pack = PACK_TYPES.find((p) => p.key === packKey);
  if (!pack) return { error: "Unknown pack." };
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { error: "Account not found." };

  if (pack.limit && !free) {
    const count = packPurchasesInWindow(userId, pack.key, pack.limit.days);
    if (count >= pack.limit.max) {
      return { error: `This pack can only be bought ${pack.limit.max} times every ${pack.limit.days} days.` };
    }
  }

  const owned = ownedCount(userId);
  const needed = pack.pick ? pack.pick.rounds : pack.cardCount;
  if (owned + needed > INVENTORY_LIMIT) {
    return { error: `Inventory full (${owned}/${INVENTORY_LIMIT}). Exchange players to make room.` };
  }

  let bonus = null;
  if (!free && pack.key === "daily") {
    if (user.last_claimed_daily === todayBucket()) return { error: "Daily pack already claimed today." };
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = user.last_claimed_daily === yesterday ? (user.streak || 0) + 1 : 1;
    bonus = { streak, coins: 50 + (streak - 1) * 25 };
    db.prepare("UPDATE users SET last_claimed_daily = ?, streak = ? WHERE id = ?").run(todayBucket(), streak, userId);
    if (bonus.coins) addCoins(userId, bonus.coins);
  } else if (!free && pack.cost.type === "coins") {
    if (user.coins < pack.cost.amount) return { error: "Not enough coins." };
    db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").run(pack.cost.amount, userId);
  } else if (!free && pack.cost.type === "gems") {
    if (user.gems < pack.cost.amount) return { error: "Not enough gems." };
    db.prepare("UPDATE users SET gems = gems - ? WHERE id = ?").run(pack.cost.amount, userId);
  }

  if (pack.limit && !free) {
    db.prepare("INSERT INTO pack_purchases (user_id, pack_key) VALUES (?, ?)").run(userId, pack.key);
  }

  let cards = [];
  let pick = null;
  if (pack.pick) {
    const pool = db.prepare("SELECT * FROM cards WHERE variant = ''").all();
    const rounds = buildPickRounds(pool, pack.pick);
    const pickId = randomUUID();
    pendingPicks.set(pickId, { userId, packKey, rounds });
    const byId = new Map(pool.map((c) => [c.id, c]));
    pick = { pickId, total: rounds.length, rounds: rounds.map((r) => ({ round: r.round, options: r.options.map((id) => byId.get(id)) })) };
  } else {
    cards = drawCards(pack, pack.cardCount);
    const insert = db.prepare("INSERT INTO owned_cards (user_id, card_id, rating, xp, is_in_xi, slot, acquired_from) VALUES (?, ?, ?, 0, 0, NULL, ?)");
    const drawnIds = [];
    for (const card of cards) {
      insert.run(userId, card.id, card.base_rating, pack.key);
      drawnIds.push(card.id);
    }
    db.prepare("INSERT INTO pack_logs (user_id, pack_key, card_ids) VALUES (?, ?, ?)").run(userId, pack.key, JSON.stringify(drawnIds));
  }
  bumpQuest(userId, "packs_opened", 1);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return { pack: { key: pack.key, name: pack.name, reveal: pack.reveal || null }, cards, pick, bonus, user: publicUser(updated) };
}

function confirmPackPick(userId, pickId, selections) {
  const entry = pendingPicks.get(pickId);
  if (!entry || entry.userId !== userId) return { error: "Pick session not found or expired." };
  const pack = PACK_TYPES.find((p) => p.key === entry.packKey);
  if (!pack || !pack.pick) return { error: "Unknown pack." };
  if (!Array.isArray(selections) || selections.length !== entry.rounds.length) {
    return { error: `Pick exactly ${entry.rounds.length} player${entry.rounds.length > 1 ? "s" : ""}.` };
  }
  const pool = db.prepare("SELECT * FROM cards WHERE variant = ''").all();
  const byId = new Map(pool.map((c) => [c.id, c]));
  const picked = [];
  for (let i = 0; i < entry.rounds.length; i++) {
    const cardId = Number(selections[i]);
    if (!entry.rounds[i].options.includes(cardId)) return { error: `Pick ${i + 1} is invalid.` };
    const card = byId.get(cardId);
    if (!card) return { error: "Invalid player." };
    picked.push(card);
  }
  const insert = db.prepare("INSERT INTO owned_cards (user_id, card_id, rating, xp, is_in_xi, slot, acquired_from) VALUES (?, ?, ?, 0, 0, NULL, ?)");
  const drawnIds = [];
  for (const card of picked) {
    insert.run(userId, card.id, card.base_rating, pack.key);
    drawnIds.push(card.id);
  }
  db.prepare("INSERT INTO pack_logs (user_id, pack_key, card_ids) VALUES (?, ?, ?)").run(userId, pack.key, JSON.stringify(drawnIds));
  pendingPicks.delete(pickId);
  prunePendingPicks();
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return { pack: { key: pack.key, name: pack.name }, cards: picked, user: publicUser(updated) };
}

function bumpQuest(userId, type, amount) {
  const quests = db.prepare("SELECT * FROM quests WHERE type = ?").all(type);
  for (const q of quests) {
    const bucket = bucketFor(q.reset_daily);
    const row = db.prepare("SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?").get(userId, q.id);
    if (!row) {
      db.prepare("INSERT INTO quest_progress (user_id, quest_id, progress, claimed_at, bucket) VALUES (?, ?, ?, NULL, ?)").run(userId, q.id, Math.min(amount, q.requirement), bucket);
    } else if (row.bucket !== bucket) {
      db.prepare("UPDATE quest_progress SET progress = ?, claimed_at = NULL, bucket = ? WHERE id = ?").run(Math.min(amount, q.requirement), bucket, row.id);
    } else if (!row.claimed_at) {
      db.prepare("UPDATE quest_progress SET progress = ? WHERE id = ?").run(Math.min(row.progress + amount, q.requirement), row.id);
    }
  }

  const eventQuests = db.prepare("SELECT * FROM event_quests WHERE type = ?").all(type);
  for (const q of eventQuests) {
    const row = db.prepare("SELECT * FROM event_quest_progress WHERE user_id = ? AND quest_id = ?").get(userId, q.id);
    if (!row) {
      db.prepare("INSERT INTO event_quest_progress (user_id, quest_id, progress, claimed_at, bucket) VALUES (?, ?, ?, NULL, ?)").run(userId, q.id, Math.min(amount, q.requirement), EVENT_BUCKET);
    } else if (row.bucket !== EVENT_BUCKET) {
      db.prepare("UPDATE event_quest_progress SET progress = ?, claimed_at = NULL, bucket = ? WHERE id = ?").run(Math.min(amount, q.requirement), EVENT_BUCKET, row.id);
    } else if (!row.claimed_at) {
      db.prepare("UPDATE event_quest_progress SET progress = ? WHERE id = ?").run(Math.min(row.progress + amount, q.requirement), row.id);
    }
  }
}

function questsFor(userId) {
  return db.prepare("SELECT * FROM quests ORDER BY reset_daily DESC, id ASC").all().map((q) => {
    const bucket = bucketFor(q.reset_daily);
    const row = db.prepare("SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?").get(userId, q.id);
    const stale = Boolean(row && row.bucket !== bucket);
    const progress = stale ? 0 : (row?.progress || 0);
    const claimed = Boolean(row && !stale && row.claimed_at);
    return { ...q, progress, claimable: !claimed && progress >= q.requirement, claimed };
  });
}

function claimQuest(userId, questId) {
  const q = db.prepare("SELECT * FROM quests WHERE id = ?").get(questId);
  if (!q) return { error: "Quest not found." };
  const bucket = bucketFor(q.reset_daily);
  const row = db.prepare("SELECT * FROM quest_progress WHERE user_id = ? AND quest_id = ?").get(userId, questId);
  const fresh = Boolean(row && row.bucket === bucket);
  const progress = fresh ? row.progress : 0;
  if (progress < q.requirement) return { error: "Quest not complete yet." };
  if (fresh && row.claimed_at) return { error: "Reward already claimed." };

  if (q.reward_pack) {
    const packResult = openPack(userId, q.reward_pack, { free: true });
    if (packResult.error) return { error: packResult.error };
    if (packResult.pick) {
      const best = packResult.pick.rounds.map((round) => {
        const options = round.options || [];
        return [...options].sort((a, b) => b.base_rating - a.base_rating || a.name.localeCompare(b.name))[0];
      });
      if (best.some((card) => !card)) return { error: "Could not grant the quest pack." };
      const confirm = confirmPackPick(userId, packResult.pick.pickId, best.map((card) => card.id));
      if (confirm.error) return { error: confirm.error };
    }
  }
  if (q.reward_coins) addCoins(userId, q.reward_coins);
  if (q.reward_gems) addGems(userId, q.reward_gems);

  if (fresh) db.prepare("UPDATE quest_progress SET claimed_at = datetime('now') WHERE id = ?").run(row.id);
  else db.prepare("INSERT INTO quest_progress (user_id, quest_id, progress, claimed_at, bucket) VALUES (?, ?, ?, datetime('now'), ?)").run(userId, questId, q.requirement, bucket);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return { questId, reward: { coins: q.reward_coins, gems: q.reward_gems, pack: q.reward_pack }, user: publicUser(updated) };
}

function eventQuestsFor(userId) {
  return db.prepare("SELECT * FROM event_quests ORDER BY id ASC").all().map((q) => {
    const row = db.prepare("SELECT * FROM event_quest_progress WHERE user_id = ? AND quest_id = ?").get(userId, q.id);
    const stale = Boolean(row && row.bucket !== EVENT_BUCKET);
    const progress = stale ? 0 : (row?.progress || 0);
    const claimed = Boolean(row && !stale && row.claimed_at);
    return { ...q, progress, claimable: !claimed && progress >= q.requirement, claimed };
  });
}

function claimEventQuest(userId, questId) {
  const q = db.prepare("SELECT * FROM event_quests WHERE id = ?").get(questId);
  if (!q) return { error: "Event quest not found." };
  const row = db.prepare("SELECT * FROM event_quest_progress WHERE user_id = ? AND quest_id = ?").get(userId, questId);
  const fresh = Boolean(row && row.bucket === EVENT_BUCKET);
  const progress = fresh ? row.progress : 0;
  if (progress < q.requirement) return { error: "Event quest not complete yet." };
  if (fresh && row.claimed_at) return { error: "Reward already claimed." };

  if (q.reward_coins) addCoins(userId, q.reward_coins);
  if (q.reward_gems) addGems(userId, q.reward_gems);

  if (fresh) db.prepare("UPDATE event_quest_progress SET claimed_at = datetime('now') WHERE id = ?").run(row.id);
  else db.prepare("INSERT INTO event_quest_progress (user_id, quest_id, progress, claimed_at, bucket) VALUES (?, ?, ?, datetime('now'), ?)").run(userId, questId, q.requirement, EVENT_BUCKET);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return { questId, reward: { coins: q.reward_coins, gems: q.reward_gems }, user: publicUser(updated) };
}

const OUTCOME_RATES = { win: { coins: 300, xp: 40 }, loss: { coins: 120, xp: 20 }, draw: { coins: 200, xp: 30 } };

function recordMatchStats(userId, outcome, goals, saves) {
  if (!userId) return;
  db.prepare(`
    INSERT INTO user_stats (user_id, wins, goals, saves)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      wins = user_stats.wins + excluded.wins,
      goals = user_stats.goals + excluded.goals,
      saves = user_stats.saves + excluded.saves
  `).run(userId, outcome === "win" ? 1 : 0, goals, saves);
}

function resolveMatchRewards(room) {
  const [a, b] = room.players;
  const sa = room.scoreA, sb = room.scoreB;
  let aOutcome, bOutcome;
  if (sa > sb) { aOutcome = "win"; bOutcome = "loss"; }
  else if (sb > sa) { aOutcome = "loss"; bOutcome = "win"; }
  else {
    const kicksA = room.shootout ? (room.shootout.kicks[a.id] || []).filter(Boolean).length : 0;
    const kicksB = room.shootout ? (room.shootout.kicks[b.id] || []).filter(Boolean).length : 0;
    aOutcome = kicksA > kicksB ? "win" : kicksA < kicksB ? "loss" : "draw";
    bOutcome = kicksA < kicksB ? "win" : kicksA > kicksB ? "loss" : "draw";
  }

  const rewards = {};
  const grant = (player, outcome) => {
    if (!player.userId) return;
    const rate = OUTCOME_RATES[outcome];
    const xp = addXp(player.userId, rate.xp);
    addCoins(player.userId, rate.coins);
    bumpQuest(player.userId, "matches_played", 1);
    if (outcome === "win") bumpQuest(player.userId, "matches_won", 1);
    const goals = room.stats?.[player.id]?.goals?.length || 0;
    if (goals) bumpQuest(player.userId, "goals_scored", goals);
    const saves = room.stats?.[player.id]?.saves || 0;
    recordMatchStats(player.userId, outcome, goals, saves);
    rewards[player.userId] = { outcome, coins: rate.coins, xp: rate.xp, goals, saves, leveledUp: xp.leveledUp, bonusCoins: xp.bonusCoins };
  };
  grant(a, aOutcome);
  grant(b, bOutcome);
  return rewards;
}

module.exports = { PACK_TYPES, openPack, confirmPackPick, questsFor, claimQuest, bumpQuest, resolveMatchRewards, grantWelcomeGift, todayBucket, ownedCount, exchangeForGuaranteed, exchangeForPurple, PURPLE_REQUIREMENTS, PURPLE_REWARD_RANGE, eventQuestsFor, claimEventQuest, INVENTORY_LIMIT, INVENTORY_WARN_AT, loginRewardStatus, claimLoginReward, LOGIN_REWARD_DAYS, LOGIN_REWARD_COINS, LOGIN_REWARD_GEMS, packPurchasesInWindow, TOKEN_RATES, TOKEN_REWARD_COST, TOKEN_REWARD_RANGE, exchangeForTokens, redeemTokenReward };
