// "Create Your Character" assets. Two sets, one catalog:
//
//   1. READY-MADES — a curated set of Pipoya character sprites (via the
//      WorkAdventure snapshot's characters/pipoya/ folder, the only
//      license-clear character assets in that tree, see
//      docs/character-designer.md §Licensing). Ids are prefixed `ch-`.
//      Selection rule: one variant per Male/Female family number (variant
//      "-2" when it exists, else the first), plus every Cat and Dog.
//      School-themed sets (Student/Teacher/Headmaster) are skipped — off-theme
//      for a trading floor.
//
//   2. LAYERS — the six-slot customisation set (body/eyes/hair/clothes/hat/
//      accessory) that powers the "BUILD YOUR OWN" designer. Ids are prefixed
//      `chl-`. ⚠ The provenance of these PNGs is UNRESOLVED — see
//      docs/character-designer.md §Licensing. The `chl-` prefix exists so the
//      whole set can be located and removed with one grep if it has to go.
//
// Every sheet in both sets is verified 96x128 = 3 cols x 4 rows of 32x32,
// rows down/left/right/up = RMSpritesheet(3,4), the same geometry as hero.png.
// Anything that fails that check is skipped with a warning rather than
// silently shipped (a wrong-size sheet renders as garbage, never as an error).
//
// Output:
//   public/spritesheets/characters/<slug>.png              ready-mades
//   public/spritesheets/characters/layers/<part>/<slug>.png layers
//   public/spritesheets/characters/catalog.json            ready-mades, for the DOM
//   public/spritesheets/characters/layers.json             layers, for the DOM
//   src/data/character-catalog.ts                          both, for TS (client + server)
//
// Idempotent and deterministic: same inputs -> byte-identical outputs.
//
// Usage: node tools/import-characters.mjs   (from stockmonsters-mmo/)
import { readdirSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WA = join(root, '..', 'workadventure-master', 'play', 'public', 'resources')
const SRC = join(WA, 'characters', 'pipoya')
const LAYER_SRC = join(WA, 'customisation')
const OUT = join(root, 'public', 'spritesheets', 'characters')
const LAYER_OUT = join(OUT, 'layers')
const CATALOG = join(root, 'src', 'data', 'character-catalog.ts')

mkdirSync(OUT, { recursive: true })

/** Reads width/height straight out of the PNG IHDR chunk. No dependencies. */
function pngSize(file) {
    const b = readFileSync(file)
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

function isRmSheet(file) {
    const s = pngSize(file)
    return !!s && s.w === 96 && s.h === 128
}

/**
 * Opaque-pixel count of frame (col, row) of a 3x4 sheet, for every frame.
 * Two things fall out of it, both of which the picker needs:
 *  - a sheet with no opaque pixels at all is a no-op placeholder (the upstream
 *    set has three); we already offer an explicit NONE, so drop them.
 *  - a few items (side-facing hair clips) are invisible in the facing-down
 *    frame the thumbnails use, which would render as an empty cell. Record the
 *    first direction row that actually shows the item and let the grid use it.
 */
async function frameCoverage(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const at = (col, row) => {
        let n = 0
        for (let y = row * 32; y < row * 32 + 32; y++) {
            for (let x = col * 32; x < col * 32 + 32; x++) {
                if (data[(y * info.width + x) * 4 + 3] > 10) n++
            }
        }
        return n
    }
    const idle = [0, 1, 2, 3].map((r) => at(IDLE_COL, r))
    let total = 0
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) total += at(c, r)
    return { idle, total }
}

const IDLE_COL = 1 // column 1 of every row is the standing frame

/** "character_hairs12.png" -> "hairs12"; "black_hoodie.png" -> "black-hoodie" */
function slugify(file) {
    return file
        .replace(/\.png$/i, '')
        .replace(/^character_/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

// Natural order so color2 sorts before color10 — purely cosmetic, but it makes
// the generated file and the on-screen grid stable and readable.
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare

// --- 1. ready-made sheets ---------------------------------------------------

const files = readdirSync(SRC).filter((f) => f.endsWith('.png'))

// family map: "Male 07" -> ["Male 07-1.png", ...]
const families = new Map()
for (const f of files) {
    const m = f.match(/^(Male|Female|Cat|Dog) (\d+)-(\d+)\.png$/)
    if (!m) continue // skips Student/Teacher/Headmaster and oddballs
    const key = `${m[1]} ${m[2]}`
    if (!families.has(key)) families.set(key, [])
    families.get(key).push(f)
}

const picks = []
for (const [key, variants] of [...families.entries()].sort()) {
    variants.sort()
    const [kind, num] = key.split(' ')
    if (kind === 'Cat' || kind === 'Dog') {
        // few of them and they're all charming — take every variant
        for (const v of variants) {
            const variantNo = v.match(/-(\d+)\.png$/)[1]
            picks.push({ file: v, slug: `${kind.toLowerCase()}-${num}-${variantNo}` })
        }
    } else {
        const preferred = variants.find((v) => v.endsWith('-2.png')) ?? variants[0]
        picks.push({ file: preferred, slug: `${kind.toLowerCase()}-${num}` })
    }
}

for (const p of picks) copyFileSync(join(SRC, p.file), join(OUT, `${p.slug}.png`))

const presets = picks.map((p) => ({
    id: `ch-${p.slug}`,
    image: `spritesheets/characters/${p.slug}.png`,
}))

// --- 2. layer sheets --------------------------------------------------------

// part name -> source directory. The order of this list IS the draw order
// (z-order) of a composed character: body at the bottom, accessory on top.
const PARTS = [
    ['body', 'character_color'],
    ['eyes', 'character_eyes'],
    ['hair', 'character_hairs'],
    ['clothes', 'character_clothes'],
    ['hat', 'character_hats'],
    ['accessory', 'character_accessories'],
]

// character_color/ contains one mojibake orphan (double-encoded bytes, not
// referenced by the upstream catalog). Matching it by literal name is fragile
// — the bytes on disk are not the UTF-8 of what a terminal prints — so the
// rule is "filename must be printable ASCII", which is true of every real
// asset and false only of that orphan.
const asciiName = (f) => /^[\x20-\x7e]+$/.test(f)

const layers = {}
const skipped = []
for (const [part, dir] of PARTS) {
    const from = join(LAYER_SRC, dir)
    const to = join(LAYER_OUT, part)
    mkdirSync(to, { recursive: true })

    const items = []
    for (const f of readdirSync(from).sort(natural)) {
        if (!f.endsWith('.png')) continue
        if (!asciiName(f)) { skipped.push(`${dir}/${JSON.stringify(f)} (non-ASCII orphan)`); continue }
        const src = join(from, f)
        if (!isRmSheet(src)) {
            const s = pngSize(src)
            skipped.push(`${dir}/${f} (${s ? `${s.w}x${s.h}` : 'not a PNG'}, need 96x128)`)
            continue
        }
        const cover = await frameCoverage(src)
        if (cover.total === 0) { skipped.push(`${dir}/${f} (fully transparent no-op)`); continue }

        const slug = slugify(f)
        copyFileSync(src, join(to, `${slug}.png`))
        const item = {
            id: `chl-${part}-${slug}`,
            image: `spritesheets/characters/layers/${part}/${slug}.png`,
        }
        // Thumbnails default to the facing-down idle frame (row 0). A handful of
        // items are invisible from that angle; point their thumbnail at the
        // first row where they can actually be seen.
        if (cover.idle[0] === 0) {
            const row = cover.idle.findIndex((n) => n > 0)
            if (row > 0) item.row = row
        }
        items.push(item)
    }
    layers[part] = items
}

// --- 3. emit ----------------------------------------------------------------

const q = (s) => `'${s}'`
const presetRows = presets.map((p) => `    { id: ${q(p.id)}, image: ${q(p.image)} },`).join('\n')
const layerRows = PARTS.map(([part]) => {
    const rows = layers[part]
        .map((i) => `        { id: ${q(i.id)}, image: ${q(i.image)}${i.row ? `, row: ${i.row}` : ''} },`)
        .join('\n')
    return `    ${part}: [\n${rows}\n    ],`
}).join('\n')

writeFileSync(
    CATALOG,
    `// GENERATED by tools/import-characters.mjs — do not edit by hand.
//
// Two sets of 96x128 sheets, both RMSpritesheet(3,4) (3 cols x 4 rows of
// 32x32, rows down/left/right/up):
//   CHARACTER_PRESETS  ready-made Pipoya characters, ids prefixed 'ch-'
//   CHARACTER_LAYERS   six-slot customisation parts, ids prefixed 'chl-'
//
// A character is an ORDERED list of ids passed to player.setGraphic(): the
// array order is the z-order. A ready-made is a one-element list; a built one
// is up to six ids in CHARACTER_PARTS order.
//
// ⚠ The 'chl-' layer assets have UNRESOLVED provenance — see
// docs/character-designer.md. The prefix is deliberate: one grep locates every
// generated id and file if the set has to be swapped out.
//
// No @rpgjs/* imports here: this file is shared with the Node server build.

export interface CharacterItem {
    id: string
    image: string
    /**
     * Direction row a thumbnail should show this item from (0 down, 1 left,
     * 2 right, 3 up). Absent = 0. Only set for the few items that are
     * invisible from the front and would otherwise render as an empty cell.
     */
    row?: number
}

/** Draw order, bottom to top. The array order IS the z-order. */
export const CHARACTER_PARTS = ['body', 'eyes', 'hair', 'clothes', 'hat', 'accessory'] as const
export type CharacterPart = (typeof CHARACTER_PARTS)[number]

export const CHARACTER_PRESETS: CharacterItem[] = [
${presetRows}
]

export const CHARACTER_LAYERS: Record<CharacterPart, CharacterItem[]> = {
${layerRows}
}

/** Every legal character graphic id — the server-side whitelist. */
export const CHARACTER_IDS: ReadonlySet<string> = new Set([
    ...CHARACTER_PRESETS.map((i) => i.id),
    ...CHARACTER_PARTS.flatMap((p) => CHARACTER_LAYERS[p].map((i) => i.id)),
])
`
)

// The DOM in index.html can't import TS — give it the same lists as JSON.
const JSON_OUT = join(OUT, 'catalog.json')
writeFileSync(JSON_OUT, JSON.stringify(presets))
const LAYERS_JSON = join(OUT, 'layers.json')
writeFileSync(LAYERS_JSON, JSON.stringify(layers))

// --- 4. report --------------------------------------------------------------

const ids = new Set()
for (const item of [...presets, ...PARTS.flatMap(([p]) => layers[p])]) {
    if (ids.has(item.id)) throw new Error(`duplicate character id: ${item.id}`)
    ids.add(item.id)
}

console.log(`copied ${picks.length} ready-made sheets -> ${OUT}`)
for (const [part] of PARTS) console.log(`copied ${String(layers[part].length).padStart(3)} ${part} layers`)
if (skipped.length) console.log(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`)
console.log(`${ids.size} unique ids`)
console.log(`emitted ${CATALOG}`)
console.log(`emitted ${JSON_OUT}`)
console.log(`emitted ${LAYERS_JSON}`)
