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
 * denominated by it. A misplaced decimal in an env var — 0.0000005 instead of
 * 0.0005 — would make one quest pay two million tokens. So a payout is clamped
 * to a band on both sides, and the clamp is reported rather than silent: a
 * board quietly paying the floor is a bug somebody has to see.
 */

/** Fallback price when nothing is configured. One SMON = 5 hundredths of a cent. */
const DEFAULT_USD_PER_TOKEN = 0.0005

/**
 * The band a single dollar may buy. With the default price a dollar is 2,000
 * tokens, so this allows the price to be wrong by 20x in either direction
 * before the clamp bites — wide enough never to interfere with a real
 * repricing, narrow enough that a typo cannot drain the pool.
 */
const MIN_TOKENS_PER_USD = 100
const MAX_TOKENS_PER_USD = 40_000

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
