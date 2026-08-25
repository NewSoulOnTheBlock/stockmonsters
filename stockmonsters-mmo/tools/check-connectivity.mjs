#!/usr/bin/env node
/*
 * check-connectivity.mjs — is the whole world one walkable place?
 *
 *   node tools/check-connectivity.mjs [--list] [--json] [--from <mapId>]
 *
 * Builds the world graph exactly the way the running game does and reports:
 *
 *   - how many connected components the world has
 *   - how big the component containing `exterior` (the spawn map) is
 *   - which REAL maps cannot be reached from `exterior` on foot
 *
 * Four edge sources, matching the two runtime modules:
 *
 *   src/data/rmxp-connections.json  edge links   -> rmxp-warps.ts edgeWarpEvents
 *   src/data/rmxp-warps.json .warps + .manual    -> rmxp-warps.ts internalWarpEvents
 *   src/tiled/warps.json            PSDK doors   -> warps.ts warpEvents
 *   the ELEVATORS table in warps.ts, mirrored below (it is hand-written there
 *   too, and there is nothing to read it out of)
 *
 * REAL vs placeholder: 25 of the 152 converted RMXP maps are folder markers
 * from the source project — blank 20x15 scratch pages named MAP0xx / Towns /
 * Routes / Extra. They are excluded from every count; linking them would be
 * linking a blank page.
 *
 * The script also VALIDATES every hand-authored warp: both the trigger tile
 * and the arrival tile must be in bounds and walkable in the map's
 * <id>.hitboxes.json (a rect list in PIXELS; tile (x,y) is blocked when the
 * point (x*32+16, y*32+16) falls inside any rect — same test as snapFree).
 * A trigger tile on a wall can never fire, so a bad entry is a silent no-op
 * unless something shouts about it. Arrivals are only a warning: the runtime
 * runs them through snapFree(), which nudges them up to 4 tiles to open ground.
 *
 * Exit code is 1 if any trigger tile is unwalkable or any warp names a map
 * that does not exist.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TILED = join(ROOT, 'src', 'tiled')
const DATA = join(ROOT, 'src', 'data')

const args = process.argv.slice(2)
const LIST = args.includes('--list')
const JSON_OUT = args.includes('--json')
const ROOT_MAP = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'exterior'

const TILE = 32

/* ============================================================= manifests ===*/

// Generated TypeScript with a fixed one-entry-per-line shape; a regex beats
// standing up a TS loader in a plain Node script (same trick as
// tools/render-map-thumbs.mjs).
function readRmxpMaps() {
  const src = readFileSync(join(TILED, 'rmxp-manifest.ts'), 'utf8')
  const re = /\{\s*id:\s*'([^']+)',\s*name:\s*"([^"]*)",\s*rmxpId:\s*(\d+),\s*width:\s*(\d+),\s*height:\s*(\d+),/g
  const out = []
  for (const m of src.matchAll(re)) {
    out.push({ id: m[1], name: m[2], rmxpId: +m[3], width: +m[4], height: +m[5], family: 'rmxp' })
  }
  return out
}

function readPsdkMaps() {
  const src = readFileSync(join(TILED, 'manifest.ts'), 'utf8')
  const out = []
  for (const m of src.matchAll(/\{\s*id:\s*'([^']+)',\s*hitboxes:/g)) {
    out.push({ id: m[1], name: m[1], family: 'psdk' })
  }
  return out
}

/** RMXP maps that are folder markers / blank scratch pages, not places. */
const PLACEHOLDER = /^(map\d+|towns(-\d+)?|routes(-\d+)?|extra|johto-enhanced|kanto-remastered)$/

const maps = [...readPsdkMaps(), ...readRmxpMaps()]
const byId = new Map(maps.map((m) => [m.id, m]))
const isReal = (id) => byId.has(id) && !PLACEHOLDER.test(id)

/* ============================================================== hitboxes ===*/

const hitCache = new Map()
function hitboxes(id) {
  let h = hitCache.get(id)
  if (h) return h
  const p = join(TILED, `${id}.hitboxes.json`)
  h = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
  hitCache.set(id, h)
  return h
}

/** Same predicate as snapFree() in src/modules/main/rmxp-warps.ts. */
function blocked(id, tx, ty) {
  const cx = tx * TILE + 16
  const cy = ty * TILE + 16
  return hitboxes(id).some((r) => cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height)
}

