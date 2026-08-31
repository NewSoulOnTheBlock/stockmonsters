/*
 * The price is an input from outside the game and every reward is denominated
 * by it, so the interesting tests are all about what happens when it is wrong.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tokenUsd, tokensPerUsd, tokensForUsd, usdForTokens } from './pricing'

const set = (v: string | undefined) => {
    if (v === undefined) delete process.env.SM_TOKEN_USD
    else process.env.SM_TOKEN_USD = v
}
afterEach(() => set(undefined))

describe('the token price', () => {
    it('uses the configured one', () => {
        set('0.01')
        expect(tokenUsd()).toBe(0.01)
        expect(tokensForUsd(1)).toBe(100)
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
        // A misplaced decimal: 0.0000005 instead of 0.0005 would make a single
        // $1 quest pay two million tokens.
        set('0.0000005')
        expect(tokensForUsd(1)).toBeLessThanOrEqual(40_000)
    })

    it('floors it when the price is far too high', () => {
        set('1000')
        expect(tokensForUsd(1)).toBeGreaterThanOrEqual(100)
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
        set('0.0005')
        const tokens = tokensForUsd(2)
        expect(usdForTokens(tokens)).toBeCloseTo(2, 6)
    })

    it('is a positive number of tokens per dollar', () => {
        set(undefined)
        expect(tokensPerUsd()).toBeGreaterThan(0)
    })
})
