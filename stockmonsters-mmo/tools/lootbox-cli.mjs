#!/usr/bin/env node
/*
 * lootbox-cli.mjs — inspect, simulate, verify and drive the sealed-box flow.
 *
 *   node tools/lootbox-cli.mjs odds
 *       Print the odds table exactly as lootbox.mjs holds it. If this and
 *       docs/lootbox.md disagree, the doc is wrong.
 *
 *   node tools/lootbox-cli.mjs simulate --tier apex -n 200000
 *       Roll the tier that many times and print the REALISED distribution.
 *       The point is to catch a weighting that reads right and rolls wrong.
 *
 *   node tools/lootbox-cli.mjs selectors
 *       Recompute the two function selectors src/box-shop.ts hand-encodes
 *       against the compiled artifact. A mismatch means the browser would
 *       build calldata the contract does not understand.
 *
 *   node tools/lootbox-cli.mjs verify --file reveal.json
 *   … | node tools/lootbox-cli.mjs verify
 *       THE PLAYER-FACING ONE. Takes the JSON body of /box/reveal and checks
 *       (a) the server seed hashes to the hash published before the purchase,
 *       (b) replaying the roll from that seed gives these exact attributes,
 *       (c) those attributes hash to the commitment that is on chain.
 *
 *   node tools/lootbox-cli.mjs quote --url http://localhost:3000
 *   node tools/lootbox-cli.mjs buy --url http://localhost:3000 \
 *        --rpc http://127.0.0.1:8545 --pk 0x… --tier prime [--open]
 *       End-to-end smoke test against a running server + chain: sign in, buy,
 *       mint from the given key, then optionally reveal and open.
 */
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, http, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  BANDS, POOLS, TIERS, TIER_IDS, NATURE_NAMES,
  rollBox, replayRoll, quoteTiers, seedHash,
} from '../lootbox.mjs'

const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1]
  return args.includes(`--${name}`) ? true : fallback
}
const num = (name, fallback) => Number(flag(name, fallback))
const die = (msg) => { console.error(msg); process.exit(1) }

const pct = (n) => `${n.toFixed(2)}%`

/* ------------------------------------------------------------------ odds --*/

function cmdOdds() {
  console.log('SEALED BOX ODDS — the table in lootbox.mjs, rendered.\n')
  console.log('Species pools by base-stat total:')
  for (const b of BANDS) {
    const range = b.max >= 9999 ? `${b.min}+` : `${b.min}-${b.max}`
    console.log(`  ${b.label.padEnd(9)} BST ${range.padEnd(8)} ${String(POOLS[b.id].length).padStart(3)} species`)
  }
  console.log()
  for (const t of quoteTiers()) {
    const eth = Number(BigInt(t.priceWei) / 10n ** 12n) / 1e6
    console.log(`${t.label.toUpperCase()}  ${eth} ETH   level ${t.level[0]}-${t.level[1]}   `
      + `IV floor ${t.ivFloor}/31   shiny ${t.shinyOdds}`)
    for (const b of t.bands) {
      const bar = '█'.repeat(Math.round(b.pct / 2)).padEnd(50, '·')
      console.log(`   ${b.label.padEnd(9)} ${String(b.pct).padStart(5)}%  ${bar}`)
    }
    console.log()
  }
  console.log('NOT ENFORCEABLE ON CHAIN: mintCaught sees a hash, never a dexId.')
  console.log('These odds are a promise made by the signing key. See docs/lootbox.md.')
}

/* -------------------------------------------------------------- simulate --*/

function cmdSimulate() {
  const tiers = flag('tier') && flag('tier') !== true ? [flag('tier')] : TIER_IDS
  const n = num('n', 100_000)
  const address = '0x' + '11'.repeat(20)
  for (const tier of tiers) {
    if (!TIERS[tier]) die(`unknown tier: ${tier}`)
    const bands = {}
    const natures = new Array(25).fill(0)
    let shiny = 0
    let ivTotal = 0
    let levelTotal = 0
    const species = new Map()
    for (let i = 0; i < n; i++) {
      const seed = '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
      const r = rollBox({ serverSeed: seed, clientSeed: String(i), tier, address })
      bands[r.band] = (bands[r.band] ?? 0) + 1
      natures[r.natureId]++
      if (r.shiny) shiny++
      ivTotal += r.ivs.reduce((a, b) => a + b, 0)
      levelTotal += r.level
      species.set(r.ticker, (species.get(r.ticker) ?? 0) + 1)
    }
    const t = TIERS[tier]
    console.log(`\n${tier.toUpperCase()} — ${n.toLocaleString()} rolls`)
    for (const b of BANDS) {
      const want = (t.bands[b.id] ?? 0) / 100
      const got = ((bands[b.id] ?? 0) / n) * 100
      console.log(`  ${b.label.padEnd(9)} want ${pct(want).padStart(7)}  got ${pct(got).padStart(7)}`)
    }
    console.log(`  shiny      want 1 in ${t.shinyOneIn}   got 1 in ${shiny ? (n / shiny).toFixed(0) : '∞'}`)
    console.log(`  mean IV    ${(ivTotal / n / 6).toFixed(2)} (floor ${t.ivFloor})`)
    console.log(`  mean level ${(levelTotal / n).toFixed(1)} (range ${t.level[0]}-${t.level[1]})`)
    console.log(`  distinct species seen ${species.size}`)
    const spread = natures.map((c, i) => ({ n: NATURE_NAMES[i], c })).sort((a, b) => a.c - b.c)
    console.log(`  natures    rarest ${spread[0].n} ${spread[0].c}, commonest `
      + `${spread[24].n} ${spread[24].c} (uniform would be ${(n / 25).toFixed(0)})`)
  }
}

