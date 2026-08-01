import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const categories = ["attackers", "midfielders", "defenders", "goalkeepers"];
const destination = join(process.cwd(), "public", "players");
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const searchAliases = { Marcelo: "Marcelo (footballer, born 1988)" };
const request = (url) => fetch(url, { headers:{ "user-agent":"FootballDraftAssetBuilder/1.0 (local development asset downloader)" } });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(destination, { recursive:true });
const players = (await Promise.all(categories.map(async (category) => JSON.parse(await readFile(join(process.cwd(), "src", "data", `${category}.json`), "utf8"))))).flat();
const failures = [];
for (const player of players) {
  try { await access(join(destination, `${slug(player.name)}.png`)); continue; } catch { /* Missing asset: download it. */ }
  const search = new URL("https://en.wikipedia.org/w/api.php");
  search.searchParams.set("action", "query");
  search.searchParams.set("format", "json");
  search.searchParams.set("generator", "search");
  search.searchParams.set("gsrsearch", searchAliases[player.name] || player.name);
  search.searchParams.set("gsrlimit", "1");
  search.searchParams.set("prop", "pageimages");
  search.searchParams.set("piprop", "thumbnail");
  search.searchParams.set("pithumbsize", "320");
  try {
    // Each player needs two Wikimedia requests. Keep the aggregate request rate
    // comfortably below the public API limit when downloading a large roster.
    await pause(2000);
    const searchResponse = await request(search);
    if (!searchResponse.ok) throw new Error(`Search request failed (${searchResponse.status})`);
    const result = await searchResponse.json();
    const page = Object.values(result.query?.pages || {})[0];
    const imageUrl = page?.thumbnail?.source;
    if (!imageUrl) throw new Error("No portrait thumbnail found");
    await pause(2000);
    const image = await request(imageUrl);
    if (!image.ok) throw new Error(`Image request failed (${image.status})`);
    await writeFile(join(destination, `${slug(player.name)}.png`), Buffer.from(await image.arrayBuffer()));
    console.log(`Downloaded ${player.name}`);
  } catch (error) {
    failures.push(`${player.name}: ${error.message}`);
  }
}
await writeFile(join(destination, "DOWNLOAD-SOURCES.txt"), `Player portraits downloaded from Wikimedia/Wikipedia thumbnails on ${new Date().toISOString()}.\n\nFailures:\n${failures.join("\n") || "None"}\n`);
console.log(`Complete: ${players.length - failures.length}/${players.length} portraits downloaded.`);
