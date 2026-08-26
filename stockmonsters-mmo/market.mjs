/*
 * market.mjs — the order book for StockmonstersMarket.
 *
 * WHAT THIS SERVER IS
 * An index of signatures. A listing is one EIP-712 `Order` signed by the
 * seller's own wallet; the token never leaves that wallet and the market
 * contract performs the swap in a single transaction the BUYER pays for. This
 * process holds no custody, holds no key that can move an asset, and signs
 * nothing on a player's behalf. Delete the whole table and nobody loses an
 * NFT — they lose an index, and can re-sign for free. That is a deliberate
 * contrast with lootbox.mjs, where a lost row bricks a token forever, and it
 * is why this file can be much less precious about its rows than that one.
 *
 * THE ONE THING IT MUST GET RIGHT
 * An order that cannot fill must never appear in the book. A listing that
 * reverts at buy time costs a stranger real gas and reads, from the outside,
 * exactly like theft. So every order is checked against LIVE CHAIN STATE
 * before it is stored —
 *
 *     the signature recovers to the claimed seller
 *     the seller still owns the token
 *     the market contract is approved to move it
 *     the seal state and attribute commitment still match the signed ones
 *     the seller's epoch has not moved past it
 *     the currency is ETH or one the contract accepts
 *     the chain id and market address are ours
 *     price minus fee minus royalty still clears the seller's own floor
 *
 * — and re-checked lazily on every read, because a write-time check expires
 * the moment the seller sells the token somewhere else.
 *
 * AND THE WORST BUG IT COULD HAVE
 * A filled order left showing as open: every buyer after it pays gas to
 * revert. `syncFills()` watches OrderFilled / OrderCancelled / EpochIncremented
 * on a timer (the same shape as lootbox.mjs `syncMints`) and closes those rows
 * whether or not anybody is looking at the page.
 *
 * DELISTING IS NOT CANCELLATION
 * `POST /market/cancel` removes a row from this index. It does NOT invalidate
 * the signature: anyone who kept a copy can still fill it while the approval
 * is live. Only `cancelOrder()` or `incrementEpoch()` on chain can do that.
 * Every response that delists says so in words rather than letting the player
 * infer a safety that is not there.
 *
 * DEGRADATION
 * Copied from lootbox.mjs. No DATABASE_URL, no SM_MARKET_ADDRESS, no RPC —
 * the routes answer `{ configured: false }` with a reason and the game falls
 * back to the demo catalogue, which is honest because the UI then says DEMO
 * MODE. Nothing here can take the rest of the server down.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timingSafeEqual } from 'node:crypto'
import pg from 'pg'
import {
  createPublicClient, http as viemHttp, getAddress, hashTypedData,
  recoverTypedDataAddress, parseAbi,
} from 'viem'

import { connectionIdFor } from './auth.mjs'
import { ORDER_TYPE, MARKET_DOMAIN_NAME } from './tools/voucher-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const dex = JSON.parse(readFileSync(join(HERE, 'src/data/dex.json'), 'utf8'))

const ZERO = '0x0000000000000000000000000000000000000000'
const RETRY_AFTER_MS = 10_000

const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
const isBytes32 = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
const isWalletId = (v) => typeof v === 'string' && /^w:[0-9a-f]{32}$/.test(v)
const lower = (v) => String(v).toLowerCase()

export class MarketError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/* ============================================================ THE ORDER ====
 * The struct, the digest and the recovery. Everything in this section is pure
 * — no database, no RPC — so test/market.test.mjs can drive it directly, and
 * so the rules that decide whether a stranger's signature is worth storing are
 * readable in one place.
 */

/** Re-exported so nothing here re-derives a typed-data shape of its own. */
export { ORDER_TYPE, MARKET_DOMAIN_NAME }

const MAX_UINT256 = (1n << 256n) - 1n
const MAX_UINT64 = (1n << 64n) - 1n

function uint(v, max, field) {
  let n
  try {
    n = BigInt(typeof v === 'number' ? Math.trunc(v) : String(v ?? '').trim())
  } catch {
    throw new MarketError(400, 'bad-order', `${field} is not a number.`)
  }
  if (n < 0n || n > max) throw new MarketError(400, 'bad-order', `${field} is out of range.`)
  return n
}

function addr(v, field) {
  if (!isAddress(v)) throw new MarketError(400, 'bad-order', `${field} is not an address.`)
  return lower(v)
}

/**
 * Coerce whatever arrived over HTTP into the exact Order the contract hashes.
 *
 * Deliberately strict about SHAPE and silent about POLICY: this decides that
 * `price` is a uint256 and `taker` is an address, not that the price is
 * sensible or the deadline is near. Policy lives in `checkOrderFillable`,
 * where it can be read next to the reason each rule exists.
 */
export function normaliseOrder(raw) {
  if (!raw || typeof raw !== 'object') throw new MarketError(400, 'bad-order', 'No order in the request.')
  if (!isBytes32(raw.attrCommit)) throw new MarketError(400, 'bad-order', 'attrCommit is not 32 bytes.')
  return {
    seller: addr(raw.seller, 'seller'),
    tokenId: uint(raw.tokenId, MAX_UINT256, 'tokenId').toString(),
    price: uint(raw.price, MAX_UINT256, 'price').toString(),
    minProceeds: uint(raw.minProceeds ?? 0, MAX_UINT256, 'minProceeds').toString(),
    deadline: Number(uint(raw.deadline, MAX_UINT64, 'deadline')),
    epoch: Number(uint(raw.epoch ?? 0, MAX_UINT64, 'epoch')),
    salt: uint(raw.salt, MAX_UINT256, 'salt').toString(),
    requireSealed: Boolean(raw.requireSealed),
    attrCommit: lower(raw.attrCommit),
    taker: addr(raw.taker ?? ZERO, 'taker'),
    currency: addr(raw.currency ?? ZERO, 'currency'),
  }
}

