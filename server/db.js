const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { tierForRating, applyTier, computeOVR } = require("./ovr");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "footyverse.db");

const db = new DatabaseSync(DB_PATH);

const SCHEMA_VERSION = 5;

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      coins INTEGER NOT NULL DEFAULT 0,
      gems INTEGER NOT NULL DEFAULT 0,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      last_claimed_daily TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      season TEXT NOT NULL DEFAULT '',
      club TEXT NOT NULL DEFAULT '',
      nation TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL,
      category TEXT NOT NULL,
      pace INTEGER NOT NULL DEFAULT 70,
      shooting INTEGER NOT NULL DEFAULT 70,
      passing INTEGER NOT NULL DEFAULT 70,
      dribbling INTEGER NOT NULL DEFAULT 70,
      defending INTEGER NOT NULL DEFAULT 70,
      physicality INTEGER NOT NULL DEFAULT 70,
      base_rating INTEGER NOT NULL DEFAULT 70,
      tier TEXT NOT NULL DEFAULT 'base',
      image TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);

    CREATE TABLE IF NOT EXISTS owned_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      is_in_xi INTEGER NOT NULL DEFAULT 0,
      slot TEXT,
      acquired_from TEXT,
      acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_owned_user ON owned_cards(user_id);

    CREATE TABLE IF NOT EXISTS pack_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pack_key TEXT NOT NULL,
      card_ids TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pack_logs_user ON pack_logs(user_id);

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      requirement INTEGER NOT NULL,
      reward_coins INTEGER NOT NULL DEFAULT 0,
      reward_gems INTEGER NOT NULL DEFAULT 0,
      reward_pack TEXT,
      reset_daily INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quest_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      quest_id INTEGER NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      claimed_at TEXT,
      bucket TEXT,
      UNIQUE(user_id, quest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_quest_progress_user ON quest_progress(user_id);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

migrate();

// Upgrade existing databases in place. v2 moves cards to the Phase 3 model:
// tiered cards with stat-driven OVR (base_rating recomputed from the six stats).
// v3 is the season reset: the card catalog is rebalanced to a 60-75 OVR scale
// (icons top out at 75, bronze/silver bulk sits at 60-69). Old-scale cards are
// wiped and reseeded from the new JSON. User accounts survive; owned cards are
// dropped because their ratings no longer match the rescaled catalog.
// v4 re-wipes the card tables: any DB seeded before the club rosters existed
// still holds the legacy 96-99 pool (seed skips when cards are present), which
// silently breaks the welcome gift (no 60-65 cards to draw) and pack odds.
function upgrade() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  const version = Number(row?.value || 0);
  if (version >= SCHEMA_VERSION) return;

  if (version < 2) {
    const cards = db.prepare("SELECT * FROM cards").all();
    const update = db.prepare("UPDATE cards SET pace = ?, shooting = ?, passing = ?, dribbling = ?, defending = ?, physicality = ?, base_rating = ?, tier = ? WHERE id = ?");
    for (const card of cards) {
      const tier = tierForRating(card.base_rating);
      const stats = applyTier({ pace:card.pace, shooting:card.shooting, passing:card.passing, dribbling:card.dribbling, defending:card.defending, physicality:card.physicality }, tier);
      update.run(stats.pace, stats.shooting, stats.passing, stats.dribbling, stats.defending, stats.physicality, computeOVR(stats, card.category), tier, card.id);
    }
  }

  if (version < 4) {
    // Card-related tables are wiped; the seed module (loaded at boot by
    // server.js after this module is fully initialised) reseeds the new
    // 60-75 catalogue.
    db.exec("DELETE FROM pack_logs; DELETE FROM owned_cards; DELETE FROM cards; DELETE FROM sqlite_sequence WHERE name IN ('cards', 'owned_cards', 'pack_logs');");
  }

  if (version < 5) {
    // v5 adds the player's nation so the client can render country flags on
    // every card. Additive column: existing rows get '' and seed.js backfills
    // them from the club JSON at boot.
    const cols = db.prepare("PRAGMA table_info(cards)").all();
    if (!cols.some((c) => c.name === "nation")) {
      db.exec("ALTER TABLE cards ADD COLUMN nation TEXT NOT NULL DEFAULT ''");
    }
  }

  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
}

upgrade();

function close() {
  try { db.close(); } catch { /* already closed */ }
}

module.exports = { db, migrate, close };
