/*
 * The marketplace, end to end, on Sepolia. Real approval, real signature, real
 * fill, real change of ownership.
 *
 *   node --env-file-if-exists=.env tools/e2e-market.mjs      # against :3000
 *   PORT_OVERRIDE=4194 node … tools/e2e-market.mjs           # boot its own
 *   SKIP_SMON=1 node …                                        # ETH round trip only
 *
 * Modelled on tools/e2e-sepolia.mjs, and for the same reason: the failures
 * that matter here do not exist against a mock. A struct encoded as dynamic
 * instead of static, a typed-data domain that disagrees with the contract by
 * one field, an order the book indexed while its approval was already revoked
 * — every one of those passes a unit test and reverts in a stranger's wallet.
 *
 * WHAT IT PROVES, IN ORDER
 *   1. the server refuses an order it cannot verify, and says why
 *   2. a listing is a SIGNATURE: it appears in the book with no transaction
 *   3. delisting is honestly reported as NOT an on-chain cancellation
 *   4. a SECOND wallet fills the order on chain and `ownerOf` really changes
 *   5. the indexer closes the filled order without being asked
 *   6. the same round trip works priced in SMON, through an ERC-20 approval
 *
 * The buy calldata is not written by this file. It is imported from the
 * BROWSER's own encoder (src/market-source-chain.ts, bundled here with vite),
 * so what lands on Sepolia is the byte string a player's wallet would send —
 * not a second implementation that happens to agree.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createPublicClient, createWalletClient, http, keccak256, toBytes, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { build } from 'vite'

import { signOrder } from './voucher-lib.mjs'

const ROOT = resolve(process.cwd())
const PORT = Number(process.env.PORT_OVERRIDE ?? 3000)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ZERO = '0x0000000000000000000000000000000000000000'
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }
const tx = (h) => `https://sepolia.etherscan.io/tx/${h}`

const envOf = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n')
  .map((l) => /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l)).filter(Boolean)
  .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const env = envOf(resolve(ROOT, '.env'))

/* ------------------------------------------------- the browser's encoder --*/
// src/market-source-chain.ts is TypeScript meant for a bundle, so it is built
// here rather than reimplemented. Sending calldata this script wrote itself
// would prove that this script agrees with viem — which the unit tests already
// say — and nothing at all about what a player's wallet sends.
const OUT = mkdtempSync(join(tmpdir(), 'sm-market-'))
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    lib: { entry: 'src/market-source-chain.ts', formats: ['es'], fileName: 'msc' },
    outDir: OUT, emptyOutDir: true, minify: false,
  },
})
const { encodeFillOrder, encodeSetApprovalForAll, SELECTORS } = await import(join(OUT, 'msc.js'))

/* ------------------------------------------------------------- the server -*/
let child = null
if (process.env.PORT_OVERRIDE) {
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
    { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
  child.stdout.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
}
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break } catch {}
  await sleep(300)
}

/* ------------------------------------------------------------- the wallets */
const rawKey = envOf(resolve(ROOT, '../contracts/.env')).PRIVATE_KEY
const SELLER_PK = rawKey.startsWith('0x') ? rawKey : '0x' + rawKey
// A deterministic second wallet. It has to be a DIFFERENT address from the
// seller because the contract refuses a self-fill outright (SELF_FILL) — which
// is exactly why a one-wallet test would prove nothing.
const BUYER_PK = keccak256(toBytes(SELLER_PK + ':stockmonsters-market-e2e-buyer'))
const seller = privateKeyToAccount(SELLER_PK)
const buyer = privateKeyToAccount(BUYER_PK)

const pub = createPublicClient({ chain: sepolia, transport: http(env.SM_RPC_URL) })
const sellerWallet = createWalletClient({ account: seller, chain: sepolia, transport: http(env.SM_RPC_URL) })
const buyerWallet = createWalletClient({ account: buyer, chain: sepolia, transport: http(env.SM_RPC_URL) })
console.log(`seller ${seller.address}\nbuyer  ${buyer.address}`)