/** The EIP-712 message viem wants, from the JSON shape everything else uses. */
function typedMessage(order) {
  return {
    seller: getAddress(order.seller),
    tokenId: BigInt(order.tokenId),
    price: BigInt(order.price),
    minProceeds: BigInt(order.minProceeds),
    deadline: Number(order.deadline),
    epoch: Number(order.epoch),
    salt: BigInt(order.salt),
    requireSealed: Boolean(order.requireSealed),
    attrCommit: order.attrCommit,
    taker: getAddress(order.taker),
    currency: getAddress(order.currency),
  }
}

const domainOf = (market, chainId) => ({
  name: MARKET_DOMAIN_NAME,
  chainId: Number(chainId),
  verifyingContract: getAddress(market),
})

/**
 * The digest `StockmonstersMarket.hashOrder()` computes, and the key the
 * contract stores `orderConsumed` under. It is also the listing id the game UI
 * uses, so one value identifies an order everywhere: in the book, on chain,
 * and in a support conversation.
 */
export function orderHash({ order, market, chainId }) {
  return hashTypedData({
    domain: domainOf(market, chainId),
    types: { Order: ORDER_TYPE },
    primaryType: 'Order',
    message: typedMessage(order),
  })
}

/** Who actually signed this order, whatever the request claimed. */
export async function recoverOrderSeller({ order, market, chainId, signature }) {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new MarketError(400, 'bad-signature', 'A signature is 65 bytes: r, s and v.')
  }
  try {
    return lower(await recoverTypedDataAddress({
      domain: domainOf(market, chainId),
      types: { Order: ORDER_TYPE },
      primaryType: 'Order',
      message: typedMessage(order),
      signature,
    }))
  } catch (err) {
    throw new MarketError(400, 'bad-signature', `That signature could not be read (${err.shortMessage ?? err.message}).`)
  }
}

/**
 * Everything the fillability check needs to ask the chain, as one small
 * interface. It exists so the rules below can be unit-tested against a stub
 * instead of a node: the interesting failures here are "we accepted an order
 * whose approval was revoked", and those are cheap to write against a fake and
 * expensive to reproduce against Sepolia.
 *
 * @typedef {object} ChainReader
 * @property {(tokenId: string) => Promise<string>} ownerOf
 * @property {(tokenId: string) => Promise<boolean>} opened
 * @property {(tokenId: string) => Promise<string>} attrCommit
 * @property {(owner: string, operator: string) => Promise<boolean>} isApprovedForAll
 * @property {(tokenId: string) => Promise<string>} getApproved
 * @property {(seller: string) => Promise<bigint>} epochOf
 * @property {(hash: string) => Promise<boolean>} orderConsumed
 * @property {(currency: string) => Promise<boolean>} acceptedCurrency
 * @property {() => Promise<bigint>} feeBps
 * @property {(tokenId: string, price: string) => Promise<[string, bigint]>} royaltyInfo
 */

/**
 * Decide whether an order would fill RIGHT NOW, and say precisely why not.
 *
 * The order of the checks is chosen so the cheapest and most likely refusals
 * come first: a mistyped chain id should not cost eight RPC round trips. Every
 * throw carries a message meant to be shown to the person who tried to list —
 * "we could not index that" with no reason is the kind of answer that makes a
 * player think the marketplace is broken when their approval simply lapsed.
 *
 * @param {object} p
 * @param {ChainReader} p.reader
 * @returns {Promise<{ hash: string, fee: string, royalty: string, proceeds: string }>}
 */
export async function checkOrderFillable({
  order, signature, market, chainId, reader, nowS = Math.floor(Date.now() / 1000),
  maxTtlS = 90 * 86_400, minTtlS = 60,
}) {
  if (BigInt(order.price) === 0n) {
    throw new MarketError(400, 'zero-price', 'A listing needs a price above zero.')
  }
  if (order.deadline <= nowS + minTtlS) {
    throw new MarketError(400, 'already-expired',
      'That order expires too soon to be worth listing. Sign one that lasts at least a minute.')
  }
  if (order.deadline > nowS + maxTtlS) {
    throw new MarketError(400, 'deadline-too-far',
      `Listings are capped at ${Math.round(maxTtlS / 86_400)} days. A signature with no practical end date is a `
      + 'standing approval nobody remembers giving.')
  }

  const signer = await recoverOrderSeller({ order, market, chainId, signature })
  if (signer !== order.seller) {
    throw new MarketError(403, 'wrong-signer',
      `That signature was made by ${signer}, not by the seller named in the order.`)
  }

  const hash = orderHash({ order, market, chainId })

  if (order.currency !== ZERO && !(await reader.acceptedCurrency(order.currency))) {
    throw new MarketError(400, 'currency-not-accepted',
      'The market contract does not accept that currency. Price it in ETH or in the game token.')
  }

  if (await reader.orderConsumed(hash)) {
    throw new MarketError(409, 'order-consumed',
      'That exact order has already been filled or cancelled on chain. Sign a new one — change the salt.')
  }

  const owner = lower(await reader.ownerOf(order.tokenId))
  if (owner !== order.seller) {
    throw new MarketError(409, 'not-the-owner',
      `Token #${order.tokenId} belongs to ${owner}, so that order could never fill.`)
  }

  const approvedAll = await reader.isApprovedForAll(order.seller, market)
  if (!approvedAll) {
    const single = lower(await reader.getApproved(order.tokenId))
    if (single !== lower(market)) {
      throw new MarketError(409, 'not-approved',
        'The market contract is not approved to move that token. Approve it and list again.')
    }
  }

  const epoch = BigInt(await reader.epochOf(order.seller))
  if (epoch !== BigInt(order.epoch)) {
    throw new MarketError(409, 'stale-epoch',
      `Your orders were mass-cancelled on chain (epoch ${epoch}); this one was signed for epoch ${order.epoch}.`)
  }

  // The seal is part of the price. A sealed box priced on its odds must not be
  // fillable once it has been opened and its contents are public — and the
  // contract enforces exactly this, so indexing an order that violates it just
  // guarantees a revert later.
  const opened = await reader.opened(order.tokenId)
  if (opened === Boolean(order.requireSealed)) {
    throw new MarketError(409, 'seal-mismatch',
      order.requireSealed
        ? 'That box has been opened, so an order priced as sealed can no longer fill.'
        : 'That token is still sealed; the order was signed for an opened one.')
  }
  const commit = lower(await reader.attrCommit(order.tokenId))
  if (commit !== order.attrCommit) {
    throw new MarketError(409, 'commit-mismatch',
      "The token's attribute commitment on chain does not match the one in the order.")
  }

  // The seller signed a floor. If a fee or royalty change since then would put
  // the payout under it, the fill reverts with PROCEEDS_TOO_LOW — better to
  // refuse the listing now and say which number moved.
  const price = BigInt(order.price)
  const feeBps = BigInt(await reader.feeBps())
  const fee = (price * feeBps) / 10_000n
  const [royaltyReceiver, royaltyRaw] = await reader.royaltyInfo(order.tokenId, order.price)
  const royalty = lower(royaltyReceiver) === ZERO ? 0n : BigInt(royaltyRaw)
  if (fee + royalty > price) {
    throw new MarketError(409, 'payout-overflow', 'Fee plus royalty exceeds the price.')
  }
  const proceeds = price - fee - royalty
  if (proceeds < BigInt(order.minProceeds)) {
    throw new MarketError(409, 'proceeds-too-low',
      `After the ${Number(feeBps) / 100}% fee and the royalty the seller would receive ${proceeds} wei, `
      + `below the ${order.minProceeds} wei floor signed into the order.`)
  }

  return { hash, fee: fee.toString(), royalty: royalty.toString(), proceeds: proceeds.toString() }
}

