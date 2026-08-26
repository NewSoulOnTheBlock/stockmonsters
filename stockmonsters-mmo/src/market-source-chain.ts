/*
 * market-source-chain.ts — the real marketplace, behind the same seam the demo
 * catalogue sits behind.
 *
 * `demoMarketSource()` in marketplace.ts fabricates listings and settles
 * transactions with `setTimeout`. This is the version that does not: every
 * listing here is a signature a player made with their own wallet, every
 * purchase is a transaction that lands on chain, and `TxHandle.settled`
 * resolves from a receipt rather than a timer.
 *
 * ## THE SHAPE OF A SALE
 *
 * There is no escrow. The seller keeps the token and approves the market
 * contract; listing is a signature and costs nothing. The BUYER pays for the
 * single transaction that moves both sides. That is why `list()` is two wallet
 * prompts at most (an approval, once per collection, then a signature) and
 * `buy()` is one, or two when paying in the game token.
 *
 * ## WHY THERE IS NO viem IN HERE
 *
 * Shipping an ABI coder to every player for four function calls is not a trade
 * worth making, so the calldata is written out by hand — the same standing
 * decision box-shop.ts and duel-ui.ts already live under. The cost is that an
 * offset error does not revert cleanly; it decodes garbage and fails somewhere
 * else entirely. So the encoders below are checked against viem, byte for
 * byte, in market-source-chain.spec.ts, where it is free.
 *
 * ## WHAT IT REFUSES TO PRETEND
 *
 * Removing a listing is not a cancellation. The server can only drop a row
 * from its index; the signature stays fillable while the approval is live.
 * `cancel()` says that out loud and then offers the on-chain `cancelOrder`
 * that actually makes it untrue.
 */

import type { MarketSource, MarketItem, MarketFilters, TxHandle, TxStatus, ItemKind } from './marketplace'
import { word, bytesTail } from './wallet-ui'
import { ensureChain, chainErrorMessage } from './chain-guard'

/* ============================================================== CALLDATA ===*/

/**
 * Pinned selectors, from `toFunctionSelector` against the deployed signatures
 * rather than from memory. market-source-chain.spec.ts asserts each one, so a
 * signature change fails the suite instead of a player's wallet.
 */
export const SELECTORS = {
  // fillOrder((address,uint256,uint256,uint256,uint64,uint64,uint256,bool,bytes32,address,address),bytes)
  fillOrder: '0x3b2dfbce',
  // cancelOrder((address,uint256,uint256,uint256,uint64,uint64,uint256,bool,bytes32,address,address))
  cancelOrder: '0x65373f4e',
  // setApprovalForAll(address,bool) — the ERC-721 standard selector
  setApprovalForAll: '0xa22cb465',
  // isApprovedForAll(address,address)
  isApprovedForAll: '0xe985e9c5',
  // opened(uint256)
  opened: '0xf1ea5cd3',
  // attrCommit(uint256)
  attrCommit: '0xc0723e46',
  // epochOf(address)
  epochOf: '0x582805d9',
  // feeBps()
  feeBps: '0x24a9d853',
  // royaltyInfo(uint256,uint256)
  royaltyInfo: '0x2a55205a',
  // allowance(address,address) — ERC-20, for a token-priced fill
  allowance: '0xdd62ed3e',
  // approve(address,uint256)
  approve: '0x095ea7b3',
} as const

/** The signed order, exactly as StockmonstersMarket declares it. */
export interface ChainOrder {
  seller: string
  tokenId: string
  price: string
  minProceeds: string
  deadline: number
  epoch: number
  salt: string
  requireSealed: boolean
  attrCommit: string
  taker: string
  currency: string
}

/**
 * The eleven words of a `Order`. Every member is a value type, so the struct
 * is STATIC and encodes inline — no offset, no length. Getting that wrong is
 * the classic hand-encoding bug, which is why it is one function used by both
 * `fillOrder` and `cancelOrder`.
 */
