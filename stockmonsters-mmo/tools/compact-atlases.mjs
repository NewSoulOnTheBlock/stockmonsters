#!/usr/bin/env node
/*
 * compact-atlases.mjs — give every map an atlas that holds ONLY the tiles that
 * map actually draws, and rewrite the map to use it.
 *
 *   node tools/compact-atlases.mjs             # report only: per-map before/after MB
 *   node tools/compact-atlases.mjs --write     # produce src/tiled/compact/
 *   node tools/compact-atlases.mjs --write --only exterior
 *
 * WHY THIS EXISTS
 *
 * The TMX maps reference a handful of shared HGSS atlases, and a PNG's file
 * size says nothing about what it costs on a GPU: an atlas is uploaded
 * decoded, at width x height x 4 bytes, transparency included. TECH-Buildings
 * .png is 1.3 MB on disk and 96 MB in VRAM. The spawn map, exterior.tmx, pulls
 * 228 MB of texture; cave.tmx pulls 265 MB. An iOS Safari tab is killed well
 * below that, which is exactly the reported bug — the game loads, you walk for
 * ten seconds, the next map's atlases upload, the tab dies white.
 *
 * Two of those atlases (4096x6144 and 4800x2016) also exceed 4096 in a
 * dimension, which plenty of iOS devices refuse to upload at all.
 *
 * But exterior.tmx only ever draws 700 DISTINCT tiles. Packed on their own —
 * with every frame of the 24 animations among them, which is what takes it to
 * 1089 — that is 1056x1056 = 4.3 MB. Same picture, 54x less texture.
 *
 * WHY A SEPARATE OUTPUT FOLDER, NOT AN IN-PLACE REWRITE
 *
 * src/tiled/ is the source art: those TMX/TSX files are what a person opens in
 * Tiled to edit the world, and a compacted atlas is unusable for that (the
 * tiles are in packing order, not in the artist's layout). Rewriting them in
 * place would also mean one bad run of this script destroys the originals, and
 * a second run would compact an already-compacted map. So everything is written
 * to src/tiled/compact/ and the build PREFERS it:
 *
 *   - vite.config.ts points tiledMapFolderPlugin at compact/ when it exists,
 *     so dist/client/map gets the small atlases and not the big ones
 *   - server.mjs lists compact/ first in tiledBasePaths, so the TMX the server
 *     parses (and streams to clients) is the compacted one
 *
 * Both fall back to src/tiled/ when compact/ is absent, so a fresh checkout that
 * has never run this script still builds and plays — just heavy.
 *
 * The folder sits INSIDE src/tiled on purpose: `npx tsc` already treats every
 * .tsx tileset there as broken TypeScript, and the project's standing filter is
 * `grep -v '^src/tiled/'`, which keeps covering the generated ones too. (It is
 * also listed in tsconfig.json's `exclude`, so it adds no new noise.)
 *
 * ITS OUTPUT HAS TO BE COMMITTED. deploy/sync.sh ships `git archive HEAD` and
 * builds on the box, so anything left untracked simply is not there — the box
 * would fall back to the full-size atlases and the iPhone fix would never
 * reach production. Generated-and-committed is already how public/previews and
 * src/data/map-catalog.ts work here.
 *
 * THE TRAPS (all of these silently corrupt maps if missed)
 *
 *  - Flip flags. The top 3 bits of a gid are horizontal/vertical/diagonal flip.
 *    They are masked off to find the tile and OR'd back onto the new gid.
 *  - Animated tiles. The nastiest one by far, because a still render cannot see
 *    it: the renderer walks the atlas SIDEWAYS to animate, so an animation's
 *    frames have to be a contiguous run on one row. See buildAtlas.
 *  - Per-tile data. Anything a tileset attaches to a tile has to survive the
 *    remap or the map is subtly wrong. See safetyOf below: a tileset carrying
 *    data this script cannot carry over makes the whole map fall through to a
 *    verbatim copy rather than shipping something broken.
 *  - Tile size. Only tilesets whose tiles are all the same size can share one
 *    packed atlas; a map mixing sizes is refused (today every tileset is 32x32).
 *  - firstgid. The compacted map declares exactly one tileset at firstgid=1, so
 *    ordering is trivially consistent.
 *  - Object gids. <object gid="..."> is remapped too, not just layer data.
 *
 * THE TRADE
 *
 * Compacting per MAP means two maps that share an atlas no longer share it —
 * some duplication on disk and in the texture cache. It is the right trade
 * here: peak-per-map is what kills the tab, and the worst map in the world
 * drops from 265 MB to 5.3.
 * Identical atlases are still shared between maps by content hash (many of the
 * placeholder mapNNN maps produce byte-identical output), and --write prints
 * the resulting on-disk total so an explosion cannot go unnoticed.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TILED = join(ROOT, 'src', 'tiled')
const OUT = join(TILED, 'compact')

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

/** Gid bits that are flip flags rather than part of the tile index. */
const FLIP_MASK = 0xe0000000
const GID_MASK = 0x1fffffff
/** Every GPU this has to run on accepts 4096; plenty of iOS devices stop there. */
const MAX_EDGE = 4096

