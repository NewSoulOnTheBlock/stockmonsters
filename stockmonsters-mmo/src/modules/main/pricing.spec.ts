/*
 * The price is an input from outside the game and every reward is denominated
 * by it, so the interesting tests are all about what happens when it is wrong.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tokenUsd, tokensPerUsd, tokensForUsd, usdForTokens, clampBand, DEFAULT_MARKET_CAP_USD, SUPPLY } from './pricing'

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
