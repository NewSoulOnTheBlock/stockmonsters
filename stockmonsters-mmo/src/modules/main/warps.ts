import { RpgPlayer } from '@rpgjs/server'
import warps from '../../tiled/warps.json'
import { MAPS, type Rect } from '../../tiled/manifest'

/*
 * `process` DOES NOT EXIST IN THE BROWSER.
 *
 * Everything under src/modules/main is bundled into the CLIENT as well as the
 * server, and a bare `process.env.X` read throws ReferenceError there. The
 * production build survives it because vite substitutes `process.env`, but the
 * dev server (`npm run dev`, standalone) does not — an unguarded read in
 * onConnected killed the whole client with "process is not defined". Read the
 * flag through this instead. (Same pattern as pricing.ts.)
 */
const envFlag = (key: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[key] : undefined


type Warp = { from: string; x: number; y: number; to: string; toX: number; toY: number; trigger: string }

const TILE = 32
const px = (t: number) => t * TILE + TILE / 2

// PSDK sometimes drops arrivals on cells its passages layer marks blocked
// (the wifi room's (24,18), for instance) — scripted walks made that fine in
// the original, but our physics shoves the player into sealed areas. Snap
// every arrival to the nearest passable cell instead.
const hitboxesById: Record<string, Rect[]> = Object.fromEntries(
  MAPS.map((m) => [m.id, m.hitboxes]),
)
const isBlocked = (mapId: string, tx: number, ty: number) => {
  const cx = tx * TILE + 16, cy = ty * TILE + 16
  return (hitboxesById[mapId] ?? []).some(
    (r) => cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height,
  )
}
function snapFree(mapId: string, tx: number, ty: number): { x: number; y: number } {
  if (!isBlocked(mapId, tx, ty)) return { x: tx, y: ty }
  for (let radius = 1; radius <= 4; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        if (!isBlocked(mapId, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy }
      }
    }
  }
  return { x: tx, y: ty } // give up; better than crashing
}

// A player who just warped often lands on or next to the return door (the
// PSDK data pairs them that way), which would ping-pong them between maps
// forever. Positional immunity: warps stay dead until the player has walked
// away from the arrival point once.
// Keyed by player.id, NOT the object — each map room hands the hooks a fresh
// RpgPlayer instance, so a WeakMap would forget the arrival on every transfer.
const arrival = new Map<string, { x: number; y: number; away: boolean }>()
const immune = (player: RpgPlayer) => {
  const a = arrival.get(String(player.id))
  if (!a) return false
  const sig = (v: any) => (typeof v === 'function' ? v() : v)
  const dx = Math.abs(sig((player as any).x) - a.x)
  const dy = Math.abs(sig((player as any).y) - a.y)
  if (dx > 40 || dy > 40) a.away = true
  return !a.away
}
const go = (player: RpgPlayer, to: string, toX: number, toY: number) => {
  if (immune(player)) return
  const cell = snapFree(to, toX, toY)
  arrival.set(String(player.id), { x: px(cell.x), y: px(cell.y), away: false })
  return player.changeMap(to, { x: px(cell.x), y: px(cell.y) })
}

// The elevators are a single PSDK event whose page branches on a floor choice,
// so they are written by hand instead of extracted. Arrivals are offset one
// tile below each floor's elevator door so the player doesn't land on the
// return warp.
const ELEVATORS: Record<string, { text: string; to: string; x: number; y: number }[]> = {
  'elevator-1': [
    { text: 'Hub', to: 'hub', x: 19, y: 29 },
    { text: 'River', to: 'river', x: 33, y: 16 },
    { text: 'Beach', to: 'beach', x: 33, y: 16 },
    { text: 'Cave', to: 'cave', x: 33, y: 16 },
    { text: 'Marsh', to: 'marsh', x: 33, y: 16 },
    { text: 'Tundra', to: 'tundra', x: 33, y: 16 },
    { text: 'Cycling Road', to: 'cyclingroad', x: 33, y: 16 },
    { text: 'Rocket HQ', to: 'rockethq', x: 33, y: 16 },
  ],
  'elevator-2': [
    { text: 'Hub', to: 'hub', x: 37, y: 29 },
    { text: 'Lab', to: 'labo', x: 32, y: 16 },
    { text: 'Library', to: 'library', x: 32, y: 16 },
    { text: 'Photo Studio', to: 'photostudio', x: 32, y: 16 },
    { text: 'Game Corner', to: 'gamecorner', x: 32, y: 16 },
  ],
}

