/*
 * Talking to somebody, and being able to stop.
 *
 *   npm run test:e2e:npc
 *
 * The bug this exists for: "it's getting stuck on chatting with people".
 *
 * Advancing a dialog and talking to an NPC are THE SAME KEY. The engine hands
 * that press to the event the player is facing as well as to the dialog, so
 * every press that moved the conversation forward also started the whole
 * conversation again from the top. It could not be finished — the box kept
 * reopening with lines already read, forever.
 *
 * So the assertion that matters is the last one: the dialog CLOSES.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT_OVERRIDE ?? 4236)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const own = !process.env.PORT_OVERRIDE
const child = own
  ? spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
      { cwd: ROOT, env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  : null
child?.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const account = privateKeyToAccount(generatePrivateKey())
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'sm-npc-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
page.on('pageerror', (e) => { if (!/tilesets is not iterable/.test(e.message)) console.log('  [page]', e.message.slice(0, 90)) })
await page.evaluateOnNewDocument((addr) => {
  window.__addr = addr
  window.ethereum = { isMetaMask: true, on() {}, removeListener() {},
    async request({ method, params }) {
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__addr]
      if (method === 'personal_sign') return await window.__sign(params[0])
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error('unexpected ' + method) } }
}, account.address)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.exposeFunction('__sign', async (m) =>
  account.signMessage({ message: m.startsWith('0x') ? Buffer.from(m.slice(2), 'hex').toString('utf8') : m }))
await page.evaluate(() => {
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
  localStorage.setItem('sm-name', 'Np' + Math.random().toString(16).slice(2, 8))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(4000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(5000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(16000)

const dialog = () => page.evaluate(() =>
  document.querySelector('.rpg-ui-dialog')?.innerText?.replace(/\s+/g, ' ').trim() ?? null)

// Stand one tile south of the hub NPC and face them.
await page.evaluate((a) => window.__engine?.processAction?.('dev:goto', a), { map: 'hub', x: 31, y: 34 })
await sleep(8000)
await page.evaluate(async () => {
  const c = window.__controls?.()
  await c.applyControl('up', true); await new Promise((r) => setTimeout(r, 120)); await c.applyControl('up', false)
})
await sleep(1000)
check('nobody is talking yet', (await dialog()) === null)

/* The control name is `action`, NOT `space`. `boundKeys` is keyed by the KEY
 * and `_controlsOptions` by the CONTROL; applyControl wants the second, and
 * sending the key name does nothing at all — which is how the phone's A
 * button spent its whole life not talking to anybody. */
await page.evaluate(async () => {
  const c = window.__controls?.()
  await c.applyControl('action', true); await new Promise((r) => setTimeout(r, 90)); await c.applyControl('action', false)
})
await sleep(1500)
const opened = await dialog()
check('pressing action opens the conversation', !!opened, (opened ?? '').slice(0, 40))

// Now read it the way a player does. Real key presses: the same press both
// advances the dialog and reaches the NPC, which is the whole problem.
let closed = false
for (let i = 0; i < 40; i++) {
  await page.keyboard.press('Space')
  await sleep(450)
  if ((await dialog()) === null) { closed = true; break }
}
check('and it can be finished — the dialog closes', closed)

// The line the user was shown must not name anything Nintendo owns.
const leaked = await page.evaluate(() => {
  const t = document.body.innerText
  return ['Rockruff', 'Pokémon', 'Pokemon'].filter((w) => t.includes(w))
})
check('no vanilla species names on screen', leaked.length === 0, leaked.join(', '))

await browser.close()
child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
