import { RpgPlayer } from '@rpgjs/server'
import warps from '../../tiled/warps.json'

type Warp = { from: string; x: number; y: number; to: string; toX: number; toY: number; trigger: string }

const TILE = 32
const px = (t: number) => t * TILE + TILE / 2

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
  arrival.set(String(player.id), { x: px(toX), y: px(toY), away: false })
  return player.changeMap(to, { x: px(toX), y: px(toY) })
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
        arrival.set(String(player.id), { x: px(f.x), y: px(f.y), away: false })
        await player.changeMap(f.to, { x: px(f.x), y: px(f.y) })
      },
    },
  }
}

/** Warp events for one map: extracted PSDK transfers + hand-written elevators. */
export function warpEvents(mapId: string) {
  const events: any[] = (warps as Warp[])
    .filter((w) => w.from === mapId && !(mapId in ELEVATORS))
    .map((w) => ({
      x: w.x * TILE,
      y: w.y * TILE,
      event:
        w.trigger === 'action'
          ? { onAction: (player: RpgPlayer) => go(player, w.to, w.toX, w.toY) }
          : { onPlayerTouch: (player: RpgPlayer) => go(player, w.to, w.toX, w.toY) },
    }))
  if (mapId in ELEVATORS) events.push(elevatorEvent(mapId))
  return events
}
