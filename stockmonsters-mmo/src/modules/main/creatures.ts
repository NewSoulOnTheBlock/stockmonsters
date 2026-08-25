import { Move, RpgEvent, RpgPlayer } from '@rpgjs/server'
import { startWildBattle } from './battle'
import { MAPS, type Rect } from '../../tiled/manifest'
import { OW_TICKERS } from '../../data/ow-spritesheets'
import dex from '../../data/dex.json'

// Wild stockmonsters wandering the outdoor maps. Every dex creature has an
// overworld charset: 68 real PSDK walk sheets (tools/import-overworld.mjs)
// plus generated fallbacks from dex front art (tools/gen-ow.mjs). Real
// wild-encounter tables come with the battle engine; this is presence, not
// gameplay yet.

const TILE = 32
const MAP_SIZE = 64 // all creature maps below are 64x64

// biome -> preferred types (renamed type names from the reskin)
const BIOMES: Record<string, { types: string[]; count: number }> = {
  exterior: { types: [], count: 6 },
  route: { types: [], count: 6 },
  river: { types: ['Tide', 'Flora'], count: 5 },
  beach: { types: ['Tide', 'Terra'], count: 5 },
  cave: { types: ['Stone', 'Terra', 'Shadow'], count: 5 },
  marsh: { types: ['Toxic', 'Flora', 'Swarm'], count: 5 },
  tundra: { types: ['Frost', 'Tide', 'Wind'], count: 5 },
  cyclingroad: { types: ['Volt', 'Neutral', 'Combat'], count: 5 },
}

const owSet = new Set<string>(OW_TICKERS as readonly string[])
const hitboxesById = Object.fromEntries(MAPS.map((m) => [m.id, m.hitboxes]))

const inRect = (px: number, py: number, r: Rect) =>
  px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height

// Deterministic PRNG so creature placement is stable across restarts
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickCells(mapId: string, n: number): { x: number; y: number }[] {
  const rects = hitboxesById[mapId] ?? []
  const rand = mulberry32([...mapId].reduce((a, c) => a * 31 + c.charCodeAt(0), 7))
  const cells: { x: number; y: number }[] = []
  for (let tries = 0; tries < 400 && cells.length < n; tries++) {
    const tx = 2 + Math.floor(rand() * (MAP_SIZE - 4))
    const ty = 2 + Math.floor(rand() * (MAP_SIZE - 4))
    const px = tx * TILE, py = ty * TILE
    if (rects.some((r) => inRect(px + 16, py + 16, r))) continue
    if (cells.some((c) => Math.abs(c.x - px) < 96 && Math.abs(c.y - py) < 96)) continue
    cells.push({ x: px, y: py })
  }
  return cells
}

const bst = (e: any) =>
  e.stats.hp + e.stats.atk + e.stats.def + e.stats.spd + e.stats.ats + e.stats.dfs

function roster(types: string[], rand: () => number): string[] {
  const pool = (dex as any[])
    .filter((e) => owSet.has(e.ticker))
    // keep legendaries out of the starter-level wild pool (a zapdos-based
    // wanderer was one-shotting L10 starters with level-1 thunderbolt)
    .filter((e) => bst(e) <= 460)
    .filter((e) => types.length === 0 || e.types.some((t: string) => types.includes(t)))
    .map((e) => e.ticker)
  const src = pool.length >= 3 ? pool : [...owSet]
  return src.sort(() => rand() - 0.5)
}

function creature(ticker: string) {
  return {
    onInit(this: RpgEvent) {
      this.setGraphic(`ow-${ticker}`)
      this.speed = 1
      this.infiniteMoveRoute([Move.tileRandom()])
    },
    onPlayerTouch(this: RpgEvent, player: RpgPlayer) {
      void startWildBattle(player, ticker)
    },
    onAction(this: RpgEvent, player: RpgPlayer) {
      void startWildBattle(player, ticker)
    },
  }
}

/** Wild-creature events for one map (empty for indoor maps). */
export function creatureEvents(mapId: string) {
  const biome = BIOMES[mapId]
  if (!biome) return []
  const rand = mulberry32([...mapId].reduce((a, c) => a * 33 + c.charCodeAt(0), 13))
  const picks = roster(biome.types, rand)
  return pickCells(mapId, biome.count).map((cell, i) => ({
    x: cell.x,
    y: cell.y,
    event: creature(picks[i % picks.length]),
  }))
}
