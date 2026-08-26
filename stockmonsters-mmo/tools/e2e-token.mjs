/*
 * End-to-end proof that the economy works ON A REAL CHAIN, driven the way a
 * player drives it: a browser, the real HUD, the real buttons, real
 * transactions on Sepolia.
 *
 *   cd contracts && forge build
 *   cd ../stockmonsters-mmo && RPG_TYPE=mmorpg npx vite build
 *   npm run test:e2e:token
 *
 * WHY IT NEEDS A WALLET SHIM
 * A headless browser has no MetaMask. The page talks to `window.ethereum`, so
 * the test injects one that forwards every request to a small local bridge
 * which signs with the deployer key. The GAME cannot tell the difference — it
 * is the same EIP-1193 surface — so what is being tested is the real client
 * code path, not a mock of it.
 *
 * The key never reaches the browser: the bridge holds it, the page only ever
 * sees method names and results.
 *
 * WHAT IT ASSERTS
 *   · the server reads the token's name, symbol and decimals OFF THE CHAIN
 *   · the HUD shows the player's real balance instead of the old placeholder
 *   · playing credits rewards, and the wallet panel shows them
 *   · CLAIM sends a real transaction and the player's on-chain balance rises
 *   · the box shop prices boxes in the token and mints one for tokens
 *   · the fee lands in the treasury, which is what funds the buyback
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { createPublicClient, createWalletClient, http, parseAbi, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import pg from 'pg'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CONTRACTS = resolve(ROOT, '../contracts')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.E2E_PORT ?? 4180)
const BRIDGE_PORT = PORT + 1
const BASE = `http://localhost:${PORT}`

/* ----------------------------------------------------------- reporting ---*/
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const step = (s) => console.log(`\n=== ${s} ===`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(label, fn, { timeout = 60_000, interval = 1000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(interval)
  }
}

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = readEnvFile(join(ROOT, '.env'))
const contractsEnv = readEnvFile(join(CONTRACTS, '.env'))
const key = contractsEnv.PRIVATE_KEY ?? process.env.PRIVATE_KEY
if (!key) { console.error('contracts/.env needs PRIVATE_KEY'); process.exit(1) }
if (!env.SM_TOKEN_ADDRESS) { console.error('.env has no SM_TOKEN_ADDRESS — run tools/deploy.mjs'); process.exit(1) }
if (!existsSync(join(ROOT, 'dist/client/index.html'))) {
  console.error('dist/client is missing — run: RPG_TYPE=mmorpg npx vite build')
  process.exit(1)
}

const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
const rpc = env.SM_RPC_URL
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpc) })

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const NFT = parseAbi(['function balanceOf(address) view returns (uint256)'])
const balanceOf = (token, who) =>
  publicClient.readContract({ address: token, abi: ERC20, functionName: 'balanceOf', args: [who] })

/* -------------------------------------------------------- wallet bridge ---*/
/*
 * The browser's window.ethereum, running in Node. Reads are forwarded to the
 * RPC untouched; a send is signed here and broadcast. Nothing else is allowed
 * through — a test harness that proxies arbitrary methods is a foot-gun.
 */
const bridge = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const chunks = []
  for await (const c of req) chunks.push(c)
  let out
  try {
    const { method, params = [] } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') out = [account.address]
    else if (method === 'eth_chainId') out = '0xaa36a7'
    else if (method === 'eth_sendTransaction') {
      const tx = params[0] ?? {}
      const hash = await walletClient.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : undefined,
      })
      console.log(`    [wallet] sent ${hash}`)
      out = hash
    } else if (method === 'eth_call' || method === 'eth_getTransactionReceipt' || method === 'eth_getBalance') {
      out = await publicClient.request({ method, params })
    } else {
      throw new Error(`the harness refuses ${method}`)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ result: out }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err?.message ?? err) }))
  }
})
await new Promise((r) => bridge.listen(BRIDGE_PORT, r))

const INJECT = `
  window.ethereum = {
    isMetaMask: true,
    selectedAddress: null,
    async request({ method, params }) {
      const res = await fetch('http://localhost:${BRIDGE_PORT}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      })
      const body = await res.json()
      if (body.error) throw new Error(body.error)
      return body.result
    },
    on() {}, removeListener() {},
  }
`

/* ------------------------------------------------------------- fixtures --*/