const mb = (w, h) => (w * h * 4) / 1048576

/* ============================================================== tilesets ===*/

/**
 * A TSX this script knows how to rebuild. Anything else is a refusal, not a
 * guess: the runtime (see sanitizeTileset in @rpgjs/tiledmap/src/streaming.ts)
 * throws away wangsets, terrains and per-tile properties/objectgroups before
 * they ever reach a client, so dropping them here changes nothing that plays —
 * but per-tile <properties>, <objectgroup> collision shapes or a per-tile
 * <image> would mean the tileset carries data this packer does not move, and a
 * map 80% smaller and subtly wrong is worse than a map that is big.
 */
function safetyOf(xml) {
  if (/<tile\b[^>]*>[\s\S]*?<properties>/.test(xml)) return 'per-tile <properties>'
  if (/<objectgroup\b/.test(xml)) return 'per-tile <objectgroup> (collision shapes)'
  if (/<terrain\b/.test(xml)) return 'terrain definitions'
  if (/<tile\b[^>]*>[\s\S]*?<image\b/.test(xml)) return 'image-collection tileset'
  return null
}

const tsxCache = new Map()
function readTsx(source) {
  const hit = tsxCache.get(source)
  if (hit) return hit
  const xml = readFileSync(join(TILED, source), 'utf8')
  const img = /<image source="([^"]+)"\s+width="(\d+)"\s+height="(\d+)"/.exec(xml)
  if (!img) throw new Error(`${source}: no <image source= width= height=>`)
  /** local tile id -> [{ tileid, duration }] */
  const animations = new Map()
  for (const m of xml.matchAll(/<tile\s+id="(\d+)"\s*>([\s\S]*?)<\/tile>/g)) {
    const frames = [...m[2].matchAll(/<frame\s+tileid="(\d+)"\s+duration="(\d+)"\s*\/>/g)]
      .map((f) => ({ tileid: Number(f[1]), duration: Number(f[2]) }))
    if (frames.length) animations.set(Number(m[1]), frames)
  }
  const t = {
    source,
    tw: Number(/tilewidth="(\d+)"/.exec(xml)[1]),
    th: Number(/tileheight="(\d+)"/.exec(xml)[1]),
    cols: Number(/columns="(\d+)"/.exec(xml)[1]),
    count: Number(/tilecount="(\d+)"/.exec(xml)[1]),
    png: img[1],
    imgW: Number(img[2]),
    imgH: Number(img[3]),
    animations,
    unsafe: safetyOf(xml),
  }
  tsxCache.set(source, t)
  return t
}

