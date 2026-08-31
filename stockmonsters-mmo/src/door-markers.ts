/*
 * door-markers.ts — a sign on every door you can actually walk into.
 *
 *   mountDoorMarkers(engine)
 *
 * ## The problem this exists for
 *
 * There are 171 maps and most buildings are scenery. A tower with a painted
 * arch looks exactly like a tower with a doorway, so a player walks into the
 * wall, decides the game is broken, and never finds the handful of buildings
 * that do open. Standing in front of the tower on `exterior` and not being
 * able to tell is precisely what was reported.
 *
 * ## What counts as a door
 *
 * The truth is the warp tables, not the art:
 *
 *   src/tiled/warps.json       the PSDK maps  {from,x,y,to,toX,toY,trigger}
 *   src/data/rmxp-warps.json   the Kanto/Johto maps, `manual` {…,tx,ty}
 *
 * A warp is a DOOR only when `to !== from`. A warp that lands on the map it
 * started on is a staircase or a one-tile hop — warps.ts makes exactly this
 * distinction in `approachEvents`, and marking those the same way would put an
 * arrow on every step of every staircase. Same rule here, same reason.
 *
 * `trigger: 'action'` warps need a button press rather than a step, so they
 * get a DIFFERENT glyph (a key, not an arrow) and the word PRESS on the plate.
 * Marking those identically would be a lie: the player would walk into the
 * ferry gangway on `exterior` (17,63) and nothing would happen, which is the
 * same disappointment as a painted door. That gangway and Olivine's return
 * ferry are the only cross-map action warps in the data today.
 *
 * Destinations are checked against MAP_CATALOG: a warp pointing at a map that
 * was never converted is a door to nowhere and the server drops it too.
 *
 * ## Where the marker goes
 *
 * On the door TILE, not on the pavement in front of it. A doorway is two tiles
 * wide (the tower's opening is (31,31)+(32,31)) and PSDK sometimes writes it as
 * a two-tile column instead, so touching tiles with the same destination are
 * merged into ONE marker at their centre — otherwise every doorway wears two
 * arrows, and the Cycling Road bridge would wear twelve.
 *
 * The marker floats DOOR_LIFT px above that centre so the character standing
 * in the opening is not covered.
 *
 * ## Why it is drawn in the DOM
 *
 * Same reasoning as exit-hints.ts: crisp at any zoom, animates for free, and
 * it needs no cooperation from the canvas scene graph. The cost is that the
 * world -> screen transform has to be done by hand every frame, which is what
 * `place()` does through the viewport's own `toScreen`.
 *
 * ## Why it polls
 *
 * `onMove` is DEAD in this engine (see HANDOVER). Anything that has to follow
 * the player rides a render loop or it does not update at all, so this runs on
 * requestAnimationFrame and writes to the DOM only when a value has changed.
 */

import warpsPsdk from './tiled/warps.json'
import warpsRmxp from './data/rmxp-warps.json'
import { MAP_CATALOG } from './data/map-catalog'

/* ------------------------------------------------------------ the data ---*/

const TILE = 32
/** How far above the doorway's centre the marker floats, in world pixels. */
const DOOR_LIFT = 30

/** A door, after the two tables have been reduced to one shape. */
interface RawDoor {
  from: string
  x: number
  y: number
  to: string
  action: boolean
}

/** One rendered sign: a doorway (one or more touching tiles) and where it goes. */
export interface DoorMarker {
  /** Map the player must be standing on to see it. */
  from: string
  /** Destination map id, and its catalog name for the label. */
  to: string
  label: string
  /** Centre of the doorway in WORLD pixels. */
  x: number
  y: number
  /** How many tiles the opening spans — 2 for a normal double doorway. */
  tiles: number
  /** Needs a button press rather than a step. */
  action: boolean
}

const NAME_BY_ID = new Map(MAP_CATALOG.map((m) => [m.id, m.name]))

