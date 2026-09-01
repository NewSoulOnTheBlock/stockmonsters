#!/usr/bin/env node
/*
 * merge-tile-layers.mjs — collapse a TMX's tile layers into the fewest that
 * still draw the identical picture.
 *
 *   node tools/merge-tile-layers.mjs --all                    # every map, no writes
 *   node tools/merge-tile-layers.mjs --write exterior cave    # named maps
 *   node tools/merge-tile-layers.mjs --write --all            # src/tiled + compact
 *   node tools/merge-tile-layers.mjs --verify                 # prove the draw
 *                                                             # stacks are unchanged
 *
 * WHY
 *
 * The PSDK-imported maps carry an absurd number of tile layers — 73 on
 * exterior, 79 on beach, against a median of 5 for the RMXP maps — because
 * RPG Maker XP paints every semantic thing (tree trunk, tree left-bottom,
 * building shadow left A, building shadow left B, …) on its own plane. On
 * exterior, 23 of the 73 hold not one painted tile and another 16 hold fewer
 * than 20. Every one of them is a container the renderer builds, a
 * width*height array @rpgjs/tiledmap's `initializeLayerData` allocates on
 * EVERY chunk that arrives, and a `findLayer` linear scan per chunk patch.
 *
 * HOW MUCH IT IS WORTH — measured, not assumed
 *
 * Across the 148 map files this touches: 2382 -> 1042 tile layers and 19.5 MB
 * -> 8.8 MB of .tmx on disk (which the server parses at boot and the direct
 * loader ships whole). That part is real and unambiguous.
 *
 * The stutter it was meant to fix, it did NOT fix. Driven with
 * `PROBE_MAPLOAD` before and after, at x1 and at a x6 CPU throttle, map-load
 * CPU fell about 5% and wall-clock settle time not at all outside the noise.
 * Instrumenting `rebuildParsedMap` directly explains why: it is called ~20
 * times per load but costs 2-12ms in total, and the per-cell work downstream
 * — which a merge cannot remove, because the painted cells are all still
 * there — is where the ~1.1s per load goes. Keep the fold for what it is: a
 * smaller, saner map file. Do not expect it to be the answer to the freeze.
 *
 * THE RULE, AND WHY IT CANNOT CHANGE A PIXEL
 *
 * Walk the layers of one container in document order. Drop a layer with no
 * painted cell. Otherwise merge it into the PREVIOUS output layer when no
 * cell is painted in both; else start a new output layer.
 *
 * A cell's picture is the ordered list of gids painted at it, bottom to top.
 * Merging two layers that never paint the same cell leaves every cell with
 * the same list in the same order, because at every cell at most one of the
 * two contributes. Dropping an empty layer removes nothing from any list.
 * So the rule is pixel-identical by construction, and it is order-preserving:
 * output layer k holds only tiles from input layers that all sat between
 * output layer k-1's and k+1's.
 *
 * (Merging into an EARLIER output layer, allowed when nothing between paints a
 * conflicting cell, is also sound — but it cannot save a single layer. A new
 * output layer is only ever started when the incoming layer conflicts with the
 * LAST one, and that check is the same under either policy. So the simple rule
 * is already optimal for this family of order-preserving merges.)
 *
 * THE BOUNDARIES IT MUST NOT CROSS
 *
 *  - `<group name="above">`. This is the whole draw order. @canvasengine/
 *    presets sorts a map's TOP-LEVEL layers by `properties.z ?? 0.5`; a tile
 *    layer is stamped z=0 by the per-tile-z splitter and a group keeps 0.5, so
 *    the group ties with the `events` objectgroup and — stable sort — stays
 *    after it, which is what puts roofs and canopies over the player. Its
 *    children are rendered in their own order, unsorted. Each container is
 *    therefore merged independently and nothing ever moves between them.
 *  - Any objectgroup, imagelayer, or NON-EMPTY group: something is drawn
 *    there, so layers on either side of it stay on their own side.
 *  - `visible="0"` layers. PSDK leaves a few (`Borders`, `terrain_tag`,
 *    `systemtags_bridge1`). One that paints anything is passed through
 *    untouched AND acts as a barrier, so the pass stays correct whether or not
 *    the renderer honours the flag. One that paints nothing is dropped, which
 *    draws nothing under either reading.
 *  - A layer carrying `<properties>`, `opacity`, `offsetx/y`, `tintcolor`,
 *    `parallaxx/y` or a non-CSV encoding. None of these maps has one — the
 *    pass refuses to touch a file that does rather than guess.
 *
 * The self-closing `<group id="4" name="Z=0"/>` markers PSDK leaves behind are
 * NOT boundaries: an empty group draws nothing, so layers merge straight
 * across one. (Treating them as boundaries costs exterior 3 layers for
 * nothing.) They are kept in the file — they end up at the end of the run they
 * were inside, which cannot matter for something that draws nothing.
 *
 * FLIP FLAGS
 *
 * A gid's top bits are horizontal/vertical/diagonal flip. Cells are moved as
 * their ORIGINAL TEXT, never re-encoded, so a flipped tile cannot lose its
 * flags or be mistaken for a different tile.
 *
 * WHERE THIS RUNS
 *
 * tools/import-maps.mjs calls mergeTileLayers() as its last step, after the
 * `above` group is inserted and phantom gids are zeroed — so a re-import keeps
 * the win instead of undoing it. tools/compact-atlases.mjs reads src/tiled and
 * copies the layer structure through, so its output inherits the fold too.
 *
 * It can inherit ONE layer more than the source has, though: compaction can
 * zero a cell whose tile no longer exists, and a layer that only held those is
 * empty in the compact copy and not in the source. That is why this CLI walks
 * src/tiled AND src/tiled/compact and folds each on its own evidence — the
 * counts are allowed to differ by a layer, and each file is proven separately.
 * (compact/wifi.tmx is the one that does: 18 -> 7 against src/tiled's 18 -> 8.)
 *
 * This CLI also exists to apply the pass to files that are already written
 * (src/tiled/compact is committed, so it must be folded in place) and to
 * re-verify them at any time with --verify.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TILED = join(ROOT, 'src', 'tiled')

/* ============================================================ tmx walking ==*/

