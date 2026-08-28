/*
 * Converts an RPG Maker XP project (the "Remastered Kanto Johto Map Pack")
 * into Tiled maps that RPG-JS can load, alongside the PSDK maps that
 * tools/import-maps.mjs produces.
 *
 *   node tools/import-rmxp-maps.mjs                    # all 152 maps
 *   node tools/import-rmxp-maps.mjs --maps 79,128,16   # a subset (art still
 *                                                      # shared, ids stable)
 *   node tools/import-rmxp-maps.mjs --keep-dump        # leave the JSON dump
 *
 * Two stages, because .rxdata is a Ruby Marshal stream:
 *
 *   1. tools/rmxp-dump.rb   .rxdata -> JSON in a temp dir
 *   2. this file            JSON + PNGs -> src/tiled/*.tmx, *.tsx, *.png
 *
 * Idempotent and deterministic: re-running overwrites the same files with
 * byte-identical content, and map ids never depend on what a previous run
 * left behind (see reservedIds()).
 *
 * See docs/rmxp-map-import.md for the format notes this implements.
 */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

const SRC = resolve(
  import.meta.dirname,
  '../../new-assets/Remastered Kanto Johto Map Pack',
)
const OUT = resolve(import.meta.dirname, '../src/tiled')
const DATA_OUT = resolve(import.meta.dirname, '../src/data')
const TILE = 32

/* Files this importer owns are all prefixed so they can never collide with
 * the PSDK art tools/import-maps.mjs copies in (TECH-*). */
const PREFIX = 'RMXP-'

/*
 * RMXP autotile quarter table.
 * ---------------------------------------------------------------------------
 * An autotile frame is 96x128 px: 3x4 blocks of 32px, or equivalently a
 * 6x8 grid of 16px QUARTERS numbered 1..48 left-to-right, top-to-bottom.
 * Each of the 48 patterns is assembled from four quarters, in the order
 * [top-left, top-right, bottom-left, bottom-right].
 *
 * The table is verifiable rather than magic: patterns 34/20/36 · 16/0/24 ·
 * 40/28/38 resolve to exactly the nine 32px blocks of the bottom-left 3x3
 * region — the classic "water body" ring (corner/edge/centre). The map data
 * in this pack uses precisely that subset plus the four single-corner
 * variants (1/2/4/8), which is only coherent if the table is right.
 */
const QUARTERS = [
  [27, 28, 33, 34], [5, 28, 33, 34], [27, 6, 33, 34], [5, 6, 33, 34],
  [27, 28, 33, 12], [5, 28, 33, 12], [27, 6, 33, 12], [5, 6, 33, 12],
  [27, 28, 11, 34], [5, 28, 11, 34], [27, 6, 11, 34], [5, 6, 11, 34],
  [27, 28, 11, 12], [5, 28, 11, 12], [27, 6, 11, 12], [5, 6, 11, 12],
  [25, 26, 31, 32], [25, 6, 31, 32], [25, 26, 31, 12], [25, 6, 31, 12],
  [15, 16, 21, 22], [15, 16, 21, 12], [15, 16, 11, 22], [15, 16, 11, 12],
  [29, 30, 35, 36], [29, 30, 11, 36], [5, 30, 35, 36], [5, 30, 11, 36],
  [39, 40, 45, 46], [5, 40, 45, 46], [39, 6, 45, 46], [5, 6, 45, 46],
  [25, 30, 31, 36], [15, 16, 45, 46], [13, 14, 19, 20], [13, 14, 19, 12],
  [17, 18, 23, 24], [17, 18, 11, 24], [41, 42, 47, 48], [5, 42, 47, 48],
  [37, 38, 43, 44], [37, 6, 43, 44], [13, 18, 19, 24], [13, 14, 43, 44],
  [37, 42, 43, 48], [17, 18, 47, 48], [13, 18, 43, 48], [1, 2, 7, 8],
]