/** Decoded RGBA of an atlas, cached — the same PNG is read by dozens of maps. */
const pixelCache = new Map()
async function pixelsOf(t) {
  const hit = pixelCache.get(t.png)
  if (hit) return hit
  const { data, info } = await sharp(join(TILED, t.png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const entry = { data, w: info.width, h: info.height }
  pixelCache.set(t.png, entry)
  return entry
}

/* =================================================================== tmx ===*/

function parseTmx(id) {
  const xml = readFileSync(join(TILED, `${id}.tmx`), 'utf8')
  const tilesets = []
  for (const m of xml.matchAll(/<tileset\b[^>]*\/>/g)) {
    const first = /firstgid="(\d+)"/.exec(m[0])
    const source = /source="([^"]+)"/.exec(m[0])
    // An embedded (non-source) tileset would have children and so would not
    // match the self-closing form at all; a self-closing one without a source
    // is malformed. Either way, refuse rather than mis-handle.
    if (!first || !source) throw new Error(`${id}.tmx: unhandled tileset tag ${m[0]}`)
    tilesets.push({ first: Number(first[1]), source: source[1], tag: m[0] })
  }
  tilesets.sort((a, b) => a.first - b.first)
  return { xml, tilesets }
}

/** Every gid the map draws, flags already masked off. Layer data AND objects. */
function usedGids(xml) {
  const used = new Set()
  for (const d of xml.matchAll(/<data encoding="csv">([\s\S]*?)<\/data>/g)) {
    for (const m of d[1].matchAll(/\d+/g)) {
      const gid = (Number(m[0]) >>> 0) & GID_MASK
      if (gid) used.add(gid)
    }
  }
  for (const o of xml.matchAll(/<object\b[^>]*\bgid="(\d+)"/g)) {
    const gid = (Number(o[1]) >>> 0) & GID_MASK
    if (gid) used.add(gid)
  }
  return used
}

/* ================================================================= plan ====*/

/**
 * Work out what one map's compacted tileset contains, without touching pixels.
 * Returns null with a `refused` reason when the map must be copied verbatim.
 */
function planMap(id) {
  const { xml, tilesets } = parseTmx(id)
  const sets = tilesets.map((ts) => ({ ...ts, t: readTsx(ts.source) }))

  const unsafe = sets.find((s) => s.t.unsafe)
  if (unsafe) return { id, refused: `${unsafe.source} carries ${unsafe.t.unsafe}`, sets }

  const tw = sets[0]?.t.tw ?? 32
  const th = sets[0]?.t.th ?? 32
  const mixed = sets.find((s) => s.t.tw !== tw || s.t.th !== th)
  if (mixed) return { id, refused: `mixes tile sizes (${tw}x${th} and ${mixed.t.tw}x${mixed.t.th})`, sets }

  // gid -> the tileset that owns it. Scanning backwards matches Tiled's rule
  // that a gid belongs to the last tileset whose firstgid is <= it.
  const owner = (gid) => {
    for (let i = sets.length - 1; i >= 0; i--) {
      if (gid >= sets[i].first && gid < sets[i].first + sets[i].t.count) return sets[i]
    }
    return null
  }

  const used = usedGids(xml)
  let unresolved = 0
  const wanted = new Set() // `${setIndex}:${localId}`, tiles the map draws directly
  const resolvedGids = new Map() // original gid -> { setIndex, local }
  for (const gid of used) {
    const s = owner(gid)
    if (!s) { unresolved++; continue }
    const si = sets.indexOf(s)
    const local = gid - s.first
    wanted.add(`${si}:${local}`)
    resolvedGids.set(gid, { setIndex: si, local })
  }

  // Deterministic packing order: source tileset, then tile id. Two runs of this
  // script on unchanged input must produce byte-identical output, or every
  // build churns the whole map folder.
  const slots = [...wanted]
    .map((k) => { const [si, local] = k.split(':').map(Number); return { setIndex: si, local } })
    .sort((a, b) => a.setIndex - b.setIndex || a.local - b.local)

  // An animation whose frames are not all inside its own tileset cannot be
  // packed as a row-run, and a broken frame reference would be packed as
  // whatever art happened to be at that index. Refuse the map instead.
  for (const s of slots) {
    for (const f of sets[s.setIndex].t.animations.get(s.local) ?? []) {
      if (f.tileid < 0 || f.tileid >= sets[s.setIndex].t.count) {
        return { id, refused: `${sets[s.setIndex].source} tile ${s.local} animates to frame ${f.tileid}, outside the tileset`, sets }
      }
    }
  }

  const before = sets.reduce((sum, s) => sum + mb(s.t.imgW, s.t.imgH), 0)
  return { id, xml, sets, slots, resolvedGids, unresolved, tw, th, before }
}

