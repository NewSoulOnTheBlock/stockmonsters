/*
 * WHAT A PLAYER SAYS, OVER THEIR HEAD, ON SOMEBODY ELSE'S SCREEN.
 *
 *   RPG_TYPE=mmorpg npx vite build     # dist must exist
 *   npm run test:e2e:chat-bubble
 *
 * Two real browsers, two wallets, two characters standing three tiles apart on
 * the dock. One of them types into the chat box; the other must see a speech
 * bubble over that character's head — not over their own, not in the corner,
 * and not still there a minute later.
 *
 * WHAT IT PROVES THAT A UNIT TEST CANNOT
 *   · that `chat:message` reaches the OTHER client carrying the sender's
 *     player id, and that the id is a key that client's scene actually knows.
 *     Everything else here is downstream of that one fact
 *   · that the world-to-screen projection lands on the character. The bubble
 *     is DOM over a pixi canvas, so nothing enforces the relationship — a
 *     wrong anchor draws a perfectly valid box in the wrong place, silently
 *   · that it FOLLOWS. The engine rebuilds the character element every few
 *     seconds while walking, so a bubble that tracks correctly for one frame
 *     proves nothing; this walks the speaker and re-measures
 *   · that a second message replaces the first instead of stacking
 *   · that it goes away on its own, and that it never eats a click
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4273)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

// Two spots on the dock, three tiles apart: far enough that the sprites do not
// overlap, close enough that both are on screen in each other's client.
const SPOT_A = { map: 'exterior', x: 31, y: 33 }
const SPOT_B = { map: 'exterior', x: 35, y: 33 }

const child = process.env.BASE ? null : spawn(
  process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
child?.stdout.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
child?.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

/** A real signed login, so the player has a wallet and may chat. */
async function signIn() {
  const account = privateKeyToAccount(generatePrivateKey())
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  return await (await fetch(`${BASE}/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })).json()
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-bubble-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})

/** One player, in their own browser profile — separate storage, like a separate machine. */
async function player(label, name, character, spot) {
  const wallet = await signIn()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(120_000)
  await page.setViewport({ width: 1100, height: 800 })
  page.on('pageerror', (e) => console.log(`  [${label} pageerror]`, e.message.slice(0, 160)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((w, n, c) => {
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    localStorage.setItem('sm-character', JSON.stringify(c))
    localStorage.setItem('sm-name', n)
  }, wallet, name, character)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(6000)
  await page.evaluate(() => document.getElementById('btn-primary')?.click())
  await sleep(13000)
  await page.evaluate((s) => window.__engine?.processAction?.('dev:goto', s), spot)
  await sleep(2500)
  const id = await page.evaluate(() => window.__engine?.playerIdSignal?.() ?? null)
  return { label, name, page, id }
}

/** Everything one client can say about the bubbles on its screen. */
const look = (page, speakerId) => page.evaluate((id) => {
  const read = (v) => { try { return typeof v === 'function' ? v() : v } catch { return undefined } }
  const engine = window.__engine
  const scene = typeof engine?.sceneMap === 'function' ? engine.sceneMap() : engine?.sceneMap
  const speaker = scene?.players?.()?.[id]
  const viewport = engine?.findViewportInstance?.()
  const canvas = engine?.renderer?.canvas ?? document.querySelector('canvas')
  const rect = canvas?.getBoundingClientRect()

  // Where the speaker's HEAD is on this screen, worked out from the engine
  // rather than from anything the bubble code wrote down.
  let head = null
  if (speaker && viewport?.toScreen) {
    const bounds = read(speaker.__rpgjsGraphicBounds)
    const cx = Number.isFinite(bounds?.centerX) ? bounds.centerX : 16
    const top = Number.isFinite(bounds?.top) ? bounds.top : 0
    const point = viewport.toScreen(read(speaker.x) + cx, read(speaker.y) + top)
    head = { x: (rect?.left ?? 0) + point.x, y: (rect?.top ?? 0) + point.y }
  }

  const nodes = [...document.querySelectorAll('#sm-bubbles .bub')]
  const visible = nodes.filter((n) => getComputedStyle(n).visibility !== 'hidden')
  const mine = nodes.find((n) => n.dataset.player === id) ?? null
  const box = mine?.getBoundingClientRect() ?? null
  // Whatever the browser thinks is under the middle of the bubble: if that is
  // the bubble itself, it is stealing clicks meant for the map.
  const under = box
    ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    : null

  return {
    knowsSpeaker: !!speaker,
    total: nodes.length,
    visible: visible.length,
    text: mine?.textContent ?? null,
    box: box ? { l: box.left, t: box.top, w: box.width, h: box.height, cx: box.left + box.width / 2, b: box.bottom } : null,
    head,
    swallowsClicks: !!under?.closest?.('#sm-bubbles'),
    log: document.getElementById('chat-log')?.innerText ?? '',
  }
}, speakerId)

/** Type into the real chat box, exactly as a player does. */
const say = (page, text) => page.evaluate(async (t) => {
  const input = document.getElementById('chat-input')
  if (!input || input.disabled) return false
  input.focus()
  input.value = t
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return true
}, text)

const NAME_A = 'Talk' + randomBytes(2).toString('hex')
const NAME_B = 'Hear' + randomBytes(2).toString('hex')

console.log('two players on the dock:')
const A = await player('A', NAME_A, ['ch-cat-01-2'], SPOT_A)
const B = await player('B', NAME_B, ['hero'], SPOT_B)
check('both are in the world with a player id', !!A.id && !!B.id, `${A.id} / ${B.id}`)

const sees = await look(B.page, A.id)
check(`B's scene knows the speaker's id`, sees.knowsSpeaker, `looking for ${A.id}`)

/* ------------------------------------------------ 1. the message travels ---*/
// Long enough to stay up for the walk that follows: 45 characters buys about
// five seconds (2.5s + 55ms a character).
const LINE = 'meet me at the dock, i have something to trade'
console.log(`\nA says "${LINE}":`)
check('the chat box accepted it', await say(A.page, LINE))
await sleep(1200)

const onB = await look(B.page, A.id)
if (process.env.VERBOSE) console.log('  [B chat log]', JSON.stringify(onB.log))
check("B sees a bubble over A's character", onB.text === LINE, JSON.stringify(onB.text))
check('and only one bubble is on screen', onB.total === 1, `${onB.total}`)
check('B still logged the line in the chat panel', onB.log.includes(LINE))
check('it does not swallow clicks', onB.box ? !onB.swallowsClicks : false)

if (onB.box && onB.head) {
  const dx = Math.abs(onB.box.cx - onB.head.x)
  const above = onB.head.y - onB.box.b
  console.log(`  bubble centre x=${onB.box.cx.toFixed(0)} vs head x=${onB.head.x.toFixed(0)}; bottom sits ${above.toFixed(0)}px above the head`)
  check('it is centred on the speaker, not on the viewer', dx < 12, `${dx.toFixed(1)}px off`)
  check('it sits above the head, and close to it', above > 0 && above < 90, `${above.toFixed(1)}px`)
} else {
  check('a bubble box was measurable', false)
}

const onA = await look(A.page, A.id)
check('A sees their own bubble too', onA.text === LINE, JSON.stringify(onA.text))
check('and it is actually drawn, not parked off-world', onB.visible === 1, `${onB.visible} visible`)

// Taken here, a second after the line was typed, so the box is at full
// opacity rather than half way through its fade.
const SHOT = process.env.SHOT ?? 'chat-bubble.png'
await B.page.screenshot({ path: SHOT })
console.log(`  screenshot: ${SHOT} — B's screen, with A's bubble over A's head`)

/* ------------------------------------------------------- 2. it follows ----*/
console.log('\nA walks east while the bubble is up:')
const beforeWalk = await look(B.page, A.id)
await A.page.evaluate(async () => {
  const c = window.__controls?.()
  if (!c?.applyControl) return
  await c.applyControl('right', true)
  await new Promise((r) => setTimeout(r, 600))
  await c.applyControl('right', false)
})

/*
 * WAIT FOR THE CHARACTER TO STOP.
 *
 * The bubble is placed once a frame from where the character is at that
 * moment, so comparing it against a position read WHILE the sprite is still
 * moving measures the poll interval, not the tracking — the first version of
 * this check failed by 15px for exactly that reason. Sample until two reads
 * agree, then compare.
 */
let afterWalk = await look(B.page, A.id)
for (let i = 0; i < 8; i++) {
  await sleep(180)
  const next = await look(B.page, A.id)
  const still = afterWalk.head && next.head && Math.abs(next.head.x - afterWalk.head.x) < 1
  afterWalk = next
  if (still) break
}
if (beforeWalk.box && afterWalk.box && beforeWalk.head && afterWalk.head) {
  const movedHead = afterWalk.head.x - beforeWalk.head.x
  const movedBubble = afterWalk.box.cx - beforeWalk.box.cx
  console.log(`  the character moved ${movedHead.toFixed(0)}px, the bubble moved ${movedBubble.toFixed(0)}px`)
  check('the character actually moved on B\'s screen', Math.abs(movedHead) > 20, `${movedHead.toFixed(1)}px`)
  check('the bubble moved with it', Math.abs(movedBubble - movedHead) < 12, `off by ${(movedBubble - movedHead).toFixed(1)}px`)
} else {
  check('the walk was measurable', false, 'the bubble expired first')
}


/* ------------------------------------------------------ 3. it goes away ---*/
// The line above lives 2.5s + 45*55ms ≈ 5s from when it was sent, and several
// seconds of that have already gone by. Seven more is comfortably past it.
await sleep(7000)
const gone = await look(B.page, A.id)
check('the bubble disappears on its own', gone.total === 0, `${gone.total} still up`)
check('...and the chat log still has the line', gone.log.includes(LINE))

/* -------------------------------------------- 4. rapid messages replace ---*/
console.log('\nA says two things in a second:')
await say(A.page, 'first thing')
await sleep(250)
await say(A.page, 'second thing')
await sleep(1200)
const rapid = await look(B.page, A.id)
check('there is still exactly one bubble', rapid.total === 1, `${rapid.total}`)
check('and it shows the newer line', rapid.text === 'second thing', JSON.stringify(rapid.text))

/* ------------------------------------------------- 5. a very long line ----*/
await sleep(4000) // let that one expire and stay inside the chat rate limit
const LONG = 'this is a deliberately long message that a player might type when they are explaining something at length ok'
console.log(`\nA says ${LONG.length} characters:`)
await say(A.page, LONG)
await sleep(1200)
const long = await look(B.page, A.id)
check('the bubble is cut short rather than covering the map',
  !!long.text && long.text.length <= 80 && long.text.endsWith('…'),
  `${long.text?.length} chars`)
check('and it wraps instead of stretching across the screen',
  !!long.box && long.box.w <= 230 && long.box.h > 20,
  long.box ? `${long.box.w.toFixed(0)}x${long.box.h.toFixed(0)}` : 'no box')
check('the whole line is still in the chat log', long.log.includes(LONG))
const SHOT_LONG = process.env.SHOT_LONG ?? 'chat-bubble-long.png'
await B.page.screenshot({ path: SHOT_LONG })
console.log(`  screenshot: ${SHOT_LONG} — the capped, wrapped version`)

/* ---------------------------------------------- 6. the other direction ----*/
console.log(`\nB answers:`)
await say(B.page, 'on my way')
await sleep(1200)
const back = await look(A.page, B.id)
check("A sees a bubble over B's character", back.text === 'on my way', JSON.stringify(back.text))

/* --------------------------------- 7. the speaker leaves the map ----------*/
// A bubble belongs to a character, not to a screen position. When that
// character is no longer on this map there is nothing to hang it on, and a box
// left floating over an empty tile is the obvious way to get this wrong.
console.log('\nA says one more thing and steps inside:')
await sleep(4000)
// 66 characters, so it is good for about six seconds — long enough to still be
// alive on the far side of a map change.
await say(A.page, 'stepping inside for a minute, wait here and i will be back')
await sleep(1000)
const beforeLeaving = await look(B.page, A.id)
check('the bubble is up before A leaves', beforeLeaving.visible === 1, `${beforeLeaving.visible} visible`)
await A.page.evaluate(() => window.__engine?.processAction?.('dev:goto', { map: 'hub', x: 28, y: 47 }))
await sleep(4500)
const left = await look(B.page, A.id)
/*
 * NOT "it vanishes the instant they walk through a door".
 *
 * Measured here: 4.5 seconds after the transfer B's scene STILL holds A —
 * the engine keeps a departed player's sprite on the map for a while, which is
 * why this game has always had brief ghosts on the dock. So the honest rule is
 * that the bubble is drawn exactly when the character it belongs to is drawn,
 * and never over empty ground; and that it expires on its own either way.
 */
console.log(`  B's scene ${left.knowsSpeaker ? 'still knows' : 'has dropped'} A`)
check('the bubble is drawn only while B can still see A',
  left.visible === (left.knowsSpeaker ? 1 : 0),
  `${left.visible} visible, knowsSpeaker=${left.knowsSpeaker}`)
await sleep(3000)
const settled = await look(B.page, A.id)
check('and it expires anyway, on the far side of a map change', settled.total === 0,
  `${settled.total} still up`)

await browser.close()
child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