/* The expanded autotile sheet: 48 tiles, 8 across. */
const AUTO_COLS = 8
const AUTO_ROWS = 6

/*
 * Two autotiles in this pack are missing from Graphics/Autotiles. R49Water is
 * declared by the Johto tileset (slot 6) but — verified against every map's
 * tile data — never actually placed, so the substitute only exists to keep
 * the gid table shaped the same for all maps that use that tileset.
 */
const AUTOTILE_SUBSTITUTES = { R49Water: 'Lake' }

/* Static tilesets are 8 tiles wide in RMXP, which makes them up to 9600 px
 * tall — past the 8192 px texture limit plenty of GPUs still have. Reflow to
 * 32 across (1024 px) and the tallest becomes 2400. Tile *index* order is
 * preserved, so a Tiled tileset with columns=32 indexes identically. */
const REFLOW_COLS = 32

// ---------------------------------------------------------------------------
// small helpers

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'map'

const xmlAttr = (s) => String(s).replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`)

async function raw(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Copies a w2*h2 tile-aligned block between two RGBA buffers. */
function blit(dst, dw, dx, dy, src, sw, sx, sy, w, h) {
  for (let y = 0; y < h; y++) {
    const s = ((sy + y) * sw + sx) * 4
    const d = ((dy + y) * dw + dx) * 4
    src.copy(dst, d, s, s + w * 4)
  }
}

/*
 * RMXP art normally carries a real alpha channel, and every static tileset in
 * this pack does. A handful of autotiles were saved without one and mark the
 * transparent area with a magenta colour key instead (A_FLOW is *entirely*
 * key; TFJ_Waterfall keys its unused top row). PIXI ignores Tiled's `trans=`
 * attribute — that is the bug tools/import-maps.mjs exists to work around —
 * so the key is baked into a real alpha channel here too.
 *
 * The key is only trusted when the corner pixel is unmistakably magenta;
 * A_beach's corner is water blue and STILL's is sand, and keying those out
 * would erase the art.
 */
function detectColourKey(data, hasAlpha) {
  if (hasAlpha) return null
  const [r, g, b] = data
  if (r > 120 && b > 120 && g < Math.min(r, b) * 0.6) return [r, g, b]
  return null
}

function applyKey(data, key) {
  let hits = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === key[0] && data[i + 1] === key[1] && data[i + 2] === key[2]) {
      data[i + 3] = 0
      hits++
    }
  }
  return hits
}

// ---------------------------------------------------------------------------
// stage 1: the Ruby dump

function dumpRxdata(keep) {
  const dir = join(tmpdir(), 'rmxp-dump')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  execFileSync('ruby', [join(import.meta.dirname, 'rmxp-dump.rb'), SRC, dir], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (keep) console.log(`  dump kept at ${dir}`)
  return dir
}

// ---------------------------------------------------------------------------
// stage 2a: art

/** Reflows an 8-across RMXP tileset PNG to REFLOW_COLS across, index-stable. */
async function buildStaticTileset(imageName) {
  const src = join(SRC, 'Graphics', 'Tilesets', `${imageName}.png`)
  const { data, w, h } = await raw(src)
  const srcCols = w / TILE
  if (srcCols !== 8) console.warn(`  ! ${imageName}: ${srcCols} columns, expected 8`)
  const count = srcCols * (h / TILE)
  const cols = REFLOW_COLS
  const rows = Math.ceil(count / cols)
  const dw = cols * TILE
  const dh = rows * TILE
  const out = Buffer.alloc(dw * dh * 4, 0)
  for (let i = 0; i < count; i++) {
    blit(
      out, dw, (i % cols) * TILE, Math.floor(i / cols) * TILE,
      data, w, (i % srcCols) * TILE, Math.floor(i / srcCols) * TILE, TILE, TILE,
    )
  }
  const png = `${PREFIX}${imageName}.png`
  await sharp(out, { raw: { width: dw, height: dh, channels: 4 } })
    .png()
    .toFile(join(OUT, png))
  const tsxName = `${PREFIX}${imageName}.tsx`
  writeFileSync(
    join(OUT, tsxName),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<tileset version="1.10" tiledversion="1.10.2" name="${xmlAttr(PREFIX + imageName)}" ` +
      `tilewidth="32" tileheight="32" tilecount="${count}" columns="${cols}">\n` +
      ` <image source="${png}" width="${dw}" height="${dh}"/>\n` +
      `</tileset>\n`,
  )
  return { tsx: tsxName, count, geometry: `${w}x${h} -> ${dw}x${dh}` }
}

