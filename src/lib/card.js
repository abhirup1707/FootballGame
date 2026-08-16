const CLUB_LOGO_SLUGS = {
  "Real Madrid": "real-madrid",
  "Barcelona": "barcelona",
  "Atlético Madrid": "atletico-madrid",
  "Athletic Club": "athletic-club",
  "Real Sociedad": "real-sociedad",
  "Villarreal": "villarreal",
  "Valencia": "valencia",
  "Real Betis": "real-betis",
  "Sevilla": "sevilla",
  "Girona": "girona",
  "Celta Vigo": "celta-vigo",
  "Rayo Vallecano": "rayo-vallecano",
  "Las Palmas": "las-palmas",
  "Osasuna": "osasuna",
  "Mallorca": "mallorca",
  "Getafe": "getafe",
  "Espanyol": "espanyol",
  "Leganés": "leganes",
  "Alavés": "alaves",
};

export function clubLogoPath(club) {
  const slug = CLUB_LOGO_SLUGS[club];
  return slug ? `/clubs/${slug}.png` : null;
}

// Event cards reach the client as version="laliga" (catalog) or
// variant="laliga" (pack opens / owned cards), so accept both.
export function isLaligaCard(player) {
  return player && (player.version === "laliga" || player.variant === "laliga");
}

// Cards display only the player's last name (FIFA-style), not the full name.
export function lastName(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : name || "";
}
