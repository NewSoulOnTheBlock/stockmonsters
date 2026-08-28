/*
 * Imports Tiled maps from the PSDK game into the RPG-JS project.
 *
 *   node tools/import-maps.mjs "003 Hub" "005 River" ...
 *   node tools/import-maps.mjs --all
 *
 * PSDK lays its Tiled data out as Maps/, Tilesets/ and Assets/ referring to
 * each other with ../ paths. RPG-JS expects the .tmx, .tsx and image files to
 * sit together in src/tiled/, so this copies what a map actually references
 * and rewrites the paths to be flat.
 *
 * PSDK also carries two metadata layers that mean nothing to RPG-JS:
 *
 *   passages   — its collision encoding
 *   systemtags — terrain tags (tall grass, water, ledges, …)
 *
 * They are dropped from the visual output here and reported, so the collision
 * conversion is a deliberate, visible step rather than silently missing.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import sharp from 'sharp'

const GAME = resolve(import.meta.dirname, '../../Stockmonsters/Data/Tiled')
const OUT = resolve(import.meta.dirname, '../src/tiled')

const META_LAYERS = ['passages', 'systemtags']

/** PSDK map files are named "003 Hub.tmx"; RPG-JS map ids should be terse. */
const mapId = (name) =>
  basename(name, '.tmx')
    .replace(/^\d+\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

function copyReferenced(fromFile, ref, seen) {
  const src = resolve(dirname(fromFile), ref)
  if (!existsSync(src)) {
    console.warn(`  ! missing: ${ref}`)
    return null
  }
  const flat = basename(src)
  const dest = join(OUT, flat)
  if (!seen.has(dest)) {
    copyFileSync(src, dest)
    seen.add(dest)
  }
  return { src, flat }
}

/*
 * PSDK tilesets mark transparency the RPG Maker way: a `trans` colour key on
 * the <image> tag, with that colour left opaque in the PNG. Tiled and PSDK
 * honour it; PIXI does not, so every "transparent" pixel renders as solid
 * magenta. Bake the key into a real alpha channel instead.
 */
async function applyColourKey(pngPath, hex) {
  const key = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const img = sharp(pngPath).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  let hits = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === key[0] && data[i + 1] === key[1] && data[i + 2] === key[2]) {
      data[i + 3] = 0
      hits++
    }
  }
  if (!hits) return 0
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(pngPath + '.tmp')
  copyFileSync(pngPath + '.tmp', pngPath)
  await import('node:fs').then((fs) => fs.unlinkSync(pngPath + '.tmp'))
  return hits
}

async function importTileset(tsxPath, seen) {
  let xml = readFileSync(tsxPath, 'utf8')
  const trans = xml.match(/<image[^>]*\btrans="([0-9a-fA-F]{6})"/)?.[1]

  const copied = []
  // <image source="../Assets/TECH-Nature.png"/>  ->  source="TECH-Nature.png"
  xml = xml.replace(/(<image[^>]*\bsource=")([^"]+)(")/g, (m, a, ref, b) => {
    const r = copyReferenced(tsxPath, ref, seen)
    if (r) copied.push(join(OUT, r.flat))
    return r ? a + r.flat + b : m
  })

  // The source project's .tsx metadata has drifted from its PNGs — the reskin
  // resized some tileset images without updating tilecount/columns, so a few
  // tilesets claim tiles that do not exist. A map referencing one of those
  // phantom indices makes the renderer ask for an undefined texture and the
  // whole map fails to draw. Re-derive the geometry from the actual image.
  for (const png of copied) {
    const meta = await sharp(png).metadata()
    const tw = Number(xml.match(/\btilewidth="(\d+)"/)?.[1] ?? 32)
    const th = Number(xml.match(/\btileheight="(\d+)"/)?.[1] ?? 32)
    const cols = Math.floor(meta.width / tw)
    const rows = Math.floor(meta.height / th)
    const declared = Number(xml.match(/\btilecount="(\d+)"/)?.[1] ?? 0)
    if (declared !== cols * rows) {
      console.log(
        `    fixed ${basename(tsxPath)}: tilecount ${declared} -> ${cols * rows}` +
          ` (image is ${meta.width}x${meta.height})`,
      )
    }
    xml = xml
      .replace(/\btilecount="\d+"/, `tilecount="${cols * rows}"`)
      .replace(/\bcolumns="\d+"/, `columns="${cols}"`)
      .replace(/(<image[^>]*\b)width="\d+"/, `$1width="${meta.width}"`)
      .replace(/(<image[^>]*\b)height="\d+"/, `$1height="${meta.height}"`)
  }

  if (trans) {
    for (const png of copied) {
      const n = await applyColourKey(png, trans)
      if (n) console.log(`    alpha: ${basename(png)} (${n.toLocaleString()} px keyed out)`)
    }
    // the key is baked in now; leaving it would be a lie about the file
    xml = xml.replace(/\s*\btrans="[0-9a-fA-F]{6}"/g, '')
  }

  writeFileSync(join(OUT, basename(tsxPath)), xml)
}