/* ============================================================== THE STORE ==*/

const MARKET_ABI = parseAbi([
  'event OrderFilled(bytes32 indexed orderHash, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price, uint256 fee, uint256 royalty)',
  'event OrderCancelled(bytes32 indexed orderHash, address indexed seller)',
  'event EpochIncremented(address indexed seller, uint64 epoch)',
  'function orderConsumed(bytes32) view returns (bool)',
  'function epochOf(address) view returns (uint64)',
  'function acceptedCurrency(address) view returns (bool)',
  'function feeBps() view returns (uint96)',
  'function feeRecipient() view returns (address)',
  'function collection() view returns (address)',
])
const FILLED_EVENT = MARKET_ABI.find((e) => e.type === 'event' && e.name === 'OrderFilled')
const CANCELLED_EVENT = MARKET_ABI.find((e) => e.type === 'event' && e.name === 'OrderCancelled')
const EPOCH_EVENT = MARKET_ABI.find((e) => e.type === 'event' && e.name === 'EpochIncremented')

const NFT_ABI = parseAbi([
  'function ownerOf(uint256) view returns (address)',
  'function opened(uint256) view returns (bool)',
  'function attrCommit(uint256) view returns (bytes32)',
  'function getApproved(uint256) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address, uint256)',
])

/**
 * @param {object} [opts]
 * @param {string|null} [opts.databaseUrl] defaults to DATABASE_URL
 * @param {string|null} [opts.market]      defaults to SM_MARKET_ADDRESS
 * @param {string|null} [opts.collection]  the NFT, defaults to BOX_NFT_ADDRESS
 * @param {string|null} [opts.rpcUrl]      defaults to MARKET_RPC_URL, then SM_RPC_URL
 * @param {number} [opts.chainId]          defaults to SM_CHAIN_ID
 * @param {bigint|number|string} [opts.fromBlock] MARKET_FROM_BLOCK, then BOX_FROM_BLOCK
 * @param {object} [opts.log]
 */
