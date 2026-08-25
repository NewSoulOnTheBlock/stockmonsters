/*
 * Verifies the on-screen touch controls against a real browser.
 *
 * It drives Chrome with touch emulation, wraps window.$client to capture what
 * would go on the wire, and asserts the exact X11 keysyms match PSDK's
 * Input::Keys table. No WebRTC session is needed.
 *
 * Setup (once):   npm i puppeteer-core
 * Run:            docker compose up -d && node scripts/test-touch-controls.mjs
 */
import puppeteer from 'puppeteer-core'

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const URL = process.env.NEKO_URL || 'http://localhost:8080/?usr=player&pwd=stonks&embed=1'

// X11 keysyms we expect, per PSDK's Input::Keys table
// Non-letter bindings on purpose — see touch-controls.js
const K = { up: 0xff52, down: 0xff54, left: 0xff51, right: 0xff53,
            enter: 0xff0d, escape: 0xff1b, insert: 0xff63, pause: 0xff13, backspace: 0xff08 }
const name = (v) =>
  Object.keys(K).find((k) => K[k] === v) ??
  (v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : `0x${v.toString(16)}`)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()

// Landscape phone with touch.
await page.emulate({
  name: 'phone',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 3, isLandscape: true },
})
const cdp = await page.createCDPSession()
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] })

// Stand in for neko's client so we can observe exactly what would go on the
// wire, without needing a live WebRTC session.
await page.evaluateOnNewDocument(() => {
  window.__sent = []
  let real = null
  const wrap = (c) => {
    if (c && typeof c.sendData === 'function') {
      c.sendData = (ev, d) => { window.__sent.push([ev, d && d.key]) }
    }
    return c
  }
  // neko's own plugin assigns window.$client once its Vue app boots, which
  // would clobber a plain stub. Intercept the assignment instead.
  Object.defineProperty(window, '$client', {
    configurable: true,
    get: () => real,
    set: (v) => { real = wrap(v) },
  })
  window.$client = { sendData: () => {} }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#sm-touch .sm-pad', { timeout: 10000 })
console.log('✓ touch overlay rendered')

// Dismiss the first-tap gate. It sits above everything by design (it is what
// buys fullscreen and audio), so it would otherwise swallow the first tap of
// the first assertion below.
await page.evaluate(() => document.querySelector('#sm-start')?.remove())

const box = async (sel) => {
  const b = await page.$eval(sel, (n) => {
    const r = n.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  })
  return b
}
const drain = async () => page.evaluate(() => { const s = window.__sent; window.__sent = []; return s })

let failures = 0
const check = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`✓ ${label}: ${g}`)
  else { console.log(`✗ ${label}\n    got  ${g}\n    want ${w}`); failures++ }
}

// --- D-pad directions -------------------------------------------------------
const pad = await box('#sm-touch .sm-pad')
const reach = pad.w / 2 - 12
const dirs = [
  ['up', 0, -reach, [K.up]],
  ['down', 0, reach, [K.down]],
  ['left', -reach, 0, [K.left]],
  ['right', reach, 0, [K.right]],
  ['up+right (diagonal)', reach * 0.7, -reach * 0.7, [K.up, K.right]],
  ['down+left (diagonal)', -reach * 0.7, reach * 0.7, [K.down, K.left]],
]
for (const [label, dx, dy, expect] of dirs) {
  await page.touchscreen.touchStart(pad.x + dx, pad.y + dy)
  const downs = (await drain()).filter(([e]) => e === 'keydown').map(([, k]) => k)
  await page.touchscreen.touchEnd()
  const ups = (await drain()).filter(([e]) => e === 'keyup').map(([, k]) => k)
  check(`dpad ${label}`, downs.sort().map(name), expect.sort().map(name))
  check(`  └ released`, ups.sort().map(name), expect.sort().map(name))
}

// --- sliding from one direction to another ---------------------------------
await page.touchscreen.touchStart(pad.x, pad.y - reach)
await drain()
await page.touchscreen.touchMove(pad.x + reach, pad.y)
const slide = await drain()
await page.touchscreen.touchEnd()
await drain()
check('slide up -> right', slide.map(([e, k]) => `${e}:${name(k)}`), ['keyup:up', 'keydown:right'])

// --- face buttons -----------------------------------------------------------
for (const [sel, keysym, label] of [
  ['#sm-touch .sm-btn.a', K.enter, 'A (confirm)'],
  ['#sm-touch .sm-btn.b', K.escape, 'B (cancel)'],
  ['#sm-touch .sm-btn.start', K.insert, 'START (menu)'],
  ['#sm-touch .sm-btn.select', K.pause, 'SELECT'],
]) {
  const b = await box(sel)
  await page.touchscreen.touchStart(b.x, b.y)
  await page.touchscreen.touchEnd()
  check(`button ${label}`, (await drain()).map(([e, k]) => `${e}:${name(k)}`), [`keydown:${name(keysym)}`, `keyup:${name(keysym)}`])
}

// --- soft keyboard: typing a name --------------------------------------------
// The game's first prompt asks for a name; on a phone this is the only way in.
await page.evaluate(() => document.querySelector('#sm-kbd').focus())
await drain()
await page.evaluate(() => {
  const i = document.querySelector('#sm-kbd')
  i.value = i.value + 'rez'
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
check('typing "rez"', (await drain()).map(([e, k]) => `${e}:${name(k)}`),
  ['keydown:r','keyup:r','keydown:e','keyup:e','keydown:z','keyup:z'])

await page.evaluate(() => {
  const i = document.querySelector('#sm-kbd')
  i.value = ''
  i.dispatchEvent(new Event('input', { bubbles: true }))
})
check('backspace on empty field', (await drain()).map(([e, k]) => `${e}:${name(k)}`),
  ['keydown:backspace','keyup:backspace'])

await page.evaluate(() => {
  document.querySelector('#sm-kbd').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
})
check('soft-keyboard Enter', (await drain()).map(([e, k]) => `${e}:${name(k)}`),
  ['keydown:enter','keyup:enter'])
await page.evaluate(() => document.querySelector('#sm-kbd').blur())
await drain()

// --- stuck-key safety -------------------------------------------------------
// Hold a direction, then background the tab. The key must be released, or the
// character keeps walking on the server after the player tabs away.
await page.touchscreen.touchStart(pad.x + reach, pad.y)
await drain()
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }) // no-op, keeps session warm
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
})
check('key released when tab hidden', (await drain()).map(([e, k]) => `${e}:${name(k)}`), ['keyup:right'])
await page.touchscreen.touchEnd()

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