/**
 * Reads the passages layer and returns merged collision rects in map pixels,
 * or null when the map has no passages layer.
 */
function extractCollision(xml, id) {
  const ts = xml.match(/<tileset firstgid="(\d+)"[^>]*source="[^"]*passages\.tsx"\s*\/>/)
  const layer = xml.match(
    /<layer[^>]*name="passages"[^>]*width="(\d+)"[^>]*height="(\d+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/,
  )
  if (!ts || !layer) return null
  const first = Number(ts[1])
  const [w, h] = [Number(layer[1]), Number(layer[2])]
  const gids = layer[3].trim().split(/[\s,]+/).map(Number)

  let directional = 0
  const blocked = gids.map((gid) => {
    if (gid === 0) return false
    const local = gid - first
    if (local >= 1 && local <= 14) {
      directional++
      return false
    }
    return true // local 0 never occurs as a gid>0 cell; 15 and phantoms block
  })
  if (directional) {
    console.warn(
      `  ! ${id}: ${directional} per-edge passage tiles treated as passable — ` +
        'collision there needs manual attention',
    )
  }

  // Greedy merge: horizontal runs per row, then vertically join equal runs.
  const TILE = 32
  const rects = []
  const open = new Map() // "x:w" -> rect still growing downward
  for (let y = 0; y < h; y++) {
    const rowRuns = new Map()
    for (let x = 0; x < w; x++) {
      if (!blocked[y * w + x]) continue
      let x2 = x
      while (x2 + 1 < w && blocked[y * w + x2 + 1]) x2++
      rowRuns.set(`${x}:${x2 - x + 1}`, { x, w: x2 - x + 1 })
      x = x2
    }
    for (const [key, rect] of open) {
      if (rowRuns.has(key)) continue
      rects.push(rect)
      open.delete(key)
    }
    for (const [key, run] of rowRuns) {
      const grow = open.get(key)
      if (grow) grow.height += TILE
      else open.set(key, { x: run.x * TILE, y: y * TILE, width: run.w * TILE, height: TILE })
    }
  }
  rects.push(...open.values())
  return rects
}


/** Replaces gids that fall outside every tileset's real range with 0. */
function sanitizeGids(xml, id) {
  const sets = [...xml.matchAll(/<tileset firstgid="(\d+)" source="([^"]+)"\/>/g)]
    .map((m) => {
      const tsx = readFileSync(join(OUT, basename(m[2])), 'utf8')
      return { first: Number(m[1]), count: Number(tsx.match(/tilecount="(\d+)"/)[1]) }
    })
    .sort((a, b) => a.first - b.first)
  const valid = (gid) => {
    let ts = null
    for (const s of sets) if (gid >= s.first) ts = s
    return ts !== null && gid < ts.first + ts.count
  }
  let dropped = 0
  xml = xml.replace(/(<data encoding="csv">)([\s\S]*?)(<\/data>)/g, (m, a, csv, b) => {
    const cleaned = csv.replace(/\d+/g, (g) => {
      const gid = Number(g)
      if (gid === 0 || valid(gid)) return g
      dropped++
      return '0'
    })
    return a + cleaned + b
  })
  if (dropped) console.warn(`  ! ${id}: ${dropped} phantom tile refs zeroed (art no longer exists)`)
  return xml
}

