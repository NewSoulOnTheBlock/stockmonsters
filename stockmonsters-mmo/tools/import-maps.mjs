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
  if (!xml.includes('<objectgroup')) {
    const next = Number(xml.match(/nextlayerid="(\d+)"/)?.[1] ?? 1)
    xml = xml
      .replace(/nextlayerid="\d+"/, `nextlayerid="${next + 1}"`)
      .replace('</map>', ` <objectgroup id="${next}" name="events"/>\n</map>`)
  }

  if (hitboxes) writeFileSync(join(OUT, `${id}.hitboxes.json`), JSON.stringify(hitboxes))

  writeFileSync(join(OUT, `${id}.tmx`), xml)
  const size = xml.match(/\bwidth="(\d+)"\s+height="(\d+)"/)
  console.log(`  ${id}  ${size ? `${size[1]}x${size[2]}` : ''}  tilesets: ${found.length}`)
  return { id, meta }
}

const args = process.argv.slice(2)
const names = args.includes('--all')
  ? readdirSync(join(GAME, 'Maps')).filter((f) => f.endsWith('.tmx'))
  : args

if (!names.length) {
  console.error('usage: node tools/import-maps.mjs "003 Hub" | --all')
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const seen = new Set()
console.log(`importing ${names.length} map(s) into src/tiled/`)
const done = (await Promise.all(names.map((n) => importMap(n, seen)))).filter(Boolean)

const withMeta = done.filter((d) => d.meta.length)
console.log(`\n${done.length} map(s), ${seen.size} asset(s) copied.`)
if (withMeta.length) {
  console.log(
    `\nNOTE: ${withMeta.length} map(s) carried PSDK metadata layers ` +
      `(${META_LAYERS.join(', ')}).\n` +
      `passages was converted to <id>.hitboxes.json (pass it as the map's\n` +
      `\`hitboxes\` in the module); systemtags (grass, water, ledges) is\n` +
      `still dropped — terrain effects are not converted yet.`,
  )
}
console.log('\nmap ids:', done.map((d) => d.id).join(', '))
