#!/usr/bin/env node
/*
 * render-map-thumbs.mjs — map preview PNGs + the browsable map catalogue.
 *
 *   node tools/render-map-thumbs.mjs [--force] [--only <id>] [--quiet]
 *
 * Two outputs, one pass over src/tiled:
 *
 *   public/previews/<id>.png   a downscaled composite of every visible tile
 *                               layer of <id>.tmx (~320px on the long edge)
 *   src/data/map-catalog.ts     { id, name, region, width, height, thumb,
 *                                 connections[] } for every map
 *
 * Rendering approach (grown out of the throwaway renderer a previous agent
 * wrote for autotile verification, which composited at full 32px/tile and then
 * asked sharp to shrink the result):
 *
 *   Full-res compositing is wasteful here — a 110x100 map is 3520x3200px, and
 *   the answer we want is 330x300. Worse, a generic resize of a *tileset atlas*
 *   bleeds neighbouring (unrelated) tiles into each other. So instead we shrink
 *   each TILESET once, with an exact per-tile box average that never reads
 *   across a tile boundary, and blit R x R blocks. Same picture, ~100x less
 *   memory, and no atlas bleed.
 *
 * Idempotent: a thumbnail is only re-rendered when the .tmx (or this script) is
 * newer than the PNG. The catalogue is always rewritten (it is cheap and it is
 * the thing that must never drift).
 */

// NOTE: the output folder must not start with "map". The tiled plugin in
// vite.config.ts claims publicPath '/map', and it matches by PREFIX — so
// /mapthumbs/foo.png was swallowed and 404'd while /dex/foo.png worked.
// That cost an afternoon; keep the name as 'previews'.
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TILED = join(ROOT, 'src', 'tiled')
const OUT_DIR = join(ROOT, 'public', 'previews')
const CATALOG = join(ROOT, 'src', 'data', 'map-catalog.ts')
const CONNECTIONS = join(ROOT, 'src', 'data', 'rmxp-connections.json')

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const QUIET = args.includes('--quiet')
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

const TILE = 32
/** Target long edge in px. R is chosen from the ladder to land near this. */
const TARGET = 320
/** Whole pixels-per-tile only — fractional R would misalign the blit grid. */
const R_LADDER = [2, 3, 4, 5, 6, 8, 10, 12, 16]
/** Background: THEME.darker, so an empty cell reads as "outside the map". */
const BG = [0x14, 0x10, 0x24]

const log = (...a) => { if (!QUIET) console.log(...a) }

/* ============================================================= manifests ===*/

/**
 * The manifests are generated TypeScript with a fixed one-entry-per-line shape,
 * so a regex beats standing up a TS loader in a plain Node script.
 */
function readPsdkMaps() {
  const src = readFileSync(join(TILED, 'manifest.ts'), 'utf8')
  const out = []
  for (const m of src.matchAll(/\{\s*id:\s*'([^']+)',\s*hitboxes:/g)) out.push({ id: m[1] })
  return out
}

function readRmxpMaps() {
  const src = readFileSync(join(TILED, 'rmxp-manifest.ts'), 'utf8')
  const out = []
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*"([^"]*)",\s*rmxpId:\s*(\d+),\s*width:\s*(\d+),\s*height:\s*(\d+),/g
  for (const m of src.matchAll(re)) {
    out.push({ id: m[1], name: m[2], rmxpId: Number(m[3]), width: Number(m[4]), height: Number(m[5]) })
  }
  return out
}

function readConnections() {
  const raw = JSON.parse(readFileSync(CONNECTIONS, 'utf8'))
  /** @type {Map<string, Set<string>>} */
  const adj = new Map()
  const link = (a, b) => {
    if (!a || !b || a === b) return
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a).add(b)
  }
  for (const c of raw.connections ?? []) { link(c.from, c.to); link(c.to, c.from) }
  return adj
}

/* ================================================================ region ===*/