/**
 * Splits a container's body into ordered nodes, keeping each node's exact
 * source text and the whitespace in front of it so an untouched file
 * round-trips byte for byte.
 */
function parseNodes(xml, from, to) {
  const nodes = []
  const re = /<(layer|group|objectgroup|imagelayer)\b[^>]*?(\/?)>/g
  re.lastIndex = from
  let cursor = from
  let m
  while ((m = re.exec(xml)) && m.index < to) {
    const [tag, kind, selfClosing] = [m[0], m[1], m[2] === '/']
    const pre = xml.slice(cursor, m.index)
    let end
    if (selfClosing) {
      end = m.index + tag.length
    } else {
      // find the matching close, counting same-named nesting
      const scan = new RegExp(`<${kind}\\b[^>]*?(\\/?)>|<\\/${kind}>`, 'g')
      scan.lastIndex = m.index + tag.length
      let depth = 1
      let s
      while (depth > 0 && (s = scan.exec(xml))) {
        if (s[0].startsWith('</')) depth--
        else if (s[1] !== '/') depth++
      }
      if (depth !== 0) throw new Error(`unterminated <${kind}>`)
      end = scan.lastIndex
    }
    const text = xml.slice(m.index, end)
    const node = { kind, pre, text, openTag: tag, selfClosing }
    if (kind === 'group' && !selfClosing) {
      // parseNodes' own `trailing` carries the whitespace up to the close tag,
      // so serialize(children) reproduces the body exactly.
      node.children = parseNodes(xml, m.index + tag.length, end - '</group>'.length)
      node.bodyEmpty = node.children.length === 0
    }
    nodes.push(node)
    cursor = end
    re.lastIndex = end
  }
  nodes.trailing = xml.slice(cursor, to)
  return nodes
}

function serialize(nodes) {
  let out = ''
  for (const n of nodes) {
    out += n.pre
    if (n.kind === 'group' && !n.selfClosing) {
      out += n.openTag + serialize(n.children) + '</group>'
    } else {
      out += n.text
    }
  }
  return out + (nodes.trailing ?? '')
}

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null

/** The csv cells of a tile layer, as their original text. */
function cellsOf(layerText) {
  const d = /<data encoding="csv">([\s\S]*?)<\/data>/.exec(layerText)
  if (!d) return null
  return d[1].trim().split(',').map((s) => s.trim())
}

/** A cell is painted when its gid, flip flags masked off, is not zero. */
const painted = (tok) => (Number(tok) & 0x0fffffff) !== 0

/* ================================================================= merge ===*/

/** A layer this pass refuses to fold into anything. */
function isBarrierLayer(text) {
  const tag = /<layer\b[^>]*>/.exec(text)[0]
  if (attr(tag, 'visible') === '0') return 'invisible'
  for (const a of ['opacity', 'offsetx', 'offsety', 'tintcolor', 'parallaxx', 'parallaxy'])
    if (attr(tag, a) !== null) return a
  if (/<properties\b/.test(text)) return 'properties'
  if (!/<data encoding="csv">/.test(text)) return 'encoding'
  return null
}

