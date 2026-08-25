import { RpgEvent, RpgPlayer, EventData, Move } from '@rpgjs/server'
import connectionsRaw from '../../data/rmxp-connections.json'
import { RMXP_MAPS } from '../../tiled/rmxp-manifest'
import { snapFree } from './geometry'

/*
 * Edge transitions for the Kanto/Johto region.
 *
 * The PSDK maps use door/stair warps at fixed tiles; these maps join at their
 * EDGES instead — walk off the west side of New Bark Town and you are on
 * Route 29. The PBS connection data gives, per link, which sides touch and an
 * offset that aligns the two maps along the shared axis:
 *
 *     arrival = departure + fromOffset - toOffset   (on the shared axis)
 *
 * So we line the whole border with touch events, one per tile, each computing
 * its own arrival coordinate. Links are declared once but work both ways, so
 * each connection is expanded into two sets of events.
 *
 * Arrivals land one tile INSIDE the destination, otherwise the player spawns
 * on the border and immediately triggers that map's own edge event back —
 * the same ping-pong that plagued the PSDK warps.
 */

const TILE = 32

type Edge = 'north' | 'south' | 'east' | 'west'
type Connection = {
    from: string | null
    fromEdge: Edge
    fromOffset: number
    to: string | null
    toEdge: Edge
    toOffset: number
}

const connections = (connectionsRaw as { connections: Connection[] }).connections
const sizeOf = new Map(RMXP_MAPS.map((m) => [m.id, { w: m.width, h: m.height }]))

/** Both directions of a declared link. */
function bothWays(c: Connection): Connection[] {
    return [
        c,
        { from: c.to, fromEdge: c.toEdge, fromOffset: c.toOffset, to: c.from, toEdge: c.fromEdge, toOffset: c.fromOffset },
    ]
}

function edgeWarpEvents(mapId: string) {
    const here = sizeOf.get(mapId)
    if (!here) return []

    const events: { x: number; y: number; event: EventData }[] = []
    const seen = new Set<string>()

    for (const link of connections.flatMap(bothWays)) {
        if (link.from !== mapId || !link.to) continue
        const there = sizeOf.get(link.to)
        if (!there) continue

        const vertical = link.fromEdge === 'north' || link.fromEdge === 'south'
        // Length of the border we line with triggers, in tiles.
        const span = vertical ? here.w : here.h
        const shift = link.fromOffset - link.toOffset

        for (let i = 0; i < span; i++) {
            const arrival = i + shift
            const limit = vertical ? there.w : there.h
            if (arrival < 0 || arrival >= limit) continue // outside the neighbour

            // departure tile on our border, arrival tile just inside theirs
            const from = vertical
                ? { x: i, y: link.fromEdge === 'north' ? 0 : here.h - 1 }
                : { x: link.fromEdge === 'west' ? 0 : here.w - 1, y: i }
            const raw = vertical
                ? { x: arrival, y: link.toEdge === 'north' ? 1 : there.h - 2 }
                : { x: link.toEdge === 'west' ? 1 : there.w - 2, y: arrival }
            // Offsets can put the arrival inside a cliff; snap to open ground.
            const to = snapFree(link.to, raw.x, raw.y)

            const target = link.to
            const key = `${from.x},${from.y}`
            if (seen.has(key)) continue // two links claiming one tile: first wins
            seen.add(key)

            events.push({
                x: from.x * TILE,
                y: from.y * TILE,
                event: {
                    name: `edge-${target}-${key}`,
                    mode: 'shared',
                    hitbox: { width: TILE, height: TILE },
                    onPlayerTouch(this: RpgEvent, player: RpgPlayer) {
                        player.changeMap(target, { x: to.x * TILE, y: to.y * TILE })
                    },
                } as unknown as EventData,
            })
        }
    }
    return events
}

export function rmxpWarpEvents(mapId: string) {
    return edgeWarpEvents(mapId)
}
