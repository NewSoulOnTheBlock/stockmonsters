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

/* -------------------------------------------------- reading a player ---- */

/**
 * RPG-JS v5 exposes x/y as reactive SIGNALS (`player.x()`) and `player.map` as
 * the RpgMap OBJECT, not its id. Both are easy to get wrong in a way that
 * fails silently: `Number(player.x)` is NaN and `String(player.map)` is
 * "[object Object]", so a lookup keyed on either simply never matches and the
 * feature does nothing at all. That cost a debugging round on terrain.ts.
 *
 * The fakes in the .spec files use plain numbers and plain strings, so both
 * shapes are read rather than making every test carry engine machinery.
 */
const read = (v: unknown): unknown => {
    try { return typeof v === 'function' ? (v as () => unknown)() : v } catch { return undefined }
}

export function playerPos(player: unknown): { x: number; y: number } | null {
    const p = player as any
    const x = read(p?.x)
    const y = read(p?.y)
    if (typeof x === 'number' && typeof y === 'number') return { x, y }
    // `position` is the deprecated v4 shape; still the best fallback.
    const pos = p?.position
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') return { x: pos.x, y: pos.y }
    return null
}

/**
 * Map ids arrive as "map-exterior" from the room and as "exterior" everywhere
 * else in this codebase (see player.ts onJoinMap). Normalise, or two players on
 * one map compare as being on two.
 */
export function playerMapId(player: unknown): string | null {
    const p = player as any
    let raw: unknown = p?.getCurrentMap?.()?.id
    if (raw == null) raw = typeof p?.map === 'string' ? p.map : p?.map?.id
    if (raw == null) return null
    const id = String(raw).replace(/^map-/, '')
    return id || null
}