const NFT_ABI = parseAbi([
  'function safeTransferFrom(address,address,uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function opened(uint256) view returns (bool)',
  'function attrCommit(uint256) view returns (bytes32)',
  'function isApprovedForAll(address,address) view returns (bool)',
  'function royaltyInfo(uint256,uint256) view returns (address,uint256)',
  'function totalSupply() view returns (uint256)',
])
const MARKET_ABI = parseAbi([
  'function epochOf(address) view returns (uint64)',
  'function feeBps() view returns (uint96)',
  'function acceptedCurrency(address) view returns (bool)',
])
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
])

/**
 * Keep the buyer in gas. The second wallet is derived, not funded, so the
 * seller tops it up — every transaction it sends afterwards is genuinely paid
 * for by a different key, which is the whole point of having it.
 */
async function fund(minWei, topUp) {
  const have = await pub.getBalance({ address: buyer.address })
  if (have >= minWei) return have
  const hash = await sellerWallet.sendTransaction({ to: buyer.address, value: topUp })
  await pub.waitForTransactionReceipt({ hash })
  console.log(`  funded the buyer with ${topUp} wei  ${tx(hash)}`)
  return pub.getBalance({ address: buyer.address })
}

/* ---------------------------------------------------------------- login ---*/
async function login(account) {
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  return (await (await fetch(`${BASE}/auth/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })).json())
}
const sellerAuth = await login(seller)
const buyerAuth = await login(buyer)
check('both wallets signed in', !!sellerAuth.connectionId && !!buyerAuth.connectionId)

/* -------------------------------------------------- is there a market at all */
const info = await (await fetch(`${BASE}/market`)).json()
check('the server indexes a real marketplace (not DEMO MODE)', info.configured === true, info.reason ?? '')
check('bound to Sepolia', info.chainId === 11155111, String(info.chainId))
if (!info.configured) {
  console.log('\nnothing else can be tested without a market — stopping')
  child?.kill('SIGTERM')
  process.exit(1)
}
const MARKET = info.market
const NFT = info.collection
console.log(`  market ${MARKET}\n  collection ${NFT}`)

/* ------------------------------------------------- find tokens to sell -----*/
const supply = await pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'totalSupply' })
const WANT = process.env.SKIP_SMON ? 2 : 3

async function census() {
  const mine = []
  const theirs = []
  for (let id = 1n; id <= supply; id++) {
    try {
      const who = (await pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'ownerOf', args: [id] }))
        .toLowerCase()
      if (who === seller.address.toLowerCase()) mine.push(id)
      else if (who === buyer.address.toLowerCase()) theirs.push(id)
    } catch { /* burned or never minted */ }
  }
  return { mine, theirs }
}

const PRICE = 400_000_000_000_000n // 0.0004 ETH — small, but genuinely paid
await fund(PRICE + 3_000_000_000_000_000n, PRICE + 9_000_000_000_000_000n)

let { mine: owned, theirs: buyerHas } = await census()
// Every run of this script permanently moves tokens to the buyer, so a second
// run would find nothing to sell. Hand back what the last run took rather than
// making the suite single-use — this is harness bookkeeping, not part of what
// is being proved.
while (owned.length < WANT && buyerHas.length) {
  const id = buyerHas.shift()
  const hash = await buyerWallet.writeContract({
    address: NFT, abi: NFT_ABI, functionName: 'safeTransferFrom',
    args: [buyer.address, seller.address, id],
  })
  await pub.waitForTransactionReceipt({ hash })
  console.log(`  returned #${id} from a previous run  ${tx(hash)}`)
  owned.push(id)
}

check('the seller owns something to list', owned.length >= 2,
  `${owned.length} token(s) of ${supply}: ${owned.join(', ')}`)
if (owned.length < 2) {
  console.log('\nrun tools/e2e-sepolia.mjs a couple of times to mint more boxes first')
  child?.kill('SIGTERM')
  process.exit(1)
}

/* --------------------------------------------------- approval (real tx) ---*/
let approved = await pub.readContract({
  address: NFT, abi: NFT_ABI, functionName: 'isApprovedForAll', args: [seller.address, MARKET],
})
if (!approved) {
  // This is step 1 of 2 in the browser, and it is a transaction: the market
  // contract cannot move a token it was never allowed to touch.
  const hash = await sellerWallet.sendTransaction({
    to: NFT, data: encodeSetApprovalForAll(MARKET, true),
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  approved = receipt.status === 'success'
  check('setApprovalForAll landed on Sepolia', approved, tx(hash))
} else {
  check('the market is already approved for the seller\'s collection', true)
}

/* ------------------------------------------------------- build an order ---*/
const [feeBps, epoch] = await Promise.all([
  pub.readContract({ address: MARKET, abi: MARKET_ABI, functionName: 'feeBps' }),
  pub.readContract({ address: MARKET, abi: MARKET_ABI, functionName: 'epochOf', args: [seller.address] }),
])

async function orderFor(tokenId, price, currency = ZERO) {
  const [opened, attrCommit, royalty] = await Promise.all([
    pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'opened', args: [tokenId] }),
    pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'attrCommit', args: [tokenId] }),
    pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'royaltyInfo', args: [tokenId, price] }),
  ])
  const fee = (price * feeBps) / 10_000n
  const royaltyWei = royalty[0] === ZERO ? 0n : royalty[1]
  return {
    seller: seller.address,
    tokenId: tokenId.toString(),
    price: price.toString(),
    // The seller's floor after fee and royalty, signed at today's numbers so a
    // later fee rise stops the order rather than quietly shrinking the payout.
    minProceeds: (price - fee - royaltyWei).toString(),
    deadline: Math.floor(Date.now() / 1000) + 7 * 86_400,
    epoch: Number(epoch),
    salt: BigInt(keccak256(toBytes(`${tokenId}-${Date.now()}-${Math.random()}`))).toString(),
    requireSealed: !opened,
    attrCommit,
    taker: ZERO,
    currency,
  }
}

