/*
 * Imports the reskinned overworld walking charsets:
 *
 *   node tools/import-overworld.mjs
 *
 * Source: Stockmonsters/graphics/characters/<dexId 4-padded>.png — 128x128,
 * 4x4 RPG Maker charset (4 frames x 4 directions), magenta chroma key.
 * The ticker->dexId mapping comes from stockmonsters-reskin/overworld-manifest.json.
 *
 * Output:
 * - public/spritesheets/ow/<TICKER>.png  — key baked into real alpha
 * - src/data/ow-spritesheets.ts         — client spritesheet registrations
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { emitOwSpritesheets } from './ow-spritesheets-emit.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CHARS = resolve(ROOT, '../Stockmonsters/graphics/characters')
const RESKIN = resolve(ROOT, '../stockmonsters-reskin')
const OUT_IMG = join(ROOT, 'public/spritesheets/ow')

const manifest = JSON.parse(readFileSync(join(RESKIN, 'overworld-manifest.json'), 'utf8'))
mkdirSync(OUT_IMG, { recursive: true })

let done = 0, missing = 0
for (const [ticker, info] of Object.entries(manifest)) {
  const src = join(CHARS, `${String(info.dexId).padStart(4, '0')}.png`)
  if (!existsSync(src)) { console.warn(`  ! missing charset for ${ticker}`); missing++; continue }
  const { data, info: meta } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = meta
  // Pass 1: the top-left pixel is usually the chroma background
  const key = data.subarray(0, 4)
  if (key[3] > 200) {
    for (let i = 0; i < data.length; i += ch) {
      const d = Math.hypot(data[i] - key[0], data[i + 1] - key[1], data[i + 2] - key[2])
      if (d < 90) data[i + 3] = 0
    }
  }
  // Pass 2: some sheets mix keys per frame or ship a transparent corner over
  // a still-magenta body. Find the dominant remaining magenta-ish colour and
  // key it too — but only when it covers background-scale area (>200px), so
  // a genuinely pink creature is never eaten.
  for (let pass = 0; pass < 3; pass++) {
    const counts = new Map()
    for (let i = 0; i < data.length; i += ch) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
      if (a > 200 && r > 180 && g < 120 && b > 80 && r - g > 90) {
        const c = (r << 16) | (g << 8) | b
        counts.set(c, (counts.get(c) ?? 0) + 1)
      }
    }
    let top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]
    let kr, kg, kb
    if (top && top[1] >= 200) {
      ;[kr, kg, kb] = [(top[0] >> 16) & 255, (top[0] >> 8) & 255, top[0] & 255]
    } else {
      // noisy key: no single dominant colour — use the centroid of all
      // magenta-ish pixels when they still cover background-scale area
      let n = 0, sr = 0, sg = 0, sb = 0
      for (const [c, cnt] of counts) {
        n += cnt; sr += ((c >> 16) & 255) * cnt; sg += ((c >> 8) & 255) * cnt; sb += (c & 255) * cnt
      }
      if (n < 100) break
      ;[kr, kg, kb] = [sr / n, sg / n, sb / n]
    }
    for (let i = 0; i < data.length; i += ch) {
      const d = Math.hypot(data[i] - kr, data[i + 1] - kg, data[i + 2] - kb)
      if (data[i + 3] > 0 && d < 70) data[i + 3] = 0
    }
  }
  await sharp(data, { raw: { width: w, height: h, channels: ch } }).png().toFile(join(OUT_IMG, `${ticker}.png`))
  done++
}

// ow-spritesheets.ts is emitted from a directory scan shared with
// tools/gen-ow.mjs (fallback charsets), so both generators cooperate: the
// list is always the full set of sheets on disk. Run gen-ow.mjs after this
// script whenever new dex creatures need fallback charsets.
const total = emitOwSpritesheets(ROOT)
console.log(`${done} overworld charsets imported, ${missing} missing, ${total} sheets listed`)