function mergeContainer(nodes, stats) {
  const out = []
  let run = [] // consecutive mergeable tile layers
  let parked = [] // empty groups the run was allowed to swallow past

  const flush = () => {
    if (!run.length) {
      out.push(...parked)
      parked = []
      return
    }
    const groups = [] // each: { first: node, cells: string[], sources: node[] }
    for (const node of run) {
      const cells = cellsOf(node.text)
      if (!cells.some(painted)) {
        stats.dropped++
        continue
      }
      const last = groups[groups.length - 1]
      if (last && !cells.some((c, i) => painted(c) && painted(last.cells[i]))) {
        for (let i = 0; i < cells.length; i++) if (painted(cells[i])) last.cells[i] = cells[i]
        last.sources.push(node)
        stats.merged++
      } else {
        groups.push({ first: node, cells, sources: [node] })
      }
    }
    for (const g of groups) out.push(g.sources.length === 1 ? g.first : rebuild(g))
    // The parked markers draw nothing, so where they land inside the container
    // cannot matter; keeping them at all is only so the file still reads like
    // the PSDK original.
    out.push(...parked)
    run = []
    parked = []
  }

  for (const node of nodes) {
    if (node.kind === 'layer' && !isBarrierLayer(node.text)) {
      run.push(node)
      continue
    }
    // An empty group draws nothing, so it is NOT a boundary: park it and let
    // the run continue straight through it. (These are PSDK's `Z=0` … `Z=4`
    // markers; on exterior alone, treating them as boundaries would cost 3
    // layers for nothing.)
    if (node.kind === 'group' && (node.selfClosing || node.bodyEmpty)) {
      parked.push(node)
      continue
    }
    // A layer with nothing painted in it draws nothing under ANY reading of
    // `visible`, so even a barrier layer goes if it is empty.
    if (node.kind === 'layer') {
      const cells = cellsOf(node.text)
      if (cells && !cells.some(painted)) {
        stats.dropped++
        continue
      }
    }
    flush()
    if (node.kind === 'group') node.children = mergeContainer(node.children, stats)
    out.push(node)
  }
  flush()
  out.trailing = nodes.trailing
  return out
}

/**
 * One <layer> node holding a merged group's cells, formatted like the
 * originals. It keeps the FIRST source layer's id (ids stay unique, and
 * @rpgjs/tiledmap's chunk patches are keyed by `layer.id ?? layer.name`) and
 * names itself after the first source plus how many more it swallowed.
 */
function rebuild(g) {
  const tag = /<layer\b[^>]*>/.exec(g.first.text)[0]
  const width = Number(attr(tag, 'width'))
  const first = attr(tag, 'name')
  const open = tag.replace(/\bname="[^"]*"/, `name="${first}+${g.sources.length - 1}"`)
  const rows = []
  for (let i = 0; i < g.cells.length; i += width) rows.push(g.cells.slice(i, i + width).join(','))
  const indent = /\n([ \t]*)$/.exec(g.first.pre)?.[1] ?? ' '
  const text =
    `${open}\n${indent} <data encoding="csv">\n` +
    rows.join(',\n') +
    `\n${indent}</data>\n${indent}</layer>`
  return { kind: 'layer', pre: g.first.pre, text, openTag: open, selfClosing: false }
}

/**
 * Rewrites one map's XML. Returns { xml, before, after, dropped, merged }.
 * Idempotent: a second run finds nothing left to merge.
 */
export function mergeTileLayers(xml) {
  const bodyFrom = xml.search(/<(layer|group|objectgroup|imagelayer)\b/)
  const bodyTo = xml.lastIndexOf('</map>')
  if (bodyFrom < 0 || bodyTo < 0) return { xml, before: 0, after: 0, dropped: 0, merged: 0 }
  const before = (xml.match(/<layer\b/g) ?? []).length
  const nodes = parseNodes(xml, bodyFrom, bodyTo)
  if (serialize(nodes) !== xml.slice(bodyFrom, bodyTo)) throw new Error('tmx round-trip failed')
  const stats = { dropped: 0, merged: 0 }
  const merged = mergeContainer(nodes, stats)
  const next = xml.slice(0, bodyFrom) + serialize(merged) + xml.slice(bodyTo)
  return { xml: next, before, after: (next.match(/<layer\b/g) ?? []).length, ...stats }
}

/* ================================================== the proof, not the eye ==*/