const postList = (order, signature, auth = sellerAuth) => fetch(`${BASE}/market/list`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    connectionId: auth.connectionId, address: seller.address,
    chainId: 11155111, market: MARKET, order, signature,
  }),
}).then(async (r) => ({ status: r.status, body: await r.json() }))

const tokenA = owned[0]
const tokenB = owned[1]

const orderA = await orderFor(tokenA, PRICE)
const sigA = (await signOrder({ pk: SELLER_PK, market: MARKET, chainId: 11155111, order: orderA })).signature

/* ------------------------------------ the server must refuse what it cannot verify */
{
  // Same signature, different price: the classic tamper. `recover` returns SOME
  // address for it, just not the seller's — which is why the check is a
  // comparison and not a try/catch.
  const tampered = { ...orderA, price: (PRICE * 2n).toString() }
  const { status, body } = await postList(tampered, sigA)
  check('a tampered order is refused', status >= 400 && body.error === 'wrong-signer', body.message ?? '')
}
{
  const notMine = { ...orderA, tokenId: '999999' }
  const sig = (await signOrder({ pk: SELLER_PK, market: MARKET, chainId: 11155111, order: notMine })).signature
  const { status, body } = await postList(notMine, sig)
  // A token that was never minted reverts on ownerOf. That has to read as
  // "nobody owns it", not as a 500 — a seller who gets "something went wrong"
  // has nothing to act on.
  check('an order for a token the seller does not own is refused',
    status >= 400 && body.error === 'not-the-owner', `${body.error}: ${body.message ?? ''}`)
}
{
  const { status, body } = await postList({ ...orderA, deadline: Math.floor(Date.now() / 1000) - 5 }, sigA)
  check('an already-expired order is refused', status >= 400 && body.error === 'already-expired', body.message ?? '')
}