export function createMarketStore(opts = {}) {
  const log = opts.log ?? console
  const databaseUrl = 'databaseUrl' in opts ? opts.databaseUrl : process.env.DATABASE_URL
  const market = (('market' in opts ? opts.market : process.env.SM_MARKET_ADDRESS) || '') || null
  const collection = (('collection' in opts ? opts.collection : process.env.BOX_NFT_ADDRESS) || '') || null
  const rpcUrl = ('rpcUrl' in opts ? opts.rpcUrl : (process.env.MARKET_RPC_URL || process.env.SM_RPC_URL)) || null
  const chainId = Number(opts.chainId ?? process.env.SM_CHAIN_ID ?? 0)

  // The market's deployment block. Left at 0 every sync asks a public RPC for
  // the whole history of the chain and is refused — the same trap BOX_FROM_BLOCK
  // documents, so it falls back to that value rather than to zero.
  const fromBlock = BigInt(
    opts.fromBlock ?? process.env.MARKET_FROM_BLOCK ?? process.env.BOX_FROM_BLOCK ?? 0,
  )
  const logSpan = BigInt(opts.logSpan ?? process.env.MARKET_LOG_SPAN ?? 9000)
  const syncMs = Number(opts.syncMs ?? process.env.MARKET_SYNC_MS ?? 20_000)
  // How long a verified row is trusted before the read path re-checks it. Short
  // enough that a token sold on another marketplace disappears from this one
  // within a page refresh or two; long enough that browsing does not hammer the
  // RPC once per card.
  const recheckMs = Number(opts.recheckMs ?? process.env.MARKET_RECHECK_MS ?? 30_000)
  const recheckMax = Number(opts.recheckMax ?? process.env.MARKET_RECHECK_MAX ?? 24)
  const maxTtlS = Number(opts.maxTtlS ?? process.env.MARKET_MAX_TTL_S ?? 90 * 86_400)
  const maxPerSeller = Number(opts.maxPerSeller ?? process.env.MARKET_MAX_PER_SELLER ?? 100)

  const configured = !!(market && isAddress(market) && collection && isAddress(collection) && rpcUrl && chainId)
  const client = configured ? createPublicClient({ transport: viemHttp(rpcUrl) }) : null

  if (!configured) {
    log.warn?.(
      '[market] not configured (needs SM_MARKET_ADDRESS, BOX_NFT_ADDRESS, SM_RPC_URL and SM_CHAIN_ID) — '
      + '/market/listings answers { configured: false } and the game shows its demo catalogue.',
    )
  }

  let pool = null
  let downUntil = 0
  let warnedDown = false
  let timer = null
  const counters = {
    listed: 0, refused: 0, delisted: 0, filled: 0, cancelled: 0, expired: 0, stale: 0,
    reads: 0, dbErrors: 0, syncErrors: 0,
  }

  if (databaseUrl) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30_000,
      query_timeout: 5000,
    })
    pool.on('error', (err) => markDown(err))
  } else {
    log.warn?.('[market] no DATABASE_URL — orders have nowhere to live, so listing is refused')
  }

  function markDown(err) {
    downUntil = Date.now() + RETRY_AFTER_MS
    if (!warnedDown) {
      warnedDown = true
      log.warn?.(`[market] Postgres unavailable (${err?.message ?? err}) — the order book is paused`)
    }
  }
  function markUp() {
    if (warnedDown) {
      warnedDown = false
      log.log?.('[market] Postgres reachable again — the order book is live')
    }
    downUntil = 0
  }
  const usable = () => !!pool && Date.now() >= downUntil

  /**
   * Throws on failure, like lootbox.mjs and unlike profiles.mjs. A listing
   * write that silently does not land leaves a player believing their token is
   * for sale when no buyer can ever see it, which is worse than an error.
   */
  async function q(sql, params) {
    if (!usable()) throw new MarketError(503, 'market-unavailable', 'The order book is offline. Try again shortly.')
    try {
      const res = await pool.query(sql, params)
      markUp()
      return res
    } catch (err) {
      // Same reasoning as lootbox.mjs: a healthy database saying "no" is an
      // ANSWER, not an outage, and must not trip the breaker.
      const said = typeof err?.code === 'string' && /^(22|23|42|P0)/.test(err.code)
      if (!said) markDown(err)
      counters.dbErrors++
      throw err
    }
  }

  /* ------------------------------------------------------------- reading --*/

  const readNft = (functionName, args) =>
    client.readContract({ address: collection, abi: NFT_ABI, functionName, args })
  const readMarket = (functionName, args) =>
    client.readContract({ address: market, abi: MARKET_ABI, functionName, args })

  /**
   * A revert is an ANSWER; a dead RPC is not.
   *
   * `ownerOf` on a token that was never minted reverts with NOT_MINTED, and
   * the honest reading of that is "nobody owns it", which the checks below
   * turn into a plain "that order could never fill". Letting the raw error out
   * instead produced a 500 and the message "something went wrong", which tells
   * a seller nothing. But a transport failure must still be an error: quietly
   * treating an unreachable node as "no owner" would delist the whole book the
   * first time the RPC hiccupped.
   */
  const orRevert = (promise, fallback) => promise.catch((err) => {
    const revert = err?.name === 'ContractFunctionExecutionError'
      || err?.name === 'ContractFunctionRevertedError'
      || /revert/i.test(err?.shortMessage ?? err?.message ?? '')
    if (!revert) throw err
    return fallback
  })

  /** The live-chain half of the verification, bound to this deployment. */
  const reader = {
    ownerOf: (tokenId) => orRevert(readNft('ownerOf', [BigInt(tokenId)]), ZERO),
    opened: (tokenId) => readNft('opened', [BigInt(tokenId)]),
    attrCommit: (tokenId) => readNft('attrCommit', [BigInt(tokenId)]),
    getApproved: (tokenId) => readNft('getApproved', [BigInt(tokenId)]),
    isApprovedForAll: (owner, operator) =>
      readNft('isApprovedForAll', [getAddress(owner), getAddress(operator)]),
    royaltyInfo: (tokenId, price) => readNft('royaltyInfo', [BigInt(tokenId), BigInt(price)]),
    epochOf: (seller) => readMarket('epochOf', [getAddress(seller)]),
    orderConsumed: (hash) => readMarket('orderConsumed', [hash]),
    acceptedCurrency: (currency) => readMarket('acceptedCurrency', [getAddress(currency)]),
    feeBps: () => readMarket('feeBps'),
  }

  /* ------------------------------------------------------------ listing ---*/

  /**
   * Verify a signed order and put it in the book.
   *
   * The row is written only after the chain has agreed with every claim in it.
   * There is no "provisional" state on purpose: a listing that is visible but
   * unverified is precisely the thing this file exists to prevent.
   */
  async function listOrder({ walletId, address, order: raw, signature, chainId: claimedChain, market: claimedMarket }) {
    if (!configured) {
      throw new MarketError(503, 'no-market', 'This server has no marketplace contract configured.')
    }
    if (claimedChain != null && Number(claimedChain) !== chainId) {
      throw new MarketError(400, 'wrong-chain',
        `That order was signed for chain ${claimedChain}; this market lives on chain ${chainId}.`)
    }
    if (claimedMarket && lower(claimedMarket) !== lower(market)) {
      throw new MarketError(400, 'wrong-market',
        `That order names market ${claimedMarket}; this server indexes ${market}.`)
    }

    const order = normaliseOrder(raw)
    if (order.seller !== lower(address)) {
      throw new MarketError(403, 'not-your-order',
        'You can only list a token you are signing for. The order names a different seller.')
    }

    const outstanding = await q(
      `SELECT count(*)::int AS n FROM market_orders
        WHERE seller = $1 AND market = $2 AND status = 'open'`,
      [order.seller, lower(market)],
    )
    if (outstanding.rows[0].n >= maxPerSeller) {
      throw new MarketError(429, 'too-many-listings',
        `You already have ${outstanding.rows[0].n} live listings. Cancel some before adding more.`)
    }

    // Anything the chain refused to answer becomes a readable refusal rather
    // than a 500: "something went wrong" is the response that makes a seller
    // give up, and the reason is nearly always something they can act on.
    const verified = await checkOrderFillable({
      order, signature: lower(signature), market, chainId, reader, maxTtlS,
    }).catch((err) => {
      if (err instanceof MarketError) throw err
      log.warn?.(`[market] could not verify an order for #${order.tokenId}: ${err.shortMessage ?? err.message}`)
      throw new MarketError(503, 'cannot-verify',
        'The order could not be checked against the chain right now, so it was not listed. '
        + `Try again in a moment. (${err.shortMessage ?? err.message})`)
    })
    const { hash, fee, royalty, proceeds } = verified

    // A relisting at a new price supersedes the old row, but the OLD SIGNATURE
    // IS STILL LIVE on chain. Saying "superseded" rather than quietly dropping
    // it is the difference between a seller who knows to cancel and one who
    // gets filled at last week's price.
    const superseded = await q(
      `UPDATE market_orders
          SET status = 'delisted', closed_reason = $3, closed_at = now(), updated_at = now()
        WHERE market = $1 AND token_id = $2::numeric AND status = 'open'
        RETURNING order_hash`,
      [lower(market), order.tokenId, 'Superseded by a newer listing. The older signature is still valid on chain '
        + 'until you cancel it there.'],
    )

    await q(
      `INSERT INTO market_orders (
         order_hash, chain_id, market, collection,
         seller, token_id, price, min_proceeds, deadline, epoch, salt,
         require_sealed, attr_commit, taker, currency, signature,
         wallet_id, status, checked_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6::numeric, $7::numeric, $8::numeric, $9, $10, $11::numeric,
         $12, $13, $14, $15, $16,
         $17, 'open', now()
       )
       ON CONFLICT (order_hash) DO UPDATE
         SET status = 'open', closed_reason = NULL, closed_at = NULL,
             checked_at = now(), updated_at = now()`,
      [
        hash, chainId, lower(market), lower(collection),
        order.seller, order.tokenId, order.price, order.minProceeds, order.deadline, order.epoch, order.salt,
        order.requireSealed, order.attrCommit, order.taker, order.currency, lower(signature),
        isWalletId(walletId) ? walletId : null,
      ],
    )
    counters.listed++

    return {
      id: hash,
      orderHash: hash,
      chainId,
      market: getAddress(market),
      collection: getAddress(collection),
      order,
      signature: lower(signature),
      fee,
      royalty,
      proceeds,
      superseded: superseded.rows.map((r) => r.order_hash),
      note: 'Listed. Nothing has moved on chain and no gas was spent — the buyer pays for the one '
        + 'transaction that transfers the token.',
    }
  }

  /* ------------------------------------------------------------ reading ---*/

  /** Deadline expiry costs no RPC at all, so it is swept on every read. */
  async function expireDeadlines() {
    const res = await q(
      `UPDATE market_orders
          SET status = 'expired', closed_reason = 'The order deadline passed.',
              closed_at = now(), updated_at = now()
        WHERE market = $1 AND status = 'open' AND deadline < extract(epoch from now())`,
      [lower(market)],
    )
    counters.expired += res.rowCount
    return res.rowCount
  }

  /**
   * Re-check the oldest-verified open rows against the chain and close the
   * ones that would now revert.
   *
   * The write-time check is a snapshot; it says nothing about the token being
   * sold on a different marketplace an hour later. This is the answer to
   * "do not trust the write-time check forever", bounded so that browsing a
   * busy book does not turn into an RPC flood.
   */
  async function revalidate(limit = recheckMax) {
    if (!client) return 0
    const due = await q(
      `SELECT order_hash, seller, token_id, epoch, require_sealed, attr_commit
         FROM market_orders
        WHERE market = $1 AND status = 'open'
          AND checked_at < now() - ($2 || ' milliseconds')::interval
        ORDER BY checked_at ASC
        LIMIT $3`,
      [lower(market), String(recheckMs), limit],
    )
    let closed = 0
    for (const row of due.rows) {
      let reason = null
      try {
        const [consumed, owner, approvedAll, epoch, opened, commit] = await Promise.all([
          reader.orderConsumed(row.order_hash),
          reader.ownerOf(String(row.token_id)),
          reader.isApprovedForAll(row.seller, market),
          reader.epochOf(row.seller),
          reader.opened(String(row.token_id)),
          reader.attrCommit(String(row.token_id)),
        ])
        if (consumed) reason = 'consumed'
        else if (lower(owner) !== row.seller) reason = 'The seller no longer owns this token.'
        else if (!approvedAll && lower(await reader.getApproved(String(row.token_id))) !== lower(market)) {
          reason = 'The seller revoked the market contract\'s approval.'
        } else if (BigInt(epoch) !== BigInt(row.epoch)) {
          reason = 'The seller mass-cancelled their orders on chain.'
        } else if (opened === Boolean(row.require_sealed)) {
          reason = row.require_sealed
            ? 'The box was opened after it was listed, so a sealed-priced order can no longer fill.'
            : 'The token is sealed again, which the order was not signed for.'
        } else if (lower(commit) !== lower(row.attr_commit)) {
          reason = 'The token\'s attribute commitment changed.'
        }
      } catch (err) {
        // An RPC hiccup must not delist honest orders. Leave checked_at alone
        // so the row is retried on the next read rather than trusted for the
        // full window on the strength of a failed call.
        log.warn?.(`[market] revalidation skipped for ${row.order_hash}: ${err.shortMessage ?? err.message}`)
        continue
      }
      if (!reason) {
        await q('UPDATE market_orders SET checked_at = now() WHERE order_hash = $1', [row.order_hash])
        continue
      }
      // `orderConsumed` is one bit for filled OR cancelled. The event indexer
      // knows which; this path only knows the order is dead, so it says the
      // true thing rather than guessing at a buyer.
      const status = reason === 'consumed' ? 'cancelled' : 'stale'
      const text = reason === 'consumed'
        ? 'This order was filled or cancelled on chain.'
        : reason
      await q(
        `UPDATE market_orders SET status = $2, closed_reason = $3, closed_at = now(),
                                  checked_at = now(), updated_at = now()
          WHERE order_hash = $1 AND status = 'open'`,
        [row.order_hash, status, text],
      )
      counters.stale++
      closed++
    }
    return closed
  }

  /**
   * Turn a stored order into the `MarketItem` the game's marketplace window
   * renders, borrowing display metadata from the `boxes` table when this
   * server happens to have sold the box.
   *
   * A SEALED listing never carries its contents, even though this process
   * knows them: the hidden creature IS the product, and leaking it through a
   * listing card would be a worse leak than leaking it through the shop.
   */
  function toItem(row) {
    const sealed = row.require_sealed
    const species = !sealed && row.dex_id != null
      ? dex.find((d) => d.dexId === Number(row.dex_id))
      : null
    const base = {
      id: row.order_hash,
      tokenId: String(row.token_id),
      kind: sealed ? 'sealed' : 'opened',
      shiny: !sealed && !!row.shiny,
      priceWei: String(row.price),
      currency: row.currency === ZERO ? null : getAddress(row.currency),
      seller: getAddress(row.seller),
      attrCommit: row.attr_commit,
      deadline: Number(row.deadline),
      listedAt: new Date(row.created_at).getTime(),
      taker: row.taker === ZERO ? null : getAddress(row.taker),
    }
    if (sealed) {
      return {
        ...base,
        name: `SEALED BOX #${row.token_id}`,
        // The tier is about the ODDS, never the contents, so it is safe to
        // show — and it is the only thing that distinguishes one sealed
        // listing from another.
        tier: row.tier ?? 'standard',
        odds: row.tier === 'apex' ? '1 in 24' : row.tier === 'prime' ? '1 in 64' : '1 in 128',
      }
    }
    return {
      ...base,
      name: species?.name ?? `STOCKMONSTER #${row.token_id}`,
      ticker: species?.ticker ?? undefined,
      types: species?.types ?? [],
      stats: species?.stats ?? undefined,
      level: row.level == null ? undefined : Number(row.level),
      art: species?.sprite ?? undefined,
    }
  }

  const SELECT_LISTING = `
    SELECT o.order_hash, o.token_id, o.price, o.min_proceeds, o.deadline, o.epoch, o.salt,
           o.require_sealed, o.attr_commit, o.taker, o.currency, o.signature, o.seller,
           o.status, o.closed_reason, o.created_at,
           b.tier, b.status AS box_status, b.dex_id, b.level, b.shiny
      FROM market_orders o
      LEFT JOIN boxes b ON b.contract = o.collection AND b.token_id = o.token_id
  `

  /**
   * The book, newest first.
   *
   * Filtering splits between SQL and JS on purpose. Chain, market, status,
   * seller and sealed/opened are columns, so SQL does them and the LIMIT is
   * meaningful. Type and free text live in dex.json rather than in the
   * database, so they are applied here — over a capped window, because
   * filtering after a LIMIT would silently drop matches from page two.
   */
  async function listings(f = {}) {
    if (!configured) return { configured: false, listings: [], total: 0 }
    counters.reads++
    await expireDeadlines()
    await revalidate().catch((err) => log.warn?.(`[market] revalidation failed: ${err.message}`))

    const limit = Math.min(Math.max(Number(f.limit ?? 60), 1), 200)
    const offset = Math.max(Number(f.offset ?? 0), 0)
    const where = ['o.market = $1', "o.status = 'open'"]
    const params = [lower(market)]
    if (f.tab === 'sealed' || f.kind === 'sealed') where.push('o.require_sealed = true')
    if (f.tab === 'opened' || f.kind === 'opened') where.push('o.require_sealed = false')
    if (f.seller) {
      params.push(lower(f.seller))
      where.push(`o.seller = $${params.length}`)
    }

    const window = Math.min(offset + limit * 4, 500)
    const res = await q(
      `${SELECT_LISTING} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ${window}`,
      params,
    )
    let items = res.rows.map(toItem)

    if (f.shinyOnly) items = items.filter((i) => i.shiny)
    const types = Array.isArray(f.types) ? f.types.filter(Boolean) : []
    if (types.length) items = items.filter((i) => (i.types ?? []).some((t) => types.includes(t)))
    if (f.q) {
      const needle = String(f.q).toLowerCase()
      items = items.filter((i) =>
        `${i.name} ${i.ticker ?? ''} ${i.tokenId} ${(i.types ?? []).join(' ')}`.toLowerCase().includes(needle))
    }
    const weight = (i) => BigInt(i.priceWei ?? '0')
    if (f.sort === 'price-asc') items.sort((a, b) => (weight(a) < weight(b) ? -1 : weight(a) > weight(b) ? 1 : 0))
    else if (f.sort === 'price-desc') items.sort((a, b) => (weight(a) > weight(b) ? -1 : weight(a) < weight(b) ? 1 : 0))
    else if (f.sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name))

    return {
      configured: true,
      chainId,
      market: getAddress(market),
      collection: getAddress(collection),
      total: items.length,
      listings: items.slice(offset, offset + limit),
    }
  }

  /**
   * One order, WITH its signature — which is public by design: a signed ask is
   * meant to be fillable by anyone who can see it, and the buyer's wallet
   * needs the whole struct to build the calldata.
   */
  async function getOrder(id) {
    if (!configured) throw new MarketError(503, 'no-market', 'This server has no marketplace contract configured.')
    if (!isBytes32(id)) throw new MarketError(400, 'bad-id', 'A listing id is a 32-byte order hash.')
    const res = await q(`${SELECT_LISTING} WHERE o.order_hash = $1`, [lower(id)])
    const row = res.rows[0]
    if (!row) throw new MarketError(404, 'no-such-order', 'No such listing.')
    return {
      configured: true,
      chainId,
      market: getAddress(market),
      collection: getAddress(collection),
      status: row.status,
      closedReason: row.closed_reason,
      item: toItem(row),
      order: {
        seller: getAddress(row.seller),
        tokenId: String(row.token_id),
        price: String(row.price),
        minProceeds: String(row.min_proceeds),
        deadline: Number(row.deadline),
        epoch: Number(row.epoch),
        salt: String(row.salt),
        requireSealed: row.require_sealed,
        attrCommit: row.attr_commit,
        taker: getAddress(row.taker),
        currency: getAddress(row.currency),
      },
      signature: row.signature,
    }
  }

  /**
   * Remove one of your own listings from the index.
   *
   * This is NOT a cancellation and the response says so. The signature stays
   * valid on chain until `cancelOrder` (or `incrementEpoch`) is called from
   * the seller's own wallet, so the payload includes everything needed to make
   * that call and the client offers it.
   */
  async function delist({ walletId, address, id }) {
    if (!configured) throw new MarketError(503, 'no-market', 'This server has no marketplace contract configured.')
    if (!isBytes32(id)) throw new MarketError(400, 'bad-id', 'A listing id is a 32-byte order hash.')
    const found = await getOrder(id)
    if (lower(found.order.seller) !== lower(address)) {
      throw new MarketError(403, 'not-your-listing', 'That listing belongs to a different wallet.')
    }
    const res = await q(
      `UPDATE market_orders
          SET status = 'delisted', closed_reason = $2, closed_at = now(), updated_at = now()
        WHERE order_hash = $1 AND status = 'open'`,
      [lower(id), 'Delisted by the seller. Still fillable on chain until cancelled there.'],
    )
    if (res.rowCount) counters.delisted++
    if (isWalletId(walletId)) {
      await q('UPDATE market_orders SET wallet_id = COALESCE(wallet_id, $2) WHERE order_hash = $1',
        [lower(id), walletId])
    }
    return {
      id: lower(id),
      removed: res.rowCount > 0,
      status: 'delisted',
      // The single most important sentence in this file's HTTP surface.
      onChain: false,
      note: 'Removed from the marketplace listing. THIS IS NOT AN ON-CHAIN CANCELLATION: the signature you '
        + 'made is still valid, and anyone who kept a copy can still buy the token while the market contract '
        + 'is approved. To make it unfillable, send cancelOrder() from your own wallet.',
      cancelOnChain: {
        market: getAddress(market),
        order: found.order,
      },
    }
  }

  /* ------------------------------------------------------------ indexer ---*/

  async function cursor() {
    const res = await q(
      `INSERT INTO market_sync (chain_id, market, last_block) VALUES ($1, $2, $3::numeric)
       ON CONFLICT (chain_id, market) DO NOTHING`,
      [chainId, lower(market), fromBlock.toString()],
    )
    if (res.rowCount) return fromBlock
    const got = await q('SELECT last_block FROM market_sync WHERE chain_id = $1 AND market = $2',
      [chainId, lower(market)])
    const stored = BigInt(got.rows[0]?.last_block ?? 0)
    return stored > fromBlock ? stored : fromBlock
  }

  /**
   * Learn from the chain which orders are dead.
   *
   * A filled order left in the book is the single worst bug this system can
   * have: every buyer after it pays gas to revert, and there is no way for
   * them to tell that from a scam. So this runs on a timer rather than only
   * when someone opens the marketplace, and it re-scans a small overlap each
   * pass — a duplicate event is idempotent here, a skipped one is not.
   */
  async function syncFills({ maxChunks = 24 } = {}) {
    if (!configured || !usable()) return { scanned: 0, filled: 0, cancelled: 0 }
    let from
    try {
      from = await cursor()
    } catch (err) {
      counters.syncErrors++
      log.warn?.(`[market] could not read the sync cursor: ${err.message}`)
      return { scanned: 0, filled: 0, cancelled: 0 }
    }
    let head
    try {
      head = await client.getBlockNumber()
    } catch (err) {
      counters.syncErrors++
      log.warn?.(`[market] sync skipped (${err.shortMessage ?? err.message})`)
      return { scanned: 0, filled: 0, cancelled: 0 }
    }
    // A few blocks of overlap absorbs a reorg at the tip without needing any
    // reorg handling: re-applying a fill we already know about changes nothing.
    if (from > 8n) from -= 8n

    let filled = 0
    let cancelled = 0
    let scanned = 0
    for (let chunk = 0; chunk < maxChunks && from <= head; chunk++) {
      const to = from + logSpan > head ? head : from + logSpan
      let fills = []
      let cancels = []
      let epochs = []
      try {
        ;[fills, cancels, epochs] = await Promise.all([
          client.getLogs({ address: market, event: FILLED_EVENT, fromBlock: from, toBlock: to }),
          client.getLogs({ address: market, event: CANCELLED_EVENT, fromBlock: from, toBlock: to }),
          client.getLogs({ address: market, event: EPOCH_EVENT, fromBlock: from, toBlock: to }),
        ])
      } catch (err) {
        counters.syncErrors++
        log.warn?.(`[market] log scan ${from}-${to} failed (${err.shortMessage ?? err.message})`)
        break
      }
      for (const l of fills) {
        const res = await q(
          `UPDATE market_orders
              SET status = 'filled', closed_reason = 'Bought on chain.',
                  buyer = $2, fill_tx = $3, fill_block = $4::numeric,
                  closed_at = COALESCE(closed_at, now()), checked_at = now(), updated_at = now()
            WHERE order_hash = $1 AND status <> 'filled'`,
          [lower(l.args.orderHash), lower(l.args.buyer), l.transactionHash, String(l.blockNumber)],
        )
        filled += res.rowCount
      }
      for (const l of cancels) {
        const res = await q(
          `UPDATE market_orders
              SET status = 'cancelled', closed_reason = 'Cancelled on chain by the seller.',
                  closed_at = COALESCE(closed_at, now()), checked_at = now(), updated_at = now()
            WHERE order_hash = $1 AND status NOT IN ('filled','cancelled')`,
          [lower(l.args.orderHash)],
        )
        cancelled += res.rowCount
      }
      for (const l of epochs) {
        // A mass-cancel invalidates every order the seller signed for an
        // earlier epoch in one transaction. Missing this leaves a whole
        // wallet's worth of dead listings in the book.
        const res = await q(
          `UPDATE market_orders
              SET status = 'cancelled',
                  closed_reason = 'The seller mass-cancelled their orders on chain (epoch bump).',
                  closed_at = COALESCE(closed_at, now()), checked_at = now(), updated_at = now()
            WHERE market = $1 AND seller = $2 AND epoch < $3 AND status = 'open'`,
          [lower(market), lower(l.args.seller), Number(l.args.epoch)],
        )
        cancelled += res.rowCount
      }
      scanned += Number(to - from) + 1
      await q(
        `INSERT INTO market_sync (chain_id, market, last_block) VALUES ($1, $2, $3::numeric)
         ON CONFLICT (chain_id, market) DO UPDATE SET last_block = EXCLUDED.last_block, updated_at = now()`,
        [chainId, lower(market), to.toString()],
      )
      if (to === head) break
      from = to + 1n
    }
    counters.filled += filled
    counters.cancelled += cancelled
    return { scanned, filled, cancelled }
  }

  /** Run the indexer in the background for the life of the process. */
  function startIndexer() {
    if (!configured || !pool || timer) return false
    const tick = () => {
      syncFills().catch((err) => {
        counters.syncErrors++
        log.warn?.(`[market] fill sync failed: ${err.message}`)
      })
    }
    tick()
    timer = setInterval(tick, syncMs)
    timer.unref?.()
    return true
  }

  return {
    get enabled() { return configured && !!pool },
    get healthy() { return usable() },
    get chainId() { return chainId },
    get market() { return market },
    get collection() { return collection },
    info() {
      return {
        configured: configured && !!pool,
        chainId,
        market: market && isAddress(market) ? getAddress(market) : null,
        collection: collection && isAddress(collection) ? getAddress(collection) : null,
        reason: configured
          ? (pool ? null : 'No DATABASE_URL — the order book has nowhere to store signed orders.')
          : 'No marketplace contract is configured on this server.',
      }
    },
    stats: () => ({ ...counters, enabled: configured && !!pool, healthy: usable() }),
    listOrder,
    listings,
    getOrder,
    delist,
    revalidate,
    syncFills,
    startIndexer,
    _reader: reader,
    _q: q,
    async close() {
      if (timer) clearInterval(timer)
      timer = null
      if (pool) await pool.end().catch(() => {})
      pool = null
    },
  }
}

