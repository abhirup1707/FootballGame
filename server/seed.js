const fs = require("fs");
const path = require("path");
const { db, usingPostgres } = require("./db");
const { buildCardStats } = require("./ovr");

const CATEGORY_FILES = {
  ATT: "attackers.json",
  MID: "midfielders.json",
  DEF: "defenders.json",
  GK: "goalkeepers.json",
};

// Event cards live in src/data/event/ and are seeded additively (never wiped
// with the club catalog), so users keep event cards they already own.
const EVENT_FILES = ["laliga_kickoff.json"];
const EVENT_VARIANT = "laliga";

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

function loadEventCatalog() {
  const eventDir = path.join(__dirname, "..", "src", "data", "event");
  const cards = [];
  for (const file of EVENT_FILES) {
    const list = readList(path.join(eventDir, file));
    if (!Array.isArray(list) || list.length === 0) continue;
    console.log(`seed: event ${file} (${list.length} cards)`);
    for (const card of list) cards.push({ ...card, category: card.position });
  }
  return cards;
}

function seed(catalog) {
  if (catalog.length === 0) return { seeded: false, cards: 0 };
  const existing = Number(db.prepare("SELECT COUNT(*) AS count FROM cards WHERE variant = ''").get().count);
  console.log(`seed: database has ${existing}/${catalog.length} cards`);
  // The club JSON is the single source of truth. Whenever the catalog size
  // differs from what the DB holds (stale legacy pool, partial seed, old
  // season), wipe and reseed so the game always plays off the club rosters.
  // Event cards (variant != '') are excluded from this check and never wiped.
  if (existing === catalog.length) return { seeded: false, cards: existing };
  db.exec("DELETE FROM pack_logs; DELETE FROM owned_cards; DELETE FROM cards; DELETE FROM sqlite_sequence WHERE name IN ('cards', 'owned_cards', 'pack_logs');");

  const seededRows = [];
  let count = 0;
  for (const card of catalog) {
    const stats = buildCardStats(card);
    seededRows.push([
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
    ]);
    count += 1;
  }
  // Postgres has a limit on parameters per query. Smaller batches also keep
  // the first cloud deployment responsive while the catalog is created.
  for (let start = 0; start < seededRows.length; start += 100) {
    const batch = seededRows.slice(start, start + 100);
    console.log(`seed: writing cards ${start + 1}-${start + batch.length}`);
    const insert = db.prepare(`
      INSERT INTO cards (name, season, club, nation, position, category, pace, shooting, passing, dribbling, defending, physicality, base_rating, tier, image)
      VALUES ${batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}
    `);
    insert.run(...batch.flat());
  }
  return { seeded: true, cards: count };
}

// Event cards are additive: only insert rows that don't exist yet, keyed by
// name + season + variant. The club-catalog reseed above deliberately wipes
// everything (dev reset), after which this re-inserts the event pool so the
// cards always live in the DB but are never deleted out from under owners.
function seedEventCards(eventCatalog) {
  if (!eventCatalog.length) return 0;
  const insert = db.prepare(`
    INSERT INTO cards (name, season, club, nation, position, category, pace, shooting, passing, dribbling, defending, physicality, base_rating, tier, image, variant)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const find = db.prepare("SELECT 1 AS c FROM cards WHERE name = ? AND season = ? AND variant = ?");
  let added = 0;
  for (const card of eventCatalog) {
    if (find.get(card.name || "Unknown", card.season || "", EVENT_VARIANT)) continue;
    const stats = buildCardStats(card);
    insert.run(
      card.name || "Unknown",
      card.season || "",
      card.club || "",
      card.nation || "",
      card.position,
      card.category,
      stats.pace,
      stats.shooting,
      stats.passing,
      stats.dribbling,
      stats.defending,
      stats.physicality,
      stats.rating,
      stats.tier,
      card.image || null,
      EVENT_VARIANT
    );
    added += 1;
  }
  return added;
}

// Additive sync: count-matched DBs skip the reseed above, so rows seeded
// before the nation column existed stay blank. Backfill nation by matching
// name + category against the club JSON whenever any card is missing it.
// On Postgres each statement goes through a spawned child process, so the
// backfill is batched into one multi-row UPDATE instead of one query per card.
function syncNations(catalog) {
  if (!catalog.length) return 0;
  const missing = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE variant = '' AND (nation = '' OR nation IS NULL)").get().c;
  if (missing === 0) return 0;
  if (usingPostgres) {
    const rows = catalog.filter((card) => card.nation && card.name);
    if (!rows.length) return 0;
    const values = rows.flatMap((card) => [card.nation, card.name, card.category]);
    const tuples = rows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(",");
    const update = db.prepare(`UPDATE cards c SET nation = v.nation FROM (VALUES ${tuples}) AS v(nation, name, category) WHERE c.name = v.name AND c.category = v.category AND (c.nation = '' OR c.nation IS NULL)`);
    return update.run(...values).changes;
  }
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
  const missing = db.prepare("SELECT COUNT(*) AS c FROM cards WHERE variant = '' AND (image IS NULL OR image = '')").get().c;
  if (missing === 0) return 0;
  if (usingPostgres) {
    const rows = catalog.filter((card) => card.image && card.name);
    if (!rows.length) return 0;
    const values = rows.flatMap((card) => [card.image, card.name, card.category]);
    const tuples = rows.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(",");
    const update = db.prepare(`UPDATE cards c SET image = v.image FROM (VALUES ${tuples}) AS v(image, name, category) WHERE c.name = v.name AND c.category = v.category AND (c.image IS NULL OR c.image = '')`);
    return update.run(...values).changes;
  }
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
const eventCatalog = loadEventCatalog();
const eventResult = seedEventCards(eventCatalog);
const nationSync = syncNations(catalog);
const imageSync = syncImages(catalog);

module.exports = { seed: () => result, syncNations: () => syncNations(loadCatalog()), syncImages: () => syncImages(loadCatalog()) };