/* ------------------------------------------------------------ list it -----*/
const blockBefore = await pub.getBlockNumber()
const listed = await postList(orderA, sigA)
check('the order was accepted and indexed', listed.status === 200 && !!listed.body.orderHash,
  listed.body.orderHash ?? listed.body.message ?? '')
check('listing cost no gas — the chain did not move', (await pub.getBlockNumber()) - blockBefore <= 2n)
const ORDER_ID = listed.body.orderHash

const book = await (await fetch(`${BASE}/market/listings?limit=100`)).json()
const row = (book.listings ?? []).find((l) => l.id === ORDER_ID)
check('it shows up in GET /market/listings', !!row,
  row ? `${row.name} @ ${row.priceWei} wei, seller ${row.seller.slice(0, 10)}` : `${book.total} listings`)
check('a sealed listing does not leak its contents',
  !row || row.kind !== 'sealed' || (!row.art && !row.types && !row.stats), row?.kind ?? '')

/* ------------------------------- delisting is not a cancellation, and says so */
{
  const orderB = await orderFor(tokenB, PRICE)
  const sigB = (await signOrder({ pk: SELLER_PK, market: MARKET, chainId: 11155111, order: orderB })).signature
  const b = await postList(orderB, sigB)
  const removed = await (await fetch(`${BASE}/market/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId: sellerAuth.connectionId, address: seller.address, id: b.body.orderHash }),
  })).json()
  check('delisting removes it from the book', removed.removed === true)
  check('and says plainly that it is NOT an on-chain cancellation',
    removed.onChain === false && /not an on-chain cancellation/i.test(removed.note ?? ''))
  check('and hands back what the wallet needs to really cancel', !!removed.cancelOnChain?.order?.salt)
  const after = await (await fetch(`${BASE}/market/listings?limit=100`)).json()
  check('the delisted order is gone from the book',
    !(after.listings ?? []).some((l) => l.id === b.body.orderHash))
}

/* ------------------------------------------ the game window, in a browser -*/
/*
 * Everything above proves the SERVER and the CONTRACT. None of it proves the
 * marketplace window ever stops showing its demo catalogue — and a perfect
 * order book behind a window still rendering 72 invented listings is worth
 * nothing to a player.
 *
 * So: a real Chrome, the real built client, an injected EIP-1193 provider
 * whose reads go to Sepolia and whose WRITES ARE RECORDED RATHER THAN SENT.
 * The transaction itself is proven for real further down; what is being
 * checked here is that pressing Buy in the game produces exactly that
 * transaction, to the market, with the right calldata and the right value.
 */
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!process.env.SKIP_UI && existsSync(CHROME) && existsSync(resolve(ROOT, 'dist/client/index.html'))) {
  const puppeteer = (await import('puppeteer-core')).default
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-market-ui-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => { if (process.env.VERBOSE) console.log('  [page]', e.message) })

  // The bridge. The page has no keys and no RPC of its own; every request it
  // makes comes back here, which is also what makes the recording honest.
  await page.exposeFunction('__smRpc', async (method, params) => {
    switch (method) {
      case 'personal_sign':
        // The title screen signs a plain UTF-8 login message, not a hex blob.
        return buyer.signMessage({ message: params[0] })
      case 'eth_call':
        return (await pub.call({ to: params[0].to, data: params[0].data })).data ?? '0x'
      case 'eth_getTransactionReceipt':
        return { status: '0x1', transactionHash: params[0] }
      default:
        throw new Error(`unexpected method ${method}`)
    }
  })
  await page.evaluateOnNewDocument((address) => {
    const sent = []
    window.__sent = sent
    window.ethereum = {
      isMetaMask: true,
      on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_chainId') return '0xaa36a7'
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [address]
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
        if (method === 'eth_sendTransaction') {
          // Recorded, never broadcast. The real one is sent below, by a wallet
          // that is genuinely a second person.
          sent.push(params[0])
          return '0x' + 'ee'.repeat(32)
        }
        return window.__smRpc(method, params)
      },
    }
  }, buyer.address)

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  await page.evaluate(() => document.getElementById('btn-primary')?.click())
  await sleep(6000)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sm:open', { detail: 'marketplace' })))
  await sleep(4000)

  const banner = await page.evaluate(() =>
    document.querySelector('#sm-market .mk-banner')?.textContent?.trim() ?? '')
  check('the marketplace window dropped its DEMO MODE banner', !/DEMO MODE/i.test(banner),
    banner.slice(0, 80) || '(empty)')

  const cards = await page.evaluate(() => Array.from(
    document.querySelectorAll('#sm-market .mk-card .name'), (n) => n.textContent))
  check('it renders the order that was just signed, not an invented catalogue',
    cards.length > 0 && cards.some((n) => n?.includes(`#${tokenA}`)),
    `${cards.length} card(s): ${cards.slice(0, 3).join(', ')}`)

  // The demo catalogue is 72 fabricated rows. One real listing is the tell.
  check('the fabricated 72-item catalogue is gone', cards.length < 72, String(cards.length))

  const pressed = await page.evaluate(async () => {
    const buy = Array.from(document.querySelectorAll('#sm-market .mk-card'))
      .flatMap((c) => Array.from(c.querySelectorAll('button')))
      .find((b) => b.textContent?.trim() === 'Buy')
    if (!buy) return 'no buy button'
    buy.click()
    await new Promise((r) => setTimeout(r, 800))
    const confirm = Array.from(document.querySelectorAll('#sm-market .mk-modal .foot button'))
      .find((b) => b.textContent?.trim() === 'Buy')
    if (!confirm) return 'no confirm button'
    confirm.click()
    await new Promise((r) => setTimeout(r, 3000))
    return 'ok'
  })
  const sent = await page.evaluate(() => window.__sent ?? [])
  check('pressing Buy in the game builds a real transaction', pressed === 'ok' && sent.length === 1, pressed)
  check('addressed to the market contract',
    sent[0]?.to?.toLowerCase() === MARKET.toLowerCase(), sent[0]?.to ?? 'nothing sent')
  check('carrying fillOrder calldata', sent[0]?.data?.startsWith(SELECTORS.fillOrder), sent[0]?.data?.slice(0, 10))
  check('and exactly the listed price as value — the contract gives no change',
    BigInt(sent[0]?.value ?? 0) === PRICE, String(BigInt(sent[0]?.value ?? 0)))
  check('the calldata is byte-identical to what this test signs off chain',
    sent[0]?.data?.toLowerCase() === encodeFillOrder(orderA, sigA).toLowerCase())

  await browser.close()
} else {
  console.log('  (skipping the browser drive — no Chrome, or dist/client is not built)')
}

/* --------------------------------------------------- the buy (real fill) --*/
const fetched = await (await fetch(`${BASE}/market/order?id=${ORDER_ID}`)).json()
check('the book serves the whole signed order to a buyer',
  fetched.signature === sigA.toLowerCase() && fetched.order.tokenId === tokenA.toString())

const fillData = encodeFillOrder(fetched.order, fetched.signature)
check('the browser encoder produces the fillOrder selector', fillData.slice(0, 10) === SELECTORS.fillOrder)

let fillHash
try {
  fillHash = await buyerWallet.sendTransaction({ to: MARKET, data: fillData, value: PRICE })
} catch (err) {
  check('the fill was accepted by the network', false, String(err.shortMessage ?? err.message).slice(0, 200))
}
if (fillHash) {
  const receipt = await pub.waitForTransactionReceipt({ hash: fillHash })
  check('the fill landed on Sepolia', receipt.status === 'success', tx(fillHash))

  const nowOwner = await pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'ownerOf', args: [tokenA] })
  check('ownerOf really changed to the buyer',
    nowOwner.toLowerCase() === buyer.address.toLowerCase(), `#${tokenA} -> ${nowOwner}`)

  /* ------------------------------------- the indexer (the one that must not miss) */
  // Nobody asks it to. A filled order left open makes every later buyer pay
  // gas to revert, so this is the check that matters most after the transfer.
  let closed = null
  for (let i = 0; i < 30; i++) {
    const one = await (await fetch(`${BASE}/market/order?id=${ORDER_ID}`)).json()
    if (one.status === 'filled') { closed = one; break }
    await sleep(3000)
  }
  check('the indexer marked the order filled without being asked', !!closed,
    closed ? `buyer recorded, ${closed.closedReason}` : 'still open after 90s')

  const finalBook = await (await fetch(`${BASE}/market/listings?limit=100`)).json()
  check('and the listing disappeared from the book',
    !(finalBook.listings ?? []).some((l) => l.id === ORDER_ID), `${finalBook.total} left`)
}

