/*
 * The price is now READ off a live market instead of written in a file, which
 * moves the risk rather than removing it. Three things can now go wrong that
 * could not before, and this is where they are pinned down:
 *
 *   1. the arithmetic. sqrtPriceX96 is a Q64.96 square root and the answer is
 *      wanted the other way up, in whole tokens, in dollars. Every step is a
 *      chance to be out by 2**96, by an inversion, or by 10**12. The known
 *      values below were READ OFF THE LIVE CHAIN on 2026-09-01 (tools/
 *      e2e-pons-price.mjs prints them) — not derived from this code.
 *
 *   2. the pool id. It is a hash of a struct, so getting a field wrong does
 *      not fail, it points at a pool that does not exist. The expected hashes
 *      here are the ids of REAL pons pools that really hold liquidity.
 *
 *   3. what happens when the market cannot be reached, which is the whole
 *      difference between underpaying everyone quietly and saying so.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain JS on purpose: it is server-only and imports viem.
import {
    poolKeyFor, priceFromSqrtPriceX96, priceFromReserves, createPriceOracle,
    PONS, PRICE_TTL_MS, STALE_AFTER_MS, MAX_MOVE_FACTOR,
} from '../../../price-oracle.mjs'

const ZERO = '0x0000000000000000000000000000000000000000'

/* --------------------------------------------------------------- pool ids */

describe('the v4 pool id', () => {
    it('hashes to the real pool of a real pons launch', () => {
        // TOGGLE, graduated, read off Robinhood Chain: this id has a live
        // pool behind it holding 2.9e22 of liquidity.
        const { poolId } = poolKeyFor({
            token: '0x2c9bd473e4582c7209671b22f5078a75409366dc',
            pairToken: ZERO, poolFee: 0, tickSpacing: 200, hooks: PONS.hook,
        })
        expect(poolId).toBe('0x367b278dc0f49650d7ee23ab9a9419770b3f044094ac060f63c637994c404348')
    })

    it('hashes a second one too, so it is not one lucky constant', () => {
        const { poolId } = poolKeyFor({
            token: '0x4532c978f3ebae4916f60013f964a67a0f5e430a',
            pairToken: ZERO, poolFee: 0, tickSpacing: 200, hooks: PONS.hook,
        })
        expect(poolId).toBe('0x6f3579e8be6369dcd503039f6e84aec6e919aeb07b9654e0030ffda680fbe9e7')
    })

    it('puts native ETH first, because the zero address sorts below everything', () => {
        const { key, tokenIsCurrency0 } = poolKeyFor({
            token: '0x0000000000000000000000000000000000000001',
            pairToken: ZERO, poolFee: 0, tickSpacing: 200,
        })
        expect(tokenIsCurrency0).toBe(false)
        expect(key.currency0).toBe(ZERO)
    })

    it('sorts the other way when the pair is not native', () => {
        const { tokenIsCurrency0 } = poolKeyFor({
            token: '0x1111111111111111111111111111111111111111',
            pairToken: '0x2222222222222222222222222222222222222222',
            poolFee: 0, tickSpacing: 200,
        })
        expect(tokenIsCurrency0).toBe(true)
    })

    it('is a different pool for a different fee tier or spacing', () => {
        const base = { token: '0x2c9bd473e4582c7209671b22f5078a75409366dc', pairToken: ZERO, poolFee: 0, tickSpacing: 200 }
        expect(poolKeyFor({ ...base, poolFee: 3000 }).poolId).not.toBe(poolKeyFor(base).poolId)
        expect(poolKeyFor({ ...base, tickSpacing: 60 }).poolId).not.toBe(poolKeyFor(base).poolId)
        expect(poolKeyFor({ ...base, hooks: ZERO }).poolId).not.toBe(poolKeyFor(base).poolId)
    })
})

/* ------------------------------------------------------------ the maths --*/

const X96 = 2n ** 96n

