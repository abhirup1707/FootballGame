// Downloads Wikimedia portrait thumbnails for every club-roster card missing
// an image, then writes the image path back into src/data/club/*.json so the
// game serves local files (no runtime API calls). Resumable: skips any player
// whose image already exists or whose slug already resolves in the JSON.
//
// Usage: node scripts/download-club-images.mjs [--limit N]   (from repo root)
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const categories = ["attackers", "midfielders", "defenders", "goalkeepers"];
const root = process.cwd();
const destination = join(root, "public", "players");

// Club cards use a diacritic-stripped slug (e.g. Andrés Iniesta ->
// andres-iniesta.png), matching the existing /players/ paths.
const slug = (name) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const request = async (url) => {
  let delay = 3000;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": "FootballDraftAssetBuilder/1.0 (local development asset downloader)" } });
    if (response.status !== 429) return response;
    console.log(`Rate limited (429) on attempt ${attempt + 1}; backing off ${delay / 1000}s...`);
    await pause(delay);
    delay *= 2;
  }
  return fetch(url, { headers: { "user-agent": "FootballDraftAssetBuilder/1.0 (local development asset downloader)" } });
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = async (path) => access(path).then(() => true).catch(() => false);

await mkdir(destination, { recursive: true });

// Load every club roster.
const rosters = {};
for (const category of categories) {
  rosters[category] = JSON.parse(await readFile(join(root, "src", "data", "club", `${category}.json`), "utf8"));
}

// Collapse to one download per unique slug (multiple season cards of the same
// player share a portrait). Track which cards point at each slug so we can
// backfill the image path afterwards.
const missingBySlug = new Map(); // slug -> { players: [card, ...] }
for (const category of categories) {
  for (const card of rosters[category]) {
    if (card.image) continue;
    const key = slug(card.name);
    if (!missingBySlug.has(key)) missingBySlug.set(key, { players: [], existing: false });
    missingBySlug.get(key).players.push(card);
  }
}

const slugs = [...missingBySlug.keys()].slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(`Club roster: ${slugs.length} unique players need a portrait${Number.isFinite(LIMIT) ? ` (limited run of ${LIMIT})` : "."}`);

const failures = [];
let downloaded = 0;
let skipped = 0;
for (const key of slugs) {
  const { players } = missingBySlug.get(key);
  const filePath = join(destination, `${key}.png`);
  if (await exists(filePath)) {
    skipped += 1;
    for (const card of players) card.image = `/players/${key}.png`;
    continue;
  }
  try {
    const search = new URL("https://en.wikipedia.org/w/api.php");
    search.searchParams.set("action", "query");
    search.searchParams.set("format", "json");
    search.searchParams.set("generator", "search");
    search.searchParams.set("gsrsearch", players[0].name);
    search.searchParams.set("gsrlimit", "1");
    search.searchParams.set("prop", "pageimages");
    search.searchParams.set("piprop", "thumbnail");
    search.searchParams.set("pithumbsize", "320");
    // Two Wikimedia requests per player; keep well under the public rate cap.
    await pause(2500);
    const searchResponse = await request(search);
    if (!searchResponse.ok) throw new Error(`Search request failed (${searchResponse.status})`);
    const result = await searchResponse.json();
    const page = Object.values(result.query?.pages || {})[0];
    const imageUrl = page?.thumbnail?.source;
    if (!imageUrl) throw new Error("No portrait thumbnail found");
    await pause(2500);
    const image = await request(imageUrl);
    if (!image.ok) throw new Error(`Image request failed (${image.status})`);
    await writeFile(filePath, Buffer.from(await image.arrayBuffer()));
    downloaded += 1;
    for (const card of players) card.image = `/players/${key}.png`;
  } catch (error) {
    failures.push(`${players[0].name}: ${error.message}`);
  }
}

// Persist the updated image paths back into the club JSON.
for (const category of categories) {
  await writeFile(join(root, "src", "data", "club", `${category}.json`), `${JSON.stringify(rosters[category], null, 2)}\n`);
}
await writeFile(
  join(destination, "DOWNLOAD-SOURCES.txt"),
  `Club-roster portraits downloaded from Wikimedia/Wikipedia thumbnails on ${new Date().toISOString()}.\n\nFailures:\n${failures.join("\n") || "None"}\n`
);
console.log(`Complete: ${downloaded} downloaded, ${skipped} already present, ${failures.length} failed.`);
if (failures.length) console.log(failures.join("\n"));