/* ------------------------------------------------ the same trip in SMON ---*/
if (!process.env.SKIP_SMON && env.SM_TOKEN_ADDRESS && owned.length >= 3) {
  const SMON = env.SM_TOKEN_ADDRESS
  const accepted = await pub.readContract({
    address: MARKET, abi: MARKET_ABI, functionName: 'acceptedCurrency', args: [SMON],
  })
  check('SMON is a whitelisted currency on the market contract', accepted === true)
  if (accepted) {
    const tokenC = owned[2]
    const TOKEN_PRICE = 1_000_000_000_000_000_000_000n // 1,000 SMON
    const balance = await pub.readContract({
      address: SMON, abi: ERC20_ABI, functionName: 'balanceOf', args: [buyer.address],
    })
    if (balance < TOKEN_PRICE) {
      const hash = await sellerWallet.writeContract({
        address: SMON, abi: ERC20_ABI, functionName: 'transfer', args: [buyer.address, TOKEN_PRICE * 2n],
      })
      await pub.waitForTransactionReceipt({ hash })
      console.log(`  sent the buyer SMON  ${tx(hash)}`)
    }

    const orderC = await orderFor(tokenC, TOKEN_PRICE, SMON)
    const sigC = (await signOrder({ pk: SELLER_PK, market: MARKET, chainId: 11155111, order: orderC })).signature
    const c = await postList(orderC, sigC)
    check('a SMON-priced order is indexed', c.status === 200 && !!c.body.orderHash, c.body.message ?? '')

    if (c.body.orderHash) {
      // Check the allowance BEFORE asking for one. A blind approve on every
      // purchase is how players are trained to click through the prompt that
      // empties a wallet.
      const allowance = await pub.readContract({
        address: SMON, abi: ERC20_ABI, functionName: 'allowance', args: [buyer.address, MARKET],
      })
      if (allowance < TOKEN_PRICE) {
        const hash = await buyerWallet.writeContract({
          address: SMON, abi: ERC20_ABI, functionName: 'approve', args: [MARKET, TOKEN_PRICE],
        })
        await pub.waitForTransactionReceipt({ hash })
        check('the buyer approved exactly the purchase price in SMON', true, tx(hash))
      } else {
        check('the buyer already had enough allowance — no second prompt', true)
      }

      const one = await (await fetch(`${BASE}/market/order?id=${c.body.orderHash}`)).json()
      let hash
      try {
        // No `value`: the contract refuses stray ETH on a token-priced order,
        // because accepting it would strand it forever.
        hash = await buyerWallet.sendTransaction({
          to: MARKET, data: encodeFillOrder(one.order, one.signature),
        })
      } catch (err) {
        check('the SMON fill was accepted', false, String(err.shortMessage ?? err.message).slice(0, 200))
      }
      if (hash) {
        const receipt = await pub.waitForTransactionReceipt({ hash })
        check('the SMON fill landed on Sepolia', receipt.status === 'success', tx(hash))
        const owner = await pub.readContract({ address: NFT, abi: NFT_ABI, functionName: 'ownerOf', args: [tokenC] })
        check('the token paid for in SMON changed hands too',
          owner.toLowerCase() === buyer.address.toLowerCase(), `#${tokenC} -> ${owner}`)
      }
    }
  }
}

child?.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