async function importMap(tmxName, seen) {
  const tmxPath = join(GAME, 'Maps', tmxName.endsWith('.tmx') ? tmxName : `${tmxName}.tmx`)
  if (!existsSync(tmxPath)) {
    console.error(`no such map: ${tmxPath}`)
    return null
  }
  const id = mapId(tmxPath)
  let xml = readFileSync(tmxPath, 'utf8')

  const found = []
  // <tileset firstgid="1" source="../Tilesets/TECH-borders.tsx"/>
  xml = xml.replace(/(<tileset[^>]*\bsource=")([^"]+)(")/g, (m, a, ref, b) => {
    const src = resolve(dirname(tmxPath), ref)
    if (!existsSync(src)) {
      console.warn(`  ! missing tileset: ${ref}`)
      return m
    }
    found.push(src)
    return a + basename(src) + b
  })
  for (const src of found) await importTileset(src, seen)

  // Convert PSDK's passages layer into collision rectangles BEFORE stripping
  // it. Palette semantics (Assets/passages.png, 16 tiles): local 0 = fully
  // passable, local 15 = fully blocked, 1-14 = per-edge blocking. The reskin
  // only uses 0 and 15; per-edge tiles are treated as passable and counted so
  // a map that does use them fails loudly rather than silently.
  const hitboxes = extractCollision(xml, id)

  // Strip the metadata layers. PSDK never draws them — they are data smuggled
  // in as tile layers — but RPG-JS treats every tile layer as something to
  // render, and their tilesets use colour-key transparency it cannot resolve.
  const meta = META_LAYERS.filter((l) => xml.includes(`name="${l}"`))
  for (const l of meta) {
    xml = xml.replace(
      new RegExp(`\\s*<layer[^>]*name="${l}"[\\s\\S]*?</layer>`, 'g'),
      '',
    )
    xml = xml.replace(
      new RegExp(`\\s*<tileset[^>]*source="${l}\\.tsx"\\s*/>`, 'g'),
      '',
    )
  }

  // RPG-JS mounts the character/event layer only where the map has an
  // <objectgroup> — no objectgroup means no player sprites and no camera
  // follow. PSDK maps never have one, so add an empty one.
  //
  // WHERE it goes is the whole draw order, and getting it there needs one
  // trick. @canvasengine/presets sorts a map's layers by `properties.z ?? 0.5`
  // and the event layer, having no properties, sorts at 0.5. A TILE layer
  // never ties with it: the renderer splits every tile layer by the `z` of
  // each tile in its tileset and stamps the result with `properties.z`, which
  // is 0 for everything, so all tile layers sort to 0 and the player is drawn
  // on top of the entire world — over doorway arches, roofs and tree canopies.
  // That is the reported "you walk over the first door" bug, and moving this
  // tag alone does not fix it: the sort puts it back.
  //
  // (Per-tile `z` is the mechanism the renderer intends, and it cannot reach
  // us. In mmorpg mode the client never parses this file — the server streams
  // it, and sanitizeTileset in @rpgjs/tiledmap/src/streaming.ts deletes every
  // tile's `properties` on the way out, as sanitizeLayerTemplate does for
  // every layer's.)
  //
  // A <group>, though, is not a tile layer: the splitter passes it through
  // untouched, so it keeps `properties.z ?? 0.5` and TIES with the event
  // layer. The sort is stable, so a group placed after the event layer stays
  // after it — and its children render in their own order, unsorted. So the
  // layers that must cover the player go inside one group, after the tag.
  //
  // PSDK names each layer with its RMXP priority level: `Grass_1`,
  // `♣_Tree_rgt_top_5`. Level 1 is the ground plane the player stands on;
  // 2 and up are the parts that must cover them.
  if (!xml.includes('<objectgroup')) {
    // PSDK's nextlayerid is stale on some maps (exterior says 2 while a
    // group with id 2 exists), so derive a free id from what is really there
    const used = [...xml.matchAll(/<(?:layer|objectgroup|imagelayer|group)[^>]*\bid="(\d+)"/g)]
      .map((m) => Number(m[1]))
    const next = Math.max(0, ...used) + 1
    // Rewrite the header FIRST: it changes the string's length, and the
    // insertion below is by offset.
    xml = xml.replace(/nextlayerid="\d+"/, `nextlayerid="${next + 2}"`)
    // First layer drawn above the player, by PSDK's own level suffix.
    let above = null
    for (const m of xml.matchAll(/<layer\b[^>]*\bname="([^"]*)"[^>]*>/g)) {
      const level = /_(\d)$/.exec(m[1])
      if (level && Number(level[1]) >= 2) { above = m.index; break }
    }
    // A map with no level-2 layer has nothing that can cover the player, so
    // it needs no group — and the tag goes where it always went.
    if (above === null) {
      xml = xml.replace('</map>', ` <objectgroup id="${next}" name="events"/>\n</map>`)
    } else {
      // `above` points at the `<layer` itself; the slice before it already
      // carries that layer's indent, so the tag is inserted without its own.
      // Everything from there to the end of the map goes inside the group,
      // which includes the trailing `Borders` frame — it has no level suffix,
      // it lies outside the walkable area, and it was drawn last already.
      xml = xml.slice(0, above) +
        `<objectgroup id="${next}" name="events"/>\n` +
        ` <group id="${next + 1}" name="above">\n ` +
        xml.slice(above).replace('</map>', '</group>\n</map>')
    }
  }

  // Zero out phantom gids — cells pointing past the end of their tileset.
  // Two maps (river, rockethq) reference TECH-Assets tiles that existed in an
  // older, larger sheet. One phantom texture makes PIXI fail the whole map,
  // so dropping the dead cells is the only honest option.
  xml = sanitizeGids(xml, id)

  if (hitboxes) writeFileSync(join(OUT, `${id}.hitboxes.json`), JSON.stringify(hitboxes))

  writeFileSync(join(OUT, `${id}.tmx`), xml)
  const size = xml.match(/\bwidth="(\d+)"\s+height="(\d+)"/)
  console.log(`  ${id}  ${size ? `${size[1]}x${size[2]}` : ''}  tilesets: ${found.length}`)
  return { id, meta }
}