function findAutotile(name) {
  const dir = join(SRC, 'Graphics', 'Autotiles')
  for (const ext of ['.png', '.jpg', '.PNG', '.JPG']) {
    const p = join(dir, name + ext)
    if (existsSync(p)) return p
  }
  return null
}

/** Expands one autotile file into a 48-tile (8x6) Tiled tileset. */
async function buildAutotile(name, log) {
  const sub = AUTOTILE_SUBSTITUTES[name]
  let file = findAutotile(name)
  if (!file && sub) {
    file = findAutotile(sub)
    log.substituted.push(`${name} -> ${sub}`)
  }
  if (!file) {
    log.missing.push(name)
    return null
  }

  const meta = await sharp(file).metadata()
  const { data, w, h } = await raw(file)
  const key = detectColourKey(data, !!meta.hasAlpha)
  if (key) {
    const n = applyKey(data, key)
    log.keyed.push(`${name}: rgb(${key.join(',')}) x${n.toLocaleString()}`)
  }

  /* Animated autotiles are frames laid out side by side. Frame 0 is what a
   * static Tiled map can show. Two files in this pack (A_FLOW, Waterfall
   * crest) are a single animated 32px tile rather than a 96x128 template. */
  const full = h >= 128
  const fw = full ? 96 : TILE
  const frames = Math.max(1, Math.round(w / fw))

  const dw = AUTO_COLS * TILE
  const dh = AUTO_ROWS * TILE
  const out = Buffer.alloc(dw * dh * 4, 0)
  for (let p = 0; p < 48; p++) {
    const dx = (p % AUTO_COLS) * TILE
    const dy = Math.floor(p / AUTO_COLS) * TILE
    if (!full) {
      blit(out, dw, dx, dy, data, w, 0, 0, TILE, TILE)
      continue
    }
    QUARTERS[p].forEach((q, i) => {
      const sx = ((q - 1) % 6) * 16
      const sy = Math.floor((q - 1) / 6) * 16
      blit(out, dw, dx + (i % 2) * 16, dy + Math.floor(i / 2) * 16, data, w, sx, sy, 16, 16)
    })
  }

  const id = `${PREFIX}auto-${slug(name)}`
  await sharp(out, { raw: { width: dw, height: dh, channels: 4 } })
    .png()
    .toFile(join(OUT, `${id}.png`))
  writeFileSync(
    join(OUT, `${id}.tsx`),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<tileset version="1.10" tiledversion="1.10.2" name="${xmlAttr(id)}" ` +
      `tilewidth="32" tileheight="32" tilecount="48" columns="${AUTO_COLS}">\n` +
      ` <image source="${id}.png" width="${dw}" height="${dh}"/>\n` +
      `</tileset>\n`,
  )
  return { tsx: `${id}.tsx`, count: 48, frames, source: basename(file) }
}

// ---------------------------------------------------------------------------
// stage 2b: collision
//
// RMXP keeps collision in the TILESET, not in a layer: Game_Map#passable?
// walks the three tile layers top-down and asks the tileset's `passages` and
// `priorities` tables about each cell.
//
//   for z in [2, 1, 0]:
//       t = data[x, y, z]
//       if passages[t] & 0x0f == 0x0f:  -> blocked
//       if priorities[t] == 0:          -> passable, stop looking
//   -> passable
//
// The empty tile (id 0) has passages 0 and priorities 5 in every tileset in
// this pack — deliberately non-zero so an empty upper layer falls through to
// the layer below instead of declaring the cell walkable. Star tiles (0x40,
// drawn above the player) also carry priority 5 and so fall through.
//
// Directional-only values (0x01..0x0e) block one edge, which a rectangle
// hitbox cannot express; they are counted, reported and treated as passable,
// exactly as tools/import-maps.mjs does for PSDK's per-edge passage tiles.

function cellBlocked(data, w, h, x, y, passages, priorities, counters) {
  for (let z = 2; z >= 0; z--) {
    const t = data[x + y * w + z * w * h]
    const p = passages[t] ?? 0
    if ((p & 0x0f) === 0x0f) return true
    if ((p & 0x0f) !== 0) counters.directional++
    if ((priorities[t] ?? 0) === 0) return false
  }
  return false
}

/** Greedy merge of blocked cells into rects, in map pixels. */
function mergeRects(blocked, w, h) {
  const rects = []
  const open = new Map()
  for (let y = 0; y < h; y++) {
    const rowRuns = new Map()
    for (let x = 0; x < w; x++) {
      if (!blocked[y * w + x]) continue
      let x2 = x
      while (x2 + 1 < w && blocked[y * w + x2 + 1]) x2++
      rowRuns.set(`${x}:${x2 - x + 1}`, { x, w: x2 - x + 1 })
      x = x2
    }
    for (const [key, rect] of open) {
      if (rowRuns.has(key)) continue
      rects.push(rect)
      open.delete(key)
    }
    for (const [key, run] of rowRuns) {
      const grow = open.get(key)
      if (grow) grow.height += TILE
      else open.set(key, { x: run.x * TILE, y: y * TILE, width: run.w * TILE, height: TILE })
    }
  }
  rects.push(...open.values())
  return rects
}

// ---------------------------------------------------------------------------
// stage 2c: map ids

/**
 * Ids the RMXP maps must not take. Read from the PSDK manifest rather than
 * from the .tmx files on disk, so a second run of this importer does not see
 * its own output as "taken" and renumber everything.
 */
function reservedIds() {
  const p = join(OUT, 'manifest.ts')
  if (!existsSync(p)) return new Set()
  return new Set([...readFileSync(p, 'utf8').matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]))
}

function assignIds(maps, reserved) {
  const counts = new Map()
  for (const m of maps) counts.set(slug(m.name), (counts.get(slug(m.name)) ?? 0) + 1)
  const ids = new Map()
  for (const m of maps) {
    const s = slug(m.name)
    // A name shared by several maps (two "Diglett's Cave", two "Route 2") gets
    // the RMXP id appended to *all* of them, so no map's id depends on order.
    let id = counts.get(s) > 1 || reserved.has(s) ? `${s}-${m.id}` : s
    while (reserved.has(id) || ids.has(id)) id = `${id}-x`
    ids.set(id, m.id)
    m.slug = id
  }
  return maps
}

// ---------------------------------------------------------------------------
// stage 2d: TMX

/**
 * `layers` is the finished draw list, in order: `{ name, cells }`, with the
 * event layer marked by a `cells` of null. Empty layers are dropped by the
 * caller, so ids are assigned here from what is actually emitted.
 */
function buildTmx(map, layers, tilesets) {
  const { width: w, height: h } = map
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down"` +
      ` compressionlevel="0" width="${w}" height="${h}" tilewidth="32" tileheight="32"` +
      ` infinite="0" nextlayerid="${layers.length + 2}" nextobjectid="1">`,
    ...tilesets.map((t) => ` <tileset firstgid="${t.firstgid}" source="${t.tsx}"/>`),
  ]
  let grouped = false
  layers.forEach((layer, i) => {
    // RPG-JS mounts its character/camera layer only on maps that have an
    // <objectgroup>. No objectgroup means no player sprite and no camera
    // follow — derive the id from the layers actually emitted, never from a
    // nextlayerid that could be stale.
    //
    // The <group> after it is what makes the layers inside DRAW ABOVE the
    // player; see the long note in tools/import-maps.mjs. In short: the
    // renderer splits every tile layer by per-tile `z` and stamps the pieces
    // with z=0, which sorts them under the event layer's 0.5 — so a bare tile
    // layer can never cover the player. A group is passed through unsplit,
    // ties at 0.5, and the sort is stable.
    if (!layer.cells) {
      parts.push(` <objectgroup id="${i + 1}" name="${layer.name}"/>`)
      if (i < layers.length - 1) {
        parts.push(` <group id="${layers.length + 1}" name="above">`)
        grouped = true
      }
      return
    }
    const rows = []
    for (let y = 0; y < h; y++) {
      const row = new Array(w)
      for (let x = 0; x < w; x++) row[x] = layer.cells[y * w + x]
      rows.push(row.join(','))
    }
    parts.push(
      ` <layer id="${i + 1}" name="${layer.name}" width="${w}" height="${h}">`,
      `  <data encoding="csv">`,
      rows.join(',\n'),
      `  </data>`,
      ` </layer>`,
    )
  })
  if (grouped) parts.push(` </group>`)
  parts.push(`</map>`, '')
  return parts.join('\n')
}