/* ================================================================ build ====*/

/**
 * Pack the planned tiles into one atlas.
 *
 * ANIMATION DICTATES THE LAYOUT, and getting this wrong is invisible in a still
 * render. @canvasengine/presets does not draw an animated tile by cycling
 * through its frame textures — it draws frame 0 and then WALKS THE ATLAS
 * SIDEWAYS:
 *
 *   setAnimation(r) { const step = (frames[1].tileid - frames[0].tileid) * this.width
 *                     r.tileAnimX(step, frames.length) }
 *
 * so every frame of an animation must sit on ONE ROW of the atlas, in order, at
 * a constant tile stride, starting at frame 0. The HGSS source art satisfies
 * that — all 242 animations in TECH-Animations.tsx are a single row at a
 * constant stride — which is why it has never had to be thought about. A packer
 * that ignores it produces a map that is pixel-perfect as a still image and
 * turns the sea into stripes of whatever art happens to lie to the right of
 * each water tile. That is exactly what the first version of this script did,
 * and no still render could have caught it.
 *
 * So the atlas is laid out from two pools:
 *   RUNS    one contiguous run per animated tile, frames in order at stride 1,
 *           never split across a row and never merged with anything
 *   SINGLES everything else, filling the space left over. Identical pixels share
 *           a slot, which is a large win: the HGSS atlases are mostly
 *           transparent, so a map's blank cells all collapse onto one tile.
 */
