/*
 * IS THERE A SIGN ON THE DOOR?
 *
 *   npm run test:e2e:door-marker
 *
 * A player stood in front of the tower on `exterior` and could not tell
 * whether it was a building or a painting. src/door-markers.ts puts a floating
 * chevron over every doorway that actually leads somewhere — and a rendering
 * feature is not finished until a real browser has drawn it, because every way
 * this can fail is silent:
 *
 *   · the module never mounts (an import that throws takes the whole UI with
 *     it and nothing in the console says which one)
 *   · it mounts, builds nodes, and puts them all at (0,0) because
 *     `viewport.toScreen` was not there or the canvas rect was empty
 *   · it renders in the right place ON THE WRONG MAP, because the map id
 *     arrives as "map-exterior" in one code path and "exterior" in another
 *   · the old map's markers are never removed, so every door you have ever
 *     walked past piles up on the current screen
 *
 * None of those throw. All of them are visible here.
 *
 * WHAT IT ASSERTS
 *   1. the marker exists over the tower's two-tile opening at (31,31)+(32,31),
 *      as ONE node, not two
 *   2. it is a real laid-out element: nonzero rect, on screen, above the
 *      doorway rather than on top of the character
 *   3. the plain wall to the west of the opening carries NOTHING
 *   4. the overlay cannot be clicked or walked into (pointer-events: none)
 *   5. walking through the door replaces the markers with the new map's
 *   6. and the ferry gangway — a cross-map ACTION warp — is marked
 *      differently, because walking into it does nothing
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4262)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const TILE = 32
// The tower on `exterior`: the opening is the two-tile notch at y=31, so its
// centre in world pixels is the 31/32 boundary. The pavement is y=32/33.
const DOOR_WORLD = { x: 32 * TILE, y: 31 * TILE + TILE / 2 }
const INFRONT = { map: 'exterior', x: 32, y: 33 }

const child = process.env.BASE ? null : spawn(
  process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
)
child?.stdout.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
child?.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-doormark-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 800 })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  const hex = '0123456789abcdef'
  const rnd = (n) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('')
  localStorage.setItem('sm-wallet', JSON.stringify({ connectionId: 'w:' + rnd(32), address: '0x' + rnd(40) }))
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
  // A FRESH NAME EVERY RUN. Reusing one makes the server answer "that name is
  // already taken" and the CHOOSE YOUR NAME modal sits over the whole map —
  // the DOM assertions still pass behind it and the screenshot shows nothing
  // but the dialog, which is not evidence of anything.
  localStorage.setItem('sm-name', 'Door' + rnd(6))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(5000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(12000)

/**
 * Everything about the overlay, read from the DOM rather than from the
 * module's own bookkeeping wherever possible — a marker that the module
 * believes it drew but that has no layout box is not a marker.
 */
const readWorld = () => page.evaluate((doorWorld) => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.()
  const r = (v) => (typeof v === 'function' ? v() : v)
  const root = document.getElementById('sm-doors')
  const canvas = e?.renderer?.canvas ?? e?.renderer?.view ?? document.querySelector('canvas')
  const rect = canvas?.getBoundingClientRect()
  const vp = e?.findViewportInstance?.()
  // The same transform the overlay uses, computed here independently so a
  // marker in the wrong place cannot agree with itself.
  const toScreen = (wx, wy) => {
    try {
      const pt = vp?.toScreen(wx, wy)
      return { x: rect.left + pt.x, y: rect.top + pt.y }
    } catch { return null }
  }
  const nodes = [...(root?.querySelectorAll('.door') ?? [])].map((n) => {
    const b = n.getBoundingClientRect()
    const cs = getComputedStyle(n)
    return {
      text: n.innerText.replace(/\s+/g, ' ').trim(),
      classes: n.className,
      shown: cs.display !== 'none',
      opacity: Number(cs.opacity),
      rect: { l: b.left, t: b.top, w: b.width, h: b.height },
      cx: b.left + b.width / 2,
      cy: b.top + b.height / 2,
    }
  })
  return {
    map: String(r(s?.id) ?? '').replace(/^map-/, ''),
    player: p ? { x: Math.round(r(p.x)), y: Math.round(r(p.y)) } : null,
    hasOverlay: !!root,
    overlayPointerEvents: root ? getComputedStyle(root).pointerEvents : null,
    markers: typeof window.__doorMarkers === 'function' ? window.__doorMarkers() : null,
    nodes,
    doorOnScreen: toScreen(doorWorld.x, doorWorld.y),
    // A stretch of plain building wall west of the opening, same row.
    wallOnScreen: [24, 26, 28].map((tx) => toScreen(tx * 32 + 16, 31 * 32 + 16)),
    canvasRect: rect ? { l: rect.left, t: rect.top, w: rect.width, h: rect.height } : null,
  }
}, DOOR_WORLD)

