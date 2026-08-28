/*
 * The ground under the player.
 *
 * These read the REAL generated terrain (src/tiled/terrain.ts), not a fixture,
 * because the thing most likely to break is the conversion: an off-by-one in
 * the gid arithmetic would put every tag one tile out and no assertion against
 * a hand-written fixture would notice.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { RpgPlayer } from '@rpgjs/server'
import { tagAt, tagUnder, applyTerrain, trackTerrain, untrackTerrain, terrainMemberCount } from './terrain'
import { TERRAIN } from '../../tiled/terrain'

const TILE = 32
/** Enough of an RpgPlayer for the ground to be read. */
const fake = (map: string, tx: number, ty: number, id = 'p1') =>
  ({ id, map, x: tx * TILE + 16, y: ty * TILE + 16, speed: 4 }) as unknown as RpgPlayer

describe('the systemtags conversion', () => {
  it('put the dock stairs where PSDK has them', () => {
    // The flight at the top of the plaza: four wide, two deep.
    for (const x of [30, 31, 32, 33]) {
      expect(tagAt('exterior', x, 36)).toBe(34)
      expect(tagAt('exterior', x, 37)).toBe(34)
    }
    // And the second flight below it.
    expect(tagAt('exterior', 31, 41)).toBe(34)
  })

  it('leaves the pavement around them untagged', () => {
    expect(tagAt('exterior', 31, 35)).toBe(0)
    expect(tagAt('exterior', 29, 36)).toBe(0)
    expect(tagAt('exterior', 31, 38)).toBe(0)
  })

  it('answers 0 rather than throwing for a map with no terrain', () => {
    expect(tagAt('goldenrod-city', 10, 10)).toBe(0)
    expect(tagAt('not-a-map', 0, 0)).toBe(0)
  })

  it('answers 0 outside the map', () => {
    expect(tagAt('exterior', -1, 10)).toBe(0)
    expect(tagAt('exterior', 10, 9999)).toBe(0)
  })

  it('carries the other tags through too, so behaviour can be added later', () => {
    // Tall grass, water and caves are all in the data even though nothing acts
    // on them yet. If this list ever empties, the conversion has regressed.
    const tags = new Set<number>()
    for (const map of Object.values(TERRAIN)) for (const tag of Object.keys(map.tags)) tags.add(Number(tag))
    for (const expected of [5, 6, 7, 15, 21]) expect(tags.has(expected)).toBe(true)
  })
})

describe('what the ground does', () => {
  beforeEach(() => {
    untrackTerrain(fake('exterior', 0, 0, 'p1'))
    untrackTerrain(fake('exterior', 0, 0, 'p2'))
  })

  it('halves the pace on a stair tile', () => {
    const player = fake('exterior', 31, 36)
    applyTerrain(player)
    expect(player.speed).toBe(2)
  })

  it('gives it back on the next tile', () => {
    const player = fake('exterior', 31, 36)
    applyTerrain(player)
    expect(player.speed).toBe(2)
    // Same player object, one tile north — off the steps.
    ;(player as { y: number }).y = 35 * TILE + 16
    applyTerrain(player)
    expect(player.speed).toBe(4)
  })

  it('leaves ordinary ground alone', () => {
    const player = fake('exterior', 24, 62)
    applyTerrain(player)
    expect(player.speed).toBe(4)
  })

  it('reads the map the player is on, not the one they left', () => {
    // The same tile index on a map with no terrain data at all.
    const player = fake('goldenrod-city', 31, 36)
    expect(tagUnder(player)).toBe(0)
    applyTerrain(player)
    expect(player.speed).toBe(4)
  })

  it('accepts the engine\'s map-<id> prefix', () => {
    expect(tagUnder(fake('map-exterior', 31, 36))).toBe(34)
  })

  it('slows one player without touching another', () => {
    const onSteps = fake('exterior', 31, 36, 'p1')
    const onPath = fake('exterior', 24, 62, 'p2')
    applyTerrain(onSteps)
    applyTerrain(onPath)
    expect(onSteps.speed).toBe(2)
    expect(onPath.speed).toBe(4)
  })

  it('forgets a player who left, so the roster cannot leak', () => {
    const player = fake('exterior', 31, 36)
    trackTerrain(player)
    expect(terrainMemberCount()).toBe(1)
    untrackTerrain(player)
    expect(terrainMemberCount()).toBe(0)
  })

  it('replaces a player rather than tracking two objects for one person', () => {
    // The engine hands each room a FRESH RpgPlayer, and a map transfer cancels
    // the goodbye that would have removed the old one.
    trackTerrain(fake('exterior', 31, 36, 'p1'))
    trackTerrain(fake('hub', 24, 37, 'p1'))
    expect(terrainMemberCount()).toBe(1)
    untrackTerrain(fake('hub', 0, 0, 'p1'))
  })
})