/* ------------------------------------------------------------- selectors --*/

const SIGNATURES = {
  mintCaught: 'mintCaught(bytes32,bytes32,uint256,uint64,bytes)',
  open: 'open(uint256,uint16,uint8,uint8[6],uint8,bool,uint64,bytes32)',
}

export function selectorFor(signature) {
  return keccak256(toHex(signature)).slice(0, 10)
}

function cmdSelectors() {
  let artifact = null
  try {
    artifact = JSON.parse(readFileSync(
      new URL('../../contracts/out/StockmonstersNFT.sol/StockmonstersNFT.json', import.meta.url), 'utf8'))
  } catch { /* not built; the keccak check still stands on its own */ }
  let bad = 0
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    const want = selectorFor(sig)
    const fromArtifact = artifact ? '0x' + artifact.methodIdentifiers[sig] : null
    const ok = !fromArtifact || fromArtifact === want
    if (!ok) bad++
    console.log(`${name.padEnd(11)} ${want}  ${sig}`)
    if (fromArtifact) console.log(`${''.padEnd(11)} artifact says ${fromArtifact} ${ok ? '✓' : '✗ MISMATCH'}`)
  }
  const shop = readFileSync(new URL('../src/box-shop.ts', import.meta.url), 'utf8')
  for (const [name, sig] of Object.entries(SIGNATURES)) {
    const want = selectorFor(sig)
    if (!shop.includes(want)) { console.log(`src/box-shop.ts does NOT pin ${name} = ${want}`); bad++ }
  }
  if (bad) process.exit(1)
  console.log('\nsrc/box-shop.ts pins both selectors correctly.')
}

/* ---------------------------------------------------------------- verify --*/

async function readStdin() {
  let s = ''
  for await (const chunk of process.stdin) s += chunk
  return s
}

async function cmdVerify() {
  const file = flag('file')
  const raw = file && file !== true ? readFileSync(file, 'utf8') : await readStdin()
  if (!raw.trim()) die('nothing to verify: pass --file reveal.json or pipe the /box/reveal body in')
  const reveal = JSON.parse(raw)
  if (!reveal.serverSeed) {
    die('this reveal has no serverSeed — it was issued without a fairness commitment '
      + 'and can only be audited against the server log. See docs/lootbox.md.')
  }
  const { ok, problems, rolled } = replayRoll(reveal)
  console.log(`box            ${reveal.uid}`)
  console.log(`tier           ${reveal.tier}`)
  console.log(`server seed    ${reveal.serverSeed}`)
  console.log(`  sha256       ${seedHash(reveal.serverSeed)}`)
  console.log(`  published    ${reveal.serverSeedHash}`)
  console.log(`client seed    ${reveal.clientSeed || '(none)'}`)
  console.log(`replayed roll  dex ${rolled.dexId} (${rolled.ticker}) lv${rolled.level} `
    + `${rolled.nature} ivs [${rolled.ivs}] ${rolled.shiny ? 'SHINY' : ''}`)
  console.log(`server said    dex ${reveal.dexId} lv${reveal.level} `
    + `${NATURE_NAMES[reveal.natureId]} ivs [${reveal.ivs}] ${reveal.shiny ? 'SHINY' : ''}`)
  console.log(`attr commit    ${reveal.attrCommit}`)
  if (ok) {
    console.log('\nOK — the seed matches its published hash, the roll replays to exactly these\n'
      + 'attributes, and they hash to the commitment the contract is holding.')
  } else {
    console.log('\nFAILED:')
    for (const p of problems) console.log(`  - ${p}`)
    process.exit(1)
  }
}

/* ------------------------------------------------------------ live flows --*/

