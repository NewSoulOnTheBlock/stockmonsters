/*
 * A whole duel, played through the real UI by two real wallets.
 *
 *   npm run test:e2e:duel-ui
 *
 * tools/e2e-duel.mjs proves the CONTRACT: approve, open, settle, balances.
 * This proves the ORCHESTRATION — the part that was never driven end to end
 * and turned out to be broken for exactly that reason: the escrow's open()
 * pulls both stakes, only the challenger's client ever approved, and two real
 * players sat at "waiting for the escrow" until their duel expired.
 *
 * So this script is the duel as players experience it: two isolated browsers,
 * an invite, an accept, two blind picks, two signatures, the opponent's
 * approval, the challenger's open, the fight, and the winner's claim — with
 * every transaction really landing on Sepolia. It is slow (two boxes are
 * minted and opened first, because a duel needs fighters) and it is worth it.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { createPublicClient, createWalletClient, http, parseAbi, formatEther } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4210)
const BASE = `http://localhost:${PORT}`
const STAKE = '500' // whole $STONKSTER per side — small, this runs often
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const envOf = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n')
  .map((l) => /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l)).filter(Boolean)
  .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const env = envOf(join(ROOT, '.env'))
const deployerPk = envOf(resolve(ROOT, '../contracts/.env')).PRIVATE_KEY
const deployer = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : '0x' + deployerPk)
const pub = createPublicClient({ chain: sepolia, transport: http(env.SM_RPC_URL) })
const funder = createWalletClient({ account: deployer, chain: sepolia, transport: http(env.SM_RPC_URL) })

const ERC20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
])
const MINT_ABI = [{
  type: 'function', name: 'mintCaught', stateMutability: 'payable',
  inputs: [
    { name: 'attrCommitment', type: 'bytes32' }, { name: 'uid', type: 'bytes32' },
    { name: 'fee', type: 'uint256' }, { name: 'deadline', type: 'uint64' }, { name: 'signature', type: 'bytes' },
  ], outputs: [{ type: 'uint256' }],
}]
const OPEN_ABI = [{
  type: 'function', name: 'open', stateMutability: 'nonpayable', outputs: [],
  inputs: [
    { name: 'tokenId', type: 'uint256' }, { name: 'dexId', type: 'uint16' },
    { name: 'level', type: 'uint8' }, { name: 'ivs', type: 'uint8[6]' },
    { name: 'natureId', type: 'uint8' }, { name: 'shiny', type: 'bool' },
    { name: 'caughtAt', type: 'uint64' }, { name: 'salt', type: 'bytes32' },
  ],
}]

/* ----------------------------------------------------------- the server ---*/
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

/* ------------------------------------------------------------- a player ---*/
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-duelui-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})

/**
 * A funded wallet with a login, an opened Stockmonster, and a browser tab
 * standing in the world. Everything a duellist needs.
 */