/**
 * Split the three RMXP layers into what is drawn behind the player and what is
 * drawn over them, and put the event layer between the two halves.
 *
 * WHY IT HAS TO BE DONE HERE. In mmorpg mode the client never reads this file:
 * the server streams it, and sanitizeLayerTemplate (@rpgjs/tiledmap) strips
 * every layer's `properties` on the way out — as sanitizeTileset does for every
 * tile's. @canvasengine/presets then orders layers by `properties.z ?? 0.5`, so
 * with the properties gone every layer ties, the sort is stable, and DOCUMENT
 * ORDER is the render order. Nothing else about a map can express "this covers
 * the player".
 *
 * RMXP keeps that per TILE, in the tileset's `priorities` table: 0 means the
 * character walks in front of the tile, anything higher means it covers them.
 * Which of the three layers a tile sits on says very little — measured over all
 * 152 maps, treating `upper` as the over-layer and the rest as under agrees
 * with the real table on only 87% of the 710,510 placed tiles, and the 60,521
 * it gets wrong are concentrated in `middle`: the tree canopies and roof edges
 * a player should disappear behind.
 *
 * Empty halves are dropped rather than written as a field of zeros — every map
 * is streamed to every client, and three redundant layers per map is a cost
 * paid on each first load.
 */
function splitByPriority(tiles, data, priorities, w, h, names) {
  const size = w * h
  const below = []
  const above = []
  names.forEach((name, z) => {
    const under = new Array(size).fill(0)
    const over = new Array(size).fill(0)
    let anyUnder = false
    let anyOver = false
    for (let i = 0; i < size; i++) {
      const gid = tiles[z][i]
      if (!gid) continue
      // The priority is looked up with the RAW RMXP tile id, not the gid this
      // importer remapped it to.
      if ((priorities[data[i + z * size]] ?? 0) > 0) { over[i] = gid; anyOver = true }
      else { under[i] = gid; anyUnder = true }
    }
    if (anyUnder) below.push({ name, cells: under })
    if (anyOver) above.push({ name: `${name}_above`, cells: over })
  })
  return [...below, { name: 'events', cells: null }, ...above]
}