function elevatorEvent(mapId: string) {
  const floors = ELEVATORS[mapId]
  return {
    x: 12 * TILE,
    y: 17 * TILE,
    event: {
      async onPlayerTouch(player: RpgPlayer) {
        if (immune(player)) return
        const choice = await player.showChoices('Which floor?', floors.map((f, i) => ({ text: f.text, value: i })))
        if (choice == null) return
        const f = floors[choice.value as number]
        const cell = snapFree(f.to, f.x, f.y)
        arrival.set(String(player.id), { x: px(cell.x), y: px(cell.y), away: false })
        await player.changeMap(f.to, { x: px(cell.x), y: px(cell.y) })
      },
    },
  }
}

/**
 * Which way the player is looking. It is a reactive signal in v5; the fakes in
 * the specs use a plain string.
 */
const facing = (player: RpgPlayer): string => {
  const d = (player as unknown as { direction?: unknown }).direction
  const v = typeof d === 'function' ? (d as () => unknown)() : d
  return typeof v === 'string' ? v : ''
}

/**
 * DOORWAYS ARE TWO TILES WIDE AND THE PLAYER IS NOT ON A GRID.
 *
 * Movement in v5 is free, not tile-locked, so a player who has walked around
 * for a while sits at, say, x=1008 — half a tile off. Stepping north from
 * there puts part of them into the wall beside the door and they simply stop,
 * a tile short of the trigger, in front of an opening they can plainly see.
 * Reported as "I cannot get into this building"; reproduced at x=1008, where
 * two and a half seconds of walking north moved nobody anywhere.
 *
 * So every door also listens on the tiles you approach it FROM — but only
 * while you are facing it. Walking past a shop along the pavement crosses
 * those tiles sideways all day and nothing happens; turning to the door and
 * stepping toward it is enough, from either of the tiles in front of it.
 */
const TOWARD: Record<string, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 }, left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
}

function approachEvents(mapId: string, doors: Warp[]) {
  const isDoor = new Set(doors.map((w) => `${w.x},${w.y}`))
  const seen = new Set<string>()
  const out: any[] = []
  for (const w of doors) {
    // Only real doors — a warp that lands on the same map is a staircase or a
    // one-tile hop, and widening those would fire them from a tile away.
    if (w.to === w.from) continue
    for (const [dir, step] of Object.entries(TOWARD)) {
      // The tile you would stand on to face the door this way.
      const ax = w.x - step.dx
      const ay = w.y - step.dy
      const key = `${ax},${ay}:${dir}`
      if (isDoor.has(`${ax},${ay}`) || seen.has(key)) continue
      if (isBlocked(mapId, ax, ay)) continue
      seen.add(key)
      out.push({
        x: ax * TILE,
        y: ay * TILE,
        event: {
          // An event is SOLID by default, and one sitting on the pavement in
          // front of a door is a wall you cannot walk past — measured: the
          // player stopped dead a tile short and never reached the door at
          // all. `through` is what makes it a trigger rather than an obstacle.
          onInit(this: { through: boolean }) { this.through = true },
          onPlayerTouch: (player: RpgPlayer) => {
            if (envFlag('SM_WARP_DEBUG') === '1') console.log('[warp] approach', mapId, ax, ay, 'want', dir, 'facing', facing(player))
            if (facing(player) !== dir) return
            return go(player, w.to, w.toX, w.toY)
          },
        },
      })
    }
  }
  return out
}

/** Warp events for one map: extracted PSDK transfers + hand-written elevators. */
export function warpEvents(mapId: string) {
  const mine = (warps as Warp[]).filter((w) => w.from === mapId && !(mapId in ELEVATORS))
  const events: any[] = mine.map((w) => ({
      x: w.x * TILE,
      y: w.y * TILE,
      event:
        w.trigger === 'action'
          ? { onAction: (player: RpgPlayer) => go(player, w.to, w.toX, w.toY) }
          : { onPlayerTouch: (player: RpgPlayer) => go(player, w.to, w.toX, w.toY) },
    }))
  events.push(...approachEvents(mapId, mine.filter((w) => w.trigger !== 'action')))
  if (mapId in ELEVATORS) events.push(elevatorEvent(mapId))
  return events
}
