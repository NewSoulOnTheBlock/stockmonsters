#!/usr/bin/env node
/*
 * render-map-full.mjs — look at a map's ART at a readable scale, with the tile
 * grid and tile coordinates drawn on top, so a cave mouth can be turned into an
 * (x, y) you can paste into src/data/rmxp-warps.json.
 *
 *   node tools/render-map-full.mjs --only ilex-forest
 *   node tools/render-map-full.mjs --only union-cave --crop 40,60,30,26 --scale 32
 *   node tools/render-map-full.mjs --only mt-moon --hitbox --scale 12
 *
 * Options
 *   --only <id>        map id (required)
 *   --scale <n>        pixels per tile, 1..32 (default: the largest that keeps
 *                      the image under --max on its long edge)
 *   --max <n>          long-edge budget when --scale is not given (default 1500)
 *   --crop x,y,w,h     region in TILES; everything else is skipped
 *   --hitbox           tint tiles that are BLOCKED in <id>.hitboxes.json red,
 *                      so walkable ground reads at a glance
 *   --grid             force the grid+labels on (they are on by default; use
 *                      --no-grid to see the bare art)
 *   --out <path>       default: <scratch or ./map-renders>/<id>[-crop].png
 *
 * This is a look-at-it tool, not part of any build. The tile blitting is the
 * same box-averaged-atlas approach as tools/render-map-thumbs.mjs (read that
 * file for why a shrunk ATLAS beats resizing the finished picture); the parts
 * that are new here are the crop window, the coordinate ruler and the hitbox
 * overlay.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TILED = join(ROOT, 'src', 'tiled')

const args = process.argv.slice(2)
const arg = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const ID = arg('--only')
const SCALE = arg('--scale') ? Number(arg('--scale')) : null
const MAXEDGE = Number(arg('--max', '1500'))
const CROP = arg('--crop') ? arg('--crop').split(',').map(Number) : null
const HITBOX = args.includes('--hitbox')
const GRID = !args.includes('--no-grid')
const OUT = arg('--out')

if (!ID) {
  console.error('usage: node tools/render-map-full.mjs --only <mapId> [--scale n] [--crop x,y,w,h] [--hitbox]')
  process.exit(2)
}

const TILE = 32
const BG = [0x14, 0x10, 0x24]

/* ================================================================== tmx ====*/

function parseTmx(id) {
  const xml = readFileSync(join(TILED, `${id}.tmx`), 'utf8')
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
    if (/visible="0"/.test(attrs)) continue
    if (/^(borders|systemtags|terrain_tag)/i.test(name)) continue
    const data = /<data encoding="csv">([\s\S]*?)<\/data>/.exec(m[2])
    if (!data) continue
    layers.push({ name, csv: data[1] })
  }
  return { width, height, tilesets, layers }
}

/* ============================================================== tilesets ===*/

const tsxCache = new Map()
function readTsx(source) {
  let t = tsxCache.get(source)
  if (t) return t
  const xml = readFileSync(join(TILED, source), 'utf8')
  const cols = Number(/columns="(\d+)"/.exec(xml)[1])
  const count = Number(/tilecount="(\d+)"/.exec(xml)[1])
  const img = /<image source="([^"]+)"/.exec(xml)
  t = { source, cols, count, rows: Math.ceil(count / cols), png: join(TILED, img[1]) }
  tsxCache.set(source, t)
  return t
}

/** Exact per-tile box average; never samples across a tile boundary. R=32 is
 *  an identity copy, which is what "full resolution" means here. */
function shrinkAtlas(raw, imgW, cols, rows, R) {
  const outW = cols * R
  const outH = rows * R
  const out = new Uint8Array(outW * outH * 4)
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
          if (aa) { out[d] = ar / aa; out[d + 1] = ag / aa; out[d + 2] = ab / aa; out[d + 3] = aa / n }
        }
      }
    }
  }
  return { data: out, w: outW, h: outH }
}

