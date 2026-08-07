// The manual-draft game mode has its own curated pool, read straight from the
// src/data/*.json files. Own-team mode pulls from the DB, which is seeded from
// src/data/club/. Keeping the two apart lets the draft roster stay lean and
// stable while the collection catalog grows with real players.
const fs = require("fs");
const path = require("path");
const { buildDraftCardStats } = require("./ovr");

const CATEGORY_FILES = { ATT: "attackers.json", MID: "midfielders.json", DEF: "defenders.json", GK: "goalkeepers.json" };
const DATA_DIR = path.join(__dirname, "..", "src", "data");

function loadDraftPool() {
  const pool = [];
  for (const [category, file] of Object.entries(CATEGORY_FILES)) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    const cards = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const card of cards) {
      const stats = buildDraftCardStats({ ...card, category });
      pool.push({
        id: card.id,
        name: card.name,
        season: card.season || "",
        club: card.club || "",
        category,
        position: category,
        base_rating: stats.rating,
        tier: stats.tier,
        image: card.image || null,
        pace: stats.pace,
        shooting: stats.shooting,
        passing: stats.passing,
        dribbling: stats.dribbling,
        defending: stats.defending,
        physicality: stats.physicality,
      });
    }
  }
  return pool;
}

const DRAFT_POOL = loadDraftPool();

module.exports = { DRAFT_POOL };