async function makeDuellist(label) {
  const account = privateKeyToAccount(generatePrivateKey())
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(env.SM_RPC_URL) })

  // Money first: gas for approve/open/settle and a mint, tokens for the stake.
  const g = await funder.sendTransaction({ to: account.address, value: 30_000_000_000_000_000n })
  await pub.waitForTransactionReceipt({ hash: g })
  const t = await funder.writeContract({
    address: env.SM_TOKEN_ADDRESS, abi: ERC20, functionName: 'transfer',
    args: [account.address, 10_000n * 10n ** 18n],
  })
  await pub.waitForTransactionReceipt({ hash: t })

  // A server login, done directly — the browser then starts already signed in,
  // exactly like a returning player.
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  const wallet = await (await fetch(`${BASE}/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })).json()

  // A fighter: buy a box through the server, mint it, let the indexer find it,
  // open it. The same journey e2e-sepolia proves, reused as plumbing.
  const voucher = await (await fetch(`${BASE}/box/voucher`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId: wallet.connectionId, address: account.address, tier: 'standard' }),
  })).json()
  if (!voucher.signature) throw new Error(`${label}: no voucher — ${JSON.stringify(voucher).slice(0, 120)}`)
  const mint = await walletClient.writeContract({
    address: voucher.contract, abi: MINT_ABI, functionName: 'mintCaught',
    args: [voucher.attrCommit, voucher.uid, BigInt(voucher.fee), BigInt(voucher.deadline), voucher.signature],
    value: BigInt(voucher.fee),
  })
  await pub.waitForTransactionReceipt({ hash: mint })

  let row = null
  for (let i = 0; i < 30; i++) {
    const mine = await (await fetch(`${BASE}/box/mine?connectionId=${wallet.connectionId}&address=${account.address}`)).json()
    row = (mine.boxes ?? []).find((b) => b.uid?.toLowerCase() === voucher.uid.toLowerCase())
    if (row?.tokenId) break
    await sleep(2500)
  }
  if (!row?.tokenId) throw new Error(`${label}: the indexer never learned the token id`)

  const reveal = await (await fetch(`${BASE}/box/reveal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId: wallet.connectionId, address: account.address, uid: voucher.uid }),
  })).json()
  const open = await walletClient.writeContract({
    address: reveal.contract ?? row.contract, abi: OPEN_ABI, functionName: 'open',
    args: [BigInt(row.tokenId), reveal.dexId, reveal.level, reveal.ivs,
      reveal.natureId, reveal.shiny, BigInt(reveal.caughtAt), reveal.salt],
  })
  await pub.waitForTransactionReceipt({ hash: open })
  // The server marks the box opened when it next syncs this wallet.
  for (let i = 0; i < 20; i++) {
    const mine = await (await fetch(`${BASE}/box/mine?connectionId=${wallet.connectionId}&address=${account.address}`)).json()
    const b = (mine.boxes ?? []).find((x) => x.uid?.toLowerCase() === voucher.uid.toLowerCase())
    if (b?.status === 'opened') break
    await sleep(2500)
  }

  /* --- the browser, with a wallet that signs for real ------------------- */
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.setDefaultNavigationTimeout(120_000)
  await page.setViewport({ width: 1200, height: 850 })
  page.on('pageerror', (e) => console.log(`  [${label}]`, e.message.slice(0, 140)))
  await page.evaluateOnNewDocument((addr) => {
    window.__addr = addr
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_chainId') return '0xaa36a7'
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__addr]
        if (method === 'wallet_switchEthereumChain') return null
        if (method === 'personal_sign') return await window.__personal(params[0])
        if (method === 'eth_signTypedData_v4') return await window.__typed(params[1])
        if (method === 'eth_sendTransaction') return await window.__send(JSON.stringify(params[0]))
        if (method === 'eth_call') return await window.__call(JSON.stringify(params[0]))
        throw new Error('unexpected ' + method)
      },
    }
  }, account.address)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.exposeFunction('__personal', async (msg) =>
    account.signMessage({ message: msg.startsWith('0x') ? Buffer.from(msg.slice(2), 'hex').toString('utf8') : msg }))
  await page.exposeFunction('__typed', async (json) => {
    const t = JSON.parse(json)
    delete t.types.EIP712Domain // viem derives it; leaving it in confuses inference
    return account.signTypedData({ domain: t.domain, types: t.types, primaryType: t.primaryType, message: t.message })
  })
  await page.exposeFunction('__send', async (json) => {
    const tx = JSON.parse(json)
    const hash = await walletClient.sendTransaction({
      to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined,
    })
    const receipt = await pub.waitForTransactionReceipt({ hash })
    // A reverted transaction still resolves the wallet call with a hash, and a
    // client that does not look at the status carries on believing the money
    // moved. Print it loudly — a silent revert here cost a debugging session.
    console.log(`    [${label}] tx ${hash} ${receipt.status.toUpperCase()}`)
    return hash
  })
  await page.exposeFunction('__call', async (json) => {
    const tx = JSON.parse(json)
    return (await pub.call({ to: tx.to, data: tx.data })).data ?? '0x0'
  })

  await page.evaluate((w, n) => {
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
    localStorage.setItem('sm-name', n)
  }, wallet, label + randomBytes(2).toString('hex'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(6000)
  await page.evaluate(() => document.getElementById('btn-primary')?.click())
  await sleep(12000)

  const modalText = () => page.evaluate(() =>
    document.querySelector('#sm-duel .d-body')?.textContent?.replace(/\s+/g, ' ').trim() ?? '')
  const clickButton = (text) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('#sm-duel button')].find((x) => x.textContent.trim() === t)
    if (b) b.click()
    return !!b
  }, text)
  return { label, account, page, wallet, modalText, clickButton }
}

