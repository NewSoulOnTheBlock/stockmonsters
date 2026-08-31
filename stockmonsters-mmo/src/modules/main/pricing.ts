/*
 * pricing.ts — what a dollar is worth in SMON, right now.
 *
 *   tokenUsd()          the price of one SMON in dollars
 *   tokensForUsd(usd)   whole tokens worth that many dollars, bounded
 *
 * ## Why quests are priced in dollars
 *
 * A quest that pays a fixed 100 tokens is a promise about a number, not about
 * value: it is worth whatever the token happens to be worth that week, and the
 * board silently becomes generous or worthless without anybody deciding it
 * should. The user's call is that a quest is worth a dollar or two, so that is
 * what is written down — and the token amount is derived from it.
 *
 * ## Where the price comes from
 *
 * There is no market on a test network, so today it is configuration:
 * `SM_TOKEN_USD` in the server's environment. When liquidity exists, the AMM
 * pair is the honest source and `readPairPrice` in token.mjs is where it goes;
 * this module is the seam so nothing else has to change.
 *
 * ## The bounds are not optional
 *
 * A price is an input from outside the game, and every reward in the game is
 * denominated by it. A misplaced decimal in an env var — 0.00000002 instead of
 * 0.0002 — would make one quest pay fifty million tokens. So a payout is
 * clamped to a band on both sides of the launch assumption.
 */

/**
 * The assumption everything else is priced from, written the way a person can
 * actually argue about it.
 *
 * THINK IN MARKET CAP, NOT IN PRICE. Supply is fixed at a billion, so the
 * price is only the valuation divided by that — and the valuation is the
 * number with an opinion in it:
 *
 *     $200k -> $0.0002      $1M -> $0.001      $10M -> $0.01
 *
 * $200k fully diluted is the launch assumption. It is deliberately modest: a
 * quest is worth a dollar either way, and the token amount is what moves.
 *
 * This single number decides what every quest pays and what every box costs,
 * so it is configuration (`SM_TOKEN_USD`) and it should be replaced by the
 * live market price the moment there is one.
 */
export const SUPPLY = 1_000_000_000
export const DEFAULT_MARKET_CAP_USD = 200_000
const DEFAULT_USD_PER_TOKEN = DEFAULT_MARKET_CAP_USD / SUPPLY

/**
 * How far the configured price may stray from that assumption before a payout
 * is clamped: 20x in either direction.
 *
 * RELATIVE, NOT ABSOLUTE, and that is the whole point. These were two literal
 * token counts, and the moment the default price moved they no longer had
 * anything to do with it — moving the default from $0.01 to $0.0002 would have
 * put the real value OUTSIDE its own band, quietly paying every quest and
 * every box a flat 2.5x less with nothing to show for it. Derived from the
 * default, the band follows it for free.
 */
export const CLAMP_FACTOR = 20
const MIN_TOKENS_PER_USD = 1 / DEFAULT_USD_PER_TOKEN / CLAMP_FACTOR
const MAX_TOKENS_PER_USD = (1 / DEFAULT_USD_PER_TOKEN) * CLAMP_FACTOR

/** The band, for anything that needs to reason about the clamp. */
export const clampBand = () => ({ min: MIN_TOKENS_PER_USD, max: MAX_TOKENS_PER_USD })

let warned = false

/** One SMON, in dollars. Always finite and positive. */
export function tokenUsd(): number {
    const raw = typeof process !== 'undefined' ? process.env?.SM_TOKEN_USD : undefined
    const parsed = Number(raw)
    if (raw !== undefined && (!Number.isFinite(parsed) || parsed <= 0)) {
        if (!warned) {
            warned = true
            console.warn(`[pricing] SM_TOKEN_USD is "${raw}", which is not a positive number — using ${DEFAULT_USD_PER_TOKEN}`)
        }
        return DEFAULT_USD_PER_TOKEN
    }
    return raw === undefined ? DEFAULT_USD_PER_TOKEN : parsed
}

/** How many whole tokens one dollar buys, after the clamp. */
export function tokensPerUsd(): number {
    const per = 1 / tokenUsd()
    if (per < MIN_TOKENS_PER_USD) return MIN_TOKENS_PER_USD
    if (per > MAX_TOKENS_PER_USD) return MAX_TOKENS_PER_USD
    return per
}

/**
 * Whole tokens worth `usd`. Rounded, never below one — a reward of zero is
 * worse than a small one, because it reads as the game being broken.
 */
export function tokensForUsd(usd: number): number {
    if (!Number.isFinite(usd) || usd <= 0) return 0
    return Math.max(1, Math.round(usd * tokensPerUsd()))
}

/** Dollars, for a token amount. Used to label what a player just earned. */
export function usdForTokens(tokens: number): number {
    if (!Number.isFinite(tokens) || tokens <= 0) return 0
    return tokens * tokenUsd()
}
