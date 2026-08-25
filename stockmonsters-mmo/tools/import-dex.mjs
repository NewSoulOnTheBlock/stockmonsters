/*
 * Imports the Stockmonsters dex into the MMO:
 *
 *   node tools/import-dex.mjs
 *
 * - public/dex/<TICKER>.png  — creature fronts from graphics/pokedex/pokefront/,
 *   chroma key removed. The key colour is NOISY and differs per file
 *   (253,82,214 / 254,0,127 / ...), so it is sampled from the corners of each
 *   sprite and removed by colour distance; files that already carry real
 *   transparency are copied untouched.
 * - src/data/dex.json — one record per monster: ticker, name, company,
 *   contract address, dexId, renamed types, base stats, catch rate.
 *
 * Sources (all outside this repo, in the sibling folders):
 * - stockmonsters-reskin/creature-types.json  — 194 stocks incl. renamed types
 * - stockmonsters-reskin/meme-roster.json     — 60 memes
 * - stockmonsters-reskin/dex-text.json        — keyed by 1-BASED POSITION in
 *   the token map, NOT dexId (88/194 would silently mismatch otherwise)
 * - stockmonsters-reskin/meme-dex-text.json   — keyed by DEX ID, not position
 * - Stockmonsters/Data/Studio/pokemon/<dbSymbol>.json — stats, catch rate,
 *   and the `resources.front` id that names the pokefront PNG
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const ROOT = resolve(import.meta.dirname, '..')
const GAME = resolve(ROOT, '../Stockmonsters')
const RESKIN = resolve(ROOT, '../stockmonsters-reskin')
const FRONTS = join(GAME, 'graphics/pokedex/pokefront')
const OUT_IMG = join(ROOT, 'public/dex')
const OUT_DATA = join(ROOT, 'src/data')

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const stocks = readJson(join(RESKIN, 'creature-types.json'))
const memes = readJson(join(RESKIN, 'meme-roster.json'))
const dexText = readJson(join(RESKIN, 'dex-text.json'))
const memeDexText = readJson(join(RESKIN, 'meme-dex-text.json'))

mkdirSync(OUT_IMG, { recursive: true })
mkdirSync(OUT_DATA, { recursive: true })

/** Removes a sampled corner chroma key; copies through real transparency. */
async function importFront(srcPng, outPng) {
  const img = sharp(srcPng).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info
  const at = (x, y) => data.subarray((y * w + x) * ch, (y * w + x) * ch + 4)
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
  const opaque = corners.filter((c) => c[3] > 200)
  // Corners transparent -> the file already has a real alpha channel
  if (opaque.length < 3) {
    await sharp(srcPng).png().toFile(outPng)
    return 'alpha'
  }
  const key = opaque[0]
  for (let i = 0; i < data.length; i += ch) {
    const d = Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2])
    if (d < 90) data[i + 3] = 0
  }
  await sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toFile(outPng)
  return `keyed rgb(${key[0]},${key[1]},${key[2]})`
}

const entries = []
let keyed = 0, copied = 0, missing = 0

// creature-types.json is the FULL roster (194 stocks + 60 memes, verified by
// tickers); meme-roster.json only tells us which tickers are memes.
// dex-text.json is keyed by 1-based POSITION in the token map;
// meme-dex-text.json is keyed by DEX ID — verified against both files.
const memeTickers = new Set(memes.map((m) => m.ticker))
let stockPos = 0, memePos = 0
const all = stocks.map((s) => {
  const kind = memeTickers.has(s.ticker) ? 'meme' : 'stock'
  return { ...s, kind, pos: kind === 'meme' ? ++memePos : ++stockPos }
})

for (const e of all) {
  const speciePath = join(GAME, 'Data/Studio/pokemon', `${e.dbSymbol}.json`)
  if (!existsSync(speciePath)) {
    console.warn(`  ! no specie json for ${e.ticker} (${e.dbSymbol})`)
    missing++
    continue
  }
  const form = readJson(speciePath).forms[0]
  const frontId = form.resources.front || String(readJson(speciePath).id).padStart(4, '0')
  const src = join(FRONTS, `${frontId}.png`)
  if (!existsSync(src)) {
    console.warn(`  ! no front png for ${e.ticker} (${frontId}.png)`)
    missing++
    continue
  }
  const how = await importFront(src, join(OUT_IMG, `${e.ticker}.png`))
  how === 'alpha' ? copied++ : keyed++

  const text = (e.kind === 'stock' ? dexText[String(e.pos)] : memeDexText[String(e.dexId)]) ?? {}
  entries.push({
    ticker: e.ticker,
    name: e.stockmonster,
    company: e.company,
    address: e.address ?? null,
    kind: e.kind,
    dexId: e.dexId,
    types: [e.t1, e.t2].filter(Boolean),
    species: text.species ?? null,
    description: text.description ?? null,
    stats: {
      hp: form.baseHp, atk: form.baseAtk, def: form.baseDfe,
      spd: form.baseSpd, ats: form.baseAts, dfs: form.baseDfs,
    },
    catchRate: form.catchRate,
    height: form.height,
    weight: form.weight,
    sprite: `dex/${e.ticker}.png`,
  })
}

writeFileSync(join(OUT_DATA, 'dex.json'), JSON.stringify(entries, null, 1))
console.log(`${entries.length} dex entries (${stockPos} stocks + ${memePos} memes)`)
console.log(`sprites: ${keyed} chroma-keyed, ${copied} copied with real alpha, ${missing} missing`)