check('the player is in the world', !!(await readWorld()).player)

/*
 * WAIT FOR THE CURTAIN, NOT JUST FOR THE MAP.
 *
 * map-transition.ts covers the screen for up to two seconds after ANY
 * transfer, including a dev teleport that never leaves the map. Reading the
 * DOM through it gives the right numbers — the markers are laid out fine
 * behind it — but the SCREENSHOT is a black rectangle that says TRAVELLING,
 * which proves nothing about what a player sees. Wait for it to lift.
 */
async function settle(wantMap, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    await sleep(400)
    const curtain = await page.evaluate(() =>
      !!document.querySelector('#sm-transit.on:not(.leaving)'))
    const w = await readWorld()
    if (!curtain && w.map === wantMap && w.player) return w
  }
  return await readWorld()
}

// Stand on the pavement two tiles below the tower's opening.
await page.evaluate((d) => window.__engine?.processAction?.('dev:goto', d), INFRONT)
await settle('exterior')
// One more breath so the bob animation is mid-cycle and the tiles have drawn.
await sleep(1200)
const near = await readWorld()
console.log('  standing in front of the tower:', JSON.stringify({ map: near.map, player: near.player }))
check('the teleport put us on the exterior map', near.map === 'exterior', near.map)
check('the door overlay is mounted', near.hasOverlay === true)
check('the overlay cannot be clicked or walked into',
  near.overlayPointerEvents === 'none', String(near.overlayPointerEvents))

/* ---------------------------------------------- 1. the tower is marked --- */

const towerRows = (near.markers ?? []).filter((m) => m.to === 'hub' && m.from === 'exterior')
console.log('  markers the module believes it drew on exterior:',
  JSON.stringify((near.markers ?? []).map((m) => `${m.to}@${m.wx},${m.wy}${m.action ? ' (press)' : ''}:${m.tier}${m.visible ? '' : ' hidden'}`)))
check('exactly ONE marker for the tower, not one per door tile', towerRows.length === 1, `${towerRows.length}`)
check('it sits at the centre of the two-tile opening',
  towerRows[0]?.wx === DOOR_WORLD.x && towerRows[0]?.wy === DOOR_WORLD.y,
  JSON.stringify(towerRows[0] && { wx: towerRows[0].wx, wy: towerRows[0].wy }))
check('standing in front of it makes it the NEAR one — the only one that names its destination',
  towerRows[0]?.tier === 'near', String(towerRows[0]?.tier))

/* -------------------------- 2. it is a real element, over the doorway --- */

const shown = near.nodes.filter((n) => n.shown)
console.log('  laid-out marker nodes:', JSON.stringify(shown.map((n) => ({ t: n.text, x: Math.round(n.cx), y: Math.round(n.cy), o: n.opacity }))))
const labelled = shown.filter((n) => /HUB/.test(n.text))
check('the tower marker is rendered as one element with the destination on it',
  labelled.length === 1, `${labelled.length} nodes said HUB`)
const sign = labelled[0]
check('it has a real layout box', !!sign && sign.rect.w > 10 && sign.rect.h > 6,
  sign ? `${Math.round(sign.rect.w)}x${Math.round(sign.rect.h)}` : 'no node')
check('it is inside the canvas', !!sign && !!near.canvasRect &&
  sign.cx > near.canvasRect.l && sign.cx < near.canvasRect.l + near.canvasRect.w &&
  sign.cy > near.canvasRect.t && sign.cy < near.canvasRect.t + near.canvasRect.h)