function orderWords(o: ChainOrder): string {
  return (
    word(o.seller)
    + word(BigInt(o.tokenId))
    + word(BigInt(o.price))
    + word(BigInt(o.minProceeds))
    + word(BigInt(o.deadline))
    + word(BigInt(o.epoch))
    + word(BigInt(o.salt))
    + word(o.requireSealed ? 1 : 0)
    + word(o.attrCommit)
    + word(o.taker)
    + word(o.currency)
  )
}

/** `fillOrder(Order,bytes) payable` — 11 struct words, then one offset word. */
export function encodeFillOrder(o: ChainOrder, signature: string): string {
  return SELECTORS.fillOrder + orderWords(o) + word(12 * 32) + bytesTail(signature)
}

/** `cancelOrder(Order)` — entirely static, so there is no tail at all. */
export function encodeCancelOrder(o: ChainOrder): string {
  return SELECTORS.cancelOrder + orderWords(o)
}

/** `setApprovalForAll(address,bool)` */
export function encodeSetApprovalForAll(operator: string, approved: boolean): string {
  return SELECTORS.setApprovalForAll + word(operator) + word(approved ? 1 : 0)
}

/** `isApprovedForAll(address,address)` */
export function encodeIsApprovedForAll(owner: string, operator: string): string {
  return SELECTORS.isApprovedForAll + word(owner) + word(operator)
}

/** `opened(uint256)` / `attrCommit(uint256)` — one uint256 argument each. */
export function encodeTokenQuery(selector: string, tokenId: string): string {
  return selector + word(BigInt(tokenId))
}

/** `royaltyInfo(uint256,uint256)` */
export function encodeRoyaltyInfo(tokenId: string, salePrice: string): string {
  return SELECTORS.royaltyInfo + word(BigInt(tokenId)) + word(BigInt(salePrice))
}

/* ================================================================ TYPES ===*/

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<any> }

export interface ChainSourceOpts {
  /** Where the market contract lives, from `/token`.contracts.market. */
  market: string
  /** The one collection this market trades, from `/token`.contracts.nft. */
  collection: string
  chainId: number
  /** Prefix for the /market/* calls. '' means same-origin, which is the norm. */
  baseUrl?: string
  /**
   * Narrate a step before the wallet prompt for it appears. An unexplained
   * signature request with a token id on it is indistinguishable from a scam,
   * so every prompt this file opens is announced first.
   */
  note?: (text: string, tone?: 'info' | 'warn') => void
  /** Test seams. Production leaves all three alone. */
  wallet?: () => { address?: string; connectionId?: string } | null
  ethereum?: () => Eip1193 | null
  fetch?: typeof fetch
}

const ZERO = '0x0000000000000000000000000000000000000000'
/** How long a listing stays signable-for. The server caps this too. */
const LISTING_TTL_S = 30 * 86_400

