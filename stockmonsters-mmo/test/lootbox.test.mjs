/*
 * Integration test for the sealed loot box flow — against a REAL Postgres and
 * a REAL chain.
 *
 *   docker compose up -d
 *   npm run db:migrate
 *   node --env-file-if-exists=.env --test test/lootbox.test.mjs
 *
 * It boots anvil, deploys StockmonstersNFT from the compiled artifact, points a
 * box store at both, mounts the real `handleBoxRoutes` on a real HTTP server,
 * and drives the whole loop through HTTP exactly as the browser would:
 *
 *     quote -> voucher -> mintCaught (exact fee, buyer pays)
 *           -> the token reads EMPTY on chain
 *           -> reveal -> open() -> the attributes match what the server rolled
 *
 * None of the interesting failures here exist against a mock: an EIP-712
 * signature the contract rejects, a uint8[6] encoded as a dynamic array, a
 * commitment that hashes differently in Solidity than in JS. Those are exactly
 * the bugs that would make a token permanently unopenable, so this suite talks
 * to the things that would catch them.
 *
 * The refusals get equal billing with the happy path — see `describe('refusals')`.
 *
 * NOTE ON LEFTOVER ROWS: `boxes` refuses DELETE by design (the salt is the only
 * way to open a token, so a tidy-up query must not be able to brick one). Test
 * rows therefore accumulate under the anvil buyer addresses. To clear them
 * deliberately:
 *     ALTER TABLE boxes DISABLE TRIGGER boxes_no_delete;
 *     DELETE FROM boxes WHERE wallet_address = '0x70997970…';
 *     ALTER TABLE boxes ENABLE TRIGGER boxes_no_delete;
 */
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import pg from 'pg'
import {
  createPublicClient, createWalletClient, http as viemHttp, keccak256, toHex, parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { migrate } from '../db/migrate.mjs'
import { connectionIdFor } from '../auth.mjs'
import {
  createBoxStore, handleBoxRoutes, replayRoll, rollBox, seedHash, TIERS, NATURE_NAMES,
} from '../lootbox.mjs'
import { attrCommitment } from '../tools/voucher-lib.mjs'

const DATABASE_URL = process.env.DATABASE_URL
const ANVIL_PORT = Number(process.env.TEST_ANVIL_PORT ?? 8546)
const RPC = `http://127.0.0.1:${ANVIL_PORT}`
const CHAIN_ID = 31337

// The canonical anvil test-mnemonic keys (printed by `anvil` on boot).
// #0 deploys; #1 is the player, #2 a stranger, #3 the marketplace buyer.
const PK = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // 0 deployer
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // 1 buyer
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // 2 stranger
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // 3 second buyer
]
// The game signer is NOT an anvil account: it is the server's key and never
// needs a balance. That is the point of the voucher design.
const SIGNER_PK = '0x' + '42'.repeat(32)

const NFT_ARTIFACT = new URL('../../contracts/out/StockmonstersNFT.sol/StockmonstersNFT.json', import.meta.url)

const READ_ABI = parseAbi([
  'function attrCommit(uint256) view returns (bytes32)',
  'function opened(uint256) view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function gameSigner() view returns (address)',
  'function tokenURI(uint256) view returns (string)',
  'function monsters(uint256) view returns (uint16 dexId, uint8 level, uint8 ivHp, uint8 ivAtk, uint8 ivDfe, uint8 ivSpd, uint8 ivAts, uint8 ivDfs, uint8 natureId, bool shiny, uint64 caughtAt)',
  'function transferFrom(address,address,uint256)',
])

/* ------------------------------------------------------------- harness ---*/

let anvil = null
let pub = null
let nft = null
let store = null
let server = null
let baseUrl = ''
let live = false

const accounts = PK.map((pk) => privateKeyToAccount(pk))
const walletOf = (i) => createWalletClient({ account: accounts[i], transport: viemHttp(RPC) })
const idFor = (i) => connectionIdFor(accounts[i].address)

/** The same hand-encoding src/box-shop.ts does — deliberately not viem's
 *  encodeFunctionData, so the browser's version is what gets exercised. */
