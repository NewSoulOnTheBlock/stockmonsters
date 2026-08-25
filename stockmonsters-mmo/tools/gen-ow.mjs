/*
 * Generates fallback overworld walking charsets for every dex creature that
 * has no real PSDK charset:
 *
 *   node tools/gen-ow.mjs
 *
 * Source: public/dex/<TICKER>.png (96x96 chroma-cleaned front art, emitted by
 * tools/import-dex.mjs). Real charsets in public/spritesheets/ow/ (emitted by
 * tools/import-overworld.mjs from PSDK walk art) are NEVER overwritten — this
 * script only fills the gaps.
 *
 * Output frame layout (RPG-JS RMSpritesheet(4, 4), 128x128, 32x32 frames):
 * - rows: down=0, left=1, right=2, up=3
 * - down/left/up rows use the front art as-is; the right row is the
 *   horizontal mirror of the left row (one consistent rule — PSDK front
 *   sprites face the viewer, slightly to the viewer's left)
 * - the sprite is alpha-trimmed, downscaled (nearest-neighbour, never
 *   enlarged) to fit 28x28, and anchored bottom-centre in each frame
 * - walk cycle is a 1px vertical bob: frames 0/2 at baseline, 1/3 raised
 *
 * Generator cooperation: BOTH this script and tools/import-overworld.mjs
 * emit src/data/ow-spritesheets.ts by scanning public/spritesheets/ow/, so
 * the ticker list is always the full set of sheets on disk no matter which
 * script ran last. Run import-overworld.mjs first if the real charsets
 * changed, then this script. Idempotent and deterministic.
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { emitOwSpritesheets } from './ow-spritesheets-emit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const DEX_IMG = join(ROOT, 'public/dex')
const OUT_IMG = join(ROOT, 'public/spritesheets/ow')

const FRAME = 32       // one charset cell
const SPRITE_MAX = 28  // trimmed art fits inside this square
const BASELINE = 1     // px gap between feet and the frame's bottom edge

const dex = JSON.parse(readFileSync(join(ROOT, 'src/data/dex.json'), 'utf8'))
mkdirSync(OUT_IMG, { recursive: true })

/** Blits raw RGBA `src` (sw x sh) into raw RGBA `dst` (dw wide) at (dx, dy). */
function blit(dst, dw, src, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4
      if (src[s + 3] === 0) continue
      const d = ((dy + y) * dw + (dx + x)) * 4
      dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3]
    }
  }
}

async function generate(ticker, srcPng, outPng) {
  let { data, info } = await sharp(srcPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info

  // Safety chroma pass: dex art is already cleaned by import-dex.mjs, but if a
  // file still carries an opaque corner background, key it out by colour
  // distance (same rule as tools/import-dex.mjs).
  const at = (x, y) => data.subarray((y * w + x) * ch, (y * w + x) * ch + 4)
  const opaqueCorners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
    .filter((c) => c[3] > 200)
  if (opaqueCorners.length >= 3) {
    const key = opaqueCorners[0]
    for (let i = 0; i < data.length; i += ch) {
      const d = Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2])
      if (d < 90) data[i + 3] = 0
    }
  }

  // Chroma-halo cleanup. Most dex fronts keep a 1px anti-aliased magenta
  // fringe (and sometimes floating speckles) that the corner keying in
  // import-dex.mjs missed. Genuinely pink creatures (LADYS, GME, APP, WIF...)
  // must survive, so decide per sprite: halo contamination means the
  // magenta-ish pixels live on the transparency border (fringe/magenta > 0.5),
  // a pink creature keeps its magenta in the body. Only contaminated sprites
  // get cleaned, and only by eroding magenta that touches transparency — the
  // interior of the sprite is never touched.
  const isMagenta = (i) => {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    return r > 180 && g < 120 && b > 80 && r - g > 90
  }
  const alphaAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : data[(y * w + x) * ch + 3]
  let magenta = 0, fringe = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch
      if (data[i + 3] === 0 || !isMagenta(i)) continue
      magenta++
      if (alphaAt(x - 1, y) === 0 || alphaAt(x + 1, y) === 0 || alphaAt(x, y - 1) === 0 || alphaAt(x, y + 1) === 0) fringe++
    }
  }
  if (magenta >= 20 && fringe / magenta > 0.5) {
    for (let pass = 0; pass < 4; pass++) {
      const kill = []
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * ch
          if (data[i + 3] === 0 || !isMagenta(i)) continue
          if (alphaAt(x - 1, y) === 0 || alphaAt(x + 1, y) === 0 || alphaAt(x, y - 1) === 0 || alphaAt(x, y + 1) === 0) kill.push(i)
        }
      }
      if (kill.length === 0) break
      for (const i of kill) data[i + 3] = 0
    }
  }

  // Trim transparent borders
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return false // fully transparent art — nothing to draw
  const tw = maxX - minX + 1, th = maxY - minY + 1

  // Downscale (never enlarge) with nearest-neighbour to keep the pixel look
  const scale = Math.min(1, SPRITE_MAX / Math.max(tw, th))
  const sw = Math.max(1, Math.round(tw * scale))
  const sh = Math.max(1, Math.round(th * scale))
  const scaled = await sharp(data, { raw: { width: w, height: h, channels: ch } })
    .extract({ left: minX, top: minY, width: tw, height: th })
    .resize(sw, sh, { kernel: 'nearest', fit: 'fill' })
    .raw()
    .toBuffer()
  const mirrored = await sharp(scaled, { raw: { width: sw, height: sh, channels: 4 } })
    .flop()
    .raw()
    .toBuffer()

  // Compose the 4x4 charset. Rows (RMSpritesheet): down, left, right, up.
  // Left/down/up use the art as-is; right mirrors left. Frames 1/3 bob up 1px.
  const SIZE = FRAME * 4
  const sheet = Buffer.alloc(SIZE * SIZE * 4)
  const rows = [scaled, scaled, mirrored, scaled]
  for (let row = 0; row < 4; row++) {
    for (let frame = 0; frame < 4; frame++) {
      const bob = frame % 2 // frames 0/2 baseline, 1/3 raised 1px
      const dx = frame * FRAME + Math.floor((FRAME - sw) / 2)
      const dy = row * FRAME + (FRAME - sh - BASELINE - bob)
      blit(sheet, SIZE, rows[row], sw, sh, dx, dy)
    }
  }
  await sharp(sheet, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toFile(outPng)
  return true
}

let generated = 0, skipped = 0, failed = 0
for (const entry of dex) {
  const out = join(OUT_IMG, `${entry.ticker}.png`)
  if (existsSync(out)) { skipped++; continue } // real PSDK charset — keep it
  const src = join(DEX_IMG, `${entry.ticker}.png`)
  if (!existsSync(src)) {
    console.warn(`  ! no dex art for ${entry.ticker}`)
    failed++
    continue
  }
  if (await generate(entry.ticker, src, out)) generated++
  else { console.warn(`  ! empty dex art for ${entry.ticker}`); failed++ }
}

const total = emitOwSpritesheets(ROOT)
console.log(`${generated} charsets generated, ${skipped} real sheets kept, ${failed} failed`)
console.log(`OW_TICKERS now lists ${total} spritesheets`)
