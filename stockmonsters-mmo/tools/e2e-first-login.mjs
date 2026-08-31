/*
 * A player who has never been here before.
 *
 *   npm run test:e2e:first-login
 *
 * The path with no coverage at all until now, and it was badly broken. The
 * title screen is an OVERLAY on a game that has already booted, so a first-time
 * player connects their wallet long after every module read localStorage and
 * found nothing there. Each of them kept that answer:
 *
 *   · game-ui never sent `auth:wallet`, so the server never learned who they
 *     were — no profile, no friends, no rewards, no name;
 *   · chat-ui left the input disabled saying "Connect a wallet to chat" while a
 *     wallet was plainly connected, and never asked for a name;
 *   · wallet-ui kept the invented placeholder chips (`$STONKSTER 12,400`).
 *
 * A RETURNING player hit none of it, because their wallet was in localStorage
 * before the page loaded. That is why it survived so long, and why this test
 * starts from a genuinely empty browser profile every run.
 *
 * It drives the real dev server, because dev is what the game is played on
 * while it is being built.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount } from 'viem/accounts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5189
const BASE = `http://localhost:${PORT}`
const ROOT = resolve(process.cwd())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const envOf = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n')
  .map((l) => /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l)).filter(Boolean)
  .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const key = envOf(resolve(ROOT, '../contracts/.env')).PRIVATE_KEY
const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key)

let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
})
child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[vite] ${c}`) })
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`${BASE}/token/chain`)).ok) break } catch {}
  await sleep(500)
}
console.log('chain:', await (await fetch(`${BASE}/token/chain`)).text())

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-probe-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1280,900'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 200)) })

// A wallet that signs for real, so /auth/verify actually passes.
await page.evaluateOnNewDocument((addr) => {
  window.__addr = addr
  window.__signed = []
  window.ethereum = {
    isMetaMask: true, on() {}, removeListener() {},
    async request({ method, params }) {
      window.__signed.push(method)
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__addr]
      if (method === 'personal_sign') return await window.__sign(params[0])
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error('unexpected ' + method)
    },
  }
}, account.address)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.exposeFunction('__sign', async (msg) => {
  const text = msg.startsWith('0x')
    ? Buffer.from(msg.slice(2), 'hex').toString('utf8')
    : msg
  return account.signMessage({ message: text })
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(3000)

console.log('\nthe title screen, with nothing remembered:')
{
  const t = await page.evaluate(() => ({
    button: document.getElementById('btn-primary')?.textContent,
    hasSMChain: !!window.SMChain,
  }))
  check('it asks for a wallet', t.button === 'CONNECT WALLET', t.button)
  check('the chain guard loaded', t.hasSMChain)
}

await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(4000)
console.log('\nconnecting:')
{
  const c = await page.evaluate(() => ({
    button: document.getElementById('btn-primary')?.textContent,
    line: document.getElementById('title-wallet-line')?.textContent,
    methods: window.__signed,
    stored: JSON.parse(localStorage.getItem('sm-wallet') ?? 'null'),
  }))
  check('the login was verified by the server', !!c.stored?.connectionId, c.line)
  check('the chain was settled before the signature',
    c.methods.indexOf('eth_chainId') < c.methods.indexOf('personal_sign'), c.methods.join(' -> '))
  check('the button becomes PLAY GAME', c.button === 'PLAY GAME', c.button)
}

// Into the world. A first-time player meets the character picker on the way,
// which is exactly the path where the name modal was never appearing.
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(2500)
console.log('\nchoosing a character:')
{
  const d = await page.evaluate(() => {
    const root = document.getElementById('sm-character-designer')
    return {
      visible: !!root && getComputedStyle(root).display !== 'none',
      presets: root?.querySelectorAll('[data-grid="preset"] > *').length ?? 0,
    }
  })
  check('the designer opens on its own', d.visible)
  check('and offers the ready-mades', d.presets > 0, `${d.presets} presets`)
}
// Pick the first ready-made and confirm, the way a new player does.
await page.evaluate(() => {
  const root = document.getElementById('sm-character-designer')
  const first = root?.querySelector('[data-grid="preset"] > *')
  first?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(900)
await page.evaluate(() => {
  document.querySelector('#sm-character-designer [data-act="confirm"]')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await sleep(3000)
check('confirming puts them in the world',
  await page.evaluate(() => !document.getElementById('title-screen')))
await sleep(9000)

console.log('\nin the world, seconds after the wallet arrived:')
{
  const w = await page.evaluate(() => ({
    placeholder: document.getElementById('chat-input')?.placeholder,
    chatDisabled: document.getElementById('chat-input')?.disabled,
    // A first-time trader is asked their name by KELBY now, as the last beat
    // of the opening — the bare modal is only the fallback for a client where
    // the intro failed to mount, and for changing a name later. Either counts
    // as being asked; neither would mean they are stuck as "Trader".
    nameModal: !!document.getElementById('name-screen')?.classList.contains('open')
      || !!document.getElementById('sm-intro')?.classList.contains('open'),
    chips: [...document.querySelectorAll('#sm-hud .hud-chips .smui-chip')]
      .map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
  }))
  // The three symptoms, each asserted where it actually shows.
  check('chat is unlocked', w.chatDisabled === false, w.placeholder)
  check('it no longer claims there is no wallet',
    !/connect a wallet/i.test(w.placeholder ?? ''), w.placeholder)
  check('they are asked to choose a name', w.nameModal)
  // The symbol is read off the chain, so the test asks for the one it
  // expects rather than assuming — `SM_TOKEN_SYMBOL` points a run at a token
  // deployed under an older symbol.
  const symbol = process.env.SM_TOKEN_SYMBOL ?? '$STONKSTER'
  const smon = w.chips.find((c) => c.startsWith(symbol))
  check('the HUD shows a real balance, not the invented placeholder',
    !!smon && !smon.includes('12,400'), smon ?? `no ${symbol} chip`)
}

await page.screenshot({ path: process.env.SHOT ?? 'first-login.png' })

await browser.close()
child.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
