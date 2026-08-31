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

/*
 * The mirror has to hold for the LIVE price too, and that is a sharper test
 * than the env one: both files now reach the price through the same
 * `globalThis.__smPrices` bridge and both have their own copy of the rule
 * about when the clamp applies. A divergence there would mean a box priced
 * against a market and a quest priced against a launch assumption.
 */
// @ts-expect-error — plain JS on purpose; see the note at the top.
import { priceQuote as boxPriceQuote, priceSource as boxPriceSource, ethUsd as boxEthUsd } from '../../../lootbox.mjs'
import { priceSource, tokensPerUsd as questTokensPerUsd } from './pricing'

const bridge = (b: unknown) => {
    if (b === null) delete (globalThis as Record<string, unknown>).__smPrices
    else (globalThis as Record<string, unknown>).__smPrices = b
}
afterEach(() => bridge(null))

describe('one live market, two implementations', () => {
    it('reads the same price and calls it the same thing', () => {
        for (const source of ['pool', 'curve'] as const) {
            bridge({ enabled: true, tokenUsd: () => 3e-6, tokenPriceSource: () => source })
            expect(boxPriceSource()).toBe(priceSource())
            expect(boxPriceSource()).toBe(source)
            expect(boxTokensPerUsd()).toBe(questTokensPerUsd())
            // and neither one clamps it back to the launch assumption
            expect(boxTokensPerUsd()).toBeCloseTo(1 / 3e-6, 6)
        }
    })

    it('refuses together when there is no price', () => {
        bridge({ enabled: true, tokenUsd: () => null, tokenPriceSource: () => null })
        expect(boxPriceSource()).toBe('unknown')
        expect(priceSource()).toBe('unknown')
        expect(boxTokensPerUsd()).toBe(questTokensPerUsd())
        expect(boxTokensPerUsd()).toBe(0)
        // A refused box is UNAVAILABLE, not free and not one token.
        for (const id of TIER_IDS as string[]) expect(tierTokens(id)).toBe(0)
    })

    it('clamps together when the oracle is quoting the environment', () => {
        bridge({ enabled: true, tokenUsd: () => 1e-9, tokenPriceSource: () => 'env' })
        expect(boxTokensPerUsd()).toBe(questTokensPerUsd())
    })

    it('takes the live ETH price for the box anchor, and SM_ETH_USD without one', () => {
        bridge({ enabled: true, tokenUsd: () => 3e-6, tokenPriceSource: () => 'pool', ethUsd: () => 2500 })
        expect(boxEthUsd()).toBe(2500)
        // 0.01 ETH at $2,500 rather than the old hardcoded $3,000.
        expect(tierUsd('standard')).toBeCloseTo(25, 6)
        bridge({ enabled: true, tokenUsd: () => 3e-6, tokenPriceSource: () => 'pool', ethUsd: () => null })
        set('SM_ETH_USD', '3000')
        expect(boxEthUsd()).toBe(3000)
    })

    it('agrees on the dollar price of a box, live', () => {
        bridge({ enabled: true, tokenUsd: () => 3e-6, tokenPriceSource: () => 'pool', ethUsd: () => 2500 })
        for (const id of TIER_IDS as string[]) {
            expect(tierTokens(id)).toBe(tokensForUsd(tierUsd(id)))
        }
        expect(boxPriceQuote().usd).toBe(3e-6)
    })
})