function collect(): RawDoor[] {
  const out: RawDoor[] = []
  for (const w of warpsPsdk as Array<Record<string, unknown>>) {
    out.push({
      from: String(w.from), x: Number(w.x), y: Number(w.y),
      to: String(w.to), action: w.trigger === 'action',
    })
  }
  const rmxp = warpsRmxp as { warps?: Array<Record<string, unknown>>; manual?: Array<Record<string, unknown>> }
  for (const w of [...(rmxp.warps ?? []), ...(rmxp.manual ?? [])]) {
    out.push({
      from: String(w.from), x: Number(w.x), y: Number(w.y),
      to: String(w.to), action: w.trigger === 'action',
    })
  }
  return out
}

/**
 * Merge touching tiles that share a destination into one opening.
 *
 * Four-neighbour flood fill: a two-tile doorway (either orientation) becomes
 * one marker, and so does a twelve-tile bridge mouth.
 */
function mergeOpenings(from: string, doors: RawDoor[]): DoorMarker[] {
  const byDest = new Map<string, RawDoor[]>()
  for (const d of doors) {
    const key = `${d.to}|${d.action ? 'a' : 't'}`
    const list = byDest.get(key) ?? []
    list.push(d)
    byDest.set(key, list)
  }

  const out: DoorMarker[] = []
  for (const [, list] of byDest) {
    const at = new Map(list.map((d) => [`${d.x},${d.y}`, d]))
    const seen = new Set<string>()
    for (const d of list) {
      const start = `${d.x},${d.y}`
      if (seen.has(start)) continue
      // Flood fill this opening.
      const group: RawDoor[] = []
      const stack = [start]
      seen.add(start)
      while (stack.length) {
        const key = stack.pop() as string
        const cell = at.get(key)
        if (!cell) continue
        group.push(cell)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = `${cell.x + dx},${cell.y + dy}`
          if (at.has(next) && !seen.has(next)) { seen.add(next); stack.push(next) }
        }
      }
      const cx = group.reduce((s, g) => s + g.x, 0) / group.length
      const cy = group.reduce((s, g) => s + g.y, 0) / group.length
      out.push({
        from,
        to: d.to,
        label: (NAME_BY_ID.get(d.to) ?? d.to).toUpperCase(),
        // + TILE/2 because a tile's centre is half a tile past its corner.
        x: cx * TILE + TILE / 2,
        y: cy * TILE + TILE / 2,
        tiles: group.length,
        action: d.action,
      })
    }
  }
  // Stable order so a test can name one.
  return out.sort((a, b) => a.y - b.y || a.x - b.x)
}

let index: Map<string, DoorMarker[]> | null = null

/**
 * Every enterable door on `mapId`, already merged into openings.
 *
 * Pure — this is the half of the module a unit test can reach.
 */
export function doorsOnMap(mapId: string): DoorMarker[] {
  if (!index) {
    const known = new Set(MAP_CATALOG.map((m) => m.id))
    const byMap = new Map<string, RawDoor[]>()
    for (const d of collect()) {
      // A door into the map you are already on is a staircase, not a door.
      if (d.to === d.from) continue
      // A door to a map that does not exist here is a door to nowhere; the
      // server drops those warps too, so marking one would be a lie.
      if (!known.has(d.to) || !known.has(d.from)) continue
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) continue
      const list = byMap.get(d.from) ?? []
      list.push(d)
      byMap.set(d.from, list)
    }
    index = new Map()
    for (const [from, list] of byMap) index.set(from, mergeOpenings(from, list))
  }
  return index.get(mapId) ?? []
}

/* --------------------------------------------------------------- the UI ---*/

/**
 * Distance tiers, in WORLD pixels from the player to the doorway.
 *
 * A city block can hold a dozen doors and a dozen labelled plates is a screen
 * of arrows rather than a piece of information. So only the door you are
 * walking up to says where it goes; the rest are a dim chevron that says
 * "something opens here" and nothing more.
 */
const NEAR = 4.5 * TILE
const MID = 11 * TILE
type Tier = 'near' | 'mid' | 'far'
const tierFor = (dist: number): Tier => (dist <= NEAR ? 'near' : dist <= MID ? 'mid' : 'far')