const w = (v) => {
  if (typeof v === 'boolean') return w(v ? 1 : 0)
  if (typeof v === 'string' && v.startsWith('0x')) return v.slice(2).toLowerCase().padStart(64, '0')
  return BigInt(v).toString(16).padStart(64, '0')
}
const SEL = {
  mintCaught: keccak256(toHex('mintCaught(bytes32,bytes32,uint256,uint64,bytes)')).slice(0, 10),
  open: keccak256(toHex('open(uint256,uint16,uint8,uint8[6],uint8,bool,uint64,bytes32)')).slice(0, 10),
}
function encodeMint(v) {
  const sig = v.signature.replace(/^0x/, '')
  const len = sig.length / 2
  return SEL.mintCaught + w(v.attrCommit) + w(v.uid) + w(BigInt(v.fee)) + w(v.deadline) + w(160)
    + w(len) + sig.padEnd(Math.ceil(len / 32) * 64, '0')
}
function encodeOpen(tokenId, r) {
  return SEL.open + w(BigInt(tokenId)) + w(r.dexId) + w(r.level)
    + r.ivs.map((x) => w(x)).join('')
    + w(r.natureId) + w(r.shiny) + w(r.caughtAt) + w(r.salt)
}

const post = async (path, body) => {
  const res = await fetch(baseUrl + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const get = async (path) => {
  const res = await fetch(baseUrl + path)
  return { status: res.status, body: await res.json().catch(() => null) }
}

async function startAnvil() {
  anvil = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent', '--chain-id', String(CHAIN_ID)], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  anvil.stderr?.on('data', (d) => process.stderr.write(`[anvil] ${d}`))
  const client = createPublicClient({ transport: viemHttp(RPC) })
  for (let i = 0; i < 60; i++) {
    try { await client.getBlockNumber(); return client } catch { await sleep(200) }
  }
  throw new Error('anvil did not come up')
}

async function deployNft() {
  const artifact = JSON.parse(readFileSync(NFT_ARTIFACT, 'utf8'))
  const hash = await walletOf(0).deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [privateKeyToAccount(SIGNER_PK).address, 'ipfs://test/', 'ipfs://sealed'],
    chain: null,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  assert.equal(receipt.status, 'success', 'NFT deployment reverted')
  return receipt.contractAddress
}

before(async () => {
  if (!DATABASE_URL) return
  const c = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 })
  await c.connect()
  await c.end()
  await migrate(DATABASE_URL, { log: () => {} })

  pub = await startAnvil()
  nft = await deployNft()

  store = createBoxStore({
    databaseUrl: DATABASE_URL,
    signerPk: SIGNER_PK,
    contract: nft,
    chainId: CHAIN_ID,
    rpcUrl: RPC,
    ttlSeconds: 900,
    // The rate limiter gets its own store below; this one must not trip on a
    // suite that legitimately buys a dozen boxes.
    rateMax: 500,
    maxOutstanding: 500,
    log: { log: () => {}, warn: () => {} },
  })

  server = http.createServer(async (req, res) => {
    if (await handleBoxRoutes(req, res, store)) return
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(0, r))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  live = true
}, { timeout: 120_000 })

after(async () => {
  await store?.close()
  await new Promise((r) => (server ? server.close(r) : r()))
  anvil?.kill('SIGKILL')
})

const requireLive = () => assert.ok(live,
  'this suite needs DATABASE_URL + a running Postgres + anvil on PATH')

/* ---------------------------------------------------------------- setup ---*/

describe('wiring', () => {
  test('the contract trusts the server key we signed with', async () => {
    requireLive()
    const signer = await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'gameSigner' })
    assert.equal(signer.toLowerCase(), privateKeyToAccount(SIGNER_PK).address.toLowerCase())
  })

  test('the selectors src/box-shop.ts hand-encodes match the compiled contract', () => {
    const artifact = JSON.parse(readFileSync(NFT_ARTIFACT, 'utf8'))
    assert.equal(SEL.mintCaught, '0x' + artifact.methodIdentifiers['mintCaught(bytes32,bytes32,uint256,uint64,bytes)'])
    assert.equal(SEL.open, '0x' + artifact.methodIdentifiers['open(uint256,uint16,uint8,uint8[6],uint8,bool,uint64,bytes32)'])
    // …and that the browser file actually pins those exact bytes.
    const shop = readFileSync(new URL('../src/box-shop.ts', import.meta.url), 'utf8')
    assert.ok(shop.includes(SEL.mintCaught), 'box-shop.ts does not pin the mintCaught selector')
    assert.ok(shop.includes(SEL.open), 'box-shop.ts does not pin the open selector')
  })
})