const atlasCache = new Map()
async function atlasFor(source, R) {
  const key = `${source}@${R}`
  if (atlasCache.has(key)) return atlasCache.get(key)
  const t = readTsx(source)
  const { data, info } = await sharp(t.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const entry = { ...shrinkAtlas(data, info.width, t.cols, t.rows, R), cols: t.cols, count: t.count }
  atlasCache.set(key, entry)
  return entry
}

/* ============================================================ 3x5 digits ===*/

// Enough of a font to write a tile number in the margin. Column-major bits are
// overkill; five rows of three characters each is easier to eyeball and edit.
const GLYPHS = {
  0: ['###', '# #', '# #', '# #', '###'],
  1: [' # ', '## ', ' # ', ' # ', '###'],
  2: ['###', '  #', '###', '#  ', '###'],
  3: ['###', '  #', '###', '  #', '###'],
  4: ['# #', '# #', '###', '  #', '  #'],
  5: ['###', '#  ', '###', '  #', '###'],
  6: ['###', '#  ', '###', '# #', '###'],
  7: ['###', '  #', '  #', '  #', '  #'],
  8: ['###', '# #', '###', '# #', '###'],
  9: ['###', '# #', '###', '  #', '###'],
}

/* ============================================================== render =====*/

const tmx = parseTmx(ID)
const [cx0, cy0, cw, ch] = CROP ?? [0, 0, tmx.width, tmx.height]
const x0 = Math.max(0, cx0)
const y0 = Math.max(0, cy0)
const x1 = Math.min(tmx.width, x0 + cw)
const y1 = Math.min(tmx.height, y0 + ch)
const tilesW = x1 - x0
const tilesH = y1 - y0

let R = SCALE
if (!R) {
  R = Math.max(2, Math.min(32, Math.floor(MAXEDGE / Math.max(tilesW, tilesH))))
}
R = Math.max(1, Math.min(32, Math.round(R)))

// Margin for the coordinate ruler, in pixels.
const M = GRID ? Math.max(14, Math.round(R * 0.9)) : 0
const W = tilesW * R + M
const H = tilesH * R + M
const out = new Uint8Array(W * H * 3)
for (let i = 0; i < out.length; i += 3) { out[i] = BG[0]; out[i + 1] = BG[1]; out[i + 2] = BG[2] }

const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const d = (y * W + x) * 3
  out[d] = r; out[d + 1] = g; out[d + 2] = b
}
const tint = (x, y, r, g, b, a) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const d = (y * W + x) * 3
  const inv = 1 - a
  out[d] = out[d] * inv + r * a
  out[d + 1] = out[d + 1] * inv + g * a
  out[d + 2] = out[d + 2] * inv + b * a
}

const sets = []
for (const ts of tmx.tilesets) {
  const a = await atlasFor(ts.source, R)
  sets.push({ first: ts.first, last: ts.first + a.count - 1, a })
}
const setFor = (gid) => {
  for (let i = sets.length - 1; i >= 0; i--) if (gid >= sets[i].first && gid <= sets[i].last) return sets[i]
  return null
}

