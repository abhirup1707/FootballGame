const { db } = require("./db");

const AI_SLOTS = ["GK", "LB", "CB1", "CB2", "RB", "CM1", "CM2", "CAM", "LW", "ST", "RW"];
const AI_SLOT_CATEGORY = { GK:"GK", LB:"DEF", CB1:"DEF", CB2:"DEF", RB:"DEF", CM1:"MID", CM2:"MID", CAM:"MID", LW:"ATT", ST:"ATT", RW:"ATT" };
const AI_DIFFICULTIES = ["easy", "medium", "hard", "extreme"];
const AI_NAMES = { easy: "CPU · Rookie", medium: "CPU · Contender", hard: "CPU · Elite", extreme: "CPU · Legend" };
// How often the AI reads the opponent's pass/shot (defending) or picks the
// best option (attacking). Difficulty ramps the squad AND the decisions. Read
// rates stay under 1 so a match can never stalemate into an endless read-vs-
// read loop.
const AI_READ_RATE = { easy: 0.2, medium: 0.45, hard: 0.7, extreme: 0.9 };
const AI_ATTACK_SMART = { easy: 0, medium: 0.4, hard: 0.7, extreme: 0.95 };
const AI_OVR_OFFSET = { easy: -6, medium: 0, hard: 6, extreme: 0 };

function aiCard(row) {
  return { id:`ai-${row.id}`, name:row.name, season:row.season, club:row.club, position:row.category, rating:row.base_rating, tier:row.tier, image:row.image, pace:row.pace, shooting:row.shooting, passing:row.passing, dribbling:row.dribbling, defending:row.defending, physicality:row.physicality };
}

// Build an 11-man AI squad from the seeded catalog. Easy sits below the user's
// team, medium matches it, hard sits above, and extreme takes the single best
// player available in every position.
function buildAiTeam(difficulty, userOvr) {
  const cards = db.prepare("SELECT * FROM cards").all();
  if (!cards.length) return null;
  const byCategory = (category) => cards.filter((card) => card.category === category).sort((a, b) => b.base_rating - a.base_rating);
  const offset = AI_OVR_OFFSET[difficulty] || 0;
  const target = difficulty === "extreme" ? 99 : Math.max(50, Math.min(99, Math.round(userOvr) + offset));
  const used = new Set();
  const positions = {};
  let index = 0;
  for (const slot of AI_SLOTS) {
    const category = AI_SLOT_CATEGORY[slot];
    const pool = byCategory(category);
    if (!pool.length) continue;
    let pick;
    if (difficulty === "extreme") {
      pick = pool.find((card) => !used.has(card.id));
    } else {
      const offsets = [-2, -1, 0, 0, 1, 1];
      const want = Math.max(1, Math.min(99, target + offsets[index % offsets.length]));
      pick = [...pool].filter((card) => !used.has(card.id)).sort((a, b) => Math.abs(a.base_rating - want) - Math.abs(b.base_rating - want))[0];
    }
    if (!pick) continue;
    used.add(pick.id);
    positions[slot] = aiCard(pick);
    index += 1;
  }
  const filled = Object.values(positions);
  if (filled.length !== AI_SLOTS.length) return null;
  const overall = Number((filled.reduce((sum, player) => sum + player.rating, 0) / AI_SLOTS.length).toFixed(1));
  return { positions, overall };
}

module.exports = { buildAiTeam, AI_DIFFICULTIES, AI_NAMES, AI_READ_RATE, AI_ATTACK_SMART };