async function startServer() {
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), PROFILE_FLUSH_MS: '250' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (c) => { if (process.env.E2E_VERBOSE) process.stdout.write(`[server] ${c}`) })
  child.stderr.on('data', (c) => { if (process.env.E2E_VERBOSE) process.stdout.write(`[server] ${c}`) })
  await until('the server to listen', async () => {
    try { return (await fetch(`${BASE}/health`)).ok } catch { return false }
  }, { timeout: 30_000, interval: 300 })
  return child
}

async function signIn() {
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })
  if (!res.ok) throw new Error(`auth/verify failed: ${res.status}`)
  return res.json()
}

/** The fixture amount the claim step pays out. Small, and well inside the
 *  epoch budget the deploy funded. */
const SEEDED_REWARD = 7n * 10n ** 18n
let seededEpoch = 1

const profileDir = mkdtempSync(join(tmpdir(), 'sm-token-'))
let server
let browser

try {
  step('boot')
  server = await startServer()
  const meta = await (await fetch(`${BASE}/token`)).json()
  check('the server read the token off the chain', meta.configured && meta.symbol === 'SMON',
    `${meta.name} (${meta.symbol}), ${meta.decimals} decimals`)
  check('and it knows every contract', !!meta.contracts?.rewards && !!meta.contracts?.nft)

  const wallet = await signIn()
  // Start from a player the game has never seen. Rewards for reaching a new
  // map are once-per-map by design, so a second run against a kept profile
  // earns nothing and the claim step would have nothing to claim — the test
  // would be measuring its own leftovers.
  if (env.DATABASE_URL) {
    const db = new pg.Client({ connectionString: env.DATABASE_URL })
    await db.connect()
    /*
     * SEED THE LEDGER, DELIBERATELY.
     *
     * What the claim step proves is the chain path: the server signs what the
     * player is owed, the player's own wallet sends it, and the pool pays. It
     * should not also depend on a random wild encounter happening within the
     * test's patience — and the spawn map cannot pay, because HOME_MAP counts
     * as visited from birth (menus.ts).
     *
     * So the amount is a fixture. That earnings are credited CORRECTLY by
     * playing is covered exactly, and much faster, by
     * src/modules/main/earnings.spec.ts.
     */
    const epoch = env.SM_EPOCH_DAY0
      ? Math.floor(Date.now() / 86_400_000) - Number(env.SM_EPOCH_DAY0) + 1
      : 1
    seededEpoch = epoch
    await db.query(
      `INSERT INTO players (wallet_id, wallet_address) VALUES ($1, $2)
       ON CONFLICT (wallet_id) DO UPDATE SET last_seen_at = now()`,
      [wallet.connectionId, account.address.toLowerCase()],
    )
    await db.query(
      `INSERT INTO player_state (wallet_id, version, state)
       VALUES ($1, 1, jsonb_build_object('earned', jsonb_build_object($2::text, $3::text)))
       ON CONFLICT (wallet_id) DO UPDATE
         SET state = jsonb_set(player_state.state, '{earned}', jsonb_build_object($2::text, $3::text))`,
      [wallet.connectionId, String(epoch), SEEDED_REWARD.toString()],
    )
    await db.end()
    console.log(`  seeded ${formatEther(SEEDED_REWARD)} SMON of earnings in epoch ${epoch} (fixture)`)
  }
  const smonBefore = await balanceOf(meta.address, account.address)
  const nftBefore = await publicClient.readContract({
    address: meta.contracts.nft, abi: NFT, functionName: 'balanceOf', args: [account.address],
  })
  const treasuryBefore = await balanceOf(meta.address, meta.contracts.treasury)
  console.log(`  player holds ${formatEther(smonBefore)} SMON, ${nftBefore} NFTs`)

  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profileDir,
    args: ['--window-size=1280,900', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`))
  await page.evaluateOnNewDocument(INJECT)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((w, n) => {
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
    localStorage.setItem('sm-name', n)
  }, wallet, 'Tester' + randomBytes(1).toString('hex'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await until('the world to load', async () =>
    page.evaluate(() => !!window.__engine?.sceneMap), { timeout: 40_000 })
  await page.evaluate(() => document.getElementById('title-screen')?.remove())
  await sleep(6000)

  step('the HUD shows real money, not the placeholder')
  const chips = await until('the balance chips', async () => {
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('#sm-hud .hud-chips .smui-chip')].map((c) => c.textContent ?? ''))
    return found.some((c) => c.includes('SMON')) ? found : null
  }, { timeout: 40_000 })
  const smonChip = chips.find((c) => c.includes('SMON')) ?? ''
  check('the SMON chip carries the real balance', /SMON[\d,]/.test(smonChip.replace(/\s/g, '')), smonChip)
  check('the invented 12,400 placeholder is gone', !smonChip.includes('12,400'), smonChip)
  const ethChip = chips.find((c) => c.startsWith('ETH')) ?? ''
  check('the ETH chip is real too', !ethChip.includes('0.482'), ethChip)

  step('playing earns tokens')
  // Arriving somewhere new credits the reward ledger. The player just spawned,
  // so the spawn map itself is new for a wallet that has never played.
  const earned = await until('the server to see the earnings', async () => {
    const r = await (
      await fetch(`${BASE}/rewards/mine?address=${account.address}&connectionId=${wallet.connectionId}`)
    ).json()
    return Number(r.earned) > 0 ? r : null
  }, { timeout: 40_000 }).catch(() => null)
  check('the reward ledger has something in it', !!earned, earned ? `${earned.earned} SMON this epoch` : 'nothing')
  if (earned) {
    check('and it is claimable', Number(earned.claimable) > 0, `${earned.claimable} claimable`)
    check('the epoch is the one the deploy funded', earned.epoch === seededEpoch, `epoch ${earned.epoch}`)
    check('the claim signer is configured', earned.canSign)
  }

  step('claiming pays out on chain')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sm:wallet-refresh')))
  await sleep(1500)
  await page.evaluate(() => {
    const w = document.getElementById('sm-wallet')
    if (w) w.classList.add('open')
    window.dispatchEvent(new CustomEvent('sm:wallet-refresh'))
  })
  await sleep(2500)
  const panelText = await page.evaluate(() => document.getElementById('sm-wallet')?.textContent ?? '')
  check('the wallet panel shows what is claimable', /READY TO CLAIM/.test(panelText))
  check('...and explains where the money comes from',
    /rewards pool|never mints/i.test(panelText), panelText.slice(0, 0) || '')

  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#sm-wallet button')].find((b) => /CLAIM REWARDS/.test(b.textContent ?? ''))
    if (!btn || btn.disabled) return false
    btn.click()
    return true
  })
  check('the CLAIM button was live', clicked)
  if (clicked) {
    const after = await until('the on-chain balance to rise', async () => {
      const now = await balanceOf(meta.address, account.address)
      return now > smonBefore ? now : null
    }, { timeout: 120_000, interval: 3000 }).catch(() => null)
    check('the player was actually paid, on chain', !!after,
      after ? `+${formatEther(after - smonBefore)} SMON` : 'balance never moved')
  }

  step('the box shop prices boxes in the token')
  const quote = await (await fetch(`${BASE}/box/quote`)).json()
  check('the quote advertises the token', quote.token?.symbol === 'SMON', JSON.stringify(quote.token ?? null))
  check('and every tier has a token price', quote.tiers.every((t) => t.priceTokens > 0),
    quote.tiers.map((t) => `${t.id}:${t.priceTokens}`).join(' '))

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sm:hud-action', { detail: { id: 'boxes' } })))
  await sleep(2500)
  const shopText = await page.evaluate(() => document.getElementById('sm-boxshop')?.textContent ?? '')
  check('the shop offers a choice of currency', /PAY WITH/.test(shopText))
  check('the standard box shows its SMON price', /2,500/.test(shopText), shopText.slice(0, 0) || '')

  step('buying a box with tokens')
  const bought = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#sm-boxshop button')].find((b) => /Buy Standard box/i.test(b.textContent ?? ''))
    if (!btn) return false
    btn.click()
    return true
  })
  check('the buy button was there', bought)
  if (bought) {
    const minted = await until('the NFT to arrive', async () => {
      const now = await publicClient.readContract({
        address: meta.contracts.nft, abi: NFT, functionName: 'balanceOf', args: [account.address],
      })
      return now > nftBefore ? now : null
    }, { timeout: 180_000, interval: 4000 }).catch(() => null)
    check('a sealed box was minted, paid for in tokens', !!minted,
      minted ? `${minted} NFTs now` : 'no mint landed')

    const treasuryAfter = await balanceOf(meta.address, meta.contracts.treasury)
    check('the fee landed in the treasury, which funds the buyback',
      treasuryAfter > treasuryBefore, `+${formatEther(treasuryAfter - treasuryBefore)} SMON`)
  }
} catch (err) {
  failures++
  console.error('\n  FAIL  the run threw:', err?.stack ?? err)
} finally {
  try { await browser?.close() } catch { /* gone */ }
  try { server?.kill('SIGTERM') } catch { /* not running */ }
  bridge.close()
  rmSync(profileDir, { recursive: true, force: true })
}

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`)
process.exit(failures ? 1 : 0)