const KANTO_PLACES = new Set([
  'pallet town', 'viridian city', 'viridian forest', 'pewter city', 'cerulean city',
  'vermilion city', 'vermilion port', 'lavender town', 'celadon city', 'fuchsia city',
  'saffron city', 'cinnabar island', 'indigo plateau', 'mt. moon', 'mt moon',
  "diglett's cave", 'rock tunnel', 'seafoam islands', 'power plant', 'safari zone',
  'pokemon tower', 'silph co', 'victory road',
])

const JOHTO_PLACES = new Set([
  'new bark town', 'cherrygrove city', 'violet city', 'azalea town', 'goldenrod city',
  'ecruteak city', 'olivine city', 'olivine marina', 'cianwood city', 'mahogany town',
  'blackthorn city', 'ilex forest', 'slowpoke well', 'union cave', 'ice path',
  'mt. mortar', 'mt mortar', 'mt. silver', 'mt silver', 'whirl islands', "dragon's den",
  'lake of rage', 'national park', 'tohjo falls', 'dark cave', 'ruins of alph',
  'battle tower', 'tin tower', 'burned tower', 'sprout tower', 'tower path',
  'goldenrod sea path', 'olivine sea path', 'whiteport town', 'cliff edge gate',
])

/** RMXP maps that are folder markers / blank scratch pages, not places. */
const PLACEHOLDER = /^(map\d+|towns(-\d+)?|routes(-\d+)?|extra|johto-enhanced|kanto-remastered)$/

/**
 * kanto / johto / other. Three signals, most confident first:
 *   1. the base place name (strip a floor suffix like "B2F" first)
 *   2. route number — Kanto is 1..25, Johto 26..48
 *   3. the PBS map-id cluster: 1..78 Kanto, 79..152 Johto
 * A map that trips none of them stays 'other' rather than being guessed at.
 */
function regionOf(id, name, rmxpId) {
  if (PLACEHOLDER.test(id)) return 'other'

  const base = name.toLowerCase()
    .replace(/\s+b?\d+f$/, '')       // "Ice Path B2F" -> "ice path"
    .replace(/\s+(east|west|north|south)$/, '')
    .trim()
  if (KANTO_PLACES.has(base)) return 'kanto'
  if (JOHTO_PLACES.has(base)) return 'johto'

  const route = /^route\s+(\d+)$/.exec(base)
  if (route) {
    const n = Number(route[1])
    if (n >= 1 && n <= 25) return 'kanto'
    if (n >= 26 && n <= 48) return 'johto'
    return 'other'
  }

  if (typeof rmxpId === 'number') {
    if (rmxpId >= 1 && rmxpId <= 78) return 'kanto'
    if (rmxpId >= 79 && rmxpId <= 152) return 'johto'
  }
  return 'other'
}

/* ================================================================== names ==*/

/** The 19 PSDK maps have bare ids and no name field. Spell them out by hand
 *  rather than letting a humaniser invent "Rockethq" or "Photostudio". */
const PSDK_NAMES = {
  basement: 'Basement',
  battlearena: 'Battle Arena',
  beach: 'Beach',
  cave: 'Cave',
  cyclingroad: 'Cycling Road',
  'elevator-1': 'Elevator 1',
  'elevator-2': 'Elevator 2',
  exterior: 'Exterior',
  gamecorner: 'Game Corner',
  hub: 'Hub',
  labo: 'Laboratory',
  library: 'Library',
  marsh: 'Marsh',
  photostudio: 'Photo Studio',
  river: 'River',
  rockethq: 'Rocket HQ',
  route: 'Route',
  tundra: 'Tundra',
  wifi: 'Wi-Fi Plaza',
}

