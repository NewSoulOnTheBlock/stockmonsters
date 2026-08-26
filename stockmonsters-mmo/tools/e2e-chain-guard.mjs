/*
 * Does the game really move a wallet onto the right chain?
 *
 * Driven in a real browser against a real page, with an injected EIP-1193
 * provider that starts on MAINNET and records every method it is asked for.
 * The thing being proved is an ordering, and only a real page can prove it:
 * the switch must happen BEFORE personal_sign, not after a failed send.
 *
 *   node tools/e2e-chain-guard.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4194)
const BASE = `http://localhost:${PORT}`
const ROOT = resolve(process.cwd())
const SEPOLIA = '0xaa36a7'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
})
child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
let up = false
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break } } catch {}
  await sleep(300)
}
if (!up) { console.error('the server never came up'); child.kill(); process.exit(1) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-chain-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})

/**
 * A wallet that starts on the wrong chain.
 *
 * @param behaviour 'switches'  — a normal wallet that knows Sepolia
 *                  'unknown'   — 4902: never heard of it, must be ADDED first
 *                  'refuses'   — the player clicks reject on the switch
 */
async function withWallet(behaviour) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('  [page]', e.message))
  await page.evaluateOnNewDocument((behaviour, SEPOLIA) => {
    const calls = []
    window.__calls = calls
    let chainId = '0x1' // mainnet, deliberately
    window.ethereum = {
      isMetaMask: true,
      on() {},
      removeListener() {},
      async request({ method, params }) {
        calls.push({ method, params })
        switch (method) {
          case 'eth_chainId':
            return chainId
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return ['0x1111111111111111111111111111111111111111']
          case 'wallet_switchEthereumChain': {
            if (behaviour === 'refuses') {
              const e = new Error('User rejected the request.'); e.code = 4001; throw e
            }
            // A wallet that has never seen the chain refuses the FIRST switch
            // and accepts the one that follows wallet_addEthereumChain.
            if (behaviour === 'unknown' && !calls.some((c) => c.method === 'wallet_addEthereumChain')) {
              const e = new Error('Unrecognized chain ID.'); e.code = 4902; throw e
            }
            chainId = params[0].chainId
            return null
          }
          case 'wallet_addEthereumChain':
            return null
          case 'personal_sign':
            return '0x' + '11'.repeat(65)
          default:
            throw new Error('unexpected method ' + method)
        }
      },
    }
  }, behaviour, SEPOLIA)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  return page
}

const methodsOf = (page) => page.evaluate(() => window.__calls.map((c) => c.method))
const callOf = (page, method) =>
  page.evaluate((m) => window.__calls.find((c) => c.method === m) ?? null, method)
const clickConnect = async (page) => {
  await page.evaluate(() => document.getElementById('btn-primary')?.click())
  await sleep(2500)
}
const walletLine = (page) =>
  page.evaluate(() => document.getElementById('title-wallet-line')?.textContent?.trim() ?? '')

/* -------------------------------------------- 1. the ordinary wrong chain -*/
console.log('a wallet sitting on mainnet:')
{
  const page = await withWallet('switches')
  await clickConnect(page)
  const methods = await methodsOf(page)
  const switched = await callOf(page, 'wallet_switchEthereumChain')

  check('it was asked to switch chains', !!switched)
  check('it was asked for Sepolia specifically', switched?.params?.[0]?.chainId === SEPOLIA,
    switched?.params?.[0]?.chainId ?? 'never asked')
  // The whole point. A signature produced on the wrong chain is bound to the
  // wrong chain id, and nothing downstream can tell afterwards.
  const iSwitch = methods.indexOf('wallet_switchEthereumChain')
  const iSign = methods.indexOf('personal_sign')
  check('the switch happened BEFORE the login signature',
    iSwitch >= 0 && iSign >= 0 && iSwitch < iSign, methods.join(' → '))
  check('it ended up on Sepolia',
    (await page.evaluate(() => window.ethereum.request({ method: 'eth_chainId' }))) === SEPOLIA)
  await page.close()
}

/* ------------------------------------- 2. a wallet that never heard of it -*/
console.log('\na wallet that does not know Sepolia (4902):')
{
  const page = await withWallet('unknown')
  await clickConnect(page)
  const methods = await methodsOf(page)
  const added = await callOf(page, 'wallet_addEthereumChain')

  check('the chain was offered to the wallet to add', !!added)
  check('with an RPC the wallet can actually use',
    Array.isArray(added?.params?.[0]?.rpcUrls) && added.params[0].rpcUrls.length > 0,
    added?.params?.[0]?.rpcUrls?.[0] ?? 'none')
  // The public RPC belongs in the wallet; the server's own may be a keyed
  // endpoint and handing that to every visitor is how a key gets stolen.
  check('and NOT the server\'s own RPC url',
    !String(added?.params?.[0]?.rpcUrls?.[0] ?? '').includes('key='))
  check('the switch was retried after adding',
    methods.lastIndexOf('wallet_switchEthereumChain') > methods.indexOf('wallet_addEthereumChain'),
    methods.join(' → '))
  check('it still signed in afterwards', methods.includes('personal_sign'))
  await page.close()
}

/* ----------------------------------------- 3. the player says no to it ----*/
console.log('\na player who refuses the switch:')
{
  const page = await withWallet('refuses')
  await clickConnect(page)
  const methods = await methodsOf(page)

  check('nothing was signed', !methods.includes('personal_sign'), methods.join(' → '))
  const said = await walletLine(page)
  check('the screen says it is a network problem, not a mystery',
    /network|sepolia/i.test(said), JSON.stringify(said))
  await page.close()
}

/* -------------------------------------------------- 4. the server's word -*/
console.log('\nthe server:')
{
  const info = await (await fetch(`${BASE}/token/chain`)).json()
  check('names the chain it signs for', info.chainId === 11155111, `${info.name} (${info.chainId})`)
  check('and an explorer to show the player', !!info.explorer, info.explorer ?? 'none')
}

await browser.close()
child.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
