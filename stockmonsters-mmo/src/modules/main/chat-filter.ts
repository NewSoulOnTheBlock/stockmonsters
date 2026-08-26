/*
 * Chat filter. The game is a crypto project, so the abuse it actually invites
 * is shilling: dropping a contract address or a link into public chat.
 *
 * The hard part is evasion — "t . me / scam", "example d o t com",
 * "exampl3.c0m", zero-width padding. So the filter never tests the raw text.
 * It builds two normalized views and checks both:
 *
 *   squashed — every separator removed, homoglyphs folded.
 *              catches "e x a m p l e . c o m" -> "examplecom"
 *   dotted   — PUNCTUATION runs collapsed to ".", spaces left as spaces.
 *              catches "t . me / scam" -> "t.me.scam"
 *
 * The space/punctuation distinction in the dotted view is load-bearing: short
 * TLDs like "to" and "me" are ordinary English words, so "want to trade" must
 * not read as a domain while "example . com" must.
 *
 * Neither view alone is enough, which is why both exist. Length checks run on
 * the raw words instead: a long sentence squashes into one long run and would
 * otherwise look exactly like a base58 address.
 *
 * Framework-independent and unit-tested (chat-filter.spec.ts).
 */

export const CHAT_MAX = 140

const INVISIBLE = /[​-‏⁠﻿­]/g
/** Characters used to break up banned words: spaces, punctuation, symbols. */
const SEPARATORS = /[\s._\-*+~^'"`|/\\()\[\]{}<>,;:!?#=&$@•·・‧°]+/g

/** Homoglyph and leetspeak folding, applied after separators are handled. */
const FOLD: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
    'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
    'х': 'x', 'у': 'y', 'і': 'i', 'ı': 'i', 'ᴏ': 'o',
    'ѕ': 's', 'ϲ': 'c', 'ԁ': 'd',
}

const TLDS = [
    'com', 'net', 'org', 'io', 'xyz', 'app', 'gg', 'me', 'co', 'link', 'finance',
    'fun', 'club', 'shop', 'site', 'online', 'top', 'live', 'ly', 'tv', 'info', 'biz',
    'ru', 'cn', 'tk', 'ml', 'ga', 'cf', 'to', 'cc', 'vip', 'pro', 'dev', 'ai',
].join('|')

// squashed view: the TLD can only be trusted at the very end of a run, and an
// explicit "dot" spelling may sit in front of it.
const DOMAIN_SQUASHED = new RegExp(`[a-z0-9]{3,}(?:dot)(?:${TLDS})$|[a-z0-9]{3,}(?:${TLDS})$`)
// dotted view: a real separator before the TLD is strong evidence on its own.
const DOMAIN_DOTTED = new RegExp(`[a-z0-9]{1,}\\.(?:${TLDS})(?![a-z0-9])`)
const PROTOCOL = /https?|www\.|discord\.gg|telegram/
const EVM_ADDRESS = /0x[a-f0-9]{8,}/
/** base58/hex runs: judged per word, so ordinary sentences never trip it. */
const LONG_TOKEN = /^[a-zA-Z0-9]{26,}$/

export type FilterResult = { ok: true; text: string } | { ok: false; reason: string }

const fold = (s: string) => {
    let out = ''
    for (const ch of s) out += FOLD[ch] ?? ch
    return out
}

const prepare = (text: string) =>
    fold(text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(INVISIBLE, ''))

export function squashed(text: string): string {
    return prepare(text).replace(SEPARATORS, '')
}

export function dotted(text: string): string {
    // only punctuation becomes a dot; spaces stay spaces (see the header note)
    return prepare(text).replace(/[ \t]*[._\-*+~^'"`|/\\()\[\]{}<>,;:!?#=&$@•·・‧°]+[ \t]*/g, '.')
}

export function filterChat(raw: unknown): FilterResult {
    if (typeof raw !== 'string') return { ok: false, reason: 'Empty message.' }
    const text = raw.replace(INVISIBLE, '').trim().replace(/\s+/g, ' ')
    if (!text) return { ok: false, reason: 'Empty message.' }
    if (text.length > CHAT_MAX) return { ok: false, reason: `Keep it under ${CHAT_MAX} characters.` }

    // Addresses are checked before folding: folding turns "0" into "o", which
    // would hide "0x..." from its own pattern.
    const noSep = text.toLowerCase().replace(INVISIBLE, '').replace(SEPARATORS, '')
    if (EVM_ADDRESS.test(noSep)) return { ok: false, reason: 'No contract addresses in chat.' }

    const sq = squashed(text)
    const dt = dotted(text)
    if (PROTOCOL.test(dt) || DOMAIN_DOTTED.test(dt)) return { ok: false, reason: 'No links in chat.' }

    /*
     * THE SQUASHED VIEW NEEDS EVIDENCE OF HIDING.
     *
     * Squashing removes every separator, so a whole sentence becomes one run —
     * and a run ending in any two-letter TLD then looks like a domain. English
     * is full of those: "call me", "text me", "trust me", "go to" all end in a
     * real TLD, and the leet folding makes it worse, because 3 folds to e and
     * "spam 3" becomes "spame" — "spa" plus ".me". Watched two real players get
     * ordinary sentences refused as links, which is a far worse failure than
     * letting one obfuscated domain through.
     *
     * A person hiding a domain leaves a mark: a dot, a bracket, a dash, the
     * word "dot", or letters spaced one apart. Somebody typing a sentence does
     * not. So the squashed rule only runs when the raw text carries one of
     * those marks — "e x a m p l e . c o m" still has its dot, and
     * "example(dot)com" still has its brackets.
     */
    const HIDING = /[.\-_()\[\]{}/\\|:*+]|\bd\s*o\s*t\b|(?:\b[a-z0-9]\s+){3,}/i
    if (HIDING.test(text)) {
        // squashed is one long run for a whole sentence, so only test its tail
        for (const run of sq.split(/[^a-z0-9]+/)) {
            if (DOMAIN_SQUASHED.test(run)) return { ok: false, reason: 'No links in chat.' }
        }
    }
    for (const word of text.split(/\s+/)) {
        if (LONG_TOKEN.test(word)) return { ok: false, reason: 'That looks like an address or key.' }
    }
    return { ok: true, text }
}