console.log('minting a fighter each (this is the slow part — real Sepolia blocks)…')
const A = await makeDuellist('Ana')
console.log(`  ${A.label} ready — ${A.account.address}`)
const B = await makeDuellist('Bo')
console.log(`  ${B.label} ready — ${B.account.address}`)

const smon = (a) => pub.readContract({ address: env.SM_TOKEN_ADDRESS, abi: ERC20, functionName: 'balanceOf', args: [a] })
const beforeA = await smon(A.account.address)
const beforeB = await smon(B.account.address)

/* ---------------------------------------------------------- the duel ---- */
console.log('\nthe challenge:')
await A.page.evaluate(() => window.dispatchEvent(new CustomEvent('sm:duel')))
await sleep(1500)
await A.page.evaluate((amt) => {
  const i = document.querySelector('#sm-duel .smui-input')
  if (i) { i.value = amt; i.dispatchEvent(new Event('input', { bubbles: true })) }
}, STAKE)
check('the offer form is up', await A.clickButton('CHALLENGE'))
await sleep(4000)
check('the challenger sees it was sent', /challenge sent/i.test(await A.modalText()))
check('the opponent gets ACCEPT', await B.clickButton('ACCEPT'))
await sleep(3000)

console.log('the blind picks:')
const pick = async (P) => {
  for (let i = 0; i < 10; i++) {
    const ok = await P.page.evaluate(() => {
      const b = document.querySelector('#sm-duel .d-pick')
      if (b) b.click()
      return !!b
    })
    if (ok) return true
    await sleep(1500)
  }
  return false
}
check('the challenger can pick a fighter', await pick(A))
check('the challenged can pick a fighter', await pick(B))
await sleep(3000)

console.log('the signatures:')
check('A is asked to sign', await A.clickButton('SIGN THE WAGER'))
await sleep(4000)
check('B is asked to sign', await B.clickButton('SIGN THE WAGER'))

/*
 * From here the flow is exactly what broke for real players: B must be told to
 * approve, the server must verify that allowance ON CHAIN, and only then may A
 * be told to open. Approve and open are real transactions on Sepolia, so this
 * takes a couple of minutes; the result and the settle follow on their own.
 */
console.log('approve (B), open (A), fight, settle — watching for up to 4 minutes…')
let won = null
for (let i = 0; i < 48; i++) {
  await sleep(5000)
  const a = await A.modalText()
  const b = await B.modalText()
  if (process.env.VERBOSE && i % 6 === 0) console.log('   A:', a.slice(0, 90), '\n   B:', b.slice(0, 90))
  if (/won in \d+ rounds|won the duel/i.test(a + b)) { won = { a, b }; break }
}
if (!won) {
  // The modal carries every note the flow wrote — the whole story of where it
  // stopped. Print all of it; a 90-character prefix hid the actual error twice.
  console.log('\n  A modal, in full:\n   ', (await A.modalText()))
  console.log('\n  B modal, in full:\n   ', (await B.modalText()))
}
check('the fight resolved', !!won)

// The settle transaction is sent by the winner's client automatically; give it
// a moment, then ask the chain who got paid.
await sleep(20_000)
const afterA = await smon(A.account.address)
const afterB = await smon(B.account.address)
const dA = afterA - beforeA
const dB = afterB - beforeB
console.log(`  A: ${formatEther(dA)} $STONKSTER   B: ${formatEther(dB)} $STONKSTER`)
const stake = 500n * 10n ** 18n
const rake = (stake * 2n * 300n) / 10_000n
const pot = stake * 2n - rake
const oneWon = (dA === pot - stake && dB === -stake) || (dB === pot - stake && dA === -stake)
check('the pot moved on chain: winner up by the pot minus the rake, loser down a stake',
  oneWon, `expected ±${formatEther(pot - stake)} / -${formatEther(stake)}`)

await browser.close()
child.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