describe('sqrtPriceX96 -> a price', () => {
    it('is 1 at 2**96, whichever side the token is on', () => {
        expect(priceFromSqrtPriceX96(X96, { tokenIsCurrency0: true })).toBeCloseTo(1, 12)
        expect(priceFromSqrtPriceX96(X96, { tokenIsCurrency0: false })).toBeCloseTo(1, 12)
    })

    it('squares, and inverts for currency1', () => {
        // sqrt = 2 * 2**96 -> currency1-per-currency0 is 4
        expect(priceFromSqrtPriceX96(2n * X96, { tokenIsCurrency0: true })).toBeCloseTo(4, 10)
        expect(priceFromSqrtPriceX96(2n * X96, { tokenIsCurrency0: false })).toBeCloseTo(0.25, 10)
    })

    it('reproduces a price read off the live TOGGLE pool', () => {
        // This sqrtPriceX96 was read out of the real TOGGLE pool on Robinhood
        // Chain. The expected answer is NOT this module's output: it is
        // 2**192 / sqrt**2 worked out to fifty significant figures in a
        // separate arbitrary-precision calculation, which is the only way a
        // "known value" test proves anything about the code under it.
        const price = priceFromSqrtPriceX96(510312647206946738949450124461732n, { tokenIsCurrency0: false })
        expect(price).toBeCloseTo(2.4103854887777627e-8, 20)
        // 24,103,854,888 wei a token; ~24.1 ETH of market cap at a billion.
        expect(Math.round(price * 1e18)).toBe(24103854888)
    })

    it('keeps the small digits that a double would round away', () => {
        // The square of a 1e33 number does not fit in a double; if the maths
        // were done in floats this would come out visibly wrong rather than to
        // sixteen figures.
        const price = priceFromSqrtPriceX96(1029144143165261152039246932018913n, { tokenIsCurrency0: false })
        // 5.9266155180077368699267…e-9 to fifty places, rounded to sixteen.
        expect(price.toPrecision(16)).toBe('5.926615518007737e-9')
    })

    it('corrects for decimals, which is where a 10**12 error would live', () => {
        // The same pool state means the same RAW ratio: one raw token per one
        // wei. With 18 decimals that is one whole token per whole ether. With
        // 6 it is a millionth of a token per 1e-18 ether — a trillion tokens
        // to the ether, so a whole token is worth a trillionth as much.
        const eighteen = priceFromSqrtPriceX96(X96, { tokenIsCurrency0: false, tokenDecimals: 18 })
        const six = priceFromSqrtPriceX96(X96, { tokenIsCurrency0: false, tokenDecimals: 6 })
        expect(eighteen).toBe(1)
        expect(six).toBe(1e-12)
    })

    it('refuses an uninitialised pool instead of returning a number', () => {
        // An uninitialised v4 pool answers getSlot0 with zeros — it does not
        // revert — so this is the only thing standing between "no pool" and
        // "this token is free".
        expect(priceFromSqrtPriceX96(0n, { tokenIsCurrency0: false })).toBe(null)
    })
})

describe('bonding-curve reserves -> a price', () => {
    it('reproduces a fresh pons curve: 1.68 ETH against a billion tokens', () => {
        const price = priceFromReserves(1_680_000_000_000_000_000n, 10n ** 27n)
        expect(price).toBeCloseTo(1.68e-9, 20)
        expect(Math.round(price * 1e9 * 1e4) / 1e4).toBe(1.68) // 1.68 ETH market cap
    })

    it('refuses a graduated curve rather than dividing by its empty reserve', () => {
        // Verified on chain: a graduated pons curve reports (1.68e18, 0). A
        // plain ratio here is Infinity, and an infinite tokens-per-dollar is a
        // quest that pays every token that will ever exist.
        expect(priceFromReserves(1_680_000_000_000_000_000n, 0n)).toBe(null)
        expect(priceFromReserves(0n, 10n ** 27n)).toBe(null)
    })

    it('corrects for decimals here too', () => {
        const eighteen = priceFromReserves(10n ** 18n, 10n ** 18n, { tokenDecimals: 18 })
        const six = priceFromReserves(10n ** 18n, 10n ** 18n, { tokenDecimals: 6 })
        expect(six / eighteen).toBeCloseTo(1e-12, 20)
    })
})

/* ------------------------------------------------------- the oracle ------*/

const TOKEN = '0x2c9bd473e4582c7209671b22f5078a75409366dc'
const CURVE = '0x9Cfe41aba75B64063e12815a07fB67742466F2F4'

/** A chain that says whatever the test wants, so every branch is reachable. */
function fakeChain({ sqrtPriceX96 = 0n, reserves = [0n, 0n], exists = true, pairToken = ZERO, fail = null }) {
    return {
        readContract: async ({ functionName }: { functionName: string }) => {
            if (fail) throw new Error(fail)
            if (functionName === 'getLaunchedToken') {
                return { token: TOKEN, curve: CURVE, pairToken, poolFee: 0, tickSpacing: 200, phase: 2, exists }
            }
            if (functionName === 'decimals') return 18
            if (functionName === 'getSlot0') return [sqrtPriceX96, 175417, 0, 0]
            if (functionName === 'getReserves') return reserves
            throw new Error(`unexpected call ${functionName}`)
        },
    }
}
const fakeEthUsd = (usd: number | null) => async () => {
    if (usd === null) throw new Error('offline')
    return { ok: true, json: async () => ({ data: { amount: String(usd) } }) }
}
const build = (opts: Record<string, unknown>) => createPriceOracle({
    token: TOKEN, log: { warn: () => {} }, ...opts,
})