const args = process.argv.slice(2)
// Not game maps: Tiled automapping rule files, the blank template, and the
// title/intro cutscene maps (PSDK plays those as movies; the MMO won't).
const NOT_GAME_MAPS = /^(rules|000 |001 |002 )/
const names = args.includes('--all')
  ? readdirSync(join(GAME, 'Maps')).filter((f) => f.endsWith('.tmx') && !NOT_GAME_MAPS.test(f))
  : args

if (!names.length) {
  console.error('usage: node tools/import-maps.mjs "003 Hub" | --all')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const seen = new Set()
console.log(`importing ${names.length} map(s) into src/tiled/`)
// Sequential on purpose: maps share tilesets, and two concurrent imports of
// the same tileset race on the .tmp file the colour-key step writes.
const done = []
for (const n of names) done.push(await importMap(n, seen))
const imported = done.filter(Boolean)

const withMeta = imported.filter((d) => d.meta.length)
console.log(`\n${imported.length} map(s), ${seen.size} asset(s) copied.`)
if (withMeta.length) {
  console.log(
    `\nNOTE: ${withMeta.length} map(s) carried PSDK metadata layers ` +
      `(${META_LAYERS.join(', ')}).\n` +
      `passages became <id>.hitboxes.json; systemtags became terrain.ts.`,
  )
}

/*
 * systemtags -> src/tiled/terrain.ts
 *
 * PSDK's second metadata layer says what a tile IS underfoot: stairs, tall
 * grass, water, a ledge to hop, a conveyor. It is stripped from the art like
 * `passages` is, and it used to be simply thrown away — which is why the
 * staircases on the dock and in the hub are walked over at full speed as if
 * they were pavement.
 *
 * The tag is the tile's index in Assets/prio_w.png, an 8x16 palette of labelled
 * icons. The ones this game's maps actually place, read off that sheet:
 *
 *     1 Ice        2 SoftSoil   3 Waterfall  4 Headbutt   5 Grass
 *     6 TallGrass  7 Cave       9-12 Rapids  13 Mountain  14 Sand
 *    15 Pond      17 RapidsS   19 Puddle    21 Sea       23 Snow
 *    24-30 ledges, bike paths and holes
 *    33 stairs down-right   34 stairs up   35 stairs down   36 stairs up-right
 *    37 swamp edge  38 deep swamp  40-46 Z levels  47 road
 *    48-51 conveyor  61 whirlpool  62 rock climb
 *
 * ("esc" on the sheet is escalier — PSDK is French — and the art under 34 on
 * the dock is a plain flight of steps, not a moving one.)
 *
 * Emitted for EVERY PSDK map, not only the ones this run imported, so a
 * partial run cannot silently empty the file. Only tiles that carry a tag are
 * listed, which is a few thousand cells across the whole game.
 */
{
  const maps = {}
  for (const f of readdirSync(join(GAME, 'Maps')).filter((f) => f.endsWith('.tmx') && !NOT_GAME_MAPS.test(f))) {
    const xml = readFileSync(join(GAME, 'Maps', f), 'utf8')
    const ts = /<tileset firstgid="(\d+)"[^>]*source="[^"]*systemtags\.tsx"\s*\/>/.exec(xml)
    const layer = /<layer[^>]*name="systemtags"[^>]*width="(\d+)"[^>]*height="(\d+)"[^>]*>[\s\S]*?<data[^>]*>([\s\S]*?)<\/data>/.exec(xml)
    if (!ts || !layer) continue
    const first = Number(ts[1])
    const tags = {}
    layer[3].trim().split(/\s*,\s*/).forEach((raw, i) => {
      // The top three bits of a gid are flip flags, never part of the index.
      const gid = (Number(raw) >>> 0) & 0x1fffffff
      if (!gid) return
      const tag = gid - first
      if (tag <= 0) return // local 0 is the palette's own "No Tag" swatch
      ;(tags[tag] ??= []).push(i)
    })
    if (Object.keys(tags).length) {
      maps[mapId(f)] = { w: Number(layer[1]), h: Number(layer[2]), tags }
    }
  }
  const body = Object.entries(maps)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, m]) => `  '${id}': { w: ${m.w}, h: ${m.h}, tags: {\n` +
      Object.entries(m.tags).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([tag, at]) => `    ${tag}: [${at.join(',')}],`).join('\n') +
      `\n  } },`)
    .join('\n')
  writeFileSync(join(OUT, 'terrain.ts'),
    '// GENERATED by tools/import-maps.mjs — do not edit by hand.\n' +
    '// PSDK systemtags: what each tile IS underfoot. Tag numbers are indices\n' +
    "// into Stockmonsters/Data/Tiled/Assets/prio_w.png; the importer's own\n" +
    '// comment lists the ones in use. `tags[tag]` holds tile INDICES (y*w+x).\n' +
    'export type MapTerrain = { w: number; h: number; tags: Record<number, number[]> }\n\n' +
    `export const TERRAIN: Record<string, MapTerrain> = {\n${body}\n}\n`)
  const cells = Object.values(maps).reduce((n, m) => n + Object.values(m.tags).reduce((k, a) => k + a.length, 0), 0)
  console.log(`terrain.ts: ${Object.keys(maps).length} maps, ${cells} tagged tiles`)
}
// Emit a plain-ESM manifest — src/server.ts is imported by vite.config.ts in
// a Node context where import.meta.glob does not exist, so the map list must
// be ordinary imports.
// The id list comes from the PSDK SOURCE folder, not from src/tiled. The RMXP
// importer writes its 152 maps into the same directory and keeps its own
// rmxp-manifest.ts, which src/server.ts concatenates with this one — so a
// listing of src/tiled would put every RMXP map in BOTH manifests and register
// each of them twice.
{
  const ids = readdirSync(join(GAME, 'Maps'))
    .filter((f) => f.endsWith('.tmx') && !NOT_GAME_MAPS.test(f))
    .map((f) => mapId(f))
    .sort()
  const lines = [
    '// GENERATED by tools/import-maps.mjs — do not edit by hand.',
    ...ids.map((mapId, i) => `import h${i} from './${mapId}.hitboxes.json'`),
    '',
    'export type Rect = { x: number; y: number; width: number; height: number }',
    '',
    'export const MAPS: { id: string; hitboxes: Rect[] }[] = [',
    ...ids.map((mapId, i) => `  { id: '${mapId}', hitboxes: h${i} },`),
    ']',
    '',
  ]
  writeFileSync(join(OUT, 'manifest.ts'), lines.join('\n'))
  console.log(`manifest.ts: ${ids.length} maps`)
}

console.log('\nmap ids:', imported.map((d) => d.id).join(', '))