const post = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${json.error ?? ''} ${json.message ?? ''}`)
  return json
}

async function cmdQuote() {
  const url = flag('url', 'http://localhost:3000')
  const q = await post(`${url}/box/quote`, {})
  console.log(JSON.stringify(q, null, 2))
}

/** Sign in the way index.html does, so the CLI gets a real connectionId. */
async function signIn(url, account) {
  const { nonce } = await fetch(`${url}/auth/nonce`).then((r) => r.json())
  const message = `Stockmonsters login\naddress: ${account.address}\nnonce: ${nonce}`
  const signature = await account.signMessage({ message })
  return post(`${url}/auth/verify`, { address: account.address, message, signature })
}

async function cmdBuy() {
  const url = flag('url', 'http://localhost:3000')
  const rpc = flag('rpc', 'http://127.0.0.1:8545')
  const pk = flag('pk')
  const tier = flag('tier', 'standard')
  if (!pk || pk === true) die('--pk is required (the BUYER key; it pays the fee)')
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)

  const quote = await post(`${url}/box/quote`, {})
  if (!quote.sellable) die('server says boxes are not sellable right now (no signer, no contract or no database)')
  const auth = await signIn(url, account)
  console.log(`signed in as ${account.address} -> ${auth.connectionId}`)

  const clientSeed = 'cli-' + Date.now()
  const voucher = await post(`${url}/box/voucher`, {
    connectionId: auth.connectionId, address: account.address, tier,
    commitId: quote.fairness.commit?.commitId ?? null, clientSeed,
  })
  console.log(`voucher ${voucher.uid} fee ${voucher.fee} deadline ${voucher.deadline}`)

  const pub = createPublicClient({ transport: http(rpc) })
  const wallet = createWalletClient({ account, transport: http(rpc) })
  const chainId = await pub.getChainId()
  if (Number(chainId) !== Number(voucher.chainId)) {
    die(`chain mismatch: RPC is ${chainId}, voucher is for ${voucher.chainId}`)
  }
  const hash = await wallet.sendTransaction({
    to: voucher.contract,
    value: BigInt(voucher.fee),
    data: encodeMint(voucher),
    chain: null,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  console.log(`minted in ${hash} (${receipt.status}, gas ${receipt.gasUsed})`)

  const mine = await fetch(
    `${url}/box/mine?connectionId=${encodeURIComponent(auth.connectionId)}&address=${account.address}`,
  ).then((r) => r.json())
  const row = mine.boxes.find((b) => b.uid === voucher.uid)
  console.log(`server sees token #${row?.tokenId ?? '(not yet — is BOX_RPC_URL set?)'} status ${row?.status}`)

  if (!flag('open')) return
  const reveal = await post(`${url}/box/reveal`, {
    connectionId: auth.connectionId, address: account.address, uid: voucher.uid,
  })
  console.log(`reveal: dex ${reveal.dexId} lv${reveal.level} ${reveal.nature}`
    + ` ivs [${reveal.ivs}] ${reveal.shiny ? 'SHINY' : ''}`)
  const { ok, problems } = replayRoll(reveal)
  console.log(ok ? 'fairness proof OK' : `fairness proof FAILED: ${problems.join('; ')}`)
  if (!row?.tokenId) die('cannot open: the server never learned the token id')
  const openHash = await wallet.sendTransaction({
    to: reveal.contract, data: encodeOpen(row.tokenId, reveal), chain: null,
  })
  const r2 = await pub.waitForTransactionReceipt({ hash: openHash })
  console.log(`opened in ${openHash} (${r2.status})`)
}

/* The same hand-encoding src/box-shop.ts does, so the CLI exercises it too. */
const w = (v) => {
  if (typeof v === 'boolean') return w(v ? 1 : 0)
  if (typeof v === 'string' && v.startsWith('0x')) return v.slice(2).toLowerCase().padStart(64, '0')
  return BigInt(v).toString(16).padStart(64, '0')
}
export function encodeMint(v) {
  const sig = v.signature.replace(/^0x/, '')
  const len = sig.length / 2
  return selectorFor(SIGNATURES.mintCaught)
    + w(v.attrCommit) + w(v.uid) + w(BigInt(v.fee)) + w(v.deadline) + w(160)
    + w(len) + sig.padEnd(Math.ceil(len / 32) * 64, '0')
}
export function encodeOpen(tokenId, r) {
  return selectorFor(SIGNATURES.open)
    + w(BigInt(tokenId)) + w(r.dexId) + w(r.level)
    + r.ivs.map((x) => w(x)).join('')
    + w(r.natureId) + w(r.shiny) + w(r.caughtAt) + w(r.salt)
}

/* ------------------------------------------------------------------ main --*/

const COMMANDS = {
  odds: cmdOdds,
  simulate: cmdSimulate,
  selectors: cmdSelectors,
  verify: cmdVerify,
  quote: cmdQuote,
  buy: cmdBuy,
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const run = COMMANDS[cmd]
  if (!run) {
    console.error(`usage: node tools/lootbox-cli.mjs <${Object.keys(COMMANDS).join('|')}> [flags]`)
    console.error('       see the comment at the top of this file')
    process.exit(1)
  }
  Promise.resolve(run()).catch((err) => die(`${err.message}`))
}
