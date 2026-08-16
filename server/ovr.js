// Season reset scale: cards run 60-75. Tiers add a small premium so the
// boosted stats (still capped at 75) never push a displayed OVR past 75.
// Event cards (Ultimate Icons, La Liga Kickoff) break the catalog cap and
// ship authored stats, so the displayed rating clamp is lifted to 85 for
// those rows.
const STAT_CAP = 75;
const CATALOG_RATING_CAP = 85;
const TIER_MULTIPLIERS = { base: 1, inform: 1.01, prime: 1.03, icon: 1.05 };

function tierForRating(rating) {
  if (rating >= 73) return "icon";
  if (rating >= 70) return "prime";
  if (rating >= 66) return "inform";
  return "base";
}

// OVR = weighted average of the six stats, position-aware: forwards lean on
// shooting/dribbling/pace, defenders on defending/physicality, keepers on
// reflexes (defending) with a touch of physicality.
const OVR_WEIGHTS = {
  ATT: { pace: 0.15, shooting: 0.3, passing: 0.15, dribbling: 0.25, defending: 0.05, physicality: 0.1 },
  MID: { pace: 0.1, shooting: 0.2, passing: 0.3, dribbling: 0.2, defending: 0.1, physicality: 0.1 },
  DEF: { pace: 0.1, shooting: 0.05, passing: 0.1, dribbling: 0.05, defending: 0.4, physicality: 0.3 },
  GK: { pace: 0.05, shooting: 0.05, passing: 0.1, dribbling: 0.05, defending: 0.6, physicality: 0.15 },
};

const STAT_KEYS = ["pace", "shooting", "passing", "dribbling", "defending", "physicality"];
// Goalkeepers carry their own six-stat set in the catalog. The engine still
// plays through the outfield slots, so GK stats map 1:1 onto them: reflexes
// drive saves (defending, the GK's dominant OVR weight), handling is the
// keeper's physicality, kicking is distribution, and the rest fill in.
const GK_STAT_KEYS = ["diving", "handling", "kicking", "reflexes", "speed", "positioning"];
const GK_TO_ENGINE = { speed: "pace", diving: "shooting", kicking: "passing", positioning: "dribbling", reflexes: "defending", handling: "physicality" };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Playing a player outside their natural category costs OVR along
// ATT -> MID -> DEF -> GK: one step away loses 3, two or more loses 5.
const POSITION_ORDER = ["ATT", "MID", "DEF", "GK"];
function positionPenalty(playerCategory, slotCategory) {
  const from = POSITION_ORDER.indexOf(playerCategory);
  const to = POSITION_ORDER.indexOf(slotCategory);
  if (from < 0 || to < 0) return 0;
  const distance = Math.abs(from - to);
  return distance === 0 ? 0 : distance === 1 ? -3 : -5;
}
function effectiveRating(rating, playerCategory, slotCategory) {
  return rating + positionPenalty(playerCategory, slotCategory);
}

function computeOVR(stats, category) {
  const weights = OVR_WEIGHTS[category] || OVR_WEIGHTS.MID;
  const total = STAT_KEYS.reduce((sum, key) => sum + (stats[key] || 0) * (weights[key] || 0), 0);
  // Internal clamp runs to 99 so stamina-aware effectiveOVR differentiates
  // real cards (whose authored stats can exceed the 60-75 display scale).
  return clamp(Math.round(total), 1, 99);
}

function applyTier(stats, tier) {
  const mult = TIER_MULTIPLIERS[tier] || 1;
  const out = {};
  for (const key of STAT_KEYS) out[key] = clamp(Math.round((stats[key] || 0) * mult), 1, STAT_CAP);
  return out;
}

// A player at 100 stamina plays at full stats; at 0 they drop to half.
function effectiveStats(stats, stamina = 100) {
  const factor = 0.5 + 0.5 * (clamp(stamina, 0, 100) / 100);
  const out = {};
  for (const key of STAT_KEYS) out[key] = Math.round((stats[key] || 0) * factor);
  return out;
}

