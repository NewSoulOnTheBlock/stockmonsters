/*
 * terrain.ts — what the ground does to you.
 *
 *   trackTerrain(player)   / untrackTerrain(player)
 *   tagAt(mapId, x, y)     // the PSDK system tag under a tile, 0 for none
 *
 * ## Why this exists
 *
 * PSDK stores two metadata layers per map. `passages` became our collision
 * rectangles on day one; `systemtags` — what a tile IS underfoot — was
 * dropped, and with it every behaviour that depends on the ground. The
 * reported symptom was the flights of steps on the dock and in the hub: you
 * cross them at walking pace, as if they were pavement.
 *
 * tools/import-maps.mjs now converts that layer into src/tiled/terrain.ts.
 * This is the half that acts on it.
 *
 * ## Why a poll and not a hook
 *
 * `onMove` is documented on RpgServer and is DEAD in beta.33 — the engine
 * dispatches `server-player-onConnected`, `-onJoinMap`, `-onLeaveMap`,
 * `-onStart`, `-onLoad`, `-onSave` and `-onAccepted`, and nothing else. (The
 * same is true of `onDisconnected`; see the note in player.ts.) So the ground
 * is sampled on a timer instead, ten times a second, over the players who are
 * actually in a map. A player crossing a one-tile step at full speed is inside
 * it for ~130ms, so the tile is never missed.
 *
 * The speed is a synced property (`_speed` in @rpgjs/common), so setting it
 * server-side is enough — every client sees the same climb.
 */
import type { RpgPlayer } from '@rpgjs/server'
import { TERRAIN } from '../../tiled/terrain'
import { playerMapId, playerPos } from './geometry'

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


const TILE = 32

/**
 * PSDK system tags this game acts on. The numbers are indices into
 * Assets/prio_w.png; the full list is in tools/import-maps.mjs.
 *
 * 33 and 36 are the diagonal flights, 34 and 35 the ones drawn face-on with an
 * up/down arrow. All four are stairs — `esc` on PSDK's palette is *escalier*,
 * and the art under them here is a plain flight of steps.
 */
const STAIRS = new Set([33, 34, 35, 36])

/** Everything walks at 4 unless something says otherwise (@rpgjs/common). */
const NORMAL_SPEED = 4
/** Stairs are climbed, not strolled over. Half pace, which is what PSDK does. */
const STAIRS_SPEED = 2

/** mapId -> tile index -> tag. Built once; the generated file is ~2500 cells. */
const INDEX = new Map<string, Map<number, number>>()
for (const [mapId, data] of Object.entries(TERRAIN)) {
  const byCell = new Map<number, number>()
  for (const [tag, cells] of Object.entries(data.tags)) {
    for (const cell of cells) byCell.set(cell, Number(tag))
  }
  INDEX.set(mapId, byCell)
}

/** The system tag on a tile, or 0 where the map has none. */
export function tagAt(mapId: string, x: number, y: number): number {
  const map = INDEX.get(mapId)
  if (!map) return 0
  const size = TERRAIN[mapId]
  if (x < 0 || y < 0 || x >= size.w || y >= size.h) return 0
  return map.get(y * size.w + x) ?? 0
}

/**
 * The tag under a player's feet.
 *
 * Read through geometry.ts, NOT off the object: `player.map` is the RpgMap
 * object and x/y are signals, so the obvious `String(player.map)` and
 * `Number(player.x)` both fail silently and the ground stops existing.
 */
export function tagUnder(player: RpgPlayer): number {
  const mapId = playerMapId(player)
  if (!mapId || !INDEX.has(mapId)) return 0
  const at = playerPos(player)
  if (!at) return 0
  return tagAt(mapId, Math.floor(at.x / TILE), Math.floor(at.y / TILE))
}

/*
 * Keyed by player id, not by object. The engine hands each room a FRESH
 * RpgPlayer, and a map transfer cancels the goodbye that would have removed the
 * old one — so a Set of objects would grow a stale entry per door walked
 * through, each still being polled and each reporting the map it left.
 */
const walking = new Map<string, RpgPlayer>()
/** Who we have slowed, so a player is never left stuck at stairs pace. */
const slowed = new Set<string>()

/** Apply the ground to one player. Exported so a test can step it by hand. */
export function applyTerrain(player: RpgPlayer): void {
  const id = String(player.id)
  const onStairs = STAIRS.has(tagUnder(player))
  if (onStairs === slowed.has(id)) return
  // Only ever move between the two speeds this module owns. If something else
  // starts changing a player's speed, that has to be reconciled here rather
  // than silently overwritten.
  if (envFlag('SM_TERRAIN_DEBUG') === '1') console.log('[terrain]', id, playerMapId(player), JSON.stringify(playerPos(player)), 'tag', tagUnder(player), '->', onStairs ? 2 : 4)
  if (onStairs) { player.speed = STAIRS_SPEED; slowed.add(id) }
  else { player.speed = NORMAL_SPEED; slowed.delete(id) }
}

let timer: ReturnType<typeof setInterval> | null = null

export function trackTerrain(player: RpgPlayer): void {
  walking.set(String(player.id), player)
  if (timer) return
  timer = setInterval(() => {
    for (const [id, p] of walking) {
      try { applyTerrain(p) } catch { walking.delete(id) }
    }
  }, 100)
  // A stray interval must never be the reason a test process will not exit.
  ;(timer as { unref?: () => void }).unref?.()
}

export function untrackTerrain(player: RpgPlayer): void {
  walking.delete(String(player.id))
  slowed.delete(String(player.id))
  if (walking.size === 0 && timer) { clearInterval(timer); timer = null }
}

/** Exposed for tests: how many players the ground is being read for. */
export const terrainMemberCount = () => walking.size
