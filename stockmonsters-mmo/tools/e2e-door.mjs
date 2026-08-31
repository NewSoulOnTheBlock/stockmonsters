/*
 * CAN YOU WALK INTO A BUILDING?
 *
 *   npm run test:e2e:door
 *
 * A player stood in the alcove of the tower on `exterior`, facing the opening,
 * and nothing happened. The data all looked right: the two door tiles at
 * (31,31) and (32,31) carry `touch` warps to `hub`, and neither is inside the
 * building's collision — they are a walkable two-tile notch in the wall.
 *
 * So the failure is not in the map. It is in what the server does when the
 * player arrives on the tile, and the only way to find out is to walk a real
 * browser into it and watch.
 *
 * WHAT IT PROVES THAT A UNIT TEST CANNOT
 *   · that the warp event on the door tile is reachable at all — an RPG-JS
 *     event is SOLID unless it sets `through`, and a solid event in a doorway
 *     is a wall shaped exactly like an entrance
 *   · that `facing()` returns what `approachEvents` compares against. It reads
 *     `player.direction` and returns '' for anything that is not a string, so
 *     if the engine hands back a number every approach trigger silently
 *     declines, forever, with no error anywhere
 *   · that the arrival immunity releases. Warps stay dead until the player has
 *     moved away from where they landed, and a stuck flag looks exactly like a
 *     broken door
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4260)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

// The tower on `exterior`. The opening is the two-tile notch at y=31; the
// pavement in front of it is y=32.
const DOOR = { map: 'exterior', x: 32, y: 31 }
const INFRONT = { map: 'exterior', x: 32, y: 33 }

const serverLog = []
const child = process.env.BASE ? null : spawn(
  process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1', SM_WARP_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
)
child?.stdout.on('data', (c) => { serverLog.push(String(c)); if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
child?.stderr.on('data', (c) => { serverLog.push(String(c)); if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-door-')),
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
  localStorage.setItem('sm-name', 'DoorTester')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(5000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(12000)

const read = () => page.evaluate(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.()
  if (!p) return null
  const r = (v) => (typeof v === 'function' ? v() : v)
  return {
    map: String(r(s?.id) ?? '').replace(/^map-/, ''),
    x: Math.round(r(p.x)), y: Math.round(r(p.y)),
    tx: Math.round(r(p.x) / 32), ty: Math.round(r(p.y) / 32),
    // The value approachEvents compares against. If this is not a string,
    // every approach trigger declines silently.
    direction: (() => { const d = r(p.direction); return { value: String(d), type: typeof d } })(),
  }
})

check('the player is in the world', !!(await read()))

// Stand on the pavement two tiles below the opening, then walk north into it.
await page.evaluate((d) => window.__engine?.processAction?.('dev:goto', d), INFRONT)
await sleep(3000)
const before = await read()
console.log('  standing in front of the tower:', JSON.stringify(before))
check('the teleport put us on the exterior map', before?.map === 'exterior', before?.map)

console.log(`  direction reads ${before?.direction.type} ${JSON.stringify(before?.direction.value)}`)
check('the engine reports direction as a STRING — approachEvents compares it to one',
  before?.direction.type === 'string', `got ${before?.direction.type}`)

/** Walk north up to `steps` times; stop as soon as the map changes. */
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
    const now = await read()
    if (now && now.map !== 'exterior') return now
  }
  return await read()
}

const after = await walkNorth()
console.log('  after walking north:', JSON.stringify(after))
check('walking into the doorway moved us OFF the exterior map',
  after && after.map !== 'exterior', `still on ${after?.map} at ${after?.tx},${after?.ty}`)

/*
 * NOW THE SAME DOOR FROM EVERY HORIZONTAL OFFSET A REAL PLAYER CAN BE AT.
 *
 * Movement is free rather than tile-locked, so a player who has walked around
 * is almost never on a tile boundary — they sit at x=1008, or 1020, or 1039.
 * The opening is two tiles wide (31 and 32) and solid building either side.
 * A door that opens from dead centre and refuses eight pixels off is a door
 * that "sometimes doesn't work", which is what was reported and what a
 * grid-aligned test cannot see.
 */
console.log('\n  approaching the same opening from each offset:')
const OPENING_LEFT = 31 * 32 // 992: the left edge of the two-tile notch
const failures = []
let tested = 0

/**
 * Get back to the pavement in front of the tower, wherever we currently are.
 *
 * `dev:goto` crosses a map boundary, and a map change is not instant — the
 * room has to hand over. Reading the position too early sees the OLD map and
 * looks like the teleport failed, which is how the first version of this
 * sweep skipped every single offset and then reported PASS on an empty list
 * of failures.
 */
async function returnToDoor(startX) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate((a) => window.__engine?.processAction?.('dev:goto', a),
      { map: 'exterior', x: startX / 32, y: 33 })
    for (let i = 0; i < 12; i++) {
      await sleep(700)
      const s = await read()
      if (s?.map === 'exterior') return s
    }
  }
  return null
}

for (const off of [-16, -8, 0, 8, 16, 24, 32, 40, 48, 56]) {
  const startX = OPENING_LEFT + off
  const start = await returnToDoor(startX)
  if (!start) { console.log(`    x+${off}: could not get back to exterior — not measured`); continue }
  tested++
  const end = await walkNorth(5)
  const got = end && end.map !== 'exterior'
  if (!got) failures.push(off)
  console.log(`    x=${startX} (${off >= 0 ? '+' : ''}${off} from the opening, landed at ${start.x}): ${
    got ? `entered -> ${end.map}` : `STUCK at tile ${end?.tx},${end?.ty}`}`)
}

// A sweep that measured nothing must not report success. This is the check
// that would have caught the first version of it.
check('the offset sweep actually ran', tested >= 6, `only ${tested} of 10 offsets were measured`)
check('the doorway opens from every offset across it, not just the middle',
  tested > 0 && failures.length === 0,
  failures.length ? `refused from offsets ${failures.join(', ')}` : '')

const warpLines = serverLog.join('').split('\n').filter((l) => l.includes('[warp]'))
console.log(`  server logged ${warpLines.length} approach events`)
warpLines.slice(-6).forEach((l) => console.log('   ', l.trim()))

await page.screenshot({ path: process.env.SHOT ?? 'door.png' })
await browser.close(); child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
