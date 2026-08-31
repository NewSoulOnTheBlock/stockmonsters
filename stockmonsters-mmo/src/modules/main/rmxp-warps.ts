import { RpgEvent, RpgPlayer, EventData, Move } from '@rpgjs/server'
import connectionsRaw from '../../data/rmxp-connections.json'
import warpsRaw from '../../data/rmxp-warps.json'
import { RMXP_MAPS } from '../../tiled/rmxp-manifest'
import { MAPS as PSDK_MAPS } from '../../tiled/manifest'
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
/**
 * Every map a warp may point at. Sizes only exist for the RMXP set, but a
 * manual link is allowed to cross into the PSDK island — the ferry does exactly
 * that. Checking existence against sizeOf alone silently dropped every link
 * whose destination was a PSDK map, which is how the return ferry went missing.
 */
const KNOWN_DESTINATIONS = new Set<string>([
    ...RMXP_MAPS.map((m) => m.id),
    ...PSDK_MAPS.map((m) => m.id),
])

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
                        // Centre, not corner — see the note in `travel`.
                        player.changeMap(target, { x: to.x * TILE + TILE / 2, y: to.y * TILE + TILE / 2 })
                    },
                } as unknown as EventData,
            })
        }
    }
    return events
}

/*
 * Internal warps — the doors, cave mouths and ladders that live INSIDE a map.
 *
 * Edges only ever get you from one outdoor map to the one next to it; every
 * cave, dungeon floor and gym is joined by an in-map transfer instead. In RPG
 * Maker XP that is an event carrying command 201 (Transfer Player), which
 * tools/extract-rmxp-warps.rb pulls out into rmxp-warps.json.
 *
 * The bundled Kanto/Johto pack turns out to ship no events at all, so that
 * file's `warps` list is empty and its `manual` list carries hand-authored
 * links instead. Both are read here and treated identically — the shape is the
 * same, and the moment a source project with real events is imported the
 * extracted links light up with no change to this file.
 */

type Warp = {
    from: string
    x: number
    y: number
    trigger: string // 'touch' | 'action'
    to: string
    tx: number
    ty: number
    dir?: number
}

const warpData = warpsRaw as { warps: Warp[]; manual: Warp[] }
const internalWarps = [...(warpData.warps ?? []), ...(warpData.manual ?? [])]

/*
 * "Don't bounce straight back" — the same problem the PSDK warps have, and the
 * same fix (see src/modules/main/warps.ts). A warp usually lands you on the
 * tile that warps back, so without this the player ping-pongs between two maps
 * forever. Warps stay dead for a player until they have walked away from their
 * arrival point once.
 *
 * Keyed by String(player.id) and NOT a WeakMap: each map room hands the hooks a
 * FRESH RpgPlayer instance, so an object-keyed map forgets the arrival on every
 * single transfer, which is exactly when we need to remember it.
 *
 * Copied rather than imported from warps.ts: that module pulls in the PSDK
 * manifest and its own snapFree, and importing it here would drag the PSDK map
 * family into the Kanto/Johto path (and back again through server.ts).
 */
const arrival = new Map<string, { x: number; y: number; away: boolean }>()

function immune(player: RpgPlayer) {
    const a = arrival.get(String(player.id))
    if (!a) return false
    // Some builds expose x/y as accessors, others as plain fields.
    const sig = (v: any) => (typeof v === 'function' ? v() : v)
    const dx = Math.abs(sig((player as any).x) - a.x)
    const dy = Math.abs(sig((player as any).y) - a.y)
    if (dx > 40 || dy > 40) a.away = true
    return !a.away
}

/** RMXP facing (2 down, 4 left, 6 right, 8 up) -> RPG-JS direction. */
const FACING: Record<number, number> = { 2: 1, 4: 2, 6: 3, 8: 4 }

function travel(player: RpgPlayer, w: Warp) {
    if (immune(player)) return
    // The recorded arrival can sit inside a wall (hand-authored, or an RMXP
    // arrival that only worked because the original scripted the walk).
    const cell = snapFree(w.to, w.tx, w.ty)
    /*
     * THE CENTRE OF THE TILE, NOT ITS CORNER.
     *
     * This used to hand `changeMap` the tile's top-left, while recording the
     * immunity anchor half a tile away at its centre — so the two disagreed
     * about where the player was, and the player was not where either thought.
     *
     * Movement is free rather than tile-locked, so a body placed on a corner
     * straddles the boundary into whatever is on the other side of it. In the
     * open that is invisible. In a one-tile corridor it is a wedge: the ferry
     * lands at olivine-city (24,42), whose only open neighbour is the tile
     * above, and a player pushed half a tile into the wall beside it cannot
     * move in any direction at all. That is what "stuck at the pier" was.
     *
     * `warps.ts` has always centred its arrivals. The two warp systems now
     * agree.
     */
    const px = { x: cell.x * TILE + TILE / 2, y: cell.y * TILE + TILE / 2 }
    arrival.set(String(player.id), { x: px.x, y: px.y, away: false })
    const facing = w.dir ? FACING[w.dir] : undefined
    if (facing) (player as any).changeDirection?.(facing)
    return player.changeMap(w.to, px)
}

function internalWarpEvents(mapId: string) {
    const events: { x: number; y: number; event: EventData }[] = []
    const seen = new Set<string>()

    for (const w of internalWarps) {
        if (w.from !== mapId) continue
        if (!KNOWN_DESTINATIONS.has(w.to)) continue // destination map does not exist
        const key = `${w.x},${w.y}`
        if (seen.has(key)) continue // two links claiming one tile: first wins
        seen.add(key)

        const hook =
            w.trigger === 'action'
                ? { onAction(this: RpgEvent, player: RpgPlayer) { travel(player, w) } }
                : { onPlayerTouch(this: RpgEvent, player: RpgPlayer) { travel(player, w) } }

        events.push({
            x: w.x * TILE,
            y: w.y * TILE,
            event: {
                name: `warp-${w.to}-${key}`,
                mode: 'shared',
                hitbox: { width: TILE, height: TILE },
                ...hook,
            } as unknown as EventData,
        })
    }
    return events
}

export function rmxpWarpEvents(mapId: string) {
    // Edge triggers sit on the border, internal warps in the interior, so the
    // two sets cannot collide on a tile in practice — but if they ever do, the
    // edge wins, matching "first wins" everywhere else here.
    const edges = edgeWarpEvents(mapId)
    const taken = new Set(edges.map((e) => `${e.x},${e.y}`))
    return [...edges, ...internalWarpEvents(mapId).filter((e) => !taken.has(`${e.x},${e.y}`))]
}
