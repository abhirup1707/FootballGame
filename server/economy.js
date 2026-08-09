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

const INVENTORY_LIMIT = 50;
const INVENTORY_WARN_AT = 35;
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

  const pool = db.prepare("SELECT * FROM cards WHERE base_rating >= ?").all(EXCHANGE_REWARD_MIN_RATING);
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
  { label: "5 × 70-74 rated", min: 70, max: 74, count: 5 },
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

  const pool = db.prepare("SELECT * FROM cards WHERE base_rating BETWEEN ? AND ?").all(PURPLE_REWARD_RANGE.min, PURPLE_REWARD_RANGE.max);
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

const PACK_TYPES = [
  { key: "daily", name: "Daily Free Pack", cost: { type: "free" }, cardCount: 3, image: "🎁", description: "Free every day. Streak bonus inside.", odds: { bronze: 0.8, silver: 0.2 } },
  { key: "basic", name: "100 Coins Pack", cost: { type: "coins", amount: 100 }, cardCount: 3, image: "📦", description: "Three players from the pool.", odds: { bronze: 0.67, silver: 0.33 } },
  { key: "gem50", name: "50 Gems Pick", cost: { type: "gems", amount: 50 }, image: "🎯", description: "Choose 1 of 3 players rated 70-75.", pick: { rounds: 1, optionsPerPick: 3, minRating: 70, maxRating: 75 } },
  { key: "gem100", name: "100 Gems Pick", cost: { type: "gems", amount: 100 }, image: "💎", description: "Choose 1 of 3 star players rated 73-75.", pick: { rounds: 1, optionsPerPick: 3, minRating: 73, maxRating: 75 } },
  { key: "gem1000", name: "1000 Coins Pick", cost: { type: "coins", amount: 1000 }, image: "👑", description: "Three picks — choose 1 of 3 players rated 70-75 each.", pick: { rounds: 3, optionsPerPick: 3, minRating: 70, maxRating: 75 } },
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
  const pool = db.prepare("SELECT * FROM cards").all();
  const odds = pack.odds;
  const selected = [];
  for (let i = 0; i < cardCount; i++) {
    let candidates = pool.filter((c) => !selected.includes(c.id));
    if (odds) {
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

  const findCard = db.prepare("SELECT id FROM cards WHERE name = ? AND category = ?");
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

function openPack(userId, packKey, options = {}) {
  const free = Boolean(options.free);
  const pack = PACK_TYPES.find((p) => p.key === packKey);
  if (!pack) return { error: "Unknown pack." };
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { error: "Account not found." };

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

  let cards = [];
  let pick = null;
  if (pack.pick) {
    const pool = db.prepare("SELECT * FROM cards").all();
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
  return { pack: { key: pack.key, name: pack.name }, cards, pick, bonus, user: publicUser(updated) };
}

function confirmPackPick(userId, pickId, selections) {
  const entry = pendingPicks.get(pickId);
  if (!entry || entry.userId !== userId) return { error: "Pick session not found or expired." };
  const pack = PACK_TYPES.find((p) => p.key === entry.packKey);
  if (!pack || !pack.pick) return { error: "Unknown pack." };
  if (!Array.isArray(selections) || selections.length !== entry.rounds.length) {
    return { error: `Pick exactly ${entry.rounds.length} player${entry.rounds.length > 1 ? "s" : ""}.` };
  }
  const pool = db.prepare("SELECT * FROM cards").all();
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

module.exports = { PACK_TYPES, openPack, confirmPackPick, questsFor, claimQuest, bumpQuest, resolveMatchRewards, grantWelcomeGift, todayBucket, ownedCount, exchangeForGuaranteed, exchangeForPurple, PURPLE_REQUIREMENTS, PURPLE_REWARD_RANGE, eventQuestsFor, claimEventQuest, INVENTORY_LIMIT, INVENTORY_WARN_AT };