const CSS = `
#sm-doors {
  position: fixed; inset: 0; z-index: 685;
  pointer-events: none;
  font-family: "Courier New", ui-monospace, monospace;
  image-rendering: pixelated;
}
#sm-doors .door {
  position: absolute;
  display: none;
  transform: translate(-50%, -100%);
  will-change: transform, left, top;
}
#sm-doors .door.on { display: block; }
#sm-doors .plate {
  display: flex; align-items: center; gap: 5px;
  padding: 2px 5px;
  color: #fff1c7;
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  white-space: nowrap;
  /* Steps, not a smooth slide — a smooth tween looks wrong beside pixel art.
     The bob lives on this inner element because the outer one owns the
     positioning transform. */
  animation: sm-door-bob 1.1s steps(2, jump-none) infinite;
}
#sm-doors .glyph { color: #7ecf6b; font-size: 13px; line-height: 1; text-shadow: 0 2px 0 #09070f; }
#sm-doors .dest { display: none; }
/* NEAR: the door you are walking up to, and the only one that names itself. */
#sm-doors .door.near .plate {
  background: rgba(38,33,58,.92);
  border: 2px solid #f6c177;
  box-shadow: 2px 2px 0 #09070f;
}
#sm-doors .door.near .dest { display: inline; }
#sm-doors .door.mid  { opacity: .72; }
#sm-doors .door.far  { opacity: .34; }
/* An action door is a different promise: stand here and press. */
#sm-doors .door.act .glyph { color: #f6c177; }
@keyframes sm-door-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
@media (prefers-reduced-motion: reduce) { #sm-doors .plate { animation: none; } }
`

interface EngineLike {
  sceneMap?: unknown
  findViewportInstance?: () => { toScreen?: (x: number, y: number) => { x: number; y: number } } | undefined
  renderer?: { canvas?: HTMLCanvasElement; view?: HTMLCanvasElement; screen?: { width: number; height: number } }
  canvasApp?: { canvas?: HTMLCanvasElement }
}

/** Signals in v5, plain values in the fakes. Read either. */
const read = (v: unknown): unknown => {
  try { return typeof v === 'function' ? (v as () => unknown)() : v } catch { return undefined }
}

const sceneOf = (engine: EngineLike) =>
  (typeof engine?.sceneMap === 'function' ? (engine.sceneMap as () => any)() : engine?.sceneMap) as any

/** The map the client is currently showing, normalised out of `map-<id>`. */
function currentMapId(engine: EngineLike): string {
  const s = sceneOf(engine)
  if (!s) return ''
  const fromData = read(s.data) as { id?: unknown } | undefined
  const raw = fromData?.id ?? read(s.id)
  return String(raw ?? '').replace(/^map-/, '')
}

interface Live { def: DoorMarker; node: HTMLElement; tier: Tier | null; on: boolean | null }

export interface DoorMarkerApi {
  /** What is on screen right now — the handle the browser test reads. */
  debug(): Array<{ from: string; to: string; action: boolean; wx: number; wy: number; sx: number; sy: number; tier: Tier | null; visible: boolean }>
  destroy(): void
}

