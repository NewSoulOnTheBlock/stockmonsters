/*
 * pricing.ts — what a dollar is worth in $STONKSTER, right now.
 *
 *   tokenUsd()          the price of one $STONKSTER in dollars
 *   priceSource()       where that price came from, and whether to trust it
 *   tokensForUsd(usd)   whole tokens worth that many dollars, or 0 to refuse
 *
 * ## Why quests are priced in dollars
 *
 * A quest that pays a fixed 100 tokens is a promise about a number, not about
 * value: it is worth whatever the token happens to be worth that week, and the
 * board silently becomes generous or worthless without anybody deciding it
 * should. The user's call is that a quest is worth a dollar or two, so that is
 * what is written down — and the token amount is derived from it.
 *
 * ## Where the price comes from — READ, not written
 *
 * It used to be an environment variable holding an ASSUMED $200k market cap.
 * The token launches on the pons launchpad, whose bonding curve opens the
 * price without asking us, and a measured launch opens orders of magnitude
 * away from that assumption. Paying "5,000 tokens for a $1 quest" against a
 * real price a fifth of the assumed one underpays every player by five to one
 * and throws nothing.
 *
 * So the live price is read off the Uniswap v4 pool (or, before graduation,
 * the bonding curve) by price-oracle.mjs, and this module ASKS for it.
 *
 * THIS FILE IS BUNDLED INTO THE BROWSER. It cannot import price-oracle.mjs —
 * viem-over-RPC, a public node URL and a refresh timer have no business in the
 * client, and a `node:fs` import in player.ts once broke the whole client
 * build. So the oracle arrives the way every other server-side store does: on
 * `globalThis.__smPrices`, hung there by server.mjs. Absent, this falls back
 * to the environment exactly as it did before.
 *
 * ## Fall back, or refuse? Both, and the line between them is the point
 *
 * FALL BACK when a HUMAN has stated a price. `SM_TOKEN_USD` is somebody's
 * decision; using it while the RPC is unreachable substitutes one considered
 * number for another and says so in the log.
 *
 * FALL BACK to the built-in launch assumption only when NO oracle is wired in
 * at all — development, tests, and every day before the token launched. There
 * is no real money there and the game must still run.
 *
 * REFUSE when an oracle IS wired in and has nothing: the token is live, the
 * chain says one thing, we cannot hear it, and no operator wrote a fallback.
 * The launch assumption is then not a fallback, it is a guess about a market
 * that exists and disagrees — the exact failure this file was rewritten to
 * remove. `tokensForUsd` returns 0, quests pay nothing and boxes quote
 * nothing, until a price can be established again. A visibly broken reward is
 * recoverable; five years of quietly underpaying everyone is not.
 *
 * ## The bounds, and why a live price is not clamped by them
 *
 * The clamp guards a MISTYPED CONFIGURATION — 0.00000002 instead of 0.0002
 * would make one quest pay fifty million tokens — so it is a band 20x either
 * side of the launch assumption, and it applies to every price a human wrote.
 *
 * It must NOT apply to a price read off a market. Its own anchor is the $200k
 * assumption, which the real launch has already contradicted; clamping a true
 * market price against a false assumption is how you pay a fifth of what you
 * promised while every test still passes. The live price is bounded instead by
 * three things that are actually about the market: the oracle refuses a
 * reading whose implied market cap is not even the right order of magnitude
 * (a units bug), it refuses a 25x jump until a second read confirms it (a
 * manipulated pool), and — the real bound — DAILY_CAP_USD in earnings.ts caps
 * a wallet at $20 a day and is itself denominated in dollars, so it shrinks in
 * tokens exactly as fast as a crashed price inflates a payout.
 */

/**
 * The assumption the game was priced from before there was a market.
 *
 * THINK IN MARKET CAP, NOT IN PRICE. Supply is fixed at a billion, so the
 * price is only the valuation divided by that — and the valuation is the
 * number with an opinion in it:
 *
 *     $200k -> $0.0002      $1M -> $0.001      $10M -> $0.01
 *
 * It is no longer what the game pays from; it is what the game pays from when
 * there is nothing else, and what the clamp band is measured against.
 */
/**
 * What the currency is called on screen.
 *
 * It lives here, next to the price, because the HUD and the quest board both
 * print an amount and a symbol together and nothing else should be inventing
 * either half. The server reads the REAL symbol off the token (token.mjs — it
 * describes itself on chain); this is the label the client shows before that
 * answer arrives, and in a build with no token configured at all.
 */
export const TOKEN_SYMBOL = 'STONKSTERS'

export const SUPPLY = 1_000_000_000
export const DEFAULT_MARKET_CAP_USD = 200_000
const DEFAULT_USD_PER_TOKEN = DEFAULT_MARKET_CAP_USD / SUPPLY