/** Where snapFree() would actually drop the player. null = nowhere within 4. */
function snapFree(id, tx, ty) {
  if (!blocked(id, tx, ty)) return { x: tx, y: ty, moved: 0 }
  for (let radius = 1; radius <= 4; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        if (!blocked(id, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy, moved: radius }
      }
    }
  }
  return null
}

function inBounds(id, tx, ty) {
  const m = byId.get(id)
  if (!m || m.width == null) return true // PSDK maps carry no size in the manifest
  return tx >= 0 && ty >= 0 && tx < m.width && ty < m.height
}

/* ================================================================ graph ====*/

/** id -> Set<id>, undirected. */
const adj = new Map(maps.map((m) => [m.id, new Set()]))
/** id -> Set<id>, directed (what a player can actually walk THROUGH). */
const dir = new Map(maps.map((m) => [m.id, new Set()]))

function link(a, b, oneWay = false) {
  if (!byId.has(a) || !byId.has(b) || a === b) return
  adj.get(a).add(b)
  adj.get(b).add(a)
  dir.get(a).add(b)
  if (!oneWay) dir.get(b).add(a)
}

// --- edge links (rmxp-connections.json) -------------------------------------
// The runtime lines both borders with touch events, so every declared
// connection is two-way by construction.
const connections = JSON.parse(readFileSync(join(DATA, 'rmxp-connections.json'), 'utf8')).connections ?? []
let edgeLinks = 0
for (const c of connections) {
  if (!c.from || !c.to) continue
  if (byId.has(c.from) && byId.has(c.to)) edgeLinks++
  link(c.from, c.to)
}

// --- internal warps (rmxp-warps.json) ---------------------------------------
const warpsRaw = JSON.parse(readFileSync(join(DATA, 'rmxp-warps.json'), 'utf8'))
const internal = [...(warpsRaw.warps ?? []), ...(warpsRaw.manual ?? [])]
for (const w of internal) link(w.from, w.to, true)

// --- PSDK doors (src/tiled/warps.json) --------------------------------------
const psdkWarps = JSON.parse(readFileSync(join(TILED, 'warps.json'), 'utf8'))
for (const w of psdkWarps) link(w.from, w.to, true)

// --- PSDK elevators (mirrors the ELEVATORS table in warps.ts) ---------------
const ELEVATORS = {
  'elevator-1': ['hub', 'river', 'beach', 'cave', 'marsh', 'tundra', 'cyclingroad', 'rockethq'],
  'elevator-2': ['hub', 'labo', 'library', 'photostudio', 'gamecorner'],
}
for (const [lift, floors] of Object.entries(ELEVATORS)) for (const f of floors) link(lift, f, true)

/* ========================================================== validation =====*/

const problems = []

for (const w of warpsRaw.manual ?? []) {
  const tag = `${w.from} (${w.x},${w.y}) -> ${w.to} (${w.tx},${w.ty})`
  if (!byId.has(w.from)) { problems.push({ level: 'error', tag, why: `source map "${w.from}" does not exist` }); continue }
  if (!byId.has(w.to)) { problems.push({ level: 'error', tag, why: `destination map "${w.to}" does not exist` }); continue }

  if (!inBounds(w.from, w.x, w.y)) {
    problems.push({ level: 'error', tag, why: `trigger tile is outside ${w.from} (${byId.get(w.from).width}x${byId.get(w.from).height})` })
  } else if (blocked(w.from, w.x, w.y)) {
    problems.push({ level: 'error', tag, why: 'TRIGGER TILE IS BLOCKED — the event can never fire' })
  }

  if (!inBounds(w.to, w.tx, w.ty)) {
    problems.push({ level: 'error', tag, why: `arrival tile is outside ${w.to} (${byId.get(w.to).width}x${byId.get(w.to).height})` })
  } else {
    const snap = snapFree(w.to, w.tx, w.ty)
    if (snap === null) {
      problems.push({ level: 'error', tag, why: 'arrival tile is walled in — snapFree finds no open cell within 4 tiles' })
    } else if (snap.moved) {
      problems.push({ level: 'warn', tag, why: `arrival is blocked; snapFree nudges it ${snap.moved} tile(s) to (${snap.x},${snap.y})` })
    }
  }
}