/* ---------------------------------------------------------------- quote ---*/

describe('POST /box/quote', () => {
  test('is public and describes all three tiers', async () => {
    requireLive()
    const { status, body } = await post('/box/quote', {})
    assert.equal(status, 200)
    assert.deepEqual(body.tiers.map((t) => t.id), ['standard', 'prime', 'apex'])
    assert.equal(body.chainId, CHAIN_ID)
    assert.equal(body.sellable, true)
    for (const t of body.tiers) {
      const sum = t.bands.reduce((a, b) => a + b.pct, 0)
      assert.ok(Math.abs(sum - 100) < 1e-9, `${t.id} band percentages sum to ${sum}`)
      assert.ok(BigInt(t.priceWei) > 0n)
    }
    // Prices must be strictly increasing, or "Apex" means nothing.
    const prices = body.tiers.map((t) => BigInt(t.priceWei))
    assert.ok(prices[0] < prices[1] && prices[1] < prices[2])
  })

  test('hands out a fresh, single-use fairness commitment', async () => {
    requireLive()
    const a = await post('/box/quote', {})
    const b = await post('/box/quote', {})
    assert.ok(a.body.fairness.commit.serverSeedHash.startsWith('0x'))
    assert.notEqual(a.body.fairness.commit.commitId, b.body.fairness.commit.commitId)
    assert.notEqual(a.body.fairness.commit.serverSeedHash, b.body.fairness.commit.serverSeedHash)
  })
})

/* ------------------------------------------------------ the whole loop ---*/

