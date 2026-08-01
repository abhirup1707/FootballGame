import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const categories = ["attackers", "midfielders", "defenders", "goalkeepers"];
const root = process.cwd();
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const exists = async (path) => access(path).then(() => true).catch(() => false);

for (const category of categories) {
  const path = join(root, "src", "data", `${category}.json`);
  const players = JSON.parse(await readFile(path, "utf8"));
  for (const player of players) {
    const image = `/players/${slug(player.name)}.png`;
    if (await exists(join(root, "public", image))) player.image = image;
  }
  await writeFile(path, `${JSON.stringify(players, null, 2)}\n`);
}