/* ============================================================= HTTP GLUE ===*/

const json = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

async function readJson(req, limit = 16_384) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new MarketError(413, 'too-large', 'Payload too large.')
  }
  return body ? JSON.parse(body) : {}
}

/**
 * The same proof of wallet ownership the box and token endpoints use: show an
 * address AND the opaque id only this server can derive from it. Reused rather
 * than reinvented — a second auth scheme is a second thing to get wrong.
 */
function authorise(address, connectionId) {
  if (!isAddress(address)) throw new MarketError(400, 'bad-address', 'Bad address.')
  if (!isWalletId(connectionId)) throw new MarketError(400, 'bad-connection', 'Bad connection id.')
  const expected = Buffer.from(connectionIdFor(address))
  const given = Buffer.from(connectionId)
  const ok = expected.length === given.length && timingSafeEqual(expected, given)
  if (!ok) throw new MarketError(403, 'not-your-wallet', 'That connection id does not belong to that wallet.')
  return connectionId
}

/**
 * Mount point. Returns true when it handled the request.
 *
 *   GET  /market                     what this server indexes, or why it does not
 *   GET  /market/listings?…          the book: tab, q, types, shinyOnly, sort, limit, offset, seller
 *   GET  /market/order?id=0x…        one order WITH its signature, for the buyer's calldata
 *   POST /market/list                { connectionId, address, chainId, market, order, signature }
 *   POST /market/cancel              { connectionId, address, id } — index only, never on chain
 */