describe('the whole loop, on chain', () => {
  test('quote -> voucher -> mint -> sealed -> reveal -> open', async () => {
    requireLive()
    const buyer = accounts[1]
    const quote = await post('/box/quote', {})
    const commit = quote.body.fairness.commit
    const tier = 'apex'
    const clientSeed = 'player-picked-' + Date.now()

    /* --- 2. the server rolls, commits, signs and PERSISTS ---------------- */
    const v = await post('/box/voucher', {
      connectionId: idFor(1), address: buyer.address, tier, commitId: commit.commitId, clientSeed,
    })
    assert.equal(v.status, 200, JSON.stringify(v.body))
    const voucher = v.body
    assert.equal(voucher.fee, TIERS[tier].priceWei)
    assert.equal(voucher.serverSeedHash, commit.serverSeedHash)
    assert.equal(voucher.signer.toLowerCase(), privateKeyToAccount(SIGNER_PK).address.toLowerCase())
    // The voucher must leak NOTHING about the contents.
    for (const leak of ['dexId', 'level', 'ivs', 'shiny', 'natureId', 'salt', 'serverSeed']) {
      assert.equal(voucher[leak], undefined, `the voucher leaked ${leak}`)
    }

    /* --- the roll is durably in Postgres BEFORE the signature was handed
     *     out; without that row the token could never be opened. ---------- */
    const row = await store._q('SELECT * FROM boxes WHERE uid = $1', [voucher.uid])
    assert.equal(row.rowCount, 1)
    assert.match(row.rows[0].salt, /^0x[0-9a-f]{64}$/)
    assert.equal(row.rows[0].status, 'issued')
    assert.equal(row.rows[0].attr_commit, voucher.attrCommit)

    /* --- 4. the PLAYER's wallet pays the fee ----------------------------- */
    const before = await pub.getBalance({ address: buyer.address })
    const hash = await walletOf(1).sendTransaction({
      to: nft, value: BigInt(voucher.fee), data: encodeMint(voucher), chain: null,
    })
    const receipt = await pub.waitForTransactionReceipt({ hash })
    assert.equal(receipt.status, 'success', 'mintCaught reverted')
    const tokenId = await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'totalSupply' })
    assert.equal(
      (await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'ownerOf', args: [tokenId] })).toLowerCase(),
      buyer.address.toLowerCase(),
    )
    // The fee left the buyer's wallet and landed in the contract.
    const after = await pub.getBalance({ address: buyer.address })
    const gas = receipt.gasUsed * receipt.effectiveGasPrice
    assert.equal(after, before - BigInt(voucher.fee) - gas)
    assert.equal(await pub.getBalance({ address: nft }), BigInt(voucher.fee))

    /* --- the sealed token reads EMPTY on chain --------------------------- */
    assert.equal(
      await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'attrCommit', args: [tokenId] }),
      voucher.attrCommit,
    )
    assert.equal(await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'opened', args: [tokenId] }), false)
    const sealed = await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'monsters', args: [tokenId] })
    assert.deepEqual(sealed.slice(0, 3), [0, 0, 0], 'a sealed token must store no attributes')
    const sealedUri = await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'tokenURI', args: [tokenId] })
    const sealedJson = Buffer.from(sealedUri.split(',')[1], 'base64').toString('utf8')
    assert.ok(/Sealed Stockmonster Box/.test(sealedJson))
    assert.ok(!/dexId|"Level"|"Nature"/.test(sealedJson), 'the sealed metadata leaked an attribute')

    /* --- the server learns the tokenId FROM THE CHAIN, not from us ------- */
    const mine = await get(`/box/mine?connectionId=${idFor(1)}&address=${buyer.address}`)
    assert.equal(mine.status, 200)
    const listed = mine.body.boxes.find((b) => b.uid === voucher.uid)
    assert.equal(listed.tokenId, String(tokenId))
    assert.equal(listed.status, 'minted')
    assert.equal(listed.contents, null, '/box/mine leaked the contents of a sealed box')

    /* --- 5. reveal, to the owner only ------------------------------------ */
    const rev = await post('/box/reveal', {
      connectionId: idFor(1), address: buyer.address, uid: voucher.uid,
    })
    assert.equal(rev.status, 200, JSON.stringify(rev.body))
    const reveal = rev.body
    assert.equal(reveal.ivs.length, 6)
    assert.ok(reveal.ivs.every((iv) => iv >= TIERS[tier].ivFloor && iv <= 31), 'an IV broke the tier floor')
    assert.ok(reveal.level >= TIERS[tier].level[0] && reveal.level <= TIERS[tier].level[1])
    assert.ok(reveal.natureId >= 0 && reveal.natureId < 25)
    assert.equal(reveal.nature, NATURE_NAMES[reveal.natureId])

    /* --- the fairness proof holds ---------------------------------------- */
    assert.equal(seedHash(reveal.serverSeed), commit.serverSeedHash)
    assert.equal(reveal.clientSeed, clientSeed)
    const replay = replayRoll({ ...reveal, address: buyer.address.toLowerCase() })
    assert.deepEqual(replay.problems, [])
    assert.ok(replay.ok, 'the roll could not be replayed from the revealed seed')
    // …and the commitment on chain is the one those attributes produce.
    assert.equal(
      attrCommitment({
        dexId: reveal.dexId, level: reveal.level, ivs: reveal.ivs, natureId: reveal.natureId,
        shiny: reveal.shiny, caughtAt: reveal.caughtAt, salt: reveal.salt,
      }),
      voucher.attrCommit,
    )

    /* --- open() succeeds and the chain now agrees with the server -------- */
    const openHash = await walletOf(1).sendTransaction({
      to: nft, data: encodeOpen(tokenId, reveal), chain: null,
    })
    const openReceipt = await pub.waitForTransactionReceipt({ hash: openHash })
    assert.equal(openReceipt.status, 'success', 'open() reverted')
    assert.equal(await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'opened', args: [tokenId] }), true)

    const m = await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'monsters', args: [tokenId] })
    const [dexId, level, ...rest] = m
    assert.equal(dexId, reveal.dexId)
    assert.equal(level, reveal.level)
    assert.deepEqual(rest.slice(0, 6), reveal.ivs, 'the IVs on chain are not the ones the server rolled')
    assert.equal(rest[6], reveal.natureId)
    assert.equal(rest[7], reveal.shiny)
    assert.equal(Number(rest[8]), reveal.caughtAt)

    /* --- and the server notices, from the chain again -------------------- */
    const after2 = await get(`/box/mine?connectionId=${idFor(1)}&address=${buyer.address}`)
    const opened = after2.body.boxes.find((b) => b.uid === voucher.uid)
    assert.equal(opened.status, 'opened')
    assert.equal(opened.contents.dexId, reveal.dexId)
    assert.equal(opened.contents.shiny, reveal.shiny)
  }, { timeout: 90_000 })
})