let drawn = 0
for (const layer of tmx.layers) {
  const gids = layer.csv.trim().split(',')
  for (let i = 0; i < gids.length; i++) {
    const tx = i % tmx.width
    const ty = Math.floor(i / tmx.width)
    if (tx < x0 || tx >= x1 || ty < y0 || ty >= y1) continue
    const gid = (Number(gids[i]) >>> 0) & 0x1fffffff
    if (!gid) continue
    const s = setFor(gid)
    if (!s) continue
    const local = gid - s.first
    const sx = (local % s.a.cols) * R
    const sy = Math.floor(local / s.a.cols) * R
    const dx = (tx - x0) * R + M
    const dy = (ty - y0) * R + M
    for (let y = 0; y < R; y++) {
      let sp = ((sy + y) * s.a.w + sx) * 4
      let dp = ((dy + y) * W + dx) * 3
      for (let x = 0; x < R; x++, sp += 4, dp += 3) {
        const a = s.a.data[sp + 3]
        if (!a) continue
        if (a === 255) {
          out[dp] = s.a.data[sp]; out[dp + 1] = s.a.data[sp + 1]; out[dp + 2] = s.a.data[sp + 2]
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

/* ============================================================== overlay ====*/

let blockedTiles = 0
if (HITBOX) {
  const p = join(TILED, `${ID}.hitboxes.json`)
  const rects = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
  const hit = (tx, ty) => {
    const px = tx * TILE + 16, py = ty * TILE + 16
    return rects.some((r) => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height)
  }
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      if (!hit(tx, ty)) continue
      blockedTiles++
      // A dot at the tile centre, not a full-tile wash: the art has to stay
      // readable, because the art is what tells you where the cave mouth is.
      const dx = (tx - x0) * R + M
      const dy = (ty - y0) * R + M
      const d = Math.max(1, Math.round(R / 3))
      const off = Math.round((R - d) / 2)
      for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) tint(dx + off + x, dy + off + y, 255, 40, 40, 0.85)
    }
  }
}

if (GRID) {
  // Every tile gets a hairline; every 5th is brighter; every 10th is cyan and
  // carries a number in the margin. Reading a coordinate off the picture then
  // needs no counting past 5.
  for (let tx = x0; tx <= x1; tx++) {
    const dx = (tx - x0) * R + M
    const major = tx % 10 === 0
    const mid = tx % 5 === 0
    if (!major && !mid && R < 8) continue
    const c = major ? [0, 220, 255] : mid ? [255, 255, 255] : [140, 140, 140]
    const a = major ? 0.85 : mid ? 0.45 : 0.18
    for (let y = M; y < H; y++) tint(dx, y, c[0], c[1], c[2], a)
  }
  for (let ty = y0; ty <= y1; ty++) {
    const dy = (ty - y0) * R + M
    const major = ty % 10 === 0
    const mid = ty % 5 === 0
    if (!major && !mid && R < 8) continue
    const c = major ? [0, 220, 255] : mid ? [255, 255, 255] : [140, 140, 140]
    const a = major ? 0.85 : mid ? 0.45 : 0.18
    for (let x = M; x < W; x++) tint(x, dy, c[0], c[1], c[2], a)
  }

  const px = Math.max(1, Math.floor(R / 5)) // glyph pixel size
  const text = (str, ox, oy) => {
    let cur = ox
    for (const chr of str) {
      const g = GLYPHS[chr]
      if (!g) { cur += 2 * px; continue }
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (g[r][c] !== '#') continue
        for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++) {
          put(cur + c * px + xx, oy + r * px + yy, 0, 240, 255)
        }
      }
      cur += 4 * px
    }
  }
  const step = R >= 16 ? 5 : 10
  for (let tx = x0; tx <= x1; tx++) {
    if (tx % step) continue
    text(String(tx), (tx - x0) * R + M + 1, 2)
  }
  for (let ty = y0; ty <= y1; ty++) {
    if (ty % step) continue
    text(String(ty), 1, (ty - y0) * R + M + 1)
  }
}

/* ================================================================= out =====*/

const outDir = process.env.SM_RENDER_DIR ?? join(ROOT, 'map-renders')
mkdirSync(outDir, { recursive: true })
const name = CROP ? `${ID}-${x0}_${y0}_${tilesW}x${tilesH}.png` : `${ID}.png`
const path = OUT ?? join(outDir, name)
await sharp(Buffer.from(out.buffer, 0, out.length), { raw: { width: W, height: H, channels: 3 } })
  .png({ compressionLevel: 6 })
  .toFile(path)

console.log(`${ID}  ${tmx.width}x${tmx.height} tiles · window (${x0},${y0})..(${x1 - 1},${y1 - 1}) · ${R}px/tile · ${drawn} tiles drawn` +
  (HITBOX ? ` · ${blockedTiles} blocked` : ''))
console.log(path)