async function buildAtlas(plan) {
  const { slots, sets, tw, th } = plan

  const tileBuf = async (setIndex, local) => {
    const t = sets[setIndex].t
    const px = await pixelsOf(t)
    const sx = (local % t.cols) * tw
    const sy = Math.floor(local / t.cols) * th
    const buf = Buffer.allocUnsafe(tw * th * 4)
    for (let y = 0; y < th; y++) {
      px.data.copy(buf, y * tw * 4, ((sy + y) * px.w + sx) * 4, ((sy + y) * px.w + sx + tw) * 4)
    }
    return buf
  }

  /** One entry per animated tile the map draws: its frames' pixels, in order. */
  const runs = []
  /** Everything else, dedupable. */
  const singles = []
  for (const s of slots) {
    const key = `${s.setIndex}:${s.local}`
    const frames = sets[s.setIndex].t.animations.get(s.local)
    if (frames) {
      const bufs = []
      for (const f of frames) bufs.push(await tileBuf(s.setIndex, f.tileid))
      runs.push({ key, frames, bufs })
    } else {
      singles.push({ key, buf: await tileBuf(s.setIndex, s.local) })
    }
  }

  // Longest run first, so fitting runs into rows never has to back-track.
  runs.sort((x, y) => y.bufs.length - x.bufs.length || (x.key < y.key ? -1 : 1))

  const byHash = new Map()
  const uniqueSingles = []
  for (const single of singles) {
    const hash = createHash('sha1').update(single.buf).digest('hex')
    const seen = byHash.get(hash)
    if (seen !== undefined) { single.sameAs = seen; continue }
    byHash.set(hash, uniqueSingles.length)
    uniqueSingles.push(single)
  }

  const runCells = runs.reduce((sum, r) => sum + r.bufs.length, 0)
  const longestRun = runs.reduce((m, r) => Math.max(m, r.bufs.length), 1)
  const total = Math.max(1, runCells + uniqueSingles.length)
  const maxCols = Math.floor(MAX_EDGE / tw)
  if (longestRun > maxCols) {
    throw new Error(`${plan.id}: an animation is ${longestRun} frames, wider than a ${MAX_EDGE}px atlas`)
  }
  const cols = Math.min(maxCols, Math.max(longestRun, Math.ceil(Math.sqrt(total))))

  /* --- layout ------------------------------------------------------------- */

  /** Row-major cells; each is a tile's pixels, or null for an unfilled gap. */
  const cells = []
  /** `${setIndex}:${local}` -> slot index in the packed atlas. */
  const slotOf = new Map()
  /** run key -> its first slot, so the TSX can number the frames from there. */
  const runStart = new Map()
  const queue = uniqueSingles.slice()
  const takeSingle = () => {
    const next = queue.shift()
    if (!next) return false
    slotOf.set(next.key, cells.length)
    cells.push(next.buf)
    return true
  }

  for (const run of runs) {
    const room = cols - (cells.length % cols)
    // A run that would straddle a row boundary starts a new row instead; the
    // tail of the old row is filled with singles rather than wasted.
    if (run.bufs.length > room) {
      for (let i = 0; i < room; i++) if (!takeSingle()) cells.push(null)
    }
    runStart.set(run.key, cells.length)
    // The map's gid points at frame 0, which is what the renderer draws at rest
    // — the same tile it draws from the original atlas.
    slotOf.set(run.key, cells.length)
    for (const buf of run.bufs) cells.push(buf)
  }
  while (queue.length) takeSingle()

  // Deduped singles land on whichever slot their twin took.
  for (const single of singles) {
    if (single.sameAs === undefined) continue
    slotOf.set(single.key, slotOf.get(uniqueSingles[single.sameAs].key))
  }

  /* --- pixels ------------------------------------------------------------- */

  // A few maps are blank scratch pages that draw nothing at all. They still need
  // a tileset a parser will accept, so they get one transparent tile that no gid
  // ever points at.
  const n = Math.max(1, cells.length)
  const rows = Math.ceil(n / cols)
  const W = cols * tw
  const H = rows * th
  if (H > MAX_EDGE) throw new Error(`${plan.id}: ${n} tiles will not fit under ${MAX_EDGE}px (${W}x${H})`)

  const out = Buffer.alloc(W * H * 4)
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue
    const dx = (i % cols) * tw
    const dy = Math.floor(i / cols) * th
    for (let y = 0; y < th; y++) {
      cells[i].copy(out, ((dy + y) * W + dx) * 4, y * tw * 4, (y + 1) * tw * 4)
    }
  }

  return {
    slotOf, runStart, n, cols, rows, W, H, raw: out,
    deduped: singles.length - uniqueSingles.length,
    animated: runs.length,
    gaps: cells.filter((c) => !c).length,
  }
}

/* =============================================================== emitters ==*/