/* ------------------------------------------------------------- refusals ---*/

describe('refusals', () => {
  /** Buy + mint a box for account `i`, returning { voucher, tokenId }. */
  async function buyAndMint(i, tier = 'standard') {
    const quote = await post('/box/quote', {})
    const v = await post('/box/voucher', {
      connectionId: idFor(i), address: accounts[i].address, tier,
      commitId: quote.body.fairness.commit.commitId, clientSeed: 'x',
    })
    assert.equal(v.status, 200, JSON.stringify(v.body))
    const hash = await walletOf(i).sendTransaction({
      to: nft, value: BigInt(v.body.fee), data: encodeMint(v.body), chain: null,
    })
    const r = await pub.waitForTransactionReceipt({ hash })
    assert.equal(r.status, 'success')
    const tokenId = await pub.readContract({ address: nft, abi: READ_ABI, functionName: 'totalSupply' })
    return { voucher: v.body, tokenId }
  }

  test('a connectionId that does not belong to the address is refused', async () => {
    requireLive()
    const r = await post('/box/voucher', {
      connectionId: idFor(2), address: accounts[1].address, tier: 'standard',
    })
    assert.equal(r.status, 403)
    assert.equal(r.body.error, 'not-your-wallet')
  })

  test('a made-up connectionId is refused', async () => {
    requireLive()
    const r = await post('/box/voucher', {
      connectionId: 'w:' + 'f'.repeat(32), address: accounts[1].address, tier: 'standard',
    })
    assert.equal(r.status, 403)
  })

  test('another wallet cannot fetch the reveal', async () => {
    requireLive()
    const { voucher } = await buyAndMint(1)
    const stranger = await post('/box/reveal', {
      connectionId: idFor(2), address: accounts[2].address, uid: voucher.uid,
    })
    assert.equal(stranger.status, 403)
    assert.equal(stranger.body.error, 'not-yours')
    assert.equal(stranger.body.salt, undefined)
    // And not by presenting the owner's id with someone else's address either.
    const mixed = await post('/box/reveal', {
      connectionId: idFor(1), address: accounts[2].address, uid: voucher.uid,
    })
    assert.equal(mixed.status, 403)
    // The owner still can.
    const owner = await post('/box/reveal', {
      connectionId: idFor(1), address: accounts[1].address, uid: voucher.uid,
    })
    assert.equal(owner.status, 200)
    assert.match(owner.body.salt, /^0x[0-9a-f]{64}$/)
  }, { timeout: 60_000 })

  test('a box follows the token: the new on-chain owner can reveal, the seller cannot re-sell the secret', async () => {
    requireLive()
    const { voucher, tokenId } = await buyAndMint(1)
    // 1 sells to 3.
    const hash = await walletOf(1).writeContract({
      address: nft, abi: READ_ABI, functionName: 'transferFrom',
      args: [accounts[1].address, accounts[3].address, tokenId], chain: null,
    })
    await pub.waitForTransactionReceipt({ hash })
    const buyer = await post('/box/reveal', {
      connectionId: idFor(3), address: accounts[3].address, tokenId: String(tokenId),
    })
    assert.equal(buyer.status, 200, JSON.stringify(buyer.body))
    assert.equal(buyer.body.via, 'current-owner')
    // A fourth party still gets nothing.
    const nobody = await post('/box/reveal', {
      connectionId: idFor(2), address: accounts[2].address, tokenId: String(tokenId),
    })
    assert.equal(nobody.status, 403)
  }, { timeout: 60_000 })

  test('a uid cannot be minted twice', async () => {
    requireLive()
    const { voucher } = await buyAndMint(1)
    await assert.rejects(
      () => walletOf(1).sendTransaction({
        to: nft, value: BigInt(voucher.fee), data: encodeMint(voucher), chain: null,
      }),
      /VOUCHER_USED/,
    )
  }, { timeout: 60_000 })

  test('an expired deadline is rejected by the contract', async () => {
    requireLive()
    // A store whose vouchers are born expired — cleaner than warping chain time
    // out from under the other tests in this file.
    const expiring = createBoxStore({
      databaseUrl: DATABASE_URL, signerPk: SIGNER_PK, contract: nft, chainId: CHAIN_ID,
      rpcUrl: RPC, ttlSeconds: -600, rateMax: 500, maxOutstanding: 500,
      log: { log: () => {}, warn: () => {} },
    })
    try {
      const v = await expiring.issueVoucher({
        walletId: idFor(1), address: accounts[1].address.toLowerCase(), tier: 'standard', clientSeed: '',
      })
      assert.ok(v.deadline < Math.floor(Date.now() / 1000))
      await assert.rejects(
        () => walletOf(1).sendTransaction({
          to: nft, value: BigInt(v.fee), data: encodeMint(v), chain: null,
        }),
        /VOUCHER_EXPIRED/,
      )
    } finally {
      await expiring.close()
    }
  }, { timeout: 60_000 })

  test('the wrong fee is rejected — under, over, and zero', async () => {
    requireLive()
    const quote = await post('/box/quote', {})
    const v = await post('/box/voucher', {
      connectionId: idFor(1), address: accounts[1].address, tier: 'prime',
      commitId: quote.body.fairness.commit.commitId,
    })
    const fee = BigInt(v.body.fee)
    for (const wrong of [fee - 1n, fee + 1n, 0n]) {
      await assert.rejects(
        () => walletOf(1).sendTransaction({
          to: nft, value: wrong, data: encodeMint(v.body), chain: null,
        }),
        /WRONG_FEE/,
        `paying ${wrong} instead of ${fee} should revert`,
      )
    }
    // The same voucher still works at the right price, so the refusals above
    // were about the fee and nothing else.
    const ok = await walletOf(1).sendTransaction({
      to: nft, value: fee, data: encodeMint(v.body), chain: null,
    })
    assert.equal((await pub.waitForTransactionReceipt({ hash: ok })).status, 'success')
  }, { timeout: 60_000 })

  test('a tampered reveal cannot open the box', async () => {
    requireLive()
    const { voucher, tokenId } = await buyAndMint(1, 'standard')
    const reveal = (await post('/box/reveal', {
      connectionId: idFor(1), address: accounts[1].address, uid: voucher.uid,
    })).body
    // Claim a better creature than the one that was actually sealed.
    const greedy = { ...reveal, dexId: reveal.dexId + 1, ivs: [31, 31, 31, 31, 31, 31], shiny: true }
    await assert.rejects(
      () => walletOf(1).sendTransaction({ to: nft, data: encodeOpen(tokenId, greedy), chain: null }),
      /BAD_REVEAL/,
    )
    // The honest payload still opens it.
    const good = await walletOf(1).sendTransaction({
      to: nft, data: encodeOpen(tokenId, reveal), chain: null,
    })
    assert.equal((await pub.waitForTransactionReceipt({ hash: good })).status, 'success')
  }, { timeout: 60_000 })

  test('a stranger cannot open someone else\'s token even holding the reveal', async () => {
    requireLive()
    const { voucher, tokenId } = await buyAndMint(1)
    const reveal = (await post('/box/reveal', {
      connectionId: idFor(1), address: accounts[1].address, uid: voucher.uid,
    })).body
    await assert.rejects(
      () => walletOf(2).sendTransaction({ to: nft, data: encodeOpen(tokenId, reveal), chain: null }),
      /NOT_AUTHORIZED/,
    )
  }, { timeout: 60_000 })

  test('an unknown tier is refused before anything is rolled', async () => {
    requireLive()
    const r = await post('/box/voucher', {
      connectionId: idFor(1), address: accounts[1].address, tier: 'legendary',
    })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'bad-tier')
  })

  test('a fairness commitment is single-use', async () => {
    requireLive()
    const quote = await post('/box/quote', {})
    const id = quote.body.fairness.commit.commitId
    const first = await post('/box/voucher', {
      connectionId: idFor(1), address: accounts[1].address, tier: 'standard', commitId: id,
    })
    assert.equal(first.status, 200)
    const second = await post('/box/voucher', {
      connectionId: idFor(1), address: accounts[1].address, tier: 'standard', commitId: id,
    })
    assert.equal(second.status, 409)
    assert.equal(second.body.error, 'commit-spent')
  })

  test('voucher issuance is rate limited per wallet', async () => {
    requireLive()
    const limited = createBoxStore({
      databaseUrl: DATABASE_URL, signerPk: SIGNER_PK, contract: nft, chainId: CHAIN_ID,
      rateMax: 3, rateWindowS: 3600, maxOutstanding: 500,
      log: { log: () => {}, warn: () => {} },
    })
    try {
      // Account 3 is used for exactly this, so a re-run inside the hour still
      // sees a wallet that is already over its budget — which is the point.
      let refused = 0
      for (let i = 0; i < 5; i++) {
        try {
          await limited.issueVoucher({
            walletId: idFor(3), address: accounts[3].address.toLowerCase(), tier: 'standard', clientSeed: '',
          })
        } catch (err) {
          if (err.status === 429) refused++
          else throw err
        }
      }
      assert.ok(refused >= 2, `expected the limiter to bite, refused ${refused}/5`)
    } finally {
      await limited.close()
    }
  }, { timeout: 60_000 })

  test('the database refuses to delete a box row', async () => {
    requireLive()
    const quote = await post('/box/quote', {})
    const v = await post('/box/voucher', {
      connectionId: idFor(1), address: accounts[1].address, tier: 'standard',
      commitId: quote.body.fairness.commit.commitId,
    })
    await assert.rejects(
      () => store._q('DELETE FROM boxes WHERE uid = $1', [v.body.uid]),
      /never deleted/,
      'the salt must not be deletable by an ordinary DELETE',
    )
    const still = await store._q('SELECT salt FROM boxes WHERE uid = $1', [v.body.uid])
    assert.equal(still.rowCount, 1)
  })
})

