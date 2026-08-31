/*
 * The price is an input from outside the game and every reward is denominated
 * by it, so the interesting tests are all about what happens when it is wrong.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tokenUsd, tokensPerUsd, tokensForUsd, usdForTokens, clampBand, priceSource, DEFAULT_MARKET_CAP_USD, SUPPLY } from './pricing'

const set = (v: string | undefined) => {
    if (v === undefined) delete process.env.SM_TOKEN_USD
    else process.env.SM_TOKEN_USD = v
}
afterEach(() => set(undefined))

describe('the token price', () => {
    it('uses the configured one', () => {
        set('0.01')
        expect(tokenUsd()).toBe(0.01)
        // 100 tokens to the dollar — but that is 50x dearer than the launch
        // assumption, so the clamp floors it. The clamp is the point.
        expect(tokensForUsd(1)).toBe(Math.round(clampBand().min))
    })

    it('is the market cap divided by the supply', () => {
        set(undefined)
        expect(tokenUsd()).toBeCloseTo(DEFAULT_MARKET_CAP_USD / SUPPLY, 12)
        // $200k / 1e9 = $0.0002, so a dollar is 5,000 tokens.
        expect(tokensForUsd(1)).toBe(5_000)
    })

    it('passes a price inside the band straight through', () => {
        set('0.0004') // twice the assumption: 2,500 to the dollar
        expect(tokensForUsd(1)).toBe(2_500)
    })

    it('falls back when nothing is configured', () => {
        set(undefined)
        expect(tokenUsd()).toBeGreaterThan(0)
        expect(Number.isFinite(tokenUsd())).toBe(true)
    })

    it('refuses nonsense rather than dividing by it', () => {
        for (const bad of ['0', '-1', 'free', '']) {
            set(bad)
            expect(tokenUsd()).toBeGreaterThan(0)
            expect(Number.isFinite(tokensForUsd(1))).toBe(true)
        }
    })
})

describe('the clamp', () => {
    it('caps what one dollar can buy when the price is far too low', () => {
        // A misplaced decimal: 0.00000002 instead of 0.0002 would make a
        // single $1 quest pay fifty million tokens.
        set('0.00000002')
        expect(tokensForUsd(1)).toBeLessThanOrEqual(Math.round(clampBand().max))
    })

    it('floors it when the price is far too high', () => {
        set('1000')
        expect(tokensForUsd(1)).toBeGreaterThanOrEqual(Math.round(clampBand().min))
    })

    it('moves the band with the assumption rather than pinning it', () => {
        // The band used to be two literal token counts. Changing the default
        // price then put the real value OUTSIDE its own band, and every payout
        // was quietly clamped with nothing to show for it.
        const per = 1 / (DEFAULT_MARKET_CAP_USD / SUPPLY)
        expect(clampBand().min).toBeLessThan(per)
        expect(clampBand().max).toBeGreaterThan(per)
    })

    it('never pays zero for a real quest', () => {
        set('1000000')
        expect(tokensForUsd(1)).toBeGreaterThan(0)
    })

    it('pays nothing for nothing', () => {
        expect(tokensForUsd(0)).toBe(0)
        expect(tokensForUsd(-5)).toBe(0)
        expect(tokensForUsd(Number.NaN)).toBe(0)
    })
})

describe('reading it back', () => {
    it('round-trips a dollar within rounding', () => {
        set('0.0002')
        const tokens = tokensForUsd(2)
        expect(usdForTokens(tokens)).toBeCloseTo(2, 6)
    })

    it('is a positive number of tokens per dollar', () => {
        set(undefined)
        expect(tokensPerUsd()).toBeGreaterThan(0)
    })
})

/*
 * The price is now read off a live pool by price-oracle.mjs and handed over on
 * `globalThis.__smPrices`. These are the four states that bridge can be in and
 * what each one is allowed to do to a payout — the part with real money in it.
 */
type FakeBridge = {
    enabled: boolean
    tokenUsd: () => number | null
    tokenPriceSource: () => 'pool' | 'curve' | 'env' | null
}
const install = (b: FakeBridge | null) => {
    if (b === null) delete (globalThis as Record<string, unknown>).__smPrices
    else (globalThis as Record<string, unknown>).__smPrices = b
}
const live = (usd: number, source: 'pool' | 'curve' = 'pool'): FakeBridge =>
    ({ enabled: true, tokenUsd: () => usd, tokenPriceSource: () => source })

afterEach(() => install(null))

describe('with a live market', () => {
    it('takes the pool price and does not clamp it', () => {
        // A real pons launch opens around $3e-6, which is more than an order
        // of magnitude below the $200k launch assumption. The old band would
        // have floored a dollar at 100,000 tokens and paid a third of what was
        // promised, with every test still green — that is the bug.
        install(live(3e-6))
        expect(priceSource()).toBe('pool')
        expect(tokenUsd()).toBe(3e-6)
        expect(tokensForUsd(1)).toBe(333_333)
        expect(tokensForUsd(1)).toBeGreaterThan(clampBand().max)
    })

    it('prices off the bonding curve the same way before graduation', () => {
        install(live(4e-6, 'curve'))
        expect(priceSource()).toBe('curve')
        expect(tokensForUsd(1)).toBe(250_000)
    })

    it('beats a configured SM_TOKEN_USD, because the market is not an opinion', () => {
        set('0.0002')
        install(live(3e-6))
        expect(tokenUsd()).toBe(3e-6)
    })

    it('still clamps what the oracle says came from the environment', () => {
        // Same bridge, but it is quoting SM_TOKEN_USD because the RPC is down.
        // A human wrote that number and a human can mistype it.
        install({ enabled: true, tokenUsd: () => 1e-9, tokenPriceSource: () => 'env' })
        expect(priceSource()).toBe('env')
        expect(tokensForUsd(1)).toBe(Math.round(clampBand().max))
    })
})

describe('with no price at all', () => {
    const blind: FakeBridge = { enabled: true, tokenUsd: () => null, tokenPriceSource: () => null }

    it('refuses to quote rather than paying from the launch assumption', () => {
        // The token is live, the chain says something, we cannot hear it, and
        // nobody wrote a fallback. Any number here is invented, and inventing
        // one is how you underpay everybody for months without an error.
        install(blind)
        expect(priceSource()).toBe('unknown')
        expect(tokensPerUsd()).toBe(0)
        expect(tokensForUsd(1)).toBe(0)
        expect(tokensForUsd(1000)).toBe(0)
    })

    it('still answers a label, because a UI needs to print something', () => {
        install(blind)
        expect(tokenUsd()).toBeGreaterThan(0)
        expect(Number.isFinite(usdForTokens(100))).toBe(true)
    })

    it('does not let a broken oracle throw into a payout', () => {
        install({
            enabled: true,
            tokenUsd: () => { throw new Error('boom') },
            tokenPriceSource: () => { throw new Error('boom') },
        })
        expect(priceSource()).toBe('unknown')
        expect(tokensForUsd(1)).toBe(0)
    })

    it('but a DISABLED oracle is just the pre-launch game, and it pays', () => {
        // No token configured at all: development, tests, and every day before
        // the launch. There is no market to be wrong about.
        install({ enabled: false, tokenUsd: () => null, tokenPriceSource: () => null })
        expect(priceSource()).toBe('assumed')
        expect(tokensForUsd(1)).toBe(5_000)
        set('0.0004')
        expect(priceSource()).toBe('env')
        expect(tokensForUsd(1)).toBe(2_500)
    })
})