describe('reading the price', () => {
    it('prices a graduated token off its pool', async () => {
        const o = build({
            client: fakeChain({ sqrtPriceX96: 510312647206946738949450124461732n }),
            fetch: fakeEthUsd(2500), env: {},
        })
        const s = await o.refresh()
        expect(s.tokenPriceSource).toBe('pool')
        expect(s.tokenEth).toBeCloseTo(2.4103854887777627e-8, 20)
        expect(s.tokenUsd).toBeCloseTo(2.4103854887777627e-8 * 2500, 15)
    })

    it('prices a token that has not graduated off its curve', async () => {
        const o = build({
            client: fakeChain({ sqrtPriceX96: 0n, reserves: [1_680_000_000_000_000_000n, 10n ** 27n] }),
            fetch: fakeEthUsd(2500), env: {},
        })
        const s = await o.refresh()
        expect(s.tokenPriceSource).toBe('curve')
        expect(s.tokenEth).toBeCloseTo(1.68e-9, 20)
    })

    it('prefers the pool over the curve, because a graduated curve is empty', async () => {
        const o = build({
            client: fakeChain({ sqrtPriceX96: 510312647206946738949450124461732n, reserves: [10n ** 18n, 0n] }),
            fetch: fakeEthUsd(2500), env: {},
        })
        expect((await o.refresh()).tokenPriceSource).toBe('pool')
    })
})

describe('when it cannot read the price', () => {
    it('falls back to SM_TOKEN_USD, which a person wrote', async () => {
        const o = build({
            client: fakeChain({ fail: 'RPC down' }), fetch: fakeEthUsd(null),
            env: { SM_TOKEN_USD: '0.0002', SM_ETH_USD: '3000' },
        })
        const s = await o.refresh()
        expect(s.tokenPriceSource).toBe('env')
        expect(s.tokenUsd).toBe(0.0002)
        expect(s.ethUsd).toBe(3000)
        expect(s.lastError).toContain('RPC down')
    })

    it('reports NO price rather than the launch assumption when nothing is configured', async () => {
        const o = build({ client: fakeChain({ fail: 'RPC down' }), fetch: fakeEthUsd(null), env: {} })
        const s = await o.refresh()
        expect(s.tokenUsd).toBe(null)
        expect(s.tokenPriceSource).toBe(null)
    })

    it('refuses a token that is not a pons launch at all', async () => {
        const o = build({ client: fakeChain({ exists: false }), fetch: fakeEthUsd(2500), env: {} })
        expect((await o.refresh()).lastError).toContain('not a pons launch')
    })

    it('refuses a pool paired with something other than ether', async () => {
        // The price would be in that asset, and we have no dollar rate for it.
        const o = build({
            client: fakeChain({ pairToken: '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2', sqrtPriceX96: X96 }),
            fetch: fakeEthUsd(2500), env: { SM_TOKEN_USD: '0.0002' },
        })
        const s = await o.refresh()
        expect(s.lastError).toContain('not native ETH')
        expect(s.tokenPriceSource).toBe('env')
    })

    it('still prices the token when only the ETH feed is down, using SM_ETH_USD', async () => {
        const o = build({
            client: fakeChain({ sqrtPriceX96: 510312647206946738949450124461732n }),
            fetch: fakeEthUsd(null), env: { SM_ETH_USD: '3000' },
        })
        const s = await o.refresh()
        expect(s.tokenPriceSource).toBe('pool')
        expect(s.ethUsd).toBe(3000)
    })
})

describe('a price that has stopped being a price', () => {
    it('stops trusting a live reading once it is stale, and says so', async () => {
        let t = 1_000_000
        const o = build({
            client: fakeChain({ sqrtPriceX96: 510312647206946738949450124461732n }),
            fetch: fakeEthUsd(2500), env: { SM_TOKEN_USD: '0.0002', SM_ETH_USD: '3000' },
            now: () => t,
        })
        expect((await o.refresh()).tokenPriceSource).toBe('pool')
        t += STALE_AFTER_MS - 1
        expect(o.tokenPriceSource()).toBe('pool')
        t += 2
        expect(o.tokenPriceSource()).toBe('env')
        expect(o.tokenUsd()).toBe(0.0002)
    })

    it('has a staleness window well clear of the refresh interval', () => {
        // Otherwise one slow RPC call would drop a perfectly good price.
        expect(STALE_AFTER_MS).toBeGreaterThan(PRICE_TTL_MS * 4)
    })
})

