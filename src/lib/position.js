export const slotCategory = { GK:"GK", LB:"DEF", CB1:"DEF", CB2:"DEF", RB:"DEF", CM1:"MID", CM2:"MID", CAM:"MID", LW:"ATT", ST:"ATT", RW:"ATT" };

// Players are free to slot into any position, but playing outside their
// natural category costs OVR along ATT -> MID -> DEF -> GK: one step away
// loses 3 OVR, two or more steps away loses 5.
const CATEGORY_ORDER = ["ATT", "MID", "DEF", "GK"];

export function positionPenalty(playerCategory, slotCategoryValue) {
  const from = CATEGORY_ORDER.indexOf(playerCategory);
  const to = CATEGORY_ORDER.indexOf(slotCategoryValue);
  if (from < 0 || to < 0) return 0;
  const distance = Math.abs(from - to);
  return distance === 0 ? 0 : distance === 1 ? -3 : -5;
}

export function effectiveRating(rating, playerCategory, slotCategoryValue) {
  return rating + positionPenalty(playerCategory, slotCategoryValue);
}