// Independently computed door position, from the viewport, in the test.
const dx = sign && near.doorOnScreen ? Math.abs(sign.cx - near.doorOnScreen.x) : Infinity
const dy = sign && near.doorOnScreen ? near.doorOnScreen.y - sign.cy : -Infinity
check('it is horizontally over the doorway', dx < 24, `${Math.round(dx)}px off`)
// Above it: the sign floats over the arch so it never covers the character
// standing in the opening. 30 world px * 1.5 zoom = 45 screen px, plus the
// plate's own height because it hangs from its bottom edge.
check('it floats ABOVE the doorway rather than on top of whoever is standing in it',
  dy > 20 && dy < 140, `${Math.round(dy)}px above the door tile`)

/* ------------------------------- 3. nothing on the plain wall beside it --- */

const covers = (n, pt) => pt && pt.x >= n.rect.l - 4 && pt.x <= n.rect.l + n.rect.w + 4 &&
  pt.y >= n.rect.t - 4 && pt.y <= n.rect.t + n.rect.h + 4
const wallHits = near.wallOnScreen.filter((pt) => shown.some((n) => covers(n, pt)))
check('the plain wall west of the opening carries no marker at all',
  wallHits.length === 0, `${wallHits.length} of 3 wall samples had a marker over them`)

const covered = await page.evaluate(() =>
  [...document.querySelectorAll('body > div')].filter((d) => {
    const cs = getComputedStyle(d)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    // #rpg IS the game — it holds the canvas. Anything else this big is on top.
    if (d.id === 'sm-doors' || d.querySelector('canvas')) return false
    if (cs.pointerEvents === 'none') return false
    const b = d.getBoundingClientRect()
    return b.width > innerWidth * 0.35 && b.height > innerHeight * 0.35
  }).map((d) => d.id || d.className || d.tagName))
check('nothing is covering the map when the screenshot is taken', covered.length === 0,
  covered.length ? `open over the map: ${covered.join(', ')}` : '')
await page.screenshot({ path: process.env.SHOT ?? 'door-marker.png' })

/* ---------------------------------- 6. the ferry gangway is marked as press */

const ferry = (near.markers ?? []).find((m) => m.to === 'olivine-city')
check('the ferry gangway is marked as a door you PRESS, not one you walk into',
  !!ferry && ferry.action === true, JSON.stringify(ferry && { wx: ferry.wx, action: ferry.action }))

/* -------------------------------------- 5. the markers follow the map --- */

async function walkNorth(steps = 6) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(async () => {
      const c = window.__controls?.()
      if (!c?.applyControl) return
      await c.applyControl('up', true)
      await new Promise((r) => setTimeout(r, 420))
      await c.applyControl('up', false)
    })
    await sleep(650)
    const now = await readWorld()
    if (now.map && now.map !== 'exterior') return now
  }
  return await readWorld()
}

// The sign said the tower opens. Walking into it must actually open it —
// otherwise the marker is a nicer lie than the painted door was.
const inside = await walkNorth()
console.log('  after walking into the marked door:', JSON.stringify({ map: inside.map, player: inside.player }))
check('the marked door really does open', inside.map && inside.map !== 'exterior', `still on ${inside.map}`)

if (inside.map && inside.map !== 'exterior') {
  await settle(inside.map)
  await sleep(1000)
  const now = await readWorld()
  const stale = (now.markers ?? []).filter((m) => m.from !== now.map)
  check('every marker from the old map is gone', stale.length === 0,
    `${stale.length} left over: ${JSON.stringify(stale.slice(0, 3))}`)
  check('the new map has its own markers', (now.markers ?? []).length > 0,
    `${(now.markers ?? []).length} on ${now.map}`)
  console.log(`  on ${now.map}: ${(now.markers ?? []).length} doors, ${now.nodes.filter((n) => n.shown).length} on screen`)
  await page.screenshot({ path: process.env.SHOT2 ?? 'door-marker-inside.png' })
}

await browser.close(); child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