const EIP712_ORDER = [
  { name: 'seller', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'price', type: 'uint256' },
  { name: 'minProceeds', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
  { name: 'epoch', type: 'uint64' },
  { name: 'salt', type: 'uint256' },
  { name: 'requireSealed', type: 'bool' },
  { name: 'attrCommit', type: 'bytes32' },
  { name: 'taker', type: 'address' },
  // Signed, so a buyer cannot substitute the asset a price is denominated in.
  { name: 'currency', type: 'address' },
]

const EIP712_DOMAIN = [
  { name: 'name', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
]

/* ================================================================ SOURCE ===*/

/** 256 bits of browser CSPRNG. Two relistings must not collide into one hash. */
function randomSalt(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n.toString()
}

const txId = () => `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function createChainMarketSource(opts: ChainSourceOpts): MarketSource {
  const base = opts.baseUrl ?? ''
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const note = opts.note ?? (() => {})
  const wallet = opts.wallet ?? (() => {
    try { return JSON.parse(localStorage.getItem('sm-wallet') ?? 'null') } catch { return null }
  })
  const ethereum = opts.ethereum ?? (() => (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null)

  const market = opts.market
  const collection = opts.collection

  async function api(path: string, init?: RequestInit): Promise<any> {
    const res = await doFetch(`${base}${path}`, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      // The server refuses with a reason on purpose (see market.mjs). Losing it
      // here and showing "request failed" would waste exactly the information
      // that tells a seller their approval lapsed.
      throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`)
    }
    return body
  }

  function need(): { eth: Eip1193; address: string; connectionId: string } {
    const eth = ethereum()
    const w = wallet()
    if (!eth) throw new Error('No wallet is connected in this browser.')
    if (!w?.address || !w?.connectionId) throw new Error('Sign in with your wallet before trading.')
    return { eth, address: w.address, connectionId: w.connectionId }
  }

  const call = async (eth: Eip1193, to: string, data: string): Promise<string> =>
    (await eth.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) || '0x'

  /**
   * Watch a transaction to its receipt. This is the whole difference between
   * this file and the demo: `settled` means the chain agreed, not that two
   * seconds went by.
   */
  async function waitForReceipt(eth: Eip1193, hash: string, timeoutMs = 300_000): Promise<TxStatus> {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      try {
        const receipt = await eth.request({ method: 'eth_getTransactionReceipt', params: [hash] })
        if (receipt) return BigInt(receipt.status ?? '0x0') === 1n ? 'confirmed' : 'failed'
      } catch { /* a dropped RPC call is not a dropped transaction */ }
      await new Promise((r) => setTimeout(r, 3000))
    }
    // Not 'failed': an unmined transaction may still land, and telling a player
    // their purchase failed when it is merely slow is the worse lie.
    return 'pending'
  }

  /**
   * The protocol fee and the creator royalty, read off the two contracts that
   * own them. Both are settable by their owners, so the sell form asks at the
   * moment of listing rather than printing a percentage somebody typed into
   * the UI once.
   */
  async function readFees(eth: Eip1193, tokenId: string, priceWei: string) {
    const [feeRaw, royaltyRaw] = await Promise.all([
      call(eth, market, SELECTORS.feeBps),
      call(eth, collection, encodeRoyaltyInfo(tokenId, priceWei)),
    ])
    const price = BigInt(priceWei)
    const fee = (price * BigInt(feeRaw || '0x0')) / 10_000n
    const body = royaltyRaw.replace(/^0x/, '')
    // (address, uint256): the receiver is right-aligned in the first word, the
    // amount fills the second. A zero receiver means no royalty is owed, and
    // the contract zeroes the amount too rather than paying address(0).
    const receiverIsSet = body.length >= 128 && BigInt('0x' + body.slice(0, 64)) !== 0n
    const royalty = receiverIsSet ? BigInt('0x' + body.slice(64, 128)) : 0n
    return {
      feeWei: fee.toString(),
      royaltyWei: royalty.toString(),
      proceedsWei: (price - fee - royalty).toString(),
    }
  }

  /* ------------------------------------------------------------- reading --*/

  function queryFor(f: MarketFilters): string {
    const p = new URLSearchParams()
    if (f.tab && f.tab !== 'all' && f.tab !== 'mine') p.set('tab', f.tab)
    if (f.kinds?.length === 1) p.set('kind', f.kinds[0])
    if (f.q) p.set('q', f.q)
    if (f.types?.length) p.set('types', f.types.join(','))
    if (f.shinyOnly) p.set('shinyOnly', '1')
    if (f.sort) p.set('sort', f.sort)
    p.set('limit', '120')
    return p.toString()
  }

  async function listItems(f: MarketFilters): Promise<MarketItem[]> {
    if (f.tab === 'mine') return myItems()
    const body = await api(`/market/listings?${queryFor(f)}`)
    const me = wallet()?.address?.toLowerCase()
    return (body.listings ?? []).map((i: MarketItem) => ({
      ...i,
      mine: !!me && i.seller.toLowerCase() === me,
    }))
  }

  async function getItem(id: string): Promise<MarketItem | null> {
    try {
      const body = await api(`/market/order?id=${encodeURIComponent(id)}`)
      return body.item ?? null
    } catch {
      return null
    }
  }

  /**
   * What the player owns, listed or not.
   *
   * `/box/mine` is the authority on which tokens are theirs — it learns token
   * ids from the mint indexer rather than from the client — and the book says
   * which of them are on sale. Merging the two here keeps MY LISTINGS honest
   * about both halves: a token with no listing shows SELL, one with a live
   * order shows CANCEL.
   *
   * KNOWN GAP. `/box/mine` is keyed by the wallet that BOUGHT the box, so a
   * token acquired on this marketplace does not appear there for its new
   * owner: the collection has no `tokenOfOwnerByIndex`, and nothing yet
   * indexes Transfer events by owner, so there is no second source to merge
   * in. A resold token is therefore invisible in MY LISTINGS until an owner
   * index exists. What the loop below DOES cover is the half that would
   * otherwise strand a player: any live order of theirs is shown whether or
   * not `/box/mine` knows the token, so a listing can always be cancelled.
   */
  async function myItems(): Promise<MarketItem[]> {
    const w = wallet()
    if (!w?.address || !w?.connectionId) return []
    const [mine, listed] = await Promise.all([
      api(`/box/mine?connectionId=${w.connectionId}&address=${w.address}`).catch(() => ({ boxes: [] })),
      api(`/market/listings?seller=${w.address}&limit=200`).catch(() => ({ listings: [] })),
    ])
    const byToken = new Map<string, MarketItem>()
    for (const l of listed.listings ?? []) byToken.set(String(l.tokenId), l)

    const items: MarketItem[] = []
    const seen = new Set<string>()
    for (const b of mine.boxes ?? []) {
      if (!b.tokenId) continue // never minted, so there is nothing to sell
      seen.add(String(b.tokenId))
      const live = byToken.get(String(b.tokenId))
      const opened = b.status === 'opened'
      const kind: ItemKind = opened ? 'opened' : 'sealed'
      items.push({
        // A listed token keeps the ORDER HASH as its id, so CANCEL acts on the
        // order rather than on the token.
        id: live?.id ?? `own-${b.tokenId}`,
        tokenId: String(b.tokenId),
        kind,
        name: opened ? (b.contents?.name ?? `STOCKMONSTER #${b.tokenId}`) : `SEALED BOX #${b.tokenId}`,
        ticker: opened ? (b.contents?.ticker ?? undefined) : undefined,
        types: opened ? (b.contents?.types ?? []) : undefined,
        level: opened ? b.contents?.level : undefined,
        shiny: opened ? !!b.contents?.shiny : false,
        art: opened ? (b.contents?.sprite ?? undefined) : undefined,
        tier: opened ? undefined : b.tier,
        attrCommit: b.attrCommit,
        seller: w.address!,
        priceWei: live?.priceWei,
        listedAt: live ? live.listedAt : new Date(b.createdAt ?? Date.now()).getTime(),
        mine: true,
        listed: !!live,
      })
    }
    // A live order on a token `/box/mine` cannot see still has to be
    // cancellable. Leaving it out would hide the seller's own listing from the
    // only screen that can take it down.
    for (const l of listed.listings ?? []) {
      if (seen.has(String(l.tokenId))) continue
      items.push({ ...l, mine: true, listed: true })
    }
    return items.sort((a, b) => b.listedAt - a.listedAt)
  }

  /* ---------------------------------------------------------------- buy ---*/

  /**
   * Fill somebody's ask.
   *
   * One transaction when the price is in ETH, two when it is in the game
   * token — and the ERC-20 approval is checked before it is asked for, because
   * a blind approve on every purchase trains players to click through exactly
   * the prompt that drains a wallet.
   */
  async function buy(id: string): Promise<TxHandle> {
    const { eth, address } = need()
    const found = await api(`/market/order?id=${encodeURIComponent(id)}`)
    if (found.status !== 'open') {
      throw new Error(found.closedReason ?? 'That listing is no longer live.')
    }
    const order: ChainOrder = found.order
    const signature: string = found.signature
    const payingInToken = order.currency.toLowerCase() !== ZERO

    await ensureChain(eth)

    if (payingInToken) {
      const allowance = BigInt(
        (await call(eth, order.currency,
          SELECTORS.allowance + word(address) + word(market))) || '0x0',
      )
      if (allowance < BigInt(order.price)) {
        note('Step 1 of 2 — allow the marketplace to take the purchase price from your token balance. '
          + 'Nothing moves until you confirm the purchase itself.')
        const approveHash = await eth.request({
          method: 'eth_sendTransaction',
          params: [{
            from: address,
            to: order.currency,
            data: SELECTORS.approve + word(market) + word(BigInt(order.price)),
          }],
        })
        const ok = await waitForReceipt(eth, approveHash)
        if (ok !== 'confirmed') throw new Error('The token approval did not land, so the purchase was not sent.')
      }
    }

    note(payingInToken
      ? 'Step 2 of 2 — buy the token. This is the transaction that transfers it to you.'
      : 'One transaction — it pays the seller and transfers the token in the same call.')

    const hash: string = await eth.request({
      method: 'eth_sendTransaction',
      params: [{
        from: address,
        to: market,
        data: encodeFillOrder(order, signature),
        // Paying in ETH means msg.value must equal the price EXACTLY: the
        // contract gives no change and refuses stray ETH on a token order.
        ...(payingInToken ? {} : { value: '0x' + BigInt(order.price).toString(16) }),
      }],
    })

    return {
      id: txId(),
      kind: 'buy',
      label: `BUY ${found.item?.name ?? `#${order.tokenId}`}`,
      status: 'pending',
      hash,
      settled: waitForReceipt(eth, hash),
    }
  }

  /* --------------------------------------------------------------- list ---*/

  /**
   * Put one of your tokens up for sale.
   *
   * Two prompts at most, both announced before they appear: an approval
   * transaction the first time (the market cannot move a token it was never
   * allowed to) and then the signature that IS the listing. The approval must
   * be mined before the order is posted — the server verifies it against live
   * chain state and would otherwise refuse the listing it just told the player
   * to make.
   */
  async function list(tokenId: string, priceWei: string, currency?: string): Promise<TxHandle> {
    const { eth, address, connectionId } = need()
    const asset = (currency ?? ZERO).toLowerCase()
    await ensureChain(eth)

    let approvalHash: string | undefined
    const approved = BigInt(
      (await call(eth, collection, encodeIsApprovedForAll(address, market))) || '0x0',
    ) === 1n
    if (!approved) {
      note('Step 1 of 2 — allow the marketplace contract to transfer your Stockmonsters when one sells. '
        + 'This is a one-off transaction for the whole collection; nothing is listed or moved by it.')
      approvalHash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: collection, data: encodeSetApprovalForAll(market, true) }],
      })
      const ok = await waitForReceipt(eth, approvalHash!)
      if (ok !== 'confirmed') {
        throw new Error('The approval did not land, so nothing was listed. Try again once it confirms.')
      }
    }

    // The seal state and the commitment are read off the chain rather than
    // taken from the UI: they are part of the signed order, and the contract
    // checks them against live state at fill time. A stale guess here produces
    // an order that can never fill.
    const [openedRaw, commitRaw, epochRaw, split] = await Promise.all([
      call(eth, collection, encodeTokenQuery(SELECTORS.opened, tokenId)),
      call(eth, collection, encodeTokenQuery(SELECTORS.attrCommit, tokenId)),
      call(eth, market, SELECTORS.epochOf + word(address)),
      readFees(eth, tokenId, priceWei),
    ])
    const isOpen = BigInt(openedRaw || '0x0') === 1n
    const attrCommit = '0x' + (commitRaw.replace(/^0x/, '').padStart(64, '0')).slice(-64)
    const epoch = Number(BigInt(epochRaw || '0x0'))

    // `minProceeds` is the seller's floor AFTER fee and royalty, and signing it
    // at exactly today's number is the point: if the market owner raises the
    // fee or the royalty afterwards, this order stops filling instead of
    // quietly paying the seller less than the UI promised them.
    const order: ChainOrder = {
      seller: address,
      tokenId,
      price: BigInt(priceWei).toString(),
      minProceeds: split.proceedsWei,
      deadline: Math.floor(Date.now() / 1000) + LISTING_TTL_S,
      epoch,
      salt: randomSalt(),
      requireSealed: !isOpen,
      attrCommit,
      taker: ZERO,
      currency: asset,
    }

    note(`Step ${approved ? 1 : 2} of ${approved ? 1 : 2} — sign the listing. This is a signature, not a `
      + 'transaction: it costs no gas, and nothing moves until somebody buys.')

    const typedData = {
      types: { EIP712Domain: EIP712_DOMAIN, Order: EIP712_ORDER },
      primaryType: 'Order',
      domain: { name: 'StockmonstersMarket', chainId: opts.chainId, verifyingContract: market },
      message: {
        ...order,
        // Every uint goes over the wire as a decimal string: a uint256 does not
        // survive JSON.stringify as a number.
        tokenId: order.tokenId,
        price: order.price,
        minProceeds: order.minProceeds,
        deadline: String(order.deadline),
        epoch: String(order.epoch),
        salt: order.salt,
      },
    }
    const signature: string = await eth.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typedData)],
    })

    const posted = api('/market/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId, address, chainId: opts.chainId, market, order, signature,
      }),
    })

    return {
      id: txId(),
      kind: 'list',
      label: `LIST #${tokenId}`,
      status: 'pending',
      hash: approvalHash,
      settled: posted.then(
        (r) => { note(r.note ?? 'Listed.'); return 'confirmed' as TxStatus },
        (err) => { note(`Not listed: ${err.message}`, 'warn'); return 'failed' as TxStatus },
      ),
    }
  }

  /* ------------------------------------------------------------- cancel ---*/

  /**
   * Take a listing down.
   *
   * The server can only drop the row. Everything after that exists because the
   * signature outlives the index: the player is told plainly, and then offered
   * the transaction that actually makes the order unfillable. Declining the
   * wallet prompt is a valid choice — it just leaves the order live, and the
   * note says so rather than pretending otherwise.
   */
  async function cancel(id: string): Promise<TxHandle> {
    const { eth, address, connectionId } = need()
    const removed = await api('/market/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, address, id }),
    })
    note(removed.note, 'warn')

    const order: ChainOrder | undefined = removed.cancelOnChain?.order
    if (!order) {
      return {
        id: txId(), kind: 'cancel', label: `DELIST ${id.slice(0, 10)}`,
        status: 'pending', settled: Promise.resolve('cancelled' as TxStatus),
      }
    }

    let hash: string | undefined
    try {
      await ensureChain(eth)
      note('One transaction makes that signature permanently unfillable. Skip it and the listing is only '
        + 'hidden — anyone holding a copy of the signature can still buy the token.')
      hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: market, data: encodeCancelOrder(order) }],
      })
    } catch (err) {
      note(`Hidden from the marketplace, but NOT cancelled on chain: ${chainErrorMessage(err)}`, 'warn')
      return {
        id: txId(), kind: 'cancel', label: `DELIST #${order.tokenId}`,
        status: 'pending', settled: Promise.resolve('cancelled' as TxStatus),
      }
    }

    return {
      id: txId(),
      kind: 'cancel',
      label: `CANCEL #${order.tokenId}`,
      status: 'pending',
      hash,
      settled: waitForReceipt(eth, hash!).then((s) => (s === 'confirmed' ? 'cancelled' : s)),
    }
  }

  return {
    listItems,
    getItem,
    myItems,
    buy,
    list,
    cancel,
    account: () => wallet()?.address,
    async fees(tokenId, priceWei) {
      const eth = ethereum()
      if (!eth) throw new Error('No wallet is connected in this browser.')
      return readFees(eth, tokenId, priceWei)
    },
  }
}

/**
 * Build the chain source if this server actually has a marketplace, or return
 * null so the caller can keep the demo catalogue — and keep saying DEMO MODE,
 * which is the only honest thing to show when the listings are invented.
 */
export async function chainMarketSourceIfAvailable(
  opts: { baseUrl?: string; note?: ChainSourceOpts['note'] } = {},
): Promise<MarketSource | null> {
  const base = opts.baseUrl ?? ''
  try {
    const [token, market] = await Promise.all([
      fetch(`${base}/token`).then((r) => r.json()),
      fetch(`${base}/market`).then((r) => r.json()),
    ])
    if (!market?.configured || !market.market || !market.collection) return null
    const chainId = Number(market.chainId ?? token?.chainId ?? 0)
    if (!chainId) return null
    return createChainMarketSource({
      market: market.market,
      collection: market.collection,
      chainId,
      baseUrl: base,
      note: opts.note,
    })
  } catch {
    return null
  }
}
