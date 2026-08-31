/*
 * THE FERRY, AND WHETHER YOU CAN WALK WHEN YOU GET OFF IT.
 *
 *   npm run test:e2e:ferry
 *
 * The pier on `exterior` is the one crossing between the two halves of this
 * world — the PSDK maps on one side, Kanto and Johto on the other. It is an
 * ACTION warp: you walk the dock and press the button.
 *
 * It landed players in olivine-city at (24,42), and they could not move. The
 * tile is open, and so is the one above it, so the map data looked fine. What
 * was wrong was where the arrival was PLACED: `rmxp-warps.ts` handed
 * `changeMap` the tile's top-left corner while `warps.ts` had always used its
 * centre. Movement here is free rather than tile-locked, so a body placed on a
 * corner straddles the boundary into whatever is beside it. In the open that
 * is invisible; at (24,42), whose only open neighbour is the tile above, it is
 * a wedge with walls on three sides and half your body in the fourth.
 *
 * So this test does not check that the ferry fires. It checks that you can
 * still WALK when it has, which is the part that was broken and the part no
 * amount of reading the warp table would have shown.
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

const child = process.env.BASE ? null : spawn(
  process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
)
child?.stdout.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
child?.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-ferry-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 800 })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  const hex = '0123456789abcdef'
  const rnd = (n) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('')
  localStorage.setItem('sm-wallet', JSON.stringify({ connectionId: 'w:' + rnd(32), address: '0x' + rnd(40) }))
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
  localStorage.setItem('sm-name', 'FerryTester')
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
  return { map: String(r(s?.id) ?? '').replace(/^map-/, ''), x: Math.round(r(p.x)), y: Math.round(r(p.y)) }
})
const hold = (dir, ms = 500) => page.evaluate(async (d, t) => {
  const c = window.__controls?.()
  if (!c?.applyControl) return
  await c.applyControl(d, true)
  await new Promise((r) => setTimeout(r, t))
  await c.applyControl(d, false)
}, dir, ms)

check('the player is in the world', !!(await read()))

// Walk the dock and press the button, exactly as a player does.
await page.evaluate((a) => window.__engine?.processAction?.('dev:goto', a), { map: 'exterior', x: 17, y: 65 })
await sleep(3000)
const dock = await read()
console.log('  on the dock:', JSON.stringify(dock))
check('we are on the pier', dock?.map === 'exterior', dock?.map)

for (let i = 0; i < 4; i++) {
  await hold('up', 380)
  await sleep(500)
  await page.evaluate(async () => {
    const c = window.__controls?.()
    await c?.applyControl?.('action', true)
    await new Promise((r) => setTimeout(r, 160))
    await c?.applyControl?.('action', false)
  })
  await sleep(1500)
  const now = await read()
  if (now && now.map !== 'exterior') break
}

const landed = await read()
console.log('  after taking the ferry:', JSON.stringify(landed))
check('the ferry crossed us into Kanto/Johto', landed && landed.map !== 'exterior', `still on ${landed?.map}`)

if (landed && landed.map !== 'exterior') {
  /*
   * THE ACTUAL BUG. Not "did we arrive" but "can we leave the tile we arrived
   * on". A wedged player reports a perfectly reasonable map and position and
   * simply never moves again.
   */
  let best = 0
  let escaped = null
  for (const dir of ['up', 'left', 'right', 'down']) {
    const from = await read()
    await hold(dir, 700)
    await sleep(800)
    const to = await read()
    if (!from || !to || to.map !== from.map) { escaped = dir; best = 999; break }
    const moved = Math.hypot(to.x - from.x, to.y - from.y)
    console.log(`    ${dir.padEnd(5)} moved ${Math.round(moved)}px`)
    if (moved > best) { best = moved; escaped = dir }
  }
  check('we can WALK where the ferry left us — not wedged into a wall',
    best > 8, best > 8 ? `moved ${Math.round(best)}px (${escaped})` : 'every direction blocked')
}

await page.screenshot({ path: process.env.SHOT ?? 'ferry.png' })
await browser.close(); child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