function humanise(id) {
  return id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/* ================================================================== tmx ====*/

function parseTmx(id) {
  const path = join(TILED, `${id}.tmx`)
  const xml = readFileSync(path, 'utf8')
  const head = /<map\b[^>]*>/.exec(xml)[0]
  const width = Number(/\bwidth="(\d+)"/.exec(head)[1])
  const height = Number(/\bheight="(\d+)"/.exec(head)[1])

  const tilesets = []
  for (const m of xml.matchAll(/<tileset\s+firstgid="(\d+)"\s+source="([^"]+)"\s*\/>/g)) {
    tilesets.push({ first: Number(m[1]), source: m[2] })
  }
  tilesets.sort((a, b) => a.first - b.first)

  const layers = []
  for (const m of xml.matchAll(/<layer\b([^>]*)>([\s\S]*?)<\/layer>/g)) {
    const attrs = m[1]
    const name = /name="([^"]*)"/.exec(attrs)?.[1] ?? ''
    // Hidden layers are collision/terrain metadata, never art.
    if (/visible="0"/.test(attrs)) continue
    if (/^(borders|systemtags|terrain_tag)/i.test(name)) continue
    const data = /<data encoding="csv">([\s\S]*?)<\/data>/.exec(m[2])
    if (!data) continue
    layers.push({ name, csv: data[1] })
  }
  return { path, xml, width, height, tilesets, layers, mtime: statSync(path).mtimeMs }
}

/* ============================================================== tilesets ===*/

/** name -> { cols, rows, w, h, png } (metadata only; pixels are cached below) */
const tsxCache = new Map()
function readTsx(source) {
  let t = tsxCache.get(source)
  if (t) return t
  const path = join(TILED, source)
  const xml = readFileSync(path, 'utf8')
  const cols = Number(/columns="(\d+)"/.exec(xml)[1])
  const count = Number(/tilecount="(\d+)"/.exec(xml)[1])
  const img = /<image source="([^"]+)"(?:\s+width="(\d+)")?(?:\s+height="(\d+)")?/.exec(xml)
  t = {
    source,
    cols,
    count,
    rows: Math.ceil(count / cols),
    png: join(TILED, img[1]),
    mtime: statSync(path).mtimeMs,
  }
  tsxCache.set(source, t)
  return t
}

/**
 * Exact per-tile box average. Never samples across a tile boundary, so an atlas
 * shrinks without its neighbours bleeding in. Alpha is averaged; RGB is an
 * alpha-weighted average, which is what "premultiply, shrink, unpremultiply"
 * amounts to and keeps transparent padding from darkening the edges.
 */
function shrinkAtlas(raw, imgW, cols, rows, R) {
  const outW = cols * R
  const outH = rows * R
  const out = new Uint8Array(outW * outH * 4)
  // Sub-block boundaries inside one 32px tile, computed once.
  const edge = new Int32Array(R + 1)
  for (let i = 0; i <= R; i++) edge[i] = Math.round((i * TILE) / R)

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const baseX = tx * TILE
      const baseY = ty * TILE
      for (let by = 0; by < R; by++) {
        for (let bx = 0; bx < R; bx++) {
          let ar = 0, ag = 0, ab = 0, aa = 0, n = 0
          for (let y = edge[by]; y < edge[by + 1]; y++) {
            let s = ((baseY + y) * imgW + baseX + edge[bx]) * 4
            for (let x = edge[bx]; x < edge[bx + 1]; x++, s += 4) {
              const a = raw[s + 3]
              if (a) { ar += raw[s] * a; ag += raw[s + 1] * a; ab += raw[s + 2] * a; aa += a }
              n++
            }
          }
          const d = ((ty * R + by) * outW + tx * R + bx) * 4
          if (aa) {
            out[d] = ar / aa
            out[d + 1] = ag / aa
            out[d + 2] = ab / aa
            out[d + 3] = aa / n
          }
        }
      }
    }
  }
  return { data: out, w: outW, h: outH }
}

