const crypto = require("crypto");
const { promisify } = require("util");
const { db } = require("./db");

const scrypt = promisify(crypto.scrypt);
const TOKEN_BYTES = 32;
const SESSION_DAYS = 30;
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored || "").split(":");
    if (!salt || !hash) return false;
    const candidate = await scrypt(String(password), salt, KEY_LENGTH);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    coins: row.coins,
    gems: row.gems,
    xp: row.xp,
    level: row.level,
    streak: row.streak,
    last_claimed_daily: row.last_claimed_daily || null,
    created_at: row.created_at,
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(userId, tokenHash, expiresAt);
  return token;
}

function userByToken(token) {
  if (!token || typeof token !== "string") return null;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    return null;
  }
  return db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id) || null;
}

function deleteSession(token) {
  if (!token || typeof token !== "string") return;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

module.exports = { hashPassword, verifyPassword, publicUser, createSession, userByToken, deleteSession };