/**
 * For every cell, the ordered list of painted gids as the renderer walks the
 * file: top-level tile layers first (they are all stamped z=0 and sort ahead
 * of the 0.5 that groups and objectgroups keep), then the groups in document
 * order, each group's children in document order. Two TMX files draw the same
 * picture if and only if this is equal for every cell.
 *
 * `visible="0"` layers are recorded in their own bucket, so a change to one
 * shows up as a difference whether or not the renderer draws them.
 */
export function drawStacks(xml) {
  const bodyFrom = xml.search(/<(layer|group|objectgroup|imagelayer)\b/)
  const bodyTo = xml.lastIndexOf('</map>')
  const nodes = parseNodes(xml, bodyFrom, bodyTo)
  const stacks = new Map()
  const push = (bucket, i, gid) => {
    const key = `${bucket}:${i}`
    if (!stacks.has(key)) stacks.set(key, [])
    stacks.get(key).push(gid)
  }
  const walk = (list, path, sorted) => {
    // At the TOP level the renderer sorts: every tile layer is stamped z=0 and
    // comes before the groups, which keep 0.5. Inside a group nothing is
    // sorted, so document order is the draw order.
    const order = sorted
      ? [...list.filter((n) => n.kind === 'layer'), ...list.filter((n) => n.kind !== 'layer')]
      : list
    for (const n of order) {
      if (n.kind === 'layer') emit(n, path)
      else if (n.kind === 'group' && n.children?.length)
        walk(n.children, `${path}/${attr(n.openTag, 'name')}`, false)
    }
  }
  const emit = (n, path) => {
    const tag = /<layer\b[^>]*>/.exec(n.text)[0]
    const bucket = attr(tag, 'visible') === '0' ? `${path}!hidden` : path
    const cells = cellsOf(n.text)
    if (!cells) return
    cells.forEach((c, i) => {
      if (painted(c)) push(bucket, i, String(Number(c)))
    })
  }
  walk(nodes, '', true)
  return stacks
}

export function stacksEqual(a, b) {
  if (a.size !== b.size) return `bucket/cell count ${a.size} vs ${b.size}`
  for (const [k, v] of a) {
    const w = b.get(k)
    if (!w) return `missing ${k}`
    if (v.length !== w.length || v.some((g, i) => g !== w[i]))
      return `cell ${k}: [${v}] vs [${w}]`
  }
  return null
}

/* =================================================================== cli ===*/

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const verify = args.includes('--verify')
  const all = args.includes('--all')
  const named = args.filter((a) => !a.startsWith('--'))

  const dirs = [TILED, join(TILED, 'compact')].filter(existsSync)
  const files = []
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.tmx')).sort()) {
      const id = basename(f, '.tmx')
      if (!all && named.length && !named.includes(id)) continue
      files.push(join(dir, f))
    }
  }
  if (!files.length) {
    console.error('usage: node tools/merge-tile-layers.mjs [--write|--verify] [--all|<mapId>...]')
    process.exit(2)
  }

  let totalBefore = 0
  let totalAfter = 0
  let changed = 0
  let bad = 0
  for (const file of files) {
    const xml = readFileSync(file, 'utf8')
    const r = mergeTileLayers(xml)
    totalBefore += r.before
    totalAfter += r.after
    const label = file.slice(TILED.length + 1).replace(/\.tmx$/, '')
    if (verify || r.before !== r.after) {
      const why = stacksEqual(drawStacks(xml), drawStacks(r.xml))
      if (why) {
        console.error(`  !! ${label}: DRAW STACK CHANGED — ${why}`)
        bad++
        continue
      }
      const again = mergeTileLayers(r.xml)
      if (again.after !== r.after) {
        console.error(`  !! ${label}: not idempotent (${r.after} -> ${again.after})`)
        bad++
        continue
      }
    }
    if (r.before !== r.after) {
      changed++
      console.log(
        `  ${label.padEnd(34)} ${String(r.before).padStart(3)} -> ${String(r.after).padStart(3)}` +
          `   (${r.dropped} empty dropped, ${r.merged} folded)`,
      )
      if (write) writeFileSync(file, r.xml)
    }
  }
  console.log(
    `\n${files.length} map file(s), ${changed} with layers to save: ` +
      `${totalBefore} -> ${totalAfter} tile layers ` +
      `(${totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0}% fewer)` +
      (write ? ' — WRITTEN' : ' — report only, pass --write'),
  )
  if (bad) {
    console.error(`\n${bad} map(s) FAILED the draw-stack proof and were not written.`)
    process.exit(1)
  }
}