/** `${source}@${R}` -> shrunk atlas. Small enough to keep all of them. */
const atlasCache = new Map()
async function atlasFor(source, R) {
  const key = `${source}@${R}`
  const hit = atlasCache.get(key)
  if (hit) return hit
  const t = readTsx(source)
  const { data, info } = await sharp(t.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const shrunk = shrinkAtlas(data, info.width, t.cols, t.rows, R)
  const entry = { ...shrunk, cols: t.cols, count: t.count }
  atlasCache.set(key, entry)
  return entry
}

/* =============================================================== render ====*/

function pickR(maxDim) {
  const want = TARGET / maxDim
  let best = R_LADDER[0]
  for (const r of R_LADDER) if (Math.abs(r - want) < Math.abs(best - want)) best = r
  return best
}

async function renderThumb(id, tmx, outPath) {
  const R = pickR(Math.max(tmx.width, tmx.height))
  const W = tmx.width * R
  const H = tmx.height * R
  const out = new Uint8Array(W * H * 3)
  for (let i = 0; i < out.length; i += 3) { out[i] = BG[0]; out[i + 1] = BG[1]; out[i + 2] = BG[2] }

  // Resolve the tilesets this map actually references, once.
  const sets = []
  for (const ts of tmx.tilesets) {
    const a = await atlasFor(ts.source, R)
    sets.push({ first: ts.first, last: ts.first + a.count - 1, a })
  }
  const setFor = (gid) => {
    for (let i = sets.length - 1; i >= 0; i--) {
      if (gid >= sets[i].first && gid <= sets[i].last) return sets[i]
    }
    return null
  }

  let drawn = 0
  let unresolved = 0
  for (const layer of tmx.layers) {
    const gids = layer.csv.trim().split(',')
    for (let i = 0; i < gids.length; i++) {
      // Flip flags live in the high bits; the art index is the low 29.
      const gid = (Number(gids[i]) >>> 0) & 0x1fffffff
      if (!gid) continue
      const s = setFor(gid)
      if (!s) { unresolved++; continue }
      const local = gid - s.first
      const sx = (local % s.a.cols) * R
      const sy = Math.floor(local / s.a.cols) * R
      const dx = (i % tmx.width) * R
      const dy = Math.floor(i / tmx.width) * R
      if (dy + R > H) continue // layer taller than the map header claims
      for (let y = 0; y < R; y++) {
        let sp = ((sy + y) * s.a.w + sx) * 4
        let dp = ((dy + y) * W + dx) * 3
        for (let x = 0; x < R; x++, sp += 4, dp += 3) {
          const a = s.a.data[sp + 3]
          if (!a) continue
          if (a === 255) {
            out[dp] = s.a.data[sp]
            out[dp + 1] = s.a.data[sp + 1]
            out[dp + 2] = s.a.data[sp + 2]
          } else {
            const inv = 255 - a
            out[dp] = (s.a.data[sp] * a + out[dp] * inv) / 255
            out[dp + 1] = (s.a.data[sp + 1] * a + out[dp + 1] * inv) / 255
            out[dp + 2] = (s.a.data[sp + 2] * a + out[dp + 2] * inv) / 255
          }
        }
      }
      drawn++
    }
  }

  await sharp(Buffer.from(out.buffer, 0, out.length), { raw: { width: W, height: H, channels: 3 } })
    .png({ palette: true, colours: 192, effort: 9, compressionLevel: 9 })
    .toFile(outPath)
  return { R, W, H, drawn, unresolved }
}

/* ================================================================= main ====*/

const selfMtime = statSync(fileURLToPath(import.meta.url)).mtimeMs

const psdk = readPsdkMaps()
const rmxp = readRmxpMaps()
const adj = readConnections()

const maps = [
  ...psdk.map((m) => ({ id: m.id, name: PSDK_NAMES[m.id] ?? humanise(m.id), region: 'exchange', rmxpId: null })),
  ...rmxp.map((m) => ({
    id: m.id,
    name: m.name && m.name.trim() ? m.name.trim() : humanise(m.id),
    region: regionOf(m.id, m.name || m.id, m.rmxpId),
    rmxpId: m.rmxpId,
    width: m.width,
    height: m.height,
  })),
].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

mkdirSync(OUT_DIR, { recursive: true })

const rendered = []
const skipped = []
const failed = []
const catalog = []

for (const m of maps) {
  if (ONLY && m.id !== ONLY) continue
  const outPath = join(OUT_DIR, `${m.id}.png`)
  let tmx = null
  try {
    tmx = parseTmx(m.id)
  } catch (e) {
    failed.push({ id: m.id, why: `tmx: ${e.message}` })
  }

  const width = tmx?.width ?? m.width ?? 0
  const height = tmx?.height ?? m.height ?? 0

  if (tmx) {
    let fresh = false
    if (!FORCE) {
      try { fresh = statSync(outPath).mtimeMs > Math.max(tmx.mtime, selfMtime) } catch { fresh = false }
    }
    if (fresh) {
      skipped.push(m.id)
    } else {
      try {
        const r = await renderThumb(m.id, tmx, outPath)
        rendered.push(m.id)
        log(`  ${m.id.padEnd(24)} ${String(width).padStart(3)}x${String(height).padEnd(3)} ` +
          `-> ${r.W}x${r.H} @${r.R}px/tile  ${r.drawn} tiles` +
          (r.unresolved ? `  (${r.unresolved} unresolved gids)` : ''))
      } catch (e) {
        failed.push({ id: m.id, why: e.message })
      }
    }
  }

  catalog.push({
    id: m.id,
    name: m.name,
    region: m.region,
    width,
    height,
    thumb: `/previews/${m.id}.png`,
    connections: [...(adj.get(m.id) ?? [])].sort(),
  })
}

/* --- catalogue ------------------------------------------------------------ */

if (!ONLY) {
  const known = new Set(catalog.map((c) => c.id))
  for (const c of catalog) c.connections = c.connections.filter((x) => known.has(x))

  const body = catalog.map((c) =>
    `  { id: ${JSON.stringify(c.id)}, name: ${JSON.stringify(c.name)}, ` +
    `region: ${JSON.stringify(c.region)}, width: ${c.width}, height: ${c.height}, ` +
    `thumb: ${JSON.stringify(c.thumb)}, connections: ${JSON.stringify(c.connections)} },`,
  ).join('\n')

  writeFileSync(CATALOG, `// GENERATED by tools/render-map-thumbs.mjs — do not edit by hand.
//
// One row per playable map, for the world-map / fast-travel browser.
// Deliberately imports nothing: this file is shared with the Node server build,
// so it must stay free of @rpgjs/* (and of anything else, really).
//
// region  'exchange' = the ${psdk.length} original PSDK maps
//         'kanto' / 'johto' = derived from the place name, the route number, or
//         the PBS map-id cluster (1..78 / 79..152). Anything none of those three
//         place confidently is 'other' — never a guess.
// thumb   site-root URL of the preview rendered from <id>.tmx
// connections  edge links from src/data/rmxp-connections.json, both directions,
//         filtered to maps that actually exist here.

export type MapRegion = 'exchange' | 'kanto' | 'johto' | 'other'

export interface MapCatalogEntry {
  id: string
  name: string
  region: MapRegion
  /** Map size in TILES (32px each). */
  width: number
  height: number
  thumb: string
  connections: string[]
}

export const MAP_CATALOG: MapCatalogEntry[] = [
${body}
]

export const REGION_LABELS: Record<MapRegion, string> = {
  exchange: 'Exchange City',
  kanto: 'Kanto',
  johto: 'Johto',
  other: 'Other',
}

export function findMap(id: string): MapCatalogEntry | undefined {
  return MAP_CATALOG.find((m) => m.id === id)
}
`)
}

/* --- report --------------------------------------------------------------- */

let bytes = 0
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith('.png')) bytes += statSync(join(OUT_DIR, f)).size
}
const byRegion = {}
for (const c of catalog) byRegion[c.region] = (byRegion[c.region] ?? 0) + 1

console.log(`\nmaps ${maps.length} · rendered ${rendered.length} · skipped (fresh) ${skipped.length} · failed ${failed.length}`)
console.log(`regions ${Object.entries(byRegion).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
console.log(`public/previews: ${readdirSync(OUT_DIR).filter((f) => f.endsWith('.png')).length} png, ${(bytes / 1048576).toFixed(2)} MB`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  ${f.id}: ${f.why}`)
  process.exitCode = 1
}