// ---------------------------------------------------------------------------
// map_connections.txt

function buildConnections(maps) {
  const file = join(SRC, 'PBS v16 - v21', 'map_connections.txt')
  if (!existsSync(file)) return null
  const byRmxp = new Map(maps.map((m) => [m.id, m.slug]))
  const out = []
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim()
    if (!line || line.startsWith('#')) continue
    const p = line.split(',').map((s) => s.trim())
    if (p.length < 6) continue
    out.push({
      from: byRmxp.get(Number(p[0])) ?? null,
      fromRmxpId: Number(p[0]),
      fromEdge: p[1].toLowerCase(),
      fromOffset: Number(p[2]),
      to: byRmxp.get(Number(p[3])) ?? null,
      toRmxpId: Number(p[3]),
      toEdge: p[4].toLowerCase(),
      toOffset: Number(p[5]),
    })
  }
  return out
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2)
  const only = argv.includes('--maps')
    ? new Set(argv[argv.indexOf('--maps') + 1].split(',').map(Number))
    : null
  const keepDump = argv.includes('--keep-dump')

  if (!existsSync(SRC)) {
    console.error(`no RMXP project at ${SRC}`)
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })
  mkdirSync(DATA_OUT, { recursive: true })

  console.log('unmarshalling .rxdata via Ruby...')
  const dump = dumpRxdata(keepDump)
  const meta = JSON.parse(readFileSync(join(dump, 'meta.json'), 'utf8'))

  // --- art -----------------------------------------------------------------
  const artLog = { substituted: [], missing: [], keyed: [] }
  const statics = new Map()
  const autos = new Map()
  console.log('\nbuilding tilesets:')
  for (const [tid, ts] of Object.entries(meta.tilesets)) {
    if (!statics.has(ts.tileset_name)) {
      const built = await buildStaticTileset(ts.tileset_name)
      statics.set(ts.tileset_name, built)
      console.log(`  ${built.tsx}  ${built.count} tiles  (${built.geometry})`)
    }
    for (const name of ts.autotile_names) {
      if (!name || autos.has(name)) continue
      const built = await buildAutotile(name, artLog)
      autos.set(name, built)
      if (built) console.log(`  ${built.tsx}  48 tiles  (from ${built.source}, ${built.frames} frame(s))`)
    }
    void tid
  }
  for (const s of artLog.substituted) console.log(`  substituted missing autotile: ${s}`)
  for (const s of artLog.keyed) console.log(`  colour key baked to alpha — ${s}`)
  for (const s of artLog.missing) console.warn(`  ! autotile missing with no substitute: ${s}`)

  /* Per RMXP tileset, a fixed gid table: the static sheet first, then the
   * seven autotile slots in order. Every map on the same tileset therefore
   * gets an identical <tileset> block, which makes the output diffable. */
  const gidTables = {}
  for (const [tid, ts] of Object.entries(meta.tilesets)) {
    const list = []
    let next = 1
    const st = statics.get(ts.tileset_name)
    list.push({ tsx: st.tsx, firstgid: next, count: st.count, kind: 'static' })
    const staticFirst = next
    next += st.count
    const autoFirst = []
    ts.autotile_names.forEach((name, i) => {
      const a = name ? autos.get(name) : null
      if (!a) {
        autoFirst[i] = null
        return
      }
      if (list.some((l) => l.tsx === a.tsx)) {
        // the same autotile file used twice in one tileset — reuse its range
        autoFirst[i] = list.find((l) => l.tsx === a.tsx).firstgid
        return
      }
      list.push({ tsx: a.tsx, firstgid: next, count: 48, kind: 'auto' })
      autoFirst[i] = next
      next += 48
    })
    gidTables[tid] = { list, staticFirst, autoFirst, ts }
  }

  // --- maps ----------------------------------------------------------------
  const reserved = reservedIds()
  const wanted = meta.maps.filter((m) => !only || only.has(m.id))
  assignIds(meta.maps, reserved) // ids computed over ALL maps, always
  const layerNames = ['lower', 'middle', 'upper']

  console.log(`\nconverting ${wanted.length} map(s):`)
  const done = []
  const problems = []
  let totalDirectional = 0
  for (const info of wanted) {
    const map = JSON.parse(readFileSync(join(dump, `map-${info.id}.json`), 'utf8'))
    const table = gidTables[map.tileset_id]
    if (!table) {
      problems.push(`map ${info.id} (${info.name}): tileset ${map.tileset_id} has no art`)
      continue
    }
    const { list, staticFirst, autoFirst, ts } = table
    const { width: w, height: h, data } = map

    const tiles = [[], [], []]
    let phantom = 0
    let unmappedAuto = 0
    for (let z = 0; z < 3; z++) {
      const out = new Array(w * h)
      for (let i = 0; i < w * h; i++) {
        const t = data[i + z * w * h]
        if (t === 0) {
          out[i] = 0
          continue
        }
        if (t >= 384) {
          const idx = t - 384
          if (idx >= list[0].count) {
            phantom++
            out[i] = 0
          } else out[i] = staticFirst + idx
          continue
        }
        const ai = Math.floor(t / 48) - 1
        const first = ai >= 0 ? autoFirst[ai] : null
        if (first == null) {
          unmappedAuto++
          out[i] = 0
          continue
        }
        out[i] = first + (t % 48)
      }
      tiles[z] = out
    }
    if (phantom) problems.push(`map ${info.id} (${info.name}): ${phantom} tile refs past the end of ${ts.tileset_name}`)
    if (unmappedAuto) problems.push(`map ${info.id} (${info.name}): ${unmappedAuto} tiles on an autotile slot with no art`)

    // collision
    const counters = { directional: 0 }
    const blocked = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        blocked[y * w + x] = cellBlocked(data, w, h, x, y, ts.passages, ts.priorities, counters) ? 1 : 0
    totalDirectional += counters.directional
    const hitboxes = mergeRects(blocked, w, h)

    const tmx = buildTmx(map, splitByPriority(tiles, data, ts.priorities, w, h, layerNames), list)
    writeFileSync(join(OUT, `${info.slug}.tmx`), tmx)
    writeFileSync(join(OUT, `${info.slug}.hitboxes.json`), JSON.stringify(hitboxes))
    done.push({ ...info, hitboxes: hitboxes.length, blocked: blocked.reduce((a, b) => a + b, 0) })
    console.log(
      `  ${info.slug.padEnd(24)} ${String(w).padStart(3)}x${String(h).padEnd(3)}` +
        ` ${ts.name.padEnd(24)} ${String(hitboxes.length).padStart(4)} hitboxes`,
    )
  }

  // --- gid validation ------------------------------------------------------
  console.log('\nvalidating gids...')
  const bad = validateAll(done.map((d) => d.slug))
  if (bad.length) {
    for (const b of bad) console.error(`  ! ${b}`)
    problems.push(...bad)
  } else {
    console.log(`  ok: every gid in ${done.length} map(s) resolves, no overlapping firstgid ranges`)
  }

  // --- manifest + connections ---------------------------------------------
  const ids = done.map((d) => d.slug).sort()
  writeFileSync(
    join(OUT, 'rmxp-manifest.ts'),
    [
      '// GENERATED by tools/import-rmxp-maps.mjs — do not edit by hand.',
      '//',
      '// Explicit imports, not import.meta.glob: vite.config.ts loads src/server',
      '// in a plain Node context where import.meta.glob does not exist.',
      '//',
      '// Separate from ./manifest (the PSDK maps) so the two importers never',
      '// clobber each other. To put these maps in the game, spread RMXP_MAPS',
      '// into the MAPS list in src/modules/main/server.ts — the hitbox shape is',
      '// identical, so the existing onBeforeUpdate hook already handles them.',
      ...ids.map((id, i) => `import h${i} from './${id}.hitboxes.json'`),
      '',
      "import type { Rect } from './manifest'",
      '',
      'export const RMXP_MAPS: { id: string; name: string; rmxpId: number; width: number; height: number; hitboxes: Rect[] }[] = [',
      ...ids.map((id, i) => {
        const d = done.find((x) => x.slug === id)
        return `  { id: '${id}', name: ${JSON.stringify(d.name)}, rmxpId: ${d.id}, width: ${d.width}, height: ${d.height}, hitboxes: h${i} },`
      }),
      ']',
      '',
    ].join('\n'),
  )
  console.log(`\nrmxp-manifest.ts: ${ids.length} maps`)

  const conns = buildConnections(meta.maps)
  if (conns) {
    writeFileSync(
      join(DATA_OUT, 'rmxp-connections.json'),
      JSON.stringify(
        {
          _comment:
            'GENERATED by tools/import-rmxp-maps.mjs from PBS map_connections.txt. ' +
            'Each entry links two map edges. fromEdge/toEdge are the sides that touch ' +
            '(north/south/east/west). The offsets align the two maps along the shared ' +
            'edge, in TILES: for a north/south link, world_x(to) = world_x(from) + ' +
            'fromOffset - toOffset; for an east/west link the same holds on y. A ' +
            'player stepping off `from` at tile (x,y) arrives on `to` at ' +
            '(x + fromOffset - toOffset) along the shared axis. Not wired into ' +
            'gameplay — this is data only. `from`/`to` are RPG-JS map ids; null means ' +
            'that RMXP map id was not converted.',
          connections: conns,
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`rmxp-connections.json: ${conns.length} edge links`)
  }

  // --- summary -------------------------------------------------------------
  console.log(
    `\n${done.length}/${wanted.length} map(s) converted, ` +
      `${statics.size} static tileset(s), ${[...autos.values()].filter(Boolean).length} autotile sheet(s).`,
  )
  if (totalDirectional)
    console.log(
      `NOTE: ${totalDirectional} cell(s) had per-edge-only passage flags; a rect ` +
        `hitbox cannot express those, so they are walkable.`,
    )
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    for (const p of problems) console.log(`  - ${p}`)
  }
  if (!keepDump) rmSync(dump, { recursive: true, force: true })
}

