const path = require("path");
const { Worker } = require("worker_threads");
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

// Synchronous Postgres bridge over a single worker thread. The worker holds
// one persistent pg Pool; the main thread parks on Atomics.wait while it runs.
// This keeps the whole codebase's synchronous db.prepare(...) API intact
// without spawning a new child process (and new pool + SSL handshake) per query.
const PG_BUFFER_BYTES = 8 * 1024 * 1024;
const PG_DATA_OFFSET = 16; // ints: [0]=reqReady, [1]=respReady, [2]=queryLen, [3]=resultLen
let pgInts = null;
let pgBytes = null;
let pgWorker = null;
let pgRequestId = 0;

function ensurePgWorker() {
  if (pgWorker) return;
  const sab = new SharedArrayBuffer(PG_BUFFER_BYTES);
  pgInts = new Int32Array(sab, 0, 4);
  pgBytes = new Uint8Array(sab);
  pgWorker = new Worker(path.join(__dirname, "pg-worker.js"), { workerData: { sab }, env: process.env });
  pgWorker.unref();
  pgWorker.on("error", (err) => console.error("[pg-worker] error:", err.message));
  pgWorker.on("exit", (code) => console.error(`[pg-worker] exited with code ${code}`));
}

function executePg(sql, params = [], returning = false) {
  ensurePgWorker();
  const query = JSON.stringify({ sql: pgSql(sql, params, returning), params });
  const qBuf = Buffer.from(query, "utf8");
  if (qBuf.length > PG_BUFFER_BYTES - PG_DATA_OFFSET) throw new Error("Query exceeds buffer size");
  pgBytes.set(qBuf, PG_DATA_OFFSET);
  Atomics.store(pgInts, 2, qBuf.length);
  Atomics.store(pgInts, 3, 0);
  // Signal a new request is ready.
  Atomics.store(pgInts, 0, 1);
  Atomics.notify(pgInts, 0);
  // Wait for the worker to ACK (so it has read the request bytes).
  while (Atomics.load(pgInts, 0) !== 0) Atomics.wait(pgInts, 0, 1, 30000);
  // Wait for the response to be ready.
  while (Atomics.load(pgInts, 1) !== 1) Atomics.wait(pgInts, 1, 0, 30000);
  const rlen = Atomics.load(pgInts, 3);
  const resultBuf = Buffer.from(pgBytes.subarray(PG_DATA_OFFSET + qBuf.length, PG_DATA_OFFSET + qBuf.length + rlen)).toString("utf8");
  const result = JSON.parse(resultBuf || '{"error":"The database did not return a response."}');
  // Consume the response so the worker can accept the next request.
  Atomics.store(pgInts, 1, 0);
  Atomics.notify(pgInts, 1);
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
const SCHEMA_VERSION = 7;

function migratePostgres() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, last_claimed_daily TEXT, streak INTEGER NOT NULL DEFAULT 0, last_login_reward TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cards (id SERIAL PRIMARY KEY, name TEXT NOT NULL, season TEXT NOT NULL DEFAULT '', club TEXT NOT NULL DEFAULT '', nation TEXT NOT NULL DEFAULT '', position TEXT NOT NULL, category TEXT NOT NULL, pace INTEGER NOT NULL DEFAULT 70, shooting INTEGER NOT NULL DEFAULT 70, passing INTEGER NOT NULL DEFAULT 70, dribbling INTEGER NOT NULL DEFAULT 70, defending INTEGER NOT NULL DEFAULT 70, physicality INTEGER NOT NULL DEFAULT 70, base_rating INTEGER NOT NULL DEFAULT 70, tier TEXT NOT NULL DEFAULT 'base', image TEXT);
    CREATE TABLE IF NOT EXISTS owned_cards (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, rating INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, is_in_xi INTEGER NOT NULL DEFAULT 0, slot TEXT, acquired_from TEXT, version TEXT NOT NULL DEFAULT 'base', acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS pack_logs (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_key TEXT NOT NULL, card_ids TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS quests (id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, requirement INTEGER NOT NULL, reward_coins INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0, reward_pack TEXT, reset_daily INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS quest_progress (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at TIMESTAMPTZ, bucket TEXT, UNIQUE(user_id, quest_id));
    CREATE TABLE IF NOT EXISTS event_quests (id SERIAL PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, requirement INTEGER NOT NULL, reward_coins INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0, difficulty TEXT NOT NULL DEFAULT 'easy');
    CREATE TABLE IF NOT EXISTS event_quest_progress (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at TIMESTAMPTZ, bucket TEXT, UNIQUE(user_id, quest_id));
    CREATE TABLE IF NOT EXISTS user_stats (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, wins INTEGER NOT NULL DEFAULT 0, goals INTEGER NOT NULL DEFAULT 0, saves INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pack_purchases (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_owned_user ON owned_cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
    CREATE INDEX IF NOT EXISTS idx_pack_purchases_user ON pack_purchases(user_id);
  `);
  db.prepare("ALTER TABLE owned_cards ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT 'base'").run();
  db.prepare("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_reward TEXT").run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
}

function migrateSqlite() {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, last_claimed_daily TEXT, streak INTEGER NOT NULL DEFAULT 0, last_login_reward TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, season TEXT NOT NULL DEFAULT '', club TEXT NOT NULL DEFAULT '', nation TEXT NOT NULL DEFAULT '', position TEXT NOT NULL, category TEXT NOT NULL, pace INTEGER NOT NULL DEFAULT 70, shooting INTEGER NOT NULL DEFAULT 70, passing INTEGER NOT NULL DEFAULT 70, dribbling INTEGER NOT NULL DEFAULT 70, defending INTEGER NOT NULL DEFAULT 70, physicality INTEGER NOT NULL DEFAULT 70, base_rating INTEGER NOT NULL DEFAULT 70, tier TEXT NOT NULL DEFAULT 'base', image TEXT); CREATE TABLE IF NOT EXISTS owned_cards (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, rating INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, is_in_xi INTEGER NOT NULL DEFAULT 0, slot TEXT, acquired_from TEXT, version TEXT NOT NULL DEFAULT 'base', acquired_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS pack_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_key TEXT NOT NULL, card_ids TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS user_stats (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, wins INTEGER NOT NULL DEFAULT 0, goals INTEGER NOT NULL DEFAULT 0, saves INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS quests (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, requirement INTEGER NOT NULL, reward_coins INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0, reward_pack TEXT, reset_daily INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS quest_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, bucket TEXT, UNIQUE(user_id, quest_id)); CREATE TABLE IF NOT EXISTS event_quests (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, requirement INTEGER NOT NULL, reward_coins INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0, difficulty TEXT NOT NULL DEFAULT 'easy'); CREATE TABLE IF NOT EXISTS event_quest_progress (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, claimed_at TEXT, bucket TEXT, UNIQUE(user_id, quest_id)); CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pack_purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
}

function migrate() { if (usingPostgres) return migratePostgres(); migrateSqlite(); }
migrate();
console.log(`[db] using ${usingPostgres ? `PostgreSQL (${new URL(DATABASE_URL).host})` : "SQLite"}`);

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
  if (version < 6) {
    const cols = db.prepare("PRAGMA table_info(owned_cards)").all().map((c) => c.name);
    if (!cols.includes("version")) db.exec("ALTER TABLE owned_cards ADD COLUMN version TEXT NOT NULL DEFAULT 'base'");
  }
  if (version < 7) {
    const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    if (!cols.includes("last_login_reward")) db.exec("ALTER TABLE users ADD COLUMN last_login_reward TEXT");
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SCHEMA_VERSION);
}
upgrade();
function close() { try { db.close(); } catch {} }
module.exports = { db, migrate, close, usingPostgres };
