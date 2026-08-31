/*
 * The two pricing implementations must agree.
 *
 * Quests are priced by src/modules/main/pricing.ts, a TypeScript module
 * bundled into the game server. Loot boxes are priced by lootbox.mjs, plain
 * Node that server.mjs loads directly and that cannot import the TypeScript.
 * So the arithmetic exists twice, and this is what stops the copies drifting:
 * a divergence would mean a quest and a box valued the same dollar
 * differently, which is exactly the bug that made paying for a box in tokens
 * twenty-four times cheaper than paying in ether.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { tokensForUsd, tokensPerUsd } from './pricing'
// @ts-expect-error — plain JS on purpose; see the note above.
import { tokensPerUsd as boxTokensPerUsd, tierTokens, tierUsd, TIER_IDS, TIERS } from '../../../lootbox.mjs'

const set = (key: string, v: string | undefined) => {
    if (v === undefined) delete process.env[key]
    else process.env[key] = v
}
afterEach(() => { set('SM_TOKEN_USD', undefined); set('SM_ETH_USD', undefined) })

describe('one dollar, two implementations', () => {
    it('buys the same number of tokens in both', () => {
        for (const price of ['0.0005', '0.01', '0.000001', '25']) {
            set('SM_TOKEN_USD', price)
            expect(boxTokensPerUsd()).toBe(tokensPerUsd())
        }
    })

    it('clamps at the same points', () => {
        // A misplaced decimal must be caught identically on both sides.
        set('SM_TOKEN_USD', '0.0000005')
        expect(boxTokensPerUsd()).toBe(tokensPerUsd())
        set('SM_TOKEN_USD', '1000')
        expect(boxTokensPerUsd()).toBe(tokensPerUsd())
    })

    it('falls back to the same default', () => {
        set('SM_TOKEN_USD', undefined)
        expect(boxTokensPerUsd()).toBe(tokensPerUsd())
    })
})

describe('what a box costs', () => {
    it('quotes the same dollar in both currencies', () => {
        set('SM_TOKEN_USD', '0.0005')
        set('SM_ETH_USD', '3000')
        for (const id of TIER_IDS as string[]) {
            const usd = tierUsd(id)
            const inTokens = tierTokens(id)
            // The token quote is the dollar price, converted. Within rounding.
            expect(inTokens).toBe(tokensForUsd(usd))
            // And the dollar price is the ether anchor, converted.
            const eth = Number(BigInt(TIERS[id].priceWei)) / 1e18
            expect(usd).toBeCloseTo(eth * 3000, 6)
        }
    })

    it('is a raise on what tokens used to buy', () => {
        // The old fixed prices were 2,500 / 7,500 / 20,000 tokens against ether
        // prices worth about twenty-four times that.
        set('SM_TOKEN_USD', '0.0005')
        set('SM_ETH_USD', '3000')
        expect(tierTokens('standard')).toBeGreaterThan(2_500)
        expect(tierTokens('prime')).toBeGreaterThan(7_500)
        expect(tierTokens('apex')).toBeGreaterThan(20_000)
    })

    it('keeps the tiers in order however the rates move', () => {
        for (const [t, e] of [['0.0005', '3000'], ['0.05', '900'], ['0.000002', '12000']]) {
            set('SM_TOKEN_USD', t)
            set('SM_ETH_USD', e)
            expect(tierTokens('prime')).toBeGreaterThan(tierTokens('standard'))
            expect(tierTokens('apex')).toBeGreaterThan(tierTokens('prime'))
        }
    })

    it('never quotes a free box', () => {
        set('SM_TOKEN_USD', '1000000')
        set('SM_ETH_USD', '0.000001')
        for (const id of TIER_IDS as string[]) expect(tierTokens(id)).toBeGreaterThan(0)
    })
})
