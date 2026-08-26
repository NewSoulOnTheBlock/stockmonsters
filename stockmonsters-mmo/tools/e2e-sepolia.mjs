/*
 * Buy a box, mint it, let the server find it, open it — all on Sepolia, with
 * real transactions. No mock provider: the point is to prove the parts that a
 * mock cannot, above all that the mint INDEXER learns the token id.
 *
 *   node e2e-sepolia.mjs            # against an already-running server on :3000
 *   PORT_OVERRIDE=4193 node …       # boot its own
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, http } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const ROOT = resolve(process.cwd())
const PORT = Number(process.env.PORT_OVERRIDE ?? 3000)
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const envOf = (p) => Object.fromEntries(readFileSync(p, 'utf8').split('\n')
  .map((l) => /^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(l)).filter(Boolean)
  .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]))
const env = envOf(resolve(ROOT, '.env'))

let child = null
if (process.env.PORT_OVERRIDE) {
  child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
    { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
}
for (let i = 0; i < 200; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break } catch {}
  await sleep(300)
}

const key = envOf(resolve(ROOT, '../contracts/.env')).PRIVATE_KEY
const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key)
const pub = createPublicClient({ chain: sepolia, transport: http(env.SM_RPC_URL) })
const wallet = createWalletClient({ account, chain: sepolia, transport: http(env.SM_RPC_URL) })
console.log(`player ${account.address}`)

/* ---------------------------------------------------------------- login --*/
const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
const signature = await account.signMessage({ message })
const w = await (await fetch(`${BASE}/auth/verify`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, message, signature }),
})).json()
check('signed in', !!w.connectionId)

/* ------------------------------------------------------------- the guard -*/
const chain = await (await fetch(`${BASE}/token/chain`)).json()
check('the server names the chain the wallet must be on', chain.chainId === 11155111, chain.name)

/* -------------------------------------------------------------- a quote --*/
const quote = await (await fetch(`${BASE}/box/quote`)).json()
check('boxes are really sellable (not DEMO MODE)', quote.sellable === true)
check('the quote is bound to Sepolia', quote.chainId === 11155111, String(quote.chainId))
const tier = quote.tiers[0]
console.log(`  tier ${tier.id}: ${tier.priceWei} wei`)

/* ------------------------------------------------------------- a voucher -*/
const voucher = await (await fetch(`${BASE}/box/voucher`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ connectionId: w.connectionId, address: account.address, tier: tier.id }),
})).json()
check('the server signed a voucher', !!voucher.signature && voucher.signature !== '0xdemo',
  voucher.uid?.slice(0, 12))
check('the voucher is bound to the same chain', voucher.chainId === chain.chainId)

/* ---------------------------------------------------------------- mint ---*/
const MINT_ABI = [{
  type: 'function', name: 'mintCaught', stateMutability: 'payable',
  // No `to`: the contract mints to msg.sender, and the voucher is signed
  // over msg.sender too. A recipient argument would be a way to burn someone
  // else's voucher onto your own address.
  inputs: [
    { name: 'attrCommitment', type: 'bytes32' },
    { name: 'uid', type: 'bytes32' }, { name: 'fee', type: 'uint256' },
    { name: 'deadline', type: 'uint64' }, { name: 'signature', type: 'bytes' },
  ],
  outputs: [{ type: 'uint256' }],
}]
let mintHash
try {
  mintHash = await wallet.writeContract({
    address: voucher.contract, abi: MINT_ABI, functionName: 'mintCaught',
    args: [voucher.attrCommit, voucher.uid, BigInt(voucher.fee),
      BigInt(voucher.deadline), voucher.signature],
    value: BigInt(voucher.fee),
  })
} catch (e) {
  check('the mint transaction was accepted', false, String(e.shortMessage ?? e.message).slice(0, 120))
}
if (mintHash) {
  const receipt = await pub.waitForTransactionReceipt({ hash: mintHash })
  check('the mint landed on Sepolia', receipt.status === 'success',
    `https://sepolia.etherscan.io/tx/${mintHash}`)

  /* ------------------------------------------- the indexer (the real test) */
  // This is what BOX_RPC_URL turns on. Without it the loop below never ends.
  let row = null
  for (let i = 0; i < 24; i++) {
    const mine = await (await fetch(
      `${BASE}/box/mine?connectionId=${w.connectionId}&address=${account.address}`)).json()
    row = (mine.boxes ?? mine ?? []).find?.((b) => b.uid?.toLowerCase() === voucher.uid.toLowerCase())
    if (row?.tokenId) break
    await sleep(2500)
  }
  check('the server learned the token id off chain', !!row?.tokenId,
    row ? `#${row.tokenId ?? 'null'} status=${row.status}` : 'box not in /box/mine')

  /* --------------------------------------------------------------- open ---*/
  if (row?.tokenId) {
    const reveal = await (await fetch(`${BASE}/box/reveal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: w.connectionId, address: account.address, uid: voucher.uid }),
    })).json()
    check('the server released the reveal', !!reveal.salt, reveal.ticker ?? reveal.error ?? '')

    const OPEN_ABI = [{
      type: 'function', name: 'open', stateMutability: 'nonpayable', outputs: [],
      inputs: [
        { name: 'tokenId', type: 'uint256' }, { name: 'dexId', type: 'uint16' },
        { name: 'level', type: 'uint8' }, { name: 'ivs', type: 'uint8[6]' },
        { name: 'natureId', type: 'uint8' }, { name: 'shiny', type: 'bool' },
        { name: 'caughtAt', type: 'uint64' }, { name: 'salt', type: 'bytes32' },
      ],
    }]
    try {
      const openHash = await wallet.writeContract({
        address: reveal.contract ?? row.contract, abi: OPEN_ABI, functionName: 'open',
        args: [BigInt(row.tokenId), reveal.dexId, reveal.level, reveal.ivs,
          reveal.natureId, reveal.shiny, BigInt(reveal.caughtAt), reveal.salt],
      })
      const r2 = await pub.waitForTransactionReceipt({ hash: openHash })
      check('open() landed on Sepolia', r2.status === 'success',
        `https://sepolia.etherscan.io/tx/${openHash}`)

      /* ------------------------------- and the token now describes a creature */
      const uri = await pub.readContract({
        address: reveal.contract ?? row.contract,
        abi: [{ type: 'function', name: 'tokenURI', stateMutability: 'view',
          inputs: [{ type: 'uint256' }], outputs: [{ type: 'string' }] }],
        functionName: 'tokenURI', args: [BigInt(row.tokenId)],
      })
      const json = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'))
      check('the token is a named creature, not a sealed box',
        !/sealed/i.test(json.name), json.name)
      check('its art is on IPFS', json.image.startsWith('ipfs://'), json.image)
      const gw = 'https://' + env.PINATA_GATEWAY.replace(/^https?:\/\//, '').replace(/\/$/, '')
      const img = await fetch(json.image.replace('ipfs://', gw + '/ipfs/'))
      check('and the art actually loads', img.ok, `${img.status} ${img.headers.get('content-length')}b`)
      console.log('  attributes:', (json.attributes ?? []).map((a) => `${a.trait_type}=${a.value}`).join(' '))
    } catch (e) {
      check('open() landed on Sepolia', false, String(e.shortMessage ?? e.message).slice(0, 160))
    }
  }
}

if (child) child.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
