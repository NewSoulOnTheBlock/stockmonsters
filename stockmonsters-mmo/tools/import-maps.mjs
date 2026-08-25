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
    `\nNOTE: ${withMeta.length} map(s) still carry PSDK metadata layers ` +
      `(${META_LAYERS.join(', ')}).\n` +
      `Those encode collision and terrain in PSDK's own format.\n` +
      `They are stripped from the imported map — RPG-JS would try to draw them.\n` +
      `Converting them into RPG-JS collision is the next step; until then\n` +
      `players walk through walls.`,
  )
}
console.log('\nmap ids:', done.map((d) => d.id).join(', '))