// A hand-authored link is meant to be walkable both ways. Flag any that is not.
const pairs = new Set((warpsRaw.manual ?? []).map((w) => `${w.from}>${w.to}`))
for (const key of pairs) {
  const [a, b] = key.split('>')
  if (!pairs.has(`${b}>${a}`)) {
    problems.push({ level: 'warn', tag: `${a} -> ${b}`, why: 'one-way: no return entry in `manual`' })
  }
}

/* ========================================================== components =====*/

function components(graph, filter = () => true) {
  const seen = new Set()
  const out = []
  for (const id of graph.keys()) {
    if (seen.has(id) || !filter(id)) continue
    const stack = [id]
    const comp = []
    seen.add(id)
    while (stack.length) {
      const n = stack.pop()
      comp.push(n)
      for (const m of graph.get(n) ?? []) {
        if (seen.has(m) || !filter(m)) continue
        seen.add(m)
        stack.push(m)
      }
    }
    out.push(comp.sort())
  }
  return out.sort((a, b) => b.length - a.length)
}

function reach(graph, from) {
  const seen = new Set([from])
  const stack = [from]
  while (stack.length) {
    const n = stack.pop()
    for (const m of graph.get(n) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m) }
  }
  return seen
}

// Everything below counts REAL maps only — placeholders are dropped from the
// graph entirely so they cannot inflate or deflate a component.
const comps = components(adj, isReal)
const realMaps = maps.filter((m) => isReal(m.id))
const homeComp = comps.find((c) => c.includes(ROOT_MAP)) ?? []
const walkable = reach(dir, ROOT_MAP)
const unreachable = realMaps.filter((m) => !walkable.has(m.id)).map((m) => m.id)
const unreachableUndirected = realMaps.filter((m) => !homeComp.includes(m.id)).map((m) => m.id)
const oneWayOnly = unreachable.filter((id) => homeComp.includes(id))

/* ============================================================== report =====*/

if (JSON_OUT) {
  console.log(JSON.stringify({
    maps: maps.length,
    realMaps: realMaps.length,
    components: comps.length,
    homeComponent: homeComp.length,
    unreachable,
    componentSizes: comps.map((c) => c.length),
  }, null, 2))
} else {
  const placeholders = maps.length - realMaps.length
  console.log(`maps            ${maps.length}  (${realMaps.length} real, ${placeholders} placeholder/folder-marker)`)
  console.log(`edge links      ${edgeLinks} from rmxp-connections.json`)
  console.log(`internal warps  ${internal.length} (${(warpsRaw.warps ?? []).length} generated + ${(warpsRaw.manual ?? []).length} manual)`)
  console.log(`psdk warps      ${psdkWarps.length} + 2 elevators`)
  console.log('')
  console.log(`COMPONENTS      ${comps.length}   sizes: ${comps.map((c) => c.length).join(', ')}`)
  console.log(`component of "${ROOT_MAP}"  ${homeComp.length} / ${realMaps.length} real maps`)
  console.log(`UNREACHABLE from "${ROOT_MAP}" on foot: ${unreachable.length}`)
  if (unreachable.length) {
    const per = 4
    for (let i = 0; i < unreachable.length; i += per) {
      console.log('   ' + unreachable.slice(i, i + per).map((s) => s.padEnd(24)).join(''))
    }
  }
  if (oneWayOnly.length) {
    console.log(`\nlinked but ONE-WAY (in the component, not walkable to): ${oneWayOnly.join(', ')}`)
  }
  if (unreachableUndirected.length !== unreachable.length) {
    console.log(`(undirected: ${unreachableUndirected.length} outside the component)`)
  }

  if (LIST) {
    console.log('\ncomponents:')
    for (const c of comps) console.log(`  [${String(c.length).padStart(3)}] ${c.join(' ')}`)
  }

  const errors = problems.filter((p) => p.level === 'error')
  const warns = problems.filter((p) => p.level === 'warn')
  console.log(`\nwarp checks: ${(warpsRaw.manual ?? []).length} manual entries · ${errors.length} error · ${warns.length} warning`)
  for (const p of errors) console.log(`  ERROR ${p.tag}\n        ${p.why}`)
  for (const p of warns) console.log(`  warn  ${p.tag}\n        ${p.why}`)
  if (errors.length) process.exitCode = 1
}