export function mountDoorMarkers(maybeEngine?: EngineLike): DoorMarkerApi | null {
  if (typeof document === 'undefined' || !maybeEngine) return null
  // Bound once so the closures below do not each have to re-prove it exists.
  const engine: EngineLike = maybeEngine

  const style = document.createElement('style')
  style.id = 'sm-doors-css'
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'sm-doors'
  root.setAttribute('aria-hidden', 'true')
  document.body.appendChild(root)

  let live: Live[] = []
  let mapId = ''
  const screenPos = new Map<Live, { x: number; y: number }>()

  function rebuild(id: string) {
    root.textContent = ''
    screenPos.clear()
    live = doorsOnMap(id).map((def) => {
      const node = document.createElement('div')
      node.className = 'door' + (def.action ? ' act' : '')
      const plate = document.createElement('div')
      plate.className = 'plate'
      const glyph = document.createElement('span')
      glyph.className = 'glyph'
      // A chevron pointing down AT the opening for a door you walk into; a
      // key for one you have to press.
      glyph.textContent = def.action ? '⚿' : '▼'
      const dest = document.createElement('span')
      dest.className = 'dest'
      dest.textContent = def.action ? `PRESS · ${def.label}` : def.label
      plate.appendChild(glyph)
      plate.appendChild(dest)
      node.appendChild(plate)
      root.appendChild(node)
      return { def, node, tier: null, on: null }
    })
  }

  /*
   * THE CANVAS RECT IS CACHED ON PURPOSE.
   *
   * getBoundingClientRect() forces a style/layout flush, and this loop also
   * WRITES styles on the same pass — doing both every frame is the classic way
   * to add a millisecond to a game that already has a stutter problem
   * (HANDOVER: 170-250ms frames while walking). The canvas only moves when the
   * window does, so re-read it on resize and twice a second as a safety net.
   */
  let rectCache: DOMRect | null = null
  let rectAt = 0
  const canvasRect = (canvas: HTMLElement) => {
    const now = performance.now()
    if (!rectCache || now - rectAt > 500) { rectCache = canvas.getBoundingClientRect(); rectAt = now }
    return rectCache
  }
  const dropRect = () => { rectCache = null }
  window.addEventListener('resize', dropRect)
  window.addEventListener('scroll', dropRect, true)

  const show = (m: Live, on: boolean) => {
    if (m.on === on) return
    m.on = on
    m.node.classList.toggle('on', on)
  }

  function frame() {
    raf = requestAnimationFrame(frame)

    const id = currentMapId(engine)
    if (id !== mapId) {
      // Requirement 4: the old map's doors must go the moment the map does.
      mapId = id
      rebuild(id)
    }
    if (!live.length) return

    const scene = sceneOf(engine)
    const player = scene?.getCurrentPlayer?.()
    const pxWorld = read(player?.x)
    const pyWorld = read(player?.y)
    const viewport = engine.findViewportInstance?.()
    const canvas = engine.renderer?.canvas ?? engine.renderer?.view ?? engine.canvasApp?.canvas
    if (typeof pxWorld !== 'number' || typeof pyWorld !== 'number' || !viewport?.toScreen || !canvas) {
      for (const m of live) show(m, false)
      return
    }

    const rect = canvasRect(canvas)
    if (!rect.width || !rect.height) { dropRect(); for (const m of live) show(m, false); return }
    // The engine's own pointer code treats viewport-global coordinates as CSS
    // pixels inside the canvas rect; keep the ratio anyway in case a renderer
    // is ever sized differently from its element.
    const kx = rect.width / (engine.renderer?.screen?.width || rect.width)
    const ky = rect.height / (engine.renderer?.screen?.height || rect.height)

    for (const m of live) {
      const wy = m.def.y - DOOR_LIFT
      const p = viewport.toScreen(m.def.x, wy)
      const sx = rect.left + p.x * kx
      const sy = rect.top + p.y * ky
      screenPos.set(m, { x: sx, y: sy })
      // Off screen: nothing to say, and nothing to pay for.
      const pad = 64
      if (sx < rect.left - pad || sx > rect.right + pad || sy < rect.top - pad || sy > rect.bottom + pad) {
        show(m, false)
        continue
      }
      const dist = Math.hypot(m.def.x - pxWorld, m.def.y - pyWorld)
      const tier = tierFor(dist)
      if (tier !== m.tier) {
        m.tier = tier
        m.node.classList.remove('near', 'mid', 'far')
        m.node.classList.add(tier)
      }
      m.node.style.left = `${Math.round(sx)}px`
      m.node.style.top = `${Math.round(sy)}px`
      show(m, true)
    }
  }

  let raf = requestAnimationFrame(frame)

  const api: DoorMarkerApi = {
    debug: () => live.map((m) => ({
      from: m.def.from,
      to: m.def.to,
      action: m.def.action,
      wx: m.def.x, wy: m.def.y,
      sx: screenPos.get(m)?.x ?? NaN, sy: screenPos.get(m)?.y ?? NaN,
      tier: m.tier,
      visible: !!m.on,
    })),
    destroy: () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', dropRect)
      window.removeEventListener('scroll', dropRect, true)
      root.remove()
      style.remove()
    },
  }
  ;(window as unknown as { __doorMarkers?: () => unknown }).__doorMarkers = () => api.debug()
  window.addEventListener('beforeunload', () => cancelAnimationFrame(raf))
  return api
}