function hashRange(str, salt, min, max) {
  let h = 2166136261;
  const input = `${str}:${salt}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return min + (Math.abs(h) % (max - min + 1));
}

// Derive the six stats deterministically from the catalog rating so the same
// player always has the same stat spread without storing hand-authored stats.
function deriveStats(card) {
  const r = card.rating;
  const d = (salt, min, max) => hashRange(`${card.name}:${card.id}`, salt, min, max);
  const c = (v) => clamp(v, 1, STAT_CAP);
  switch (card.category) {
    case "ATT":
      return { pace: c(r - d(1, 0, 3)), shooting: c(r), passing: c(r - d(2, 0, 6)), dribbling: c(r - d(3, 0, 2)), defending: c(r - d(4, 32, 42)), physicality: c(r - d(5, 0, 10)) };
    case "MID":
      return { pace: c(r - d(1, 0, 8)), shooting: c(r - d(2, 0, 6)), passing: c(r), dribbling: c(r - d(3, 0, 5)), defending: c(r - d(4, 8, 20)), physicality: c(r - d(5, 0, 8)) };
    case "DEF":
      return { pace: c(r - d(1, 0, 6)), shooting: c(r - d(2, 18, 30)), passing: c(r - d(3, 0, 10)), dribbling: c(r - d(4, 6, 16)), defending: c(r), physicality: c(r - d(5, 0, 4)) };
    default:
      return { pace: c(r - d(1, 0, 12)), shooting: c(r - d(2, 0, 14)), passing: c(r - d(3, 0, 6)), dribbling: c(r - d(4, 0, 6)), defending: c(r - d(5, 0, 8)), physicality: c(r - d(6, 0, 6)) };
  }
}

// A card has authored stats when the core attacking/defensive fields the data
// tables carry are present. Individual stats can be absent (attackers ship no
// DEF; a few midfield rows omit PHY) and are derived per-field instead. GKs
// are recognised by their own six-stat set.
function hasProvidedStats(card) {
  const keys = card.category === "GK" ? GK_STAT_KEYS : ["pace", "shooting", "passing", "dribbling"];
  return keys.every((key) => typeof card[key] === "number" && card[key] >= 1);
}

function providedStats(card) {
  const r = card.rating;
  const d = (salt, min, max) => hashRange(`${card.name}:${card.id}`, salt, min, max);
  const c = (v) => clamp(v, 1, 100);
  if (card.category === "GK") {
    // GK rows ship all six keeper stats, so just translate them across.
    const pick = (key) => (typeof card[key] === "number" && card[key] >= 1 ? card[key] : r - d(GK_TO_ENGINE[key], 0, 10));
    return { pace: c(pick("speed")), shooting: c(pick("diving")), passing: c(pick("kicking")), dribbling: c(pick("positioning")), defending: c(pick("reflexes")), physicality: c(pick("handling")) };
  }
  const pick = (key, salt, min, max) => (typeof card[key] === "number" && card[key] >= 1 ? card[key] : r - d(salt, min, max));
  return {
    pace: c(pick("pace", "p", 0, 12)),
    shooting: c(pick("shooting", "s", 0, 8)),
    passing: c(pick("passing", "q", 0, 6)),
    dribbling: c(pick("dribbling", "d", 0, 5)),
    defending: c(pick("defending", "def", 32, 42)),
    physicality: c(pick("physicality", "phy", 0, 8)),
  };
}

// The full pipeline for a catalog card: stats -> tier -> boosted stats -> OVR.
// The displayed OVR is the catalog rating itself (60-75). Cards with authored
// stats keep them exactly as provided; only derived cards get the tier bump.
function buildCardStats(card) {
  const tier = tierForRating(card.rating);
  const stats = hasProvidedStats(card) ? providedStats(card) : applyTier(deriveStats(card), tier);
  return { ...stats, tier, rating: clamp(card.rating, 1, CATALOG_RATING_CAP) };
}

// Draft-mode cards come from src/data/*.json, a curated legend pool rated
// 93-99. They carry no per-stat fields, so stats are derived from the rating
// on the full 1-99 scale (no 60-75 catalog clamp) so a 99-rated legend plays
// like one.
function buildDraftStats(card) {
  const r = card.rating;
  const d = (salt, min, max) => hashRange(`${card.name}:${card.id}`, salt, min, max);
  const c = (v) => clamp(v, 1, 99);
  switch (card.category) {
    case "ATT":
      return { pace: c(r - d(1, 0, 3)), shooting: c(r), passing: c(r - d(2, 0, 6)), dribbling: c(r - d(3, 0, 2)), defending: c(r - d(4, 32, 42)), physicality: c(r - d(5, 0, 10)) };
    case "MID":
      return { pace: c(r - d(1, 0, 8)), shooting: c(r - d(2, 0, 6)), passing: c(r), dribbling: c(r - d(3, 0, 5)), defending: c(r - d(4, 8, 20)), physicality: c(r - d(5, 0, 8)) };
    case "DEF":
      return { pace: c(r - d(1, 0, 6)), shooting: c(r - d(2, 18, 30)), passing: c(r - d(3, 0, 10)), dribbling: c(r - d(4, 6, 16)), defending: c(r), physicality: c(r - d(5, 0, 4)) };
    default:
      return { pace: c(r - d(1, 0, 12)), shooting: c(r - d(2, 0, 14)), passing: c(r - d(3, 0, 6)), dribbling: c(r - d(4, 0, 6)), defending: c(r - d(5, 0, 8)), physicality: c(r - d(6, 0, 6)) };
  }
}

function buildDraftCardStats(card) {
  const stats = buildDraftStats(card);
  return { ...stats, tier: "icon", rating: clamp(card.rating, 1, 99) };
}

module.exports = { TIER_MULTIPLIERS, tierForRating, computeOVR, applyTier, effectiveStats, deriveStats, hasProvidedStats, providedStats, buildCardStats, buildDraftCardStats, STAT_KEYS, GK_STAT_KEYS, GK_TO_ENGINE, positionPenalty, effectiveRating };
