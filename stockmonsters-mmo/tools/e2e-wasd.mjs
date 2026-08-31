/*
 * WASD, and the two ways adding it goes wrong.
 *
 *   npm run test:e2e:wasd
 *
 * The engine binds the arrow keys itself and cannot be talked into WASD by
 * dispatching KeyboardEvents — RPG-JS reads its own key state and ignores
 * synthetic events entirely. So `wasd.ts` listens for the letters and pushes
 * the CONTROL name into `applyControl`, the same way the touch stick does.
 *
 * WHAT THIS PROVES THAT A UNIT TEST CANNOT
 *
 *   · that the letters actually move the character, through the real engine,
 *     rather than through a mock of what we believe it does;
 *   · that typing in chat does NOT walk you. This is the failure that matters:
 *     a player types "we should head west" and their character sets off across
 *     the map mid-sentence. It is also the failure a unit test is least likely
 *     to catch, because it depends on where focus is;
 *   · that Ctrl/Cmd combinations are left alone. `Cmd+A` is select-all and
 *     `Cmd+S` is save; a game that walks the player left on Ctrl+A is worse
 *     than one with no WASD at all.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4266)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const child = process.env.BASE ? null : spawn(
  process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
)
child?.stdout.on('data', () => {})
child?.stderr.on('data', () => {})
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-wasd-')),
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
  localStorage.setItem('sm-name', 'WasdTester')
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

check('the player is in the world', !!(await read()))

// Somewhere with room on all sides: the forecourt the ferry now lands in.
await page.evaluate((a) => window.__engine?.processAction?.('dev:goto', a), { map: 'olivine-city', x: 22, y: 39 })
await sleep(3000)

/** Hold a real key down and let go, the way a keyboard does. */
async function holdKey(key, ms = 650) {
  await page.keyboard.down(key)
  await sleep(ms)
  await page.keyboard.up(key)
  await sleep(700)
}

const moves = {}
for (const [key, label] of [['w', 'up'], ['a', 'left'], ['s', 'down'], ['d', 'right']]) {
  const from = await read()
  await holdKey(key)
  const to = await read()
  const dx = to.x - from.x
  const dy = to.y - from.y
  moves[key] = { dx, dy, dist: Math.round(Math.hypot(dx, dy)) }
  console.log(`  ${key.toUpperCase()} (${label.padEnd(5)}) moved ${moves[key].dist}px  dx=${dx} dy=${dy}`)
}

check('W walks', moves.w.dist > 8, `${moves.w.dist}px`)
check('A walks', moves.a.dist > 8, `${moves.a.dist}px`)
check('S walks', moves.s.dist > 8, `${moves.s.dist}px`)
check('D walks', moves.d.dist > 8, `${moves.d.dist}px`)

// ...and in the RIGHT directions. A mapping that moved every key the same way
// would pass all four checks above.
check('W and S are opposite, A and D are opposite',
  Math.sign(moves.w.dy) === -Math.sign(moves.s.dy) && Math.sign(moves.a.dx) === -Math.sign(moves.d.dx),
  `w.dy=${moves.w.dy} s.dy=${moves.s.dy} a.dx=${moves.a.dx} d.dx=${moves.d.dx}`)
check('W goes up and A goes left', moves.w.dy < 0 && moves.a.dx < 0)

/* --------------------------------------------- the one that actually bites --*/

const beforeChat = await read()
await page.evaluate(() => {
  const i = document.getElementById('chat-input')
  i.disabled = false
  i.focus()
})
await page.keyboard.type('we should head west', { delay: 25 })
await sleep(900)
const afterChat = await read()
const typedInto = await page.evaluate(() => document.getElementById('chat-input')?.value ?? '')
const drifted = Math.round(Math.hypot(afterChat.x - beforeChat.x, afterChat.y - beforeChat.y))

console.log(`  typed "${typedInto}" — character moved ${drifted}px`)
check('the text reached the chat box', typedInto === 'we should head west', typedInto)
check('typing in chat does NOT walk the character', drifted === 0, `drifted ${drifted}px`)

await page.evaluate(() => document.getElementById('chat-input')?.blur())
await sleep(400)

/* ------------------------------------------------------- modifier combos --*/

const beforeCombo = await read()
for (const mod of ['Control', 'Meta']) {
  await page.keyboard.down(mod)
  await page.keyboard.press('a')
  await page.keyboard.press('s')
  await page.keyboard.up(mod)
  await sleep(500)
}
const afterCombo = await read()
const comboDrift = Math.round(Math.hypot(afterCombo.x - beforeCombo.x, afterCombo.y - beforeCombo.y))
check('Ctrl+A / Cmd+S do not walk the character', comboDrift === 0, `drifted ${comboDrift}px`)

/* ------------------------------------ a key held when the tab goes away ---*/

await page.keyboard.down('d')
await sleep(300)
await page.evaluate(() => window.dispatchEvent(new Event('blur')))
await sleep(1200)
const afterBlur = await read()
await sleep(1200)
const wellAfterBlur = await read()
await page.keyboard.up('d')
const keptWalking = Math.round(Math.hypot(wellAfterBlur.x - afterBlur.x, wellAfterBlur.y - afterBlur.y))
check('a key held when the window loses focus is released, not stuck',
  keptWalking < 6, `still moving ${keptWalking}px after the blur`)

await page.screenshot({ path: process.env.SHOT ?? 'wasd.png' })
await browser.close(); child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