export async function handleMarketRoutes(req, res, store) {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  if (path !== '/market' && !path.startsWith('/market/')) return false

  try {
    if (path === '/market' && req.method === 'GET') {
      json(res, 200, store.info())
      return true
    }

    if (path === '/market/listings' && req.method === 'GET') {
      const p = url.searchParams
      json(res, 200, await store.listings({
        tab: p.get('tab') ?? undefined,
        kind: p.get('kind') ?? undefined,
        q: p.get('q') ?? undefined,
        types: p.get('types') ? p.get('types').split(',').map((s) => s.trim()).filter(Boolean) : [],
        shinyOnly: p.get('shinyOnly') === '1' || p.get('shinyOnly') === 'true',
        sort: p.get('sort') ?? undefined,
        seller: p.get('seller') ?? undefined,
        limit: p.get('limit') ?? undefined,
        offset: p.get('offset') ?? undefined,
      }))
      return true
    }

    if (path === '/market/order' && req.method === 'GET') {
      json(res, 200, await store.getOrder(url.searchParams.get('id') ?? ''))
      return true
    }

    if (path === '/market/list' && req.method === 'POST') {
      const body = await readJson(req)
      const address = String(body.address ?? '')
      const walletId = authorise(address, body.connectionId)
      json(res, 200, await store.listOrder({
        walletId,
        address: lower(address),
        order: body.order,
        signature: String(body.signature ?? ''),
        chainId: body.chainId,
        market: body.market,
      }))
      return true
    }

    if (path === '/market/cancel' && req.method === 'POST') {
      const body = await readJson(req)
      const address = String(body.address ?? '')
      const walletId = authorise(address, body.connectionId)
      json(res, 200, await store.delist({ walletId, address: lower(address), id: String(body.id ?? '') }))
      return true
    }

    json(res, 404, { error: 'not-found' })
    return true
  } catch (err) {
    if (err instanceof MarketError) {
      json(res, err.status, { error: err.code, message: err.message })
    } else if (err instanceof SyntaxError) {
      json(res, 400, { error: 'bad-json', message: 'Body is not JSON.' })
    } else {
      console.error('[market]', err)
      json(res, 500, { error: 'server-error', message: 'Something went wrong in the order book.' })
    }
    return true
  }
}