/**
 * How far a CONFIGURED price may stray from that assumption before a payout is
 * clamped: 20x in either direction.
 *
 * RELATIVE, NOT ABSOLUTE, and that is the whole point. These were two literal
 * token counts, and the moment the default price moved they no longer had
 * anything to do with it — moving the default from $0.01 to $0.0002 would have
 * put the real value OUTSIDE its own band, quietly paying every quest and
 * every box a flat 2.5x less with nothing to show for it. Derived from the
 * default, the band follows it for free.
 *
 * That same failure is why a LIVE price is not run through this band at all;
 * see the header.
 */
export const CLAMP_FACTOR = 20
const MIN_TOKENS_PER_USD = 1 / DEFAULT_USD_PER_TOKEN / CLAMP_FACTOR
const MAX_TOKENS_PER_USD = (1 / DEFAULT_USD_PER_TOKEN) * CLAMP_FACTOR

/** The band, for anything that needs to reason about the clamp. */
export const clampBand = () => ({ min: MIN_TOKENS_PER_USD, max: MAX_TOKENS_PER_USD })

/**
 * Where the number came from.
 *
 *   'pool' | 'curve'  a live market, read this minute. Not clamped.
 *   'env'             SM_TOKEN_USD — a person wrote it. Clamped.
 *   'assumed'         the built-in launch assumption, because nothing else
 *                     exists yet. Clamped. Pays.
 *   'unknown'         an oracle is wired in and has nothing. REFUSES to pay.
 */
export type PriceSource = 'pool' | 'curve' | 'env' | 'assumed' | 'unknown'

/**
 * The server-side price oracle, injected by server.mjs the way __smTokens and
 * __smProfiles are. Absent in the browser and in any process that never built
 * one — in which case everything below reads the environment as it always did.
 */
interface PriceBridge {
    enabled?: boolean
    tokenUsd?: () => number | null
    tokenPriceSource?: () => 'pool' | 'curve' | 'env' | null
}
const bridge = (): PriceBridge | null =>
    ((globalThis as Record<string, unknown>).__smPrices as PriceBridge | undefined) ?? null

let warned = false

/** Read SM_TOKEN_USD, complaining once about a value that is not a price. */
function envTokenUsd(): number | null {
    const raw = typeof process !== 'undefined' ? process.env?.SM_TOKEN_USD : undefined
    if (raw === undefined) return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        if (!warned) {
            warned = true
            console.warn(`[pricing] SM_TOKEN_USD is "${raw}", which is not a positive number — ignoring it`)
        }
        return null
    }
    return parsed
}

/**
 * The price and its provenance, together, because the second decides what the
 * first is allowed to do.
 */
export function priceQuote(): { usd: number; source: PriceSource } {
    const b = bridge()
    if (b) {
        let usd: number | null = null
        let source: 'pool' | 'curve' | 'env' | null = null
        try {
            usd = b.tokenUsd?.() ?? null
            source = b.tokenPriceSource?.() ?? null
        } catch {
            usd = null
            source = null
        }
        if (source && usd !== null && Number.isFinite(usd) && usd > 0) return { usd, source }
        // An oracle exists, is pointed at a real token, and has nothing to say.
        // The launch assumption is a guess here, not a fallback — see header.
        if (b.enabled) return { usd: DEFAULT_USD_PER_TOKEN, source: 'unknown' }
    }
    const env = envTokenUsd()
    if (env !== null) return { usd: env, source: 'env' }
    return { usd: DEFAULT_USD_PER_TOKEN, source: 'assumed' }
}

/** Where today's price came from. Exported so the UI and the tools can say so. */
export const priceSource = (): PriceSource => priceQuote().source

/** One $STONKSTER, in dollars. Always finite and positive — this is for LABELS. */
export function tokenUsd(): number {
    return priceQuote().usd
}

/**
 * How many whole tokens one dollar buys.
 *
 * ZERO MEANS REFUSED, and callers must treat it that way rather than paying a
 * token: it is the answer when no price can be established at all.
 */
export function tokensPerUsd(): number {
    const { usd, source } = priceQuote()
    if (source === 'unknown') return 0
    const per = 1 / usd
    if (source === 'pool' || source === 'curve') return per
    if (per < MIN_TOKENS_PER_USD) return MIN_TOKENS_PER_USD
    if (per > MAX_TOKENS_PER_USD) return MAX_TOKENS_PER_USD
    return per
}

/**
 * Whole tokens worth `usd`. Rounded, never below one — a reward of zero is
 * worse than a small one, because it reads as the game being broken. Which is
 * exactly why zero is reserved for the case where the game IS broken: no
 * price, no quote.
 */
export function tokensForUsd(usd: number): number {
    if (!Number.isFinite(usd) || usd <= 0) return 0
    const per = tokensPerUsd()
    if (!(per > 0)) return 0
    return Math.max(1, Math.round(usd * per))
}

/** Dollars, for a token amount. Used to label what a player just earned. */
export function usdForTokens(tokens: number): number {
    if (!Number.isFinite(tokens) || tokens <= 0) return 0
    return tokens * tokenUsd()
}