function tsxText(plan, atlas, pngName) {
  const { sets, slots, tw, th } = plan
  // One <tile> per animated tile, numbering the frames straight off the run the
  // packer laid down: consecutive, in order, on one row. That makes the step the
  // renderer computes — (frame[1] - frame[0]) * tilewidth — exactly one tile.
  const blocks = []
  for (const s of slots) {
    const frames = sets[s.setIndex].t.animations.get(s.local)
    if (!frames) continue
    const start = atlas.runStart.get(`${s.setIndex}:${s.local}`)
    blocks.push({
      start,
      text: [
        ` <tile id="${start}">`,
        '  <animation>',
        ...frames.map((f, i) => `   <frame tileid="${start + i}" duration="${f.duration}"/>`),
        '  </animation>',
        ' </tile>',
      ].join('\n'),
    })
  }
  // Ascending tile id, the way Tiled writes them.
  const lines = blocks.sort((a, b) => a.start - b.start).map((b) => b.text)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by tools/compact-atlases.mjs from src/tiled/${plan.id}.tmx — do not edit.
     Holds only the ${atlas.n} tiles that map draws, plus every frame of the
     ${atlas.animated} animations among them, laid out so each animation is one
     unbroken row-run. Edit the originals in src/tiled/. -->
<tileset version="1.10" tiledversion="1.11.0" name="${plan.id}-compact" tilewidth="${tw}" tileheight="${th}" tilecount="${atlas.n}" columns="${atlas.cols}">
 <image source="${pngName}" width="${atlas.W}" height="${atlas.H}"/>
${lines.join('\n')}${lines.length ? '\n' : ''}</tileset>
`
}

function tmxText(plan, atlas, tsxName) {
  const { xml, sets, resolvedGids } = plan

  const remap = (value) => {
    const raw = Number(value) >>> 0
    const gid = raw & GID_MASK
    if (!gid) return 0
    const hit = resolvedGids.get(gid)
    // A gid no tileset claims draws nothing today and must keep drawing
    // nothing; passing it through would index into the compacted atlas.
    if (!hit) return 0
    return ((atlas.slotOf.get(`${hit.setIndex}:${hit.local}`) + 1) | (raw & FLIP_MASK)) >>> 0
  }

  // All the <tileset .../> declarations collapse into one at firstgid=1. They
  // sit consecutively at the top of a TMX, so the whole span is replaced in one
  // go — and the span is first checked to hold nothing but those tags and
  // whitespace, so a map laid out some other way is refused rather than
  // silently losing a layer.
  // Document order, which is not necessarily firstgid order.
  const at = sets.map((s) => ({ at: xml.indexOf(s.tag), len: s.tag.length }))
  const start = Math.min(...at.map((a) => a.at))
  const end = Math.max(...at.map((a) => a.at + a.len))
  let span = xml.slice(start, end)
  for (const s of sets) span = span.replace(s.tag, '')
  if (span.trim()) throw new Error(`${plan.id}.tmx: content between the <tileset> declarations`)
  let out = xml.slice(0, start) + `<tileset firstgid="1" source="${tsxName}"/>` + xml.slice(end)

  // Layer data is nothing but digits, commas and whitespace, so rewriting every
  // integer inside a <data> block is exactly rewriting every gid.
  out = out.replace(/(<data encoding="csv">)([\s\S]*?)(<\/data>)/g,
    (_, open, body, close) => open + body.replace(/\d+/g, (d) => String(remap(d))) + close)
  out = out.replace(/(<object\b[^>]*\bgid=")(\d+)(")/g, (_, a, d, b) => a + remap(d) + b)

  return out
}

/* ================================================================== main ===*/

const ids = readdirSync(TILED)
  .filter((f) => f.endsWith('.tmx'))
  .map((f) => f.replace(/\.tmx$/, ''))
  .filter((id) => !ONLY || id === ONLY)
  .sort()

if (!ids.length) {
  console.error(ONLY ? `no map ${ONLY}.tmx in src/tiled` : 'no maps in src/tiled')
  process.exit(2)
}

if (WRITE && !ONLY) rmSync(OUT, { recursive: true, force: true })
if (WRITE) mkdirSync(OUT, { recursive: true })

const rows = []
const refusals = []
const copiedThrough = new Set()
/** atlas+tileset content hash -> the map id whose .png/.tsx everyone reuses. */
const shared = new Map()

for (const id of ids) {
  const plan = planMap(id)

  if (plan.refused) {
    refusals.push({ id, why: plan.refused })
    const before = plan.sets.reduce((sum, s) => sum + mb(s.t.imgW, s.t.imgH), 0)
    rows.push({ id, before, after: before, tiles: null, note: 'verbatim' })
    if (WRITE) {
      copyFileSync(join(TILED, `${id}.tmx`), join(OUT, `${id}.tmx`))
      for (const s of plan.sets) {
        if (copiedThrough.has(s.source)) continue
        copiedThrough.add(s.source)
        copyFileSync(join(TILED, s.source), join(OUT, s.source))
        copyFileSync(join(TILED, s.t.png), join(OUT, s.t.png))
      }
    }
    continue
  }

  const atlas = await buildAtlas(plan)
  const after = mb(atlas.W, atlas.H)
  rows.push({
    id, before: plan.before, after, tiles: atlas.n, animated: atlas.animated,
    dims: `${atlas.W}x${atlas.H}`, deduped: atlas.deduped, unresolved: plan.unresolved,
  })

  if (!WRITE) continue

  // palette:false is not the belt-and-braces it looks like — sharp turns PNG
  // quantisation ON as soon as `effort` is passed, and a quantised atlas is not
  // the same art (the first run of this shifted colours by up to 53/255, which
  // the render comparison caught). Nothing here may be lossy.
  const png = await sharp(atlas.raw, { raw: { width: atlas.W, height: atlas.H, channels: 4 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer()
  // Byte-identical atlases (common among the placeholder mapNNN maps) share one
  // file, so the browser uploads the texture once and the folder stays small.
  const tsxProbe = tsxText(plan, atlas, `${id}.png`)
  const key = createHash('sha1').update(png).update(tsxProbe.split(id).join('')).digest('hex')
  const ownerId = shared.get(key)
  if (ownerId === undefined) {
    shared.set(key, id)
    writeFileSync(join(OUT, `${id}.png`), png)
    writeFileSync(join(OUT, `${id}.tsx`), tsxProbe)
  }
  writeFileSync(join(OUT, `${id}.tmx`), tmxText(plan, atlas, `${ownerId ?? id}.tsx`))
}

/* ================================================================ report ===*/

rows.sort((a, b) => b.before - a.before)
console.log('MAP'.padEnd(26) + 'BEFORE MB'.padStart(10) + 'AFTER MB'.padStart(10) + 'TILES'.padStart(8) + '  ATLAS')
for (const r of rows) {
  console.log(
    r.id.padEnd(26) + r.before.toFixed(1).padStart(10) + r.after.toFixed(2).padStart(10) +
    String(r.tiles ?? '-').padStart(8) + '  ' + (r.dims ?? r.note ?? '') +
    (r.animated ? `  (${r.animated} animations)` : '') +
    (r.deduped ? `  (${r.deduped} duplicate tiles merged)` : '') +
    (r.unresolved ? `  (${r.unresolved} gids belonged to no tileset -> blanked)` : ''),
  )
}

const before = rows.reduce((a, r) => a + r.before, 0)
const after = rows.reduce((a, r) => a + r.after, 0)
const worst = rows.reduce((a, r) => Math.max(a, r.after), 0)
console.log(`\n${rows.length} maps · worst single map ${before === 0 ? 0 : rows[0].before.toFixed(0)} MB -> ${worst.toFixed(1)} MB`)
console.log(`sum over every map: ${before.toFixed(0)} MB -> ${after.toFixed(0)} MB texture`)

const oversize = rows.filter((r) => r.dims && r.dims.split('x').some((d) => Number(d) > MAX_EDGE))
console.log(oversize.length
  ? `WARNING: ${oversize.length} compacted atlases exceed ${MAX_EDGE}px: ${oversize.map((r) => r.id).join(', ')}`
  : `no compacted atlas exceeds ${MAX_EDGE}px in either dimension`)

if (refusals.length) {
  console.log(`\nLEFT ALONE (copied verbatim, still big):`)
  for (const r of refusals) console.log(`  ${r.id}: ${r.why}`)
}

if (WRITE) {
  let bytes = 0
  let files = 0
  for (const f of readdirSync(OUT)) { bytes += statSync(join(OUT, f)).size; files++ }
  let source = 0
  for (const f of readdirSync(TILED)) {
    if (/\.(tmx|tsx|png)$/.test(f)) source += statSync(join(TILED, f)).size
  }
  console.log(`\nwrote ${files} files to src/tiled/compact — ${(bytes / 1048576).toFixed(1)} MB on disk` +
    ` (src/tiled tmx+tsx+png is ${(source / 1048576).toFixed(1)} MB)`)
  if (shared.size < rows.length - refusals.length) {
    console.log(`${rows.length - refusals.length - shared.size} maps reuse another map's identical atlas`)
  }
} else {
  console.log('\n(report only — pass --write to produce src/tiled/compact)')
}
