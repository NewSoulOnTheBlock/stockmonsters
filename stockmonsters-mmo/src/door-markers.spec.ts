/*
 * Which warps get a sign on them.
 *
 * The rendering half needs a browser (tools/e2e-door-marker.mjs drives it), but
 * the decision — is this a door into another map, or a staircase, and where
 * exactly is its opening — is pure data and belongs here. Getting it wrong is
 * silent: a marker on a staircase looks like a door that does not work, which
 * is the exact complaint this feature exists to answer.
 */
import { describe, it, expect } from 'vitest'
import { doorsOnMap } from './door-markers'

const at = (list: ReturnType<typeof doorsOnMap>, x: number, y: number) =>
  list.find((d) => d.x === x && d.y === y)

describe('doorsOnMap', () => {
  it('marks the tower on `exterior` once, in the middle of its two-tile opening', () => {
    // warps.json puts touch warps to `hub` on tiles (31,31) and (32,31). Two
    // tiles, ONE doorway: the merge is what keeps a normal door from wearing
    // two arrows.
    const doors = doorsOnMap('exterior')
    const tower = doors.filter((d) => d.to === 'hub')
    expect(tower).toHaveLength(1)
    expect(tower[0].tiles).toBe(2)
    // Tile centres: x spans 31..32 so the centre is the 31/32 boundary + 16.
    expect(tower[0]).toMatchObject({ x: 1024, y: 1008, label: 'HUB', action: false })
  })

  it('merges a doorway written as a two-tile COLUMN as well as a row', () => {
    // The basement stairs are (30,24)+(30,25) and (33,24)+(33,25) — same
    // destination, stacked vertically. Two openings, not four.
    const basement = doorsOnMap('exterior').filter((d) => d.to === 'basement')
    expect(basement).toHaveLength(2)
    expect(basement.map((d) => [d.x, d.y])).toEqual([[976, 800], [1072, 800]])
    expect(basement.every((d) => d.tiles === 2)).toBe(true)
  })

  it('never marks a same-map warp — those are staircases and one-tile hops', () => {
    // `exterior` (25,24) -> `exterior` (25,25) is an action-triggered step.
    // warps.ts excludes exactly this class from its approach triggers.
    const doors = doorsOnMap('exterior')
    expect(doors.some((d) => d.to === 'exterior')).toBe(false)
    expect(at(doors, 25 * 32 + 16, 24 * 32 + 16)).toBeUndefined()
    // Two basement stairways, the tower, and the ferry gangway. Nothing else.
    expect(doors).toHaveLength(4)
  })

  it('marks a cross-map ACTION warp differently instead of pretending it opens', () => {
    // The ferry gangway on the dock, (17,63)+(17,64) -> olivine-city, is the
    // only kind of door you have to PRESS. Walking into it does nothing, so a
    // marker that promised a step would be exactly the lie this feature is
    // meant to remove.
    const ferry = doorsOnMap('exterior').find((d) => d.to === 'olivine-city')
    expect(ferry).toBeDefined()
    expect(ferry).toMatchObject({ action: true, tiles: 2, x: 17 * 32 + 16, y: 63.5 * 32 + 16 })
  })

  it('puts nothing on the plain wall either side of the tower opening', () => {
    // Requirement 5 of the ask, and the thing the browser test screenshots:
    // the wall next to a real door must stay bare.
    const doors = doorsOnMap('exterior')
    for (let tx = 20; tx <= 29; tx++) {
      expect(at(doors, tx * 32 + 16, 31 * 32 + 16)).toBeUndefined()
    }
  })

  it('collapses a twelve-tile bridge mouth into one marker', () => {
    // rmxp-warps.json lines the Cycling Road handover with a warp per tile.
    // Twelve arrows in a row would be noise; one in the middle is the fact.
    const doors = doorsOnMap('route-17')
    const up = doors.filter((d) => d.to === 'route-16')
    expect(up).toHaveLength(1)
    expect(up[0].tiles).toBe(12)
    expect(up[0].x).toBe(16.5 * 32 + 16)
    expect(up[0].y).toBe(58 * 32 + 16)
  })

  it('names the destination from the map catalog', () => {
    const doors = doorsOnMap('route-17')
    expect(doors.find((d) => d.to === 'route-18')?.label).toBe('ROUTE 18')
  })

  it('answers for a map with no doors at all, and for one that does not exist', () => {
    expect(doorsOnMap('no-such-map')).toEqual([])
    // Every marker on every map points at a map that exists — a door to a
    // dropped destination is a door the server does not honour either.
    const known = new Set(['hub', 'basement', 'olivine-city'])
    for (const d of doorsOnMap('exterior')) expect(known.has(d.to)).toBe(true)
  })
})
