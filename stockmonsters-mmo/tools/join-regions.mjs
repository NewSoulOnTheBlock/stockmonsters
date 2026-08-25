/*
 * Fuses the world's separate blobs by adding border gates to the `manual` list
 * in src/data/rmxp-warps.json.
 *
 * The map pack ships no events, so nothing links a route to the town it should
 * touch. Where two maps are adjacent in Gold/Silver geography, a gate at the
 * middle of the shared border is the honest minimum: the player walks off one
 * side and arrives on the other, which is what the border would have done if
 * the pack had described it.
 *
 * A gate is only written where BOTH tiles are walkable — the hitbox rects are
 * the authority, and a gate onto a cliff would strand the player. Each pair is
 * searched outward from the middle of the border until a walkable pair is
 * found, and reported if none is.
 *
 * Usage: node tools/join-regions.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const TILE = 32
const WARPS = join(root, 'src', 'data', 'rmxp-warps.json')

const manifest = readFileSync(join(root, 'src', 'tiled', 'rmxp-manifest.ts'), 'utf8')
const size = new Map(
    [...manifest.matchAll(/id: '([^']+)',[^\n]*?width: (\d+), height: (\d+)/g)]
        .map((m) => [m[1], { w: +m[2], h: +m[3] }])
)

const hitboxCache = new Map()
function blocked(id, tx, ty) {
    if (!hitboxCache.has(id)) {
        try {
            hitboxCache.set(id, JSON.parse(readFileSync(join(root, 'src', 'tiled', `${id}.hitboxes.json`), 'utf8')))
        } catch {
            hitboxCache.set(id, [])
        }
    }
    const cx = tx * TILE + 16
    const cy = ty * TILE + 16
    return hitboxCache.get(id).some((r) => cx >= r.x && cx < r.x + r.width && cy >= r.y && cy < r.y + r.height)
}

/** Opposite side, and the facing the player should arrive with. */
const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' }
const FACING = { north: 8, south: 2, east: 6, west: 4 }

/**
 * A walkable tile on `edge` of `id`, searched outward from the middle of that
 * border. `inset` keeps the gate one tile off the very rim so the arrival does
 * not sit on the neighbour's own gate and bounce straight back.
 */
function gateTile(id, edge, claimed = new Set()) {
    const s = size.get(id)
    if (!s) return null
    // Distance from the chosen edge, so "closest to that side" is a single
    // number to sort on. Caves and forests are solid right up to the rim, so a
    // border-only probe finds nothing and we fall back to the nearest walkable
    // tile anywhere on the map — still on the right side of it, just further in.
    const depth = (x, y) =>
        edge === 'north' ? y : edge === 'south' ? s.h - 1 - y : edge === 'west' ? x : s.w - 1 - x
    let best = null
    const mid = edge === 'north' || edge === 'south' ? s.w / 2 : s.h / 2
    for (let y = 1; y < s.h - 1; y++) {
        for (let x = 1; x < s.w - 1; x++) {
            if (claimed.has(`${id}:${x},${y}`)) continue // another gate owns it
            if (blocked(id, x, y)) continue
            const along = edge === 'north' || edge === 'south' ? x : y
            // Prefer shallow, then near the middle of that border.
            const score = depth(x, y) * 1000 + Math.abs(along - mid)
            if (!best || score < best.score) best = { x, y, score }
        }
    }
    return best ? { x: best.x, y: best.y } : null
}

/**
 * Pairs to fuse, in Gold/Silver geography. Each is [mapA, edgeOfA, mapB] —
 * B's edge is the opposite one. Chosen to join the separate blobs the
 * connectivity check reports, not to re-describe links the PBS data already has.
 */
