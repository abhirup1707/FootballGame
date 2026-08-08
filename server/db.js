const path = require("path");
const { spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const { tierForRating, applyTier, computeOVR } = require("./ovr");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "footyverse.db");
const DATABASE_URL = process.env.DATABASE_URL;
const usingPostgres = Boolean(DATABASE_URL);

function pgSql(sql, params, returning) {
  let index = 0;
  let converted = sql.replace(/\?/g, () => `$${++index}`)
    .replace(/datetime\('now'\)/g, "CURRENT_TIMESTAMP")
    .replace(/;\s*DELETE FROM sqlite_sequence[^;]*;?/gi, ";");
  if (returning && /^\s*INSERT\s+INTO\s+(?!meta\b)/i.test(converted) && !/\bRETURNING\b/i.test(converted)) converted += " RETURNING id";
  return converted;
}

function executePg(sql, params = [], returning = false) {
  const query = JSON.stringify({ sql: pgSql(sql, params, returning), params });
  const child = spawnSync(process.execPath, [path.join(__dirname, "postgres-query.js"), query], { env:process.env, encoding:"utf8", timeout:20000 });
  if (child.error) throw child.error;
  const result = JSON.parse(child.stdout || '{"error":"The database did not return a response."}');
  if (result.error) throw new Error(result.error);
  return result;
}

function postgresDb() {
  return {
    prepare(sql) {
      return {
        get: (...params) => executePg(sql, params).rows[0],
        all: (...params) => executePg(sql, params).rows,
        run: (...params) => {
          const result = executePg(sql, params, true);
          return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
        },
      };
    },
    exec: (sql) => { if (!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) executePg(sql); },
    close: () => {},
  };
}

const db = usingPostgres ? postgresDb() : new DatabaseSync(DB_PATH);
const SCHEMA_VERSION = 5;

function migratePostgres() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, last_claimed_daily TEXT, streak INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cards (id SERIAL PRIMARY KEY, name TEXT NOT NULL, season TEXT NOT NULL DEFAULT '', club TEXT NOT NULL DEFAULT '', nation TEXT NOT NULL DEFAULT '', position TEXT NOT NULL, category TEXT NOT NULL, pace INTEGER NOT NULL DEFAULT 70, shooting INTEGER NOT NULL DEFAULT 70, passing INTEGER NOT NULL DEFAULT 70, dribbling INTEGER NOT NULL DEFAULT 70, defending INTEGER NOT NULL DEFAULT 70, physicality INTEGER NOT NULL DEFAULT 70, base_rating INTEGER NOT NULL DEFAULT 70, tier TEXT NOT NULL DEFAULT 'base', image TEXT);
    CREATE TABLE IF NOT EXISTS owned_cards (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, rating INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, is_in_xi INTEGER NOT NULL DEFAULT 0, slot TEXT, acquired_from TEXT, acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS pack_logs (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_key TEXT NOT NULL, card_ids TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS quests (id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, requirement INTEGER NOT NULL, reward_coins INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0, reward_pack TEXT, reset_daily INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS quest_progress (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at TIMESTAMPTZ, bucket TEXT, UNIQUE(user_id, quest_id));
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_owned_user ON owned_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
  `);
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
}

function migrateSqlite() {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, last_claimed_daily TEXT, streak INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, season TEXT NOT NULL DEFAULT '', club TEXT NOT NULL DEFAULT '', nation TEXT NOT NULL DEFAULT '', position TEXT NOT NULL, category TEXT NOT NULL, pace INTEGER NOT NULL DEFAULT 70, shooting INTEGER NOT NULL DEFAULT 70, passing INTEGER NOT NULL DEFAULT 70, dribbling INTEGER NOT NULL DEFAULT 70, defending INTEGER NOT NULL DEFAULT 70, physicality INTEGER NOT NULL DEFAULT 70, base_rating INTEGER NOT NULL DEFAULT 70, tier TEXT NOT NULL DEFAULT 'base', image TEXT); CREATE TABLE IF NOT EXISTS owned_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, rating INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, is_in_xi INTEGER NOT NULL DEFAULT 0, slot TEXT, acquired_from TEXT, acquired_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS pack_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_key TEXT NOT NULL, card_ids TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS quests (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, requirement INTEGER NOT NULL, reward_coins INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0, reward_pack TEXT, reset_daily INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS quest_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, bucket TEXT, UNIQUE(user_id, quest_id)); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
}

function migrate() { if (usingPostgres) return migratePostgres(); migrateSqlite(); }
migrate();

function upgrade() {
  if (usingPostgres) return;
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  const version = Number(row?.value || 0);
  if (version >= SCHEMA_VERSION) return;
  if (version < 2) {
    const cards = db.prepare("SELECT * FROM cards").all();
    const update = db.prepare("UPDATE cards SET pace = ?, shooting = ?, passing = ?, dribbling = ?, defending = ?, physicality = ?, base_rating = ?, tier = ? WHERE id = ?");
    for (const card of cards) { const tier = tierForRating(card.base_rating); const stats = applyTier({ pace:card.pace, shooting:card.shooting, passing:card.passing, dribbling:card.dribbling, defending:card.defending, physicality:card.physicality }, tier); update.run(stats.pace, stats.shooting, stats.passing, stats.dribbling, stats.defending, stats.physicality, computeOVR(stats, card.category), tier, card.id); }
  }
  if (version < 4) db.exec("DELETE FROM pack_logs; DELETE FROM owned_cards; DELETE FROM cards; DELETE FROM sqlite_sequence WHERE name IN ('cards', 'owned_cards', 'pack_logs');");
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
}
upgrade();
function close() { try { db.close(); } catch {} }
module.exports = { db, migrate, close, usingPostgres };
