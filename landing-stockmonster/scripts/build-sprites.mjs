/**
 * build-sprites.mjs
 *
 * Copies creature art out of the game into public/. Originals are never
 * touched.
 *
 * ONLY `Stockmonsters/graphics/pokedex/pokefront/*.png` is used. Those are the
 * reskinned, AI-generated Stockmonsters fronts (sprite-manifest.json records a
 * generated `front` for all 194 token creatures and all 60 meme creatures).
 *
 * Deliberately NOT used, because they are still unmodified Nintendo art:
 *   graphics/icons/      -> Poke Balls, potions, berries (item icons)
 *   graphics/battlers/   -> Pokemon trainer sprites holding a Poke Ball
 *   graphics/pokedex/pokeicon/ -> vanilla creature icons
 *
 * The generated fronts sit on a noisy magenta chroma key that varies per file,
 * so the key colour is sampled from each sprite's border and removed with a
 * border-seeded flood fill rather than a fixed colour match.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const PUB = path.resolve(HERE, "../public");
const SRC = path.join(REPO, "Stockmonsters/graphics/pokedex/pokefront");

const S = 96; // native sprite size

const creatures = JSON.parse(fs.readFileSync(path.resolve(HERE, "../src/data/creatures.json"), "utf8"));
const memes = JSON.parse(fs.readFileSync(path.resolve(HERE, "../src/data/memes.json"), "utf8"));

const dist2 = (a, b, o) =>
  (a[o] - b[0]) ** 2 + (a[o + 1] - b[1]) ** 2 + (a[o + 2] - b[2]) ** 2;

const PINKISH = (r, g, b) => r > 170 && g < 115 && r - g > 70 && b - g > 40;

/** Remove the chroma-key background from one 96x96 RGBA buffer, in place. */
function dekey(px) {
  // 1. find the key colour. Most sprites sit on a full-bleed key, so the
  //    border is the best sample; a few sit on a smaller keyed rectangle with
  //    transparent margins, so fall back to the median of every keyed pixel.
  const sample = (idxs) => {
    if (!idxs.length) return null;
    const med = (ch) => {
      const v = idxs.map((o) => px[o + ch]).sort((a, b) => a - b);
      return v[v.length >> 1];
    };
    return [med(0), med(1), med(2)];
  };

  const border = [];
  for (let x = 0; x < S; x++) for (const y of [0, 1, S - 2, S - 1]) border.push((y * S + x) * 4);
  for (let y = 0; y < S; y++) for (const x of [0, 1, S - 2, S - 1]) border.push((y * S + x) * 4);

  const borderKeyed = border.filter((o) => px[o + 3] > 200 && PINKISH(px[o], px[o + 1], px[o + 2]));
  let key = borderKeyed.length > border.length * 0.4 ? sample(borderKeyed) : null;

  if (!key) {
    const all = [];
    for (let i = 0; i < S * S; i++) {
      const o = i * 4;
      if (px[o + 3] > 200 && PINKISH(px[o], px[o + 1], px[o + 2])) all.push(o);
    }
    if (all.length < S * S * 0.008) return; // no meaningful key present
    key = sample(all);
  }

  // 2. flood fill the key region inward from the border
  const TOL = 55 ** 2;
  const seen = new Uint8Array(S * S);
  const stack = [];
  for (let x = 0; x < S; x++) stack.push(x, (S - 1) * S + x);
  for (let y = 0; y < S; y++) stack.push(y * S, y * S + S - 1);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    const o = i * 4;
    if (px[o + 3] !== 0 && dist2(px, key, o) > TOL) continue;
    seen[i] = 1;
    px[o + 3] = 0;
    const x = i % S;
    const y = (i / S) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < S - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - S);
    if (y < S - 1) stack.push(i + S);
  }

  // 3. the key is dithered and sometimes fenced off from the border, so sweep
  //    every remaining pixel that is both saturated magenta AND a close match
  //    for the sampled key. Creature colours never land that close.
  const EXACT = 55 ** 2;
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    if (px[o + 3] === 0) continue;
    if (dist2(px, key, o) <= EXACT && PINKISH(px[o], px[o + 1], px[o + 2])) {
      px[o + 3] = 0;
      seen[i] = 1;
    }
  }

  // 4. shave the anti-aliased halo left on the silhouette edge (two passes)
  const HALO = 92 ** 2;
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    for (let i = 0; i < S * S; i++) {
      const o = i * 4;
      if (px[o + 3] === 0) continue;
      if (dist2(px, key, o) > HALO) continue;
      const x = i % S;
      const y = (i / S) | 0;
      const touching =
        (x > 0 && seen[i - 1]) ||
        (x < S - 1 && seen[i + 1]) ||
        (y > 0 && seen[i - S]) ||
        (y < S - 1 && seen[i + S]);
      if (touching) kill.push(i);
    }
    if (!kill.length) break;
    for (const i of kill) {
      px[i * 4 + 3] = 0;
      seen[i] = 1;
    }
  }
}

async function load(id) {
  const file = path.join(SRC, `${String(id).padStart(4, "0")}.png`);
  if (!fs.existsSync(file)) return null;
  const { data } = await sharp(file)
    .ensureAlpha()
    .resize(S, S, { kernel: "nearest", fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  dekey(data);
  return data;
}

async function buildSet(list, dirName) {
  const dir = path.join(PUB, dirName);
  fs.mkdirSync(dir, { recursive: true });
  let missing = 0;

  for (let n = 0; n < list.length; n++) {
    const px = await load(list[n].id);
    if (!px) {
      missing++;
      continue;
    }
    await sharp(px, { raw: { width: S, height: S, channels: 4 } })
      .png({ compressionLevel: 9, palette: true })
      .toFile(path.join(dir, `${list[n].id}.png`));
  }

  console.log(`[sprites] ${dirName}: ${list.length - missing}/${list.length} written (${missing} missing)`);
}

fs.mkdirSync(PUB, { recursive: true });
await buildSet(creatures, "mon");
await buildSet(memes, "meme");

// The reskinned title art (has a .vanilla-bak sibling, i.e. it was replaced).
await sharp(path.join(REPO, "Stockmonsters/graphics/titles/background.png"))
  .png()
  .toFile(path.join(PUB, "skyline.png"));
console.log("[sprites] skyline.png");
