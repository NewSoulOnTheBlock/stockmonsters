/*
 * The same wallet, on a second computer.
 *
 *   npm run test:e2e:second-device
 *
 * The name belongs to the WALLET and lives in Postgres; localStorage is only
 * a cache of it. This drives a wallet through naming itself on one browser
 * profile, then signs the SAME wallet in on a completely separate profile —
 * empty cache, exactly like sitting down at another machine.
 *
 * What it defends: the second device must NOT ask for a name again. It used
 * to, every time, and the player could not even re-enter their own name —
 * the server correctly answers "taken", because it is taken by them.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4230)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const account = privateKeyToAccount(generatePrivateKey())
const NAME = 'Dev' + randomBytes(3).toString('hex')

/** A fresh login for this wallet — a new connection id, as a new device gets. */
async function signIn() {
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  return (await (await fetch(`${BASE}/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })).json())
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-dev-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})

/** A browser profile with its own storage — the "different computer" part. */
async function device(label, wallet, seedName) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(120_000)
  await page.setViewport({ width: 1100, height: 800 })
  page.on('pageerror', (e) => console.log(`  [${label}]`, e.message.slice(0, 120)))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((w, n) => {
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
    // seedName is null for the second device: an empty cache is the point.
    if (n) localStorage.setItem('sm-name', n)
  }, wallet, seedName)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(6000)
  await page.evaluate(() => document.getElementById('btn-primary')?.click())
  await sleep(13000)
  return { page, context }
}

/* --------------------------------------------------- device one: naming ---*/
console.log('device one — a new wallet chooses a name:')
const w1 = await signIn()
const d1 = await device('one', w1, null)
const asked = await d1.page.evaluate(() => !!document.getElementById('name-screen')?.classList.contains('open'))
check('a genuinely new wallet IS asked for a name', asked)

const named = await d1.page.evaluate(async (n) => {
  const input = document.getElementById('name-input')
  const ok = document.getElementById('name-ok')
  input.value = n
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  ok.click()
  await new Promise((r) => setTimeout(r, 3000))
  return {
    closed: !document.getElementById('name-screen')?.classList.contains('open'),
    stored: localStorage.getItem('sm-name'),
  }
}, NAME)
check('the name was accepted', named.closed && named.stored === NAME, JSON.stringify(named))

// Let the profile write batch reach Postgres before the second device asks.
await sleep(4000)

/* ------------------------------------------- device two: the actual test ---*/
console.log(`\ndevice two — same wallet, empty browser (${NAME} is already theirs):`)
const w2 = await signIn()
const d2 = await device('two', w2, null)

// Give it longer than the client's own grace period, so a modal that is going
// to appear has certainly appeared.
await sleep(9000)
const second = await d2.page.evaluate(() => ({
  modal: !!document.getElementById('name-screen')?.classList.contains('open'),
  stored: localStorage.getItem('sm-name'),
  hud: document.querySelector('#sm-hud .hud-name')?.textContent?.trim() ?? null,
}))
console.log('  device two:', JSON.stringify(second))
check('it does NOT ask for a name again', second.modal === false)
check('the name came back from the server', second.stored === NAME, `stored ${second.stored}`)
check('and it is on the HUD', second.hud === NAME, `hud ${second.hud}`)

await browser.close()
child.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