const JOINS = [
    // Olivine's island into the Goldenrod/Ecruteak mainland
    ['route-38', 'east', 'ecruteak-city', 'Route 38 runs east from Olivine into Ecruteak'],
    // Ecruteak/Goldenrod into the Violet/Azalea group
    ['route-36', 'north', 'violet-city', 'Route 36 climbs north from Goldenrod to Violet City'],
    // Violet into the New Bark / Blackthorn blob
    ['violet-city', 'east', 'route-31', 'Violet City opens east onto Route 31'],
    // Johto into Kanto, the canonical crossing
    ['route-27', 'east', 'tohjo-falls', 'Route 27 ends at Tohjo Falls, the gate between the regions'],
    ['tohjo-falls', 'east', 'route-26', 'Tohjo Falls opens onto Route 26 on the Kanto side'],
    ['route-26', 'north', 'indigo-plateau', 'Route 26 climbs to Indigo Plateau'],
    // Vermilion group into Kanto proper
    ['route-6', 'north', 'saffron-city', 'Route 6 runs north from Vermilion into Saffron'],
    ['saffron-city', 'east', 'route-8', 'Saffron opens east onto Route 8'],
    // Azalea group into Ilex and the south
    ['azalea-town', 'west', 'ilex-forest', 'Ilex Forest lies west of Azalea Town'],
    ['ilex-forest', 'west', 'route-34', 'Ilex Forest opens west onto Route 34 toward Goldenrod'],

    // --- second pass: the dungeons and the towns still stranded ------------
    // Kanto's northern chain
    ['viridian-city', 'north', 'route-2-70', 'Route 2 leaves Viridian City to the north'],
    ['route-2-70', 'north', 'pewter-city', 'Route 2 runs north from Viridian to Pewter'],
    ['pewter-city', 'east', 'route-3', 'Route 3 leaves Pewter to the east'],
    ['route-3', 'east', 'mt-moon', 'Mt. Moon sits at the east end of Route 3'],
    ['mt-moon', 'south', 'mt-moon-b1f', 'stairs down into Mt. Moon B1F'],
    ['mt-moon-b1f', 'south', 'mt-moon-b2f', 'stairs down into Mt. Moon B2F'],
    ['route-2-70', 'west', 'viridian-forest', 'Viridian Forest opens off Route 2'],
    ['route-9', 'east', 'rock-tunnel', 'Rock Tunnel is the east end of Route 9'],
    ['rock-tunnel', 'south', 'rock-tunnel-b1f', 'ladder down into Rock Tunnel B1F'],
    ['route-2-11', 'south', 'diglett-s-cave-13', 'Diglett\'s Cave mouth near Route 2'],
    ['diglett-s-cave-13', 'south', 'diglett-s-cave-b1f', 'down into Diglett\'s Cave'],
    ['diglett-s-cave-b1f', 'south', 'diglett-s-cave-15', 'the far end of Diglett\'s Cave'],
    ['route-20', 'west', 'seafoam-islands', 'Seafoam Islands sit on Route 20'],
    ['seafoam-islands', 'south', 'seafoam-islands-b1f', 'down into Seafoam B1F'],
    ['seafoam-islands-b1f', 'south', 'seafoam-islands-b2f', 'down into Seafoam B2F'],
    ['seafoam-islands-b2f', 'south', 'seafoam-islands-b3f', 'down into Seafoam B3F'],
    ['seafoam-islands-b3f', 'south', 'seafoam-islands-b4f', 'down into Seafoam B4F'],
    // Johto's dungeons
    ['route-32', 'south', 'union-cave', 'Union Cave opens off Route 32'],
    ['union-cave', 'south', 'union-cave-b1f', 'ladder down into Union Cave B1F'],
    ['union-cave-b1f', 'south', 'union-cave-b2f', 'ladder down into Union Cave B2F'],
    ['azalea-town', 'north', 'slowpoke-well', 'the well in the middle of Azalea Town'],
    ['slowpoke-well', 'south', 'slowpoke-well-1bf', 'down into the well'],
    ['slowpoke-well-1bf', 'south', 'slowpoke-well-b2f', 'deeper into the well'],
    ['route-42', 'north', 'mt-mortar', 'Mt. Mortar opens off Route 42'],
    ['mt-mortar', 'south', 'mt-mortar-b1f', 'down into Mt. Mortar B1F'],
    ['mt-mortar-b1f', 'south', 'mt-mortar-b2f', 'down into Mt. Mortar B2F'],
    ['route-41', 'north', 'whirl-islands', 'the Whirl Islands lie in the Route 41 sea'],
    ['whirl-islands', 'south', 'whirl-islands-b1f', 'down into the Whirl Islands'],
    ['whirl-islands-b1f', 'south', 'whirl-islands-b2f', 'deeper still'],
    ['whirl-islands-b2f', 'south', 'whirl-islands-b3f', 'the lowest chamber'],
    ['blackthorn-city', 'north', 'dragon-s-den', 'the Dragon\'s Den behind Blackthorn'],
    ['route-35', 'east', 'national-park', 'National Park sits between Routes 35 and 36'],
    ['ecruteak-city', 'north', 'tower-path', 'the tower path north of Ecruteak'],
    ['route-28', 'west', 'route-27', 'Route 28 continues west from Route 27'],
    ['route-28', 'east', 'mt-silver', 'Mt. Silver stands at the end of Route 28'],
    ['mt-silver', 'north', 'mt-silver-peak', 'the climb to the peak'],
    ['route-47', 'north', 'route-48', 'Route 48 continues north from Route 47'],
    ['route-47', 'south', 'cliff-edge-gate', 'the gate on the cliff road'],
    ['cianwood-city', 'north', 'cliff-edge-gate', 'the cliff gate above Cianwood'],
    ['route-48', 'east', 'peaceful-garden', 'the garden off Route 48'],
    ['olivine-sea-path', 'south', 'south-rock-cave', 'the rock cave on the southern sea path'],
    ['goldenrod-sea-path', 'north', 'north-rock-cave', 'the rock cave on the northern sea path'],
    ['north-rock-cave', 'south', 'abandoned-mine', 'the abandoned mine below the rock cave'],
    ['abandoned-mine', 'south', 'abandoned-mine-b1f', 'down into the mine'],
    ['abandoned-mine-b1f', 'south', 'abandoned-mine-b2f', 'deeper into the mine'],
    ['abandoned-mine-b2f', 'south', 'abandoned-mine-b3f', 'deeper still'],
    ['abandoned-mine-b3f', 'south', 'abandoned-mine-b4f', 'the bottom of the mine'],
    ['route-40', 'east', 'battle-tower', 'the Battle Tower on the Olivine coast'],
]

