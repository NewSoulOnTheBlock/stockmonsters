import { MAPS as PSDK_MAPS } from '../../tiled/manifest'
import { RMXP_MAPS } from '../../tiled/rmxp-manifest'

/*
 * Shared arrival snapping for both map families.
 *
 * Dropping a player on a blocked cell is the single most common transfer bug
 * here: PSDK's own data does it (scripted walks made it fine in the original,
 * our physics does not), and the Kanto/Johto edge links compute arrivals from
 * offsets that can land inside a cliff. Both cases want the same fix — move to
 * the nearest passable cell.
 *
 * warps.ts keeps its own copy for the PSDK maps; this one serves the newer
 * code paths. Merge them when warps.ts is next touched.
 */

export const TILE = 32
type Rect = { x: number; y: number; width: number; height: number }

const hitboxesById: Record<string, Rect[]> = Object.fromEntries([
    ...PSDK_MAPS.map((m) => [m.id, m.hitboxes] as const),
    ...RMXP_MAPS.map((m) => [m.id, m.hitboxes] as const),
])

export function isBlocked(mapId: string, tx: number, ty: number): boolean {
    const cx = tx * TILE + 16
    const cy = ty * TILE + 16
    return (hitboxesById[mapId] ?? []).some(
        (r) => cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height,
    )
}

/** Nearest passable cell within `maxRadius`, or the original if none is found. */
export function snapFree(mapId: string, tx: number, ty: number, maxRadius = 6) {
    if (!isBlocked(mapId, tx, ty)) return { x: tx, y: ty }
    for (let radius = 1; radius <= maxRadius; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
                if (!isBlocked(mapId, tx + dx, ty + dy)) return { x: tx + dx, y: ty + dy }
            }
        }
    }
    return { x: tx, y: ty }
}