/**
 * Every gid in every emitted map must resolve to a real tile in a declared
 * tileset, and the firstgid ranges must not overlap. A single phantom gid
 * makes PIXI fail the texture lookup and the WHOLE map renders blank, so this
 * is checked rather than assumed.
 */
export function validateAll(slugs) {
  const bad = []
  const tsxCache = new Map()
  const tsxCount = (name) => {
    if (!tsxCache.has(name)) {
      const p = join(OUT, name)
      if (!existsSync(p)) return null
      tsxCache.set(name, Number(readFileSync(p, 'utf8').match(/tilecount="(\d+)"/)[1]))
    }
    return tsxCache.get(name)
  }
  for (const id of slugs) {
    const xml = readFileSync(join(OUT, `${id}.tmx`), 'utf8')
    const sets = [...xml.matchAll(/<tileset firstgid="(\d+)" source="([^"]+)"\/>/g)]
      .map((m) => ({ first: Number(m[1]), src: m[2], count: tsxCount(m[2]) }))
      .sort((a, b) => a.first - b.first)
    if (sets.some((s) => s.count === null)) {
      bad.push(`${id}: references a .tsx that does not exist`)
      continue
    }
    for (let i = 1; i < sets.length; i++) {
      if (sets[i].first < sets[i - 1].first + sets[i - 1].count)
        bad.push(`${id}: firstgid ranges overlap (${sets[i - 1].src} / ${sets[i].src})`)
    }
    const max = sets.length ? sets[sets.length - 1].first + sets[sets.length - 1].count - 1 : 0
    let phantom = 0
    for (const m of xml.matchAll(/<data encoding="csv">([\s\S]*?)<\/data>/g)) {
      for (const g of m[1].split(/[\s,]+/)) {
        if (!g) continue
        const gid = Number(g)
        if (gid === 0) continue
        if (gid > max) {
          phantom++
          continue
        }
        let ts = null
        for (const s of sets) if (gid >= s.first) ts = s
        if (!ts || gid >= ts.first + ts.count) phantom++
      }
    }
    if (phantom) bad.push(`${id}: ${phantom} phantom gid(s)`)
  }
  return bad
}

if (import.meta.url === `file://${process.argv[1]}`) await main()

export { QUARTERS, OUT }