const data = JSON.parse(readFileSync(WARPS, 'utf8'))
const have = new Set(data.manual.map((w) => `${w.from}:${w.x},${w.y}`))
const added = []
const skipped = []

for (const [a, edge, b, why] of JOINS) {
    if (!size.has(a) || !size.has(b)) { skipped.push(`${a} -> ${b}: map missing`); continue }
    const from = gateTile(a, edge, have)
    const to = gateTile(b, OPPOSITE[edge], have)
    if (!from || !to) { skipped.push(`${a} -> ${b}: no walkable tile on the border`); continue }
    const pair = [
        { from: a, x: from.x, y: from.y, trigger: 'touch', to: b, tx: to.x, ty: to.y, dir: FACING[edge], why },
        { from: b, x: to.x, y: to.y, trigger: 'touch', to: a, tx: from.x, ty: from.y, dir: FACING[OPPOSITE[edge]], why: `return leg: ${why}` },
    ]
    // Claim both tiles up front: a one-way gate is worse than no gate, since
    // the player walks in and cannot walk back out.
    const keys = pair.map((w) => `${w.from}:${w.x},${w.y}`)
    if (keys.some((k) => have.has(k))) {
        skipped.push(`${a} <-> ${b}: a tile was already claimed`)
        continue
    }
    keys.forEach((k) => have.add(k))
    added.push(...pair)
}

console.log(`gates added: ${added.length}`)
for (const w of added) console.log(`  ${w.from} (${w.x},${w.y}) -> ${w.to} (${w.tx},${w.ty})`)
if (skipped.length) {
    console.log(`skipped: ${skipped.length}`)
    for (const s of skipped) console.log(`  ${s}`)
}

if (process.argv.includes('--write') && added.length) {
    data.manual.push(...added)
    writeFileSync(WARPS, JSON.stringify(data, null, 1) + '\n')
    console.log(`wrote ${WARPS}`)
} else if (!process.argv.includes('--write')) {
    console.log('(dry run — pass --write to save)')
}
