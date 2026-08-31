/*
 * price-oracle.mjs — what one game token is worth, read off the live market.
 *
 * THE PROBLEM THIS FILE EXISTS TO FIX
 * Every price in the game is denominated in DOLLARS: a quest is worth $1-2,
 * the board $7, a day's earnings are capped at $20, a box is anchored to an
 * ether price. The dollar is converted to tokens at the last moment, by
 * dividing by "what is one token worth". Until now that divisor was a fixed
 * environment variable, SM_TOKEN_USD=0.0002, written from an ASSUMED $200k
 * market cap over a billion supply.
 *
 * The token now launches on the pons launchpad, which mints the whole supply
 * to a bonding curve and lets the curve open the price. Nobody sets it. A
 * measured pons launch opens two orders of magnitude away from that $200k
 * assumption — and the failure is silent: the game keeps paying "5,000 tokens
 * for a $1 quest" and those tokens are worth a fraction of a dollar. Players
 * are underpaid and nothing errors.
 *
 * So the price is READ, not written. This module is the single place that
 * reads it. src/modules/main/pricing.ts (quests, the daily cap) and
 * lootbox.mjs (box prices) both consult it and neither reads the chain
 * itself — they reach it through `globalThis.__smPrices`, the same bridge
 * server.mjs already uses for profiles, boxes, tokens and the market, because
 * src/modules/** is bundled into the BROWSER and must not import viem-over-RPC
 * or anything Node-only.
 *
 * WHERE THE PRICE COMES FROM
 *
 *   pons factory.getLaunchedToken(token) -> the launch record
 *      |
 *      +-- graduated: a Uniswap v4 pool. The PoolKey is (currencies sorted
 *      |   ascending, fee, tickSpacing, the pons Meme hook); its id is
 *      |   keccak256(abi.encode(key)); StateView.getSlot0(id) gives
 *      |   sqrtPriceX96 and the price follows.
 *      |
 *      +-- not graduated: the bonding curve. curve.getReserves() gives
 *          (quoteReserve, tokenReserve) and their ratio is the spot price.
 *
 * Either way the answer is a price in the PAIR asset — native ETH — which is
 * then multiplied by an ETH/USD rate fetched from a public HTTP API.
 *
 * WHAT IS VERIFIED AND WHAT IS NOT
 * Every contract call shape here was run against the live chain before it was
 * written down (tools/e2e-pons-price.mjs re-runs it). The one thing that
 * cannot be verified yet is OUR token: it does not exist. The mechanism is
 * proven against real graduated pons launches instead.
 */

import { createPublicClient, http, defineChain, keccak256, encodeAbiParameters } from 'viem'

/* ============================================================ the chain ==
 * Verified against the live chain on 2026-09-01: chain id 0x1237 = 4663, and
 * every one of these addresses has code.
 */
export const PONS = {
    chainId: 4663,
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    /** Holds the launch record for every pons token. */
    factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
    /** v4 keeps all pool state in one singleton; StateView is the read helper. */
    stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
    poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
    quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    /** Every graduated pons pool carries this hook, and it is part of the id. */
    hook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
}

/** `TokenLaunched(address indexed token, address indexed curve, address indexed deployer, ...)` — topic0 read off real logs. */
export const TOKEN_LAUNCHED_TOPIC = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607'

const ZERO = '0x0000000000000000000000000000000000000000'

/**
 * The launch record. Fifteen value-typed fields, so the struct is STATIC and
 * decodes inline — checked by querying three real tokens and confirming the
 * returned `token` field equals the address asked for.
 */
export const LAUNCHED_TOKEN_ABI = [{
    type: 'function', name: 'getLaunchedToken', stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{
        type: 'tuple', components: [
            { name: 'token', type: 'address' },
            { name: 'curve', type: 'address' },
            { name: 'deployer', type: 'address' },
            { name: 'creatorFeeRecipient', type: 'address' },
            { name: 'pairToken', type: 'address' },
            { name: 'graduationThreshold', type: 'uint256' },
            { name: 'poolFee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'creatorTaxBps', type: 'uint16' },
            { name: 'buybackEnabled', type: 'bool' },
            { name: 'phase', type: 'uint8' },
            { name: 'sweptQuote', type: 'uint256' },
            { name: 'sweptTokens', type: 'uint256' },
            { name: 'sweptAt', type: 'uint256' },
            { name: 'exists', type: 'bool' },
        ],
    }],
}]

