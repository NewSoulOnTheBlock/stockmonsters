/*
 * Does the DEPLOYED game actually play?
 *
 *   npm run test:e2e:live
 *   BASE=https://somewhere-else npm run test:e2e:live
 *
 * Everything else in tools/ drives a server on localhost. This drives the real
 * one, through Caddy, over TLS — because the thing most likely to be broken by
 * a reverse proxy is the one thing the game cannot do without.
 *
 * THE WEBSOCKET IS THE POINT. A misconfigured proxy serves the title screen,
 * the API and every asset perfectly and then silently fails the upgrade, so the
 * site looks completely fine and the world never loads. Checking that a page
 * returns 200 proves nothing here; only a player object standing on a map does,
 * and only a player who MOVES proves input round-trips both ways.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount } from 'viem/accounts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE ?? 'https://test.lordfishnu.com'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const envOf = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n')
  .map((l) => /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l)).filter(Boolean)
  .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const key = envOf(resolve('../contracts/.env')).PRIVATE_KEY
const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key)

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-live-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

// Record every websocket the page opens, and whether it survived.
const sockets = []
const cdp = await page.createCDPSession()
await cdp.send('Network.enable')
cdp.on('Network.webSocketCreated', ({ url }) => sockets.push({ url, frames: 0, closed: false }))
cdp.on('Network.webSocketFrameReceived', ({ response }) => {
  const s = sockets[sockets.length - 1]; if (s) s.frames++
})
cdp.on('Network.webSocketClosed', () => { const s = sockets[sockets.length - 1]; if (s) s.closed = true })

await page.evaluateOnNewDocument((addr) => {
  window.__addr = addr
  window.ethereum = {
    isMetaMask: true, on() {}, removeListener() {},
    async request({ method, params }) {
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__addr]
      if (method === 'personal_sign') return await window.__sign(params[0])
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error('unexpected ' + method)
    },
  }
}, account.address)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.exposeFunction('__sign', async (msg) =>
  account.signMessage({ message: msg.startsWith('0x') ? Buffer.from(msg.slice(2), 'hex').toString('utf8') : msg }))
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(4000)

check('the title screen is served over https', await page.evaluate(() => !!document.getElementById('title-screen')))

await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(5000)
const stored = await page.evaluate(() => localStorage.getItem('sm-wallet'))
check('wallet login works against the live server', !!stored && stored.includes('connectionId'))

// Character, then in.
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(3500)
await page.evaluate(() => {
  document.querySelector('#sm-character-designer [data-grid="preset"] > *')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(1200)
await page.evaluate(() => {
  document.querySelector('#sm-character-designer [data-act="confirm"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(12000)

// THE POINT: a player object only exists if the room websocket connected.
const read = () => page.evaluate(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.()
  if (!p) return null
  const r = (v) => (typeof v === 'function' ? v() : v)
  return { map: String(r(s?.id) ?? '').replace(/^map-/, ''), x: Math.round(r(p.x)), y: Math.round(r(p.y)) }
})
const before = await read()
check('the room websocket connected and put a player in the world',
  !!before, before ? `${before.map} ${before.x},${before.y}` : 'no player — the socket did not come up')

console.log('  sockets:', JSON.stringify(sockets.map((s) => ({ u: s.url.slice(0, 60), frames: s.frames, closed: s.closed }))))
check('at least one websocket is open and carrying traffic',
  sockets.some((s) => !s.closed && s.frames > 0))
check('and it is wss, not ws', sockets.every((s) => s.url.startsWith('wss://')))

// Walk, which is a round trip through the proxy.
if (before) {
  /*
   * TRY EVERY DIRECTION, and stop at the first that moves.
   *
   * This walked left and only left. That was fine when everybody spawned on
   * the dock; now a returning player resumes wherever they last stood, and
   * this account's saved tile happens to have a wall on its left — so the
   * check failed while the game was working perfectly. What it is really
   * asking is whether input round-trips through the proxy at all, and any
   * direction answers that.
   */
  let moved = 0
  let used = ''
  for (const dir of ['left', 'right', 'up', 'down']) {
    const from = await read()
    await page.evaluate(async (d) => {
      const c = window.__controls?.()
      if (!c?.applyControl) return
      await c.applyControl(d, true)
      await new Promise((r) => setTimeout(r, 1000))
      await c.applyControl(d, false)
    }, dir)
    await sleep(1000)
    const to = await read()
    const d = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0
    if (d > moved) { moved = d; used = dir }
    if (moved > 8) break
  }
  check('the character walks — input round-trips through the proxy', moved > 8,
    `moved ${Math.round(moved)}px ${used ? `(${used})` : '— every direction blocked'}`)
}

await page.screenshot({ path: process.env.SHOT ?? 'live.png' })
await browser.close()
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