/* ------------------------------------------------------------ the rolls ---*/

describe('the roll', () => {
  test('is deterministic and replayable', () => {
    const seed = '0x' + 'ab'.repeat(32)
    const a = replayRoll({
      serverSeed: seed, serverSeedHash: seedHash(seed), clientSeed: 'x', tier: 'prime',
      address: '0x' + '11'.repeat(20),
      // deliberately wrong attributes, so the replay must complain about them
      dexId: 1, level: 1, ivs: [0, 0, 0, 0, 0, 0], natureId: 0, shiny: false,
      caughtAt: 0, salt: '0x' + '00'.repeat(32), attrCommit: '0x' + '00'.repeat(32),
    })
    assert.equal(a.ok, false)
    assert.ok(a.problems.length >= 2)
    // The same inputs give the same creature every time.
    const rolled = a.rolled
    const again = replayRoll({
      serverSeed: seed, serverSeedHash: seedHash(seed), clientSeed: 'x', tier: 'prime',
      address: '0x' + '11'.repeat(20),
      ...rolled, caughtAt: 0, salt: '0x' + '00'.repeat(32),
      attrCommit: attrCommitment({ ...rolled, caughtAt: 0, salt: '0x' + '00'.repeat(32) }),
    })
    assert.deepEqual(again.problems, [])
  })

  test('a different client seed gives a different box', () => {
    const base = { serverSeed: '0x' + 'cd'.repeat(32), tier: 'apex', address: '0x' + '22'.repeat(20) }
    assert.notDeepEqual(
      rollBox({ ...base, clientSeed: 'a' }),
      rollBox({ ...base, clientSeed: 'b' }),
    )
  })

  test('every tier stays inside its own advertised bounds', () => {
    // 3,000 rolls per tier: enough that a broken floor or level range shows up
    // every time, fast enough to run on every commit.
    for (const [id, t] of Object.entries(TIERS)) {
      for (let i = 0; i < 3000; i++) {
        const r = rollBox({
          serverSeed: seedHash('0x' + i.toString(16).padStart(64, '0')),
          clientSeed: String(i), tier: id, address: '0x' + '33'.repeat(20),
        })
        assert.ok(r.level >= t.level[0] && r.level <= t.level[1], `${id} level ${r.level}`)
        assert.ok(r.ivs.every((iv) => iv >= t.ivFloor && iv <= 31), `${id} ivs ${r.ivs}`)
        assert.ok(r.natureId >= 0 && r.natureId < 25)
        assert.ok(r.dexId >= 1 && r.dexId <= 65535)
      }
    }
  })
})