export const STATE_VIEW_ABI = [
    {
        type: 'function', name: 'getSlot0', stateMutability: 'view',
        inputs: [{ name: 'poolId', type: 'bytes32' }],
        outputs: [
            { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
            { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' },
        ],
    },
    {
        type: 'function', name: 'getLiquidity', stateMutability: 'view',
        inputs: [{ name: 'poolId', type: 'bytes32' }],
        outputs: [{ name: 'liquidity', type: 'uint128' }],
    },
]

export const CURVE_ABI = [{
    type: 'function', name: 'getReserves', stateMutability: 'view', inputs: [],
    outputs: [{ name: 'quoteReserve', type: 'uint256' }, { name: 'tokenReserve', type: 'uint256' }],
}]

export const DECIMALS_ABI = [{
    type: 'function', name: 'decimals', stateMutability: 'view', inputs: [],
    outputs: [{ type: 'uint8' }],
}]

const POOL_KEY_ABI = [{
    type: 'tuple', components: [
        { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
    ],
}]

/* ======================================================== the arithmetic ==
 * Pure, exported and unit-tested against numbers read off the live chain
 * (price-oracle.spec.ts). Nothing here touches the network.
 */

/**
 * The v4 PoolKey and its id, from a launch record.
 *
 * The two currencies are the launch token and its `pairToken`, SORTED BY
 * ADDRESS ASCENDING — native ETH is the zero address, so whenever the pair is
 * native ETH the token is currency1 and never currency0. `fee` comes off the
 * record and is zero for pons (the hook charges the fee, not the pool), which
 * is exactly the kind of value that looks like a missing field; it is not.
 */
export function poolKeyFor({ token, pairToken, poolFee, tickSpacing, hooks = PONS.hook }) {
    const a = String(token)
    const b = String(pairToken ?? ZERO)
    const tokenIsCurrency0 = BigInt(a) < BigInt(b)
    const key = {
        currency0: tokenIsCurrency0 ? a : b,
        currency1: tokenIsCurrency0 ? b : a,
        fee: Number(poolFee ?? 0),
        tickSpacing: Number(tickSpacing),
        hooks: String(hooks),
    }
    return { key, tokenIsCurrency0, poolId: keccak256(encodeAbiParameters(POOL_KEY_ABI, [key])) }
}

/** Scale used to carry the BigInt ratio into a double without losing the small end. */
const Q = 10n ** 36n

/**
 * sqrtPriceX96 -> how many PAIR units one whole TOKEN is worth.
 *
 * v4 keeps the same convention as v3: (sqrtPriceX96 / 2**96)**2 is the price
 * of currency0 denominated in currency1, in RAW units. Two corrections turn
 * that into an answer about whole tokens:
 *
 *   1. which side the token is on — invert when the token is currency1;
 *   2. decimals — raw units differ by 10**(dec0 - dec1).
 *
 * The squaring is done in BigInt because sqrtPriceX96 runs to 1e33 and a
 * double would round away the digits that matter; only the final ratio,
 * pre-scaled by 1e36, becomes a Number.
 */
export function priceFromSqrtPriceX96(sqrtPriceX96, { tokenIsCurrency0, tokenDecimals = 18, pairDecimals = 18 }) {
    const sqrt = BigInt(sqrtPriceX96)
    if (sqrt <= 0n) return null
    // raw currency1 per raw currency0
    const raw1per0 = Number((sqrt * sqrt * Q) / (1n << 192n)) / 1e36
    if (!Number.isFinite(raw1per0) || raw1per0 <= 0) return null
    const dec0 = tokenIsCurrency0 ? tokenDecimals : pairDecimals
    const dec1 = tokenIsCurrency0 ? pairDecimals : tokenDecimals
    // whole currency1 per whole currency0
    const per0 = raw1per0 * 10 ** (dec0 - dec1)
    // pair per token
    const price = tokenIsCurrency0 ? per0 : 1 / per0
    return Number.isFinite(price) && price > 0 ? price : null
}

/**
 * Bonding-curve reserves -> how many PAIR units one whole TOKEN is worth.
 *
 * A GRADUATED curve reports a token reserve of ZERO (verified: the graduated
 * GPRO curve answers `(1.68e18, 0)`), which divides to Infinity. That is why
 * the curve is only ever consulted when the pool has no price, and why this
 * refuses a zero reserve instead of returning a number.
 */
export function priceFromReserves(quoteReserve, tokenReserve, { tokenDecimals = 18, quoteDecimals = 18 } = {}) {
    const q = BigInt(quoteReserve)
    const t = BigInt(tokenReserve)
    if (q <= 0n || t <= 0n) return null
    const ratio = Number((q * Q) / t) / 1e36
    const price = ratio * 10 ** (tokenDecimals - quoteDecimals)
    return Number.isFinite(price) && price > 0 ? price : null
}

/* ============================================================== the cache ==
 *
 * HOW LONG A PRICE IS GOOD FOR.
 *
 * Quest payouts, the daily cap and every box quote divide by this number, and
 * they happen many times a second across a populated map. One RPC round trip
 * per payout would put a public node in the middle of gameplay latency and
 * would be rate-limited within minutes.
 *
 * 45 seconds is the trade: the cost of being stale is at most 45 seconds of
 * price drift against a reward denominated in dollars — cents on a $1 quest —
 * while the cost of being live is an RPC call in the path of every reward. It
 * is also short enough that an operator who re-launches the token sees the new
 * price inside a minute without restarting the server.
 *
 * The refresh is a BACKGROUND timer, not lazy-on-read, because the consumers
 * (pricing.ts, lootbox.mjs) are synchronous and cannot await.
 */
export const PRICE_TTL_MS = 45_000

/**
 * When a cached price stops being a price.
 *
 * Ten missed refreshes. Past this the RPC has been unreachable for seven and a
 * half minutes and the cached number is a memory, not a market — it is dropped
 * and the fallback takes over, loudly. "Never let a stale price silently
 * produce a payout" is the whole reason this constant exists separately from
 * the TTL: the TTL says when to re-read, this says when to stop believing.
 */
export const STALE_AFTER_MS = PRICE_TTL_MS * 10

/**
 * Sanity bounds on a market cap, in dollars, for a fixed billion supply.
 *
 * NOT a market opinion — a units check. Every bug this codebase has produced
 * in this area was a factor of 10**12: a decimals mix-up, a raw/whole
 * confusion, a wei/ether slip. A real meme launch lives somewhere between a
 * few thousand and a few billion dollars; anything outside $100 .. $100bn is
 * not a cheap token, it is a units bug, and using it would misprice every
 * reward in the game.
 */
export const SUPPLY = 1_000_000_000
export const MIN_SANE_MARKET_CAP_USD = 100
export const MAX_SANE_MARKET_CAP_USD = 100_000_000_000

/**
 * How far one refresh may move the price before it needs a second opinion.
 *
 * A pons pool graduates with about one ether of liquidity. A few hundred
 * dollars moves it tenfold, and a spot price is a spot price: it can be pushed
 * inside a single transaction and pushed back. A crashed price INFLATES what a
 * quest pays in tokens, so the attack is to dump the pool and farm.
 *
 * The dollar damage is already bounded — DAILY_CAP_USD in earnings.ts caps a
 * wallet at $20 a day and is itself dollar-denominated, so it shrinks in
 * tokens exactly as fast as the payout grows. This is the second belt: a
 * reading more than 25x from the last accepted one is not accepted on its own
 * word, it must still be there at the next refresh. A real move survives 45
 * seconds; a sandwich does not.
 */
export const MAX_MOVE_FACTOR = 25

/* ========================================================== ETH in dollars ==
 *
 * There is no Chainlink feed on Robinhood Chain that anyone has verified, so
 * this is an off-chain HTTP read with the same cache-and-fallback discipline
 * as the pool price. Two keyless public sources, tried in order, because one
 * of them being down should not reprice the game. Both were checked live.
 */
export const ETH_USD_SOURCES = [
    { name: 'coinbase', url: 'https://api.coinbase.com/v2/prices/ETH-USD/spot', pick: (j) => Number(j?.data?.amount) },
    { name: 'kraken', url: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD', pick: (j) => Number(j?.result?.XETHZUSD?.c?.[0]) },
]
const MIN_SANE_ETH_USD = 10
const MAX_SANE_ETH_USD = 1_000_000

async function fetchEthUsd(fetchImpl = fetch, timeoutMs = 8000) {
    const errors = []
    for (const src of ETH_USD_SOURCES) {
        try {
            const res = await fetchImpl(src.url, { signal: AbortSignal.timeout(timeoutMs) })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const usd = src.pick(await res.json())
            if (!Number.isFinite(usd) || usd < MIN_SANE_ETH_USD || usd > MAX_SANE_ETH_USD) {
                throw new Error(`implausible ETH/USD ${usd}`)
            }
            return { usd, source: src.name }
        } catch (err) {
            errors.push(`${src.name}: ${err.message}`)
        }
    }
    throw new Error(errors.join('; '))
}

/* ================================================================ helpers ==*/

const positiveEnv = (env, key) => {
    const raw = env[key]
    if (raw === undefined || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
}

const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) && BigInt(v) !== 0n

/* ================================================================ the oracle ==*/

/**
 * Build an oracle. `createPublicClient` is injected so the unit tests can drive
 * every branch without a network, and so a caller can point it at a fork.
 */
export function createPriceOracle(opts = {}) {
    const env = opts.env ?? (typeof process !== 'undefined' ? process.env : {})
    const log = opts.log ?? console
    const now = opts.now ?? (() => Date.now())
    const fetchImpl = opts.fetch ?? ((...a) => fetch(...a))

    const chainId = Number(env.SM_PONS_CHAIN_ID ?? PONS.chainId)
    const rpcUrl = env.SM_PONS_RPC_URL || PONS.rpcUrl
    const factory = env.SM_PONS_FACTORY || PONS.factory
    const stateView = env.SM_PONS_STATE_VIEW || PONS.stateView
    const hook = env.SM_PONS_HOOK || PONS.hook

    /*
     * WHICH TOKEN TO PRICE.
     *
     * `SM_TOKEN_ADDRESS` is the game's currency, but it currently points at a
     * Sepolia deployment; asking the pons factory about a Sepolia address gets
     * a confidently empty record. So the pons reader only claims that address
     * when the game's chain IS the pons chain, and `SM_PRICE_TOKEN_ADDRESS`
     * exists to say so explicitly (useful while the two are being switched
     * over, and to point a probe at somebody else's launch).
     */
    const explicit = env.SM_PRICE_TOKEN_ADDRESS
    const gameChain = env.SM_CHAIN_ID === undefined || env.SM_CHAIN_ID === '' ? null : Number(env.SM_CHAIN_ID)
    const inherited = gameChain === null || gameChain === chainId ? env.SM_TOKEN_ADDRESS : undefined
    const token = opts.token ?? (isAddress(explicit) ? explicit : isAddress(inherited) ? inherited : null)

    const client = opts.client ?? (token || opts.forceClient
        ? createPublicClient({
            chain: defineChain({
                id: chainId, name: 'Robinhood Chain',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: { default: { http: [rpcUrl] } },
            }),
            transport: http(rpcUrl),
        })
        : null)

    const enabled = Boolean(token && client)

    /** Last accepted readings. `at` is when they were accepted, not read. */
    let tokenEth = null          // ETH per whole token, from the chain
    let tokenEthAt = 0
    let tokenEthFrom = null      // 'pool' | 'curve'
    let outlier = null           // a reading awaiting confirmation
    let ethUsdValue = null
    let ethUsdAt = 0
    let ethUsdFrom = null
    let timer = null
    let lastError = null
    const warned = new Set()
    const warnOnce = (key, msg) => { if (!warned.has(key)) { warned.add(key); log.warn?.(msg) } }
    /* A repeated failure must not become a repeated log line every 45s forever,
     * but it must not go quiet either — so it is re-announced on every change
     * of state, and once an hour otherwise. */
    let lastLoudAt = 0
    const loud = (msg) => {
        const t = now()
        if (t - lastLoudAt > 3_600_000) { lastLoudAt = t; log.warn?.(msg) }
    }

    const fresh = (at) => at > 0 && now() - at < STALE_AFTER_MS

    /** Read the launch record, then whichever venue actually holds a price. */
    async function readTokenEth() {
        const record = await client.readContract({
            address: factory, abi: LAUNCHED_TOKEN_ABI, functionName: 'getLaunchedToken', args: [token],
        })
        if (!record?.exists) throw new Error(`${token} is not a pons launch on chain ${chainId}`)
        if (BigInt(record.pairToken) !== 0n) {
            /* Priced against some other ERC-20. Converting that to dollars needs
             * a price for THAT asset, which we do not have — so this refuses
             * rather than pretending the pair is ether. */
            throw new Error(`pair token ${record.pairToken} is not native ETH — cannot price in dollars`)
        }
        const decimals = Number(await client.readContract({ address: token, abi: DECIMALS_ABI, functionName: 'decimals' }))

        const { poolId, tokenIsCurrency0 } = poolKeyFor({
            token, pairToken: record.pairToken, poolFee: record.poolFee, tickSpacing: record.tickSpacing, hooks: hook,
        })

        /*
         * POOL FIRST, AND ON THE POOL'S OWN EVIDENCE — not on `phase`.
         *
         * An uninitialised v4 pool answers getSlot0 with zeros rather than
         * reverting (verified), so "is there a pool" is a question the chain
         * answers directly. `phase` is read and reported because it is useful
         * to a human, but the enum's meaning is pons's to change and a wrong
         * guess about it would silently price a graduated token off a curve
         * whose token reserve is zero.
         */
        const slot0 = await client.readContract({
            address: stateView, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [poolId],
        })
        const sqrtPriceX96 = BigInt(slot0[0] ?? slot0.sqrtPriceX96 ?? 0n)
        if (sqrtPriceX96 > 0n) {
            const price = priceFromSqrtPriceX96(sqrtPriceX96, { tokenIsCurrency0, tokenDecimals: decimals })
            if (price) return { price, from: 'pool', poolId, tokenIsCurrency0, decimals, phase: Number(record.phase), sqrtPriceX96, tick: Number(slot0[1] ?? 0) }
        }

        const reserves = await client.readContract({ address: record.curve, abi: CURVE_ABI, functionName: 'getReserves' })
        const price = priceFromReserves(reserves[0], reserves[1], { tokenDecimals: decimals })
        if (!price) throw new Error(`neither a pool nor a curve reserve for ${token}`)
        return { price, from: 'curve', poolId, tokenIsCurrency0, decimals, phase: Number(record.phase), curve: record.curve, reserves }
    }

    /** One refresh. Never throws: it records and reports instead. */
    async function refresh() {
        const [ethResult, tokenResult] = await Promise.allSettled([
            fetchEthUsd(fetchImpl),
            enabled ? readTokenEth() : Promise.reject(new Error('no pons token configured')),
        ])

        if (ethResult.status === 'fulfilled') {
            ethUsdValue = ethResult.value.usd
            ethUsdFrom = ethResult.value.source
            ethUsdAt = now()
        } else {
            loud(`[price] no live ETH/USD (${ethResult.reason?.message}) — falling back to SM_ETH_USD`)
        }

        if (tokenResult.status === 'fulfilled') {
            const { price, from } = tokenResult.value
            const usd = ethUsdValue ? price * ethUsdValue : positiveEnv(env, 'SM_ETH_USD') ? price * positiveEnv(env, 'SM_ETH_USD') : null
            const cap = usd === null ? null : usd * SUPPLY
            if (cap !== null && (cap < MIN_SANE_MARKET_CAP_USD || cap > MAX_SANE_MARKET_CAP_USD)) {
                lastError = `implausible market cap $${cap.toExponential(3)} from ${from} — refusing the reading`
                loud(`[price] ${lastError}`)
            } else if (tokenEth !== null && (price > tokenEth * MAX_MOVE_FACTOR || price < tokenEth / MAX_MOVE_FACTOR)) {
                if (outlier !== null && price > outlier / MAX_MOVE_FACTOR && price < outlier * MAX_MOVE_FACTOR) {
                    log.warn?.(`[price] ${(price / tokenEth).toExponential(2)}x move confirmed over two reads — accepting ${price} ETH/token`)
                    tokenEth = price; tokenEthFrom = from; tokenEthAt = now(); outlier = null; lastError = null
                } else {
                    outlier = price
                    log.warn?.(`[price] ignoring a ${(price / tokenEth).toExponential(2)}x jump to ${price} ETH/token until it is still there next read`)
                }
            } else {
                tokenEth = price; tokenEthFrom = from; tokenEthAt = now(); outlier = null; lastError = null
                lastLoudAt = 0
            }
        } else {
            lastError = tokenResult.reason?.message ?? String(tokenResult.reason)
            if (enabled) loud(`[price] could not read the pons price (${lastError}) — falling back to SM_TOKEN_USD`)
        }
        return snapshot()
    }

    /* -------------------------------------------------------- the answers --*/

    /**
     * ETH in dollars: live, else SM_ETH_USD, else nothing.
     *
     * FALL BACK, do not refuse. This one only scales the ether ANCHOR on a box
     * price, a number a human chose; being a few percent out prices a box a
     * few percent wrong and nobody is underpaid by a factor of five.
     */
    function ethUsd() {
        if (ethUsdValue !== null && fresh(ethUsdAt)) return ethUsdValue
        if (ethUsdValue !== null) warnOnce('eth-stale', `[price] the live ETH/USD is older than ${STALE_AFTER_MS / 1000}s — using SM_ETH_USD`)
        return positiveEnv(env, 'SM_ETH_USD')
    }
    function ethUsdSource() {
        if (ethUsdValue !== null && fresh(ethUsdAt)) return ethUsdFrom
        return positiveEnv(env, 'SM_ETH_USD') === null ? null : 'env'
    }

    /**
     * One token in dollars, or null when no price can be established.
     *
     * THE ORDER, AND WHY IT IS NOT A PREFERENCE:
     *
     *   1. the live pool or curve, if it was read recently enough to still be
     *      a market rather than a memory (STALE_AFTER_MS);
     *   2. SM_TOKEN_USD, if an operator wrote one. Falling back to it is not a
     *      guess — a person put a number there and can be argued with;
     *   3. null. NOT the $200k launch assumption. Once a real market exists,
     *      that assumption is known to be wrong by orders of magnitude, and
     *      quietly paying from it is precisely the bug this file was written
     *      to remove. A caller that gets null must refuse to quote.
     */
    function tokenUsd() {
        const eth = ethUsd()
        if (tokenEth !== null && eth !== null) {
            if (fresh(tokenEthAt)) return tokenEth * eth
            warnOnce('token-stale', `[price] the live token price is older than ${STALE_AFTER_MS / 1000}s — using SM_TOKEN_USD`)
        }
        return positiveEnv(env, 'SM_TOKEN_USD')
    }

    /** Where `tokenUsd()` came from: 'pool' | 'curve' | 'env' | null. */
    function tokenPriceSource() {
        if (tokenEth !== null && fresh(tokenEthAt) && ethUsd() !== null) return tokenEthFrom
        return positiveEnv(env, 'SM_TOKEN_USD') === null ? null : 'env'
    }

    function snapshot() {
        return {
            enabled, token, chainId, rpcUrl,
            tokenUsd: tokenUsd(), tokenPriceSource: tokenPriceSource(),
            tokenEth, tokenEthFrom, tokenEthAgeMs: tokenEthAt ? now() - tokenEthAt : null,
            ethUsd: ethUsd(), ethUsdSource: ethUsdSource(),
            ethUsdAgeMs: ethUsdAt ? now() - ethUsdAt : null,
            lastError,
        }
    }

    function start() {
        if (timer) return
        timer = setInterval(() => { refresh().catch(() => {}) }, PRICE_TTL_MS)
        timer.unref?.()
    }
    function stop() { if (timer) { clearInterval(timer); timer = null } }

    return {
        enabled, token, chainId, rpcUrl, factory, stateView, hook,
        tokenUsd, tokenPriceSource, ethUsd, ethUsdSource,
        refresh, snapshot, start, stop,
        readTokenEth: () => readTokenEth(),
    }
}

/**
 * The process-wide instance. One oracle, one cache, one timer — server.mjs
 * hangs it on `globalThis.__smPrices` so the browser-bundled game code can ask
 * without importing any of this.
 */
let singleton = null
export function getPriceOracle(opts) {
    if (!singleton) singleton = createPriceOracle(opts)
    return singleton
}
/** Tests only: forget the singleton so the next call rebuilds it from env. */
export function resetPriceOracle() { singleton?.stop?.(); singleton = null }