describe('a pool that has been pushed', () => {
    it('will not act on a huge jump until a second read agrees', async () => {
        let sqrt = 510312647206946738949450124461732n
        const client = {
            readContract: async ({ functionName }: { functionName: string }) => {
                if (functionName === 'getLaunchedToken') return { token: TOKEN, curve: CURVE, pairToken: ZERO, poolFee: 0, tickSpacing: 200, phase: 2, exists: true }
                if (functionName === 'decimals') return 18
                if (functionName === 'getSlot0') return [sqrt, 0, 0, 0]
                return [0n, 0n]
            },
        }
        const o = build({ client, fetch: fakeEthUsd(2500), env: {} })
        const first = (await o.refresh()).tokenEth
        // A hundredfold crash, which inflates what a quest pays in tokens.
        sqrt = sqrt * 10n
        const second = await o.refresh()
        expect(second.tokenEth).toBe(first)
        // Still there next time: a real move, not a sandwich.
        const third = await o.refresh()
        expect(third.tokenEth).toBeCloseTo(first / 100, 20)
    })

    it('lets an ordinary move straight through', async () => {
        let sqrt = 510312647206946738949450124461732n
        const client = {
            readContract: async ({ functionName }: { functionName: string }) => {
                if (functionName === 'getLaunchedToken') return { token: TOKEN, curve: CURVE, pairToken: ZERO, poolFee: 0, tickSpacing: 200, phase: 2, exists: true }
                if (functionName === 'decimals') return 18
                if (functionName === 'getSlot0') return [sqrt, 0, 0, 0]
                return [0n, 0n]
            },
        }
        const o = build({ client, fetch: fakeEthUsd(2500), env: {} })
        const first = (await o.refresh()).tokenEth
        // The token is currency1, so a higher sqrtPriceX96 is a CHEAPER token:
        // 1.5x on the square root is 2.25x on the ratio and 1/2.25 on us.
        sqrt = (sqrt * 3n) / 2n
        expect((await o.refresh()).tokenEth).toBeCloseTo(first / 2.25, 20)
        expect(MAX_MOVE_FACTOR).toBeGreaterThan(2.25)
    })

    it('rejects a reading whose market cap is not even the right order of magnitude', async () => {
        // A units bug — raw against whole, wei against ether — does not look
        // like a price, it looks like a trillion dollars.
        const o = build({
            client: fakeChain({ sqrtPriceX96: X96 / 10n ** 9n }), // ~1e18 ETH a token
            fetch: fakeEthUsd(2500), env: { SM_TOKEN_USD: '0.0002' },
        })
        const s = await o.refresh()
        expect(s.tokenPriceSource).toBe('env')
        expect(s.lastError).toContain('implausible market cap')
    })
})

describe('which token it decides to price', () => {
    it('takes SM_PRICE_TOKEN_ADDRESS outright', () => {
        const o = createPriceOracle({ env: { SM_PRICE_TOKEN_ADDRESS: TOKEN }, log: { warn: () => {} } })
        expect(o.token.toLowerCase()).toBe(TOKEN)
        expect(o.enabled).toBe(true)
    })

    it('will not ask the pons factory about a token on another chain', () => {
        // SM_TOKEN_ADDRESS currently points at Sepolia; the pons factory would
        // answer about it confidently and emptily.
        const o = createPriceOracle({
            env: { SM_TOKEN_ADDRESS: TOKEN, SM_CHAIN_ID: '11155111' }, log: { warn: () => {} },
        })
        expect(o.enabled).toBe(false)
    })

    it('inherits SM_TOKEN_ADDRESS once the game is on the pons chain', () => {
        const o = createPriceOracle({
            env: { SM_TOKEN_ADDRESS: TOKEN, SM_CHAIN_ID: String(PONS.chainId) }, log: { warn: () => {} },
        })
        expect(o.enabled).toBe(true)
    })

    it('is simply off with no token configured', () => {
        const o = createPriceOracle({ env: {}, log: { warn: () => {} } })
        expect(o.enabled).toBe(false)
        expect(o.tokenUsd()).toBe(null)
    })
})
