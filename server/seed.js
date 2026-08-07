const fs = require("fs");
const path = require("path");
const { db } = require("./db");
const { buildCardStats } = require("./ovr");

const CATEGORY_FILES = {
  ATT: "attackers.json",
  MID: "midfielders.json",
  DEF: "defenders.json",
  GK: "goalkeepers.json",
};

function readList(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

// Own-team cards live in src/data/club/. A category falls back to the legacy
// src/data/*.json pool until its real roster is delivered, so the game stays
// fully playable while the catalog is built up category by category.
function loadCatalog() {
  const clubDir = path.join(__dirname, "..", "src", "data", "club");
  const baseDir = path.join(__dirname, "..", "src", "data");
  const cards = [];
  for (const [category, file] of Object.entries(CATEGORY_FILES)) {
    let list = readList(path.join(clubDir, file));
    let source = `club/${file}`;
    if (!Array.isArray(list) || list.length === 0) {
      list = readList(path.join(baseDir, file));
      source = file;
    }
    if (!Array.isArray(list) || list.length === 0) continue;
    console.log(`seed: ${category} <- ${source} (${list.length} cards)`);
    for (const card of list) cards.push({ ...card, category });
  }
  return cards;
}

function seed(catalog) {
  if (catalog.length === 0) return { seeded: false, cards: 0 };
  const existing = db.prepare("SELECT COUNT(*) AS count FROM cards").get().count;
  // The club JSON is the single source of truth. Whenever the catalog size
  // differs from what the DB holds (stale legacy pool, partial seed, old
  // season), wipe and reseed so the game always plays off the club rosters.
  if (existing === catalog.length) return { seeded: false, cards: existing };
  db.exec("DELETE FROM pack_logs; DELETE FROM owned_cards; DELETE FROM cards; DELETE FROM sqlite_sequence WHERE name IN ('cards', 'owned_cards', 'pack_logs');");

  const insert = db.prepare(`
    INSERT INTO cards (name, season, club, nation, position, category, pace, shooting, passing, dribbling, defending, physicality, base_rating, tier, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  for (const card of catalog) {
    const stats = buildCardStats(card);
    insert.run(
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
    count += 1;
  }
  return { seeded: true, cards: count };
}

// Additive sync: count-matched DBs skip the reseed above, so rows seeded
// before the nation column existed stay blank. Backfill nation by matching
// name + category against the club JSON whenever any card is missing it.
function syncNations(catalog) {
  if (!catalog.length) return 0;
  const missing = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE nation = '' OR nation IS NULL").get().c;
  if (missing === 0) return 0;
  const upd = db.prepare("UPDATE cards SET nation = ? WHERE name = ? AND category = ?");
  let changed = 0;
  for (const card of catalog) {
    if (!card.nation) continue;
    changed += upd.run(card.nation, card.name || "Unknown", card.category).changes;
  }
  return changed;
}

// Same idea for portraits: after scripts/download-club-images.mjs writes image
// paths into the club JSON, backfill cards.image for rows that lack one.
function syncImages(catalog) {
  if (!catalog.length) return 0;
  const missing = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE image IS NULL OR image = ''").get().c;
  if (missing === 0) return 0;
  const upd = db.prepare("UPDATE cards SET image = ? WHERE name = ? AND category = ? AND (image IS NULL OR image = '')");
  let changed = 0;
  for (const card of catalog) {
    if (!card.image) continue;
    changed += upd.run(card.image, card.name || "Unknown", card.category).changes;
  }
  return changed;
}

const catalog = loadCatalog();
const result = seed(catalog);
const nationSync = syncNations(catalog);
const imageSync = syncImages(catalog);

module.exports = { seed: () => result, syncNations: () => syncNations(loadCatalog()), syncImages: () => syncImages(loadCatalog()) };
