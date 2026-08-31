/*
 * Closing the game and coming back.
 *
 *   npm run test:e2e:return
 *
 * The complaint this exists for: "I close the game, and when I come back it
 * always starts me at the beginning" — plus "it asks me to choose a name even
 * though I already picked one", and a duel that answered "they have no wallet
 * connected" for a player who was plainly logged in.
 *
 * All three were one bug. RpgPlayer VARIABLES DO NOT SURVIVE A MAP CHANGE: the
 * engine builds a fresh player for every room, and WALLET_ID, NAME, the party,
 * the box, the bag and the visited list all went with the old one. The server
 * forgot who you were the first time you walked through a door, which also
 * stopped every save, because the save loop is keyed to the object registered
 * at login and that object stops changing the moment you leave its room.
 *
 * So this drives a wallet through a door, closes the browser completely, and
 * comes back as the same wallet on an empty one.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4233)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const OWN_SERVER = !process.env.PORT_OVERRIDE
const child = OWN_SERVER
  ? spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
      { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  : null
child?.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

// ONE wallet, two browsers. The whole point is that the second browser knows
// nothing except the key.
const account = privateKeyToAccount(generatePrivateKey())
const NAME = 'Ret' + Math.random().toString(16).slice(2, 8)

/** A complete session: fresh browser, wallet login, into the world. */
async function session(label, { seedName }) {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-ret-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  })
  const page = await browser.newPage()
  page.setDefaultNavigationTimeout(120_000)
  await page.setViewport({ width: 900, height: 700 })
  page.on('pageerror', (e) => { if (!/tilesets is not iterable/.test(e.message)) console.log(`  [${label}]`, e.message.slice(0, 110)) })
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
  await page.exposeFunction('__sign', async (m) =>
    account.signMessage({ message: m.startsWith('0x') ? Buffer.from(m.slice(2), 'hex').toString('utf8') : m }))
  await page.evaluate((n) => {
    localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
    if (n) localStorage.setItem('sm-name', n)
  }, seedName)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(4000)
  await page.evaluate(() => document.getElementById('btn-primary')?.click())   // connect
  await sleep(5000)
  await page.evaluate(() => document.getElementById('btn-primary')?.click())   // play
  await sleep(16000)
  return { browser, page }
}

const where = (page) => page.evaluate(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.()
  const r = (v) => (typeof v === 'function' ? v() : v)
  return {
    map: String(r(s?.id) ?? '').replace(/^map-/, ''),
    x: p ? Math.round(r(p.x)) : null,
    y: p ? Math.round(r(p.y)) : null,
    name: document.querySelector('#sm-hud .hud-name')?.textContent?.trim() ?? null,
    asked: !!document.getElementById('name-screen')?.classList.contains('open')
      || !!document.getElementById('sm-intro')?.classList.contains('open'),
  }
})

/* --------------------------------------------- first visit: walk somewhere -*/
console.log('first visit — name yourself and walk into another map:')
const one = await session('one', { seedName: NAME })
const start = await where(one.page)
check('the player is in the world', !!start.map, JSON.stringify(start))
await one.page.evaluate(() => window.__engine?.processAction?.('dev:goto', { map: 'goldenrod-city', x: 30, y: 30 }))
await sleep(9000)
const moved = await where(one.page)
check('and walked into Goldenrod', moved.map === 'goldenrod-city', JSON.stringify(moved))
check('the name survived the map change', moved.name === NAME, `HUD says ${moved.name}`)
// The carry loop banks position every 4s.
await sleep(6000)
await one.browser.close()
await sleep(2000)

/* -------------------------------------------- second visit: an empty browser */
console.log('\ncoming back later, on a browser that knows nothing:')
const two = await session('two', { seedName: null })
const back = await where(two.page)
console.log('  ', JSON.stringify(back))
check('it does NOT ask for a name again', back.asked === false)
check('the name came back from the server', back.name === NAME, `HUD says ${back.name}`)
check('and they are standing where they left off', back.map === 'goldenrod-city', `on ${back.map}`)
check('within a tile of the spot', back.x !== null && Math.abs(back.x - 960) <= 48 && Math.abs(back.y - 960) <= 64,
  `${back.x},${back.y} vs 960,960`)
await two.browser.close()

child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
