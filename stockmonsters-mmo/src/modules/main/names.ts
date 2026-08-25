/*
 * Player names: chosen once when the wallet connects, shown above every
 * character, and persisted per wallet like the rest of the save.
 *
 * Kept framework-independent so the same rules can be reused by the chat
 * filter and, later, by any leaderboard.
 */

export const NAME_MIN = 3
export const NAME_MAX = 14

// Reserved so nobody can impersonate the game itself or an unnamed player.
const RESERVED = new Set(['trader', 'admin', 'system', 'server', 'stockmonsters', 'mod', 'moderator'])

/** Anything that reads as a URL, contract address or ticker-shill in a name. */
const NAME_BANNED = /0x[0-9a-f]{6,}|\b(?:com|net|org|io|xyz|gg|link)\b|https?|www/i

/**
 * Returns the cleaned name, or an error string explaining the rejection.
 * Letters, digits, underscore and a single inner space are all that survive —
 * lookalike Unicode and zero-width characters are the usual impersonation
 * trick, so anything outside ASCII is refused rather than transliterated.
 */
export function validateName(raw: unknown): { name: string } | { error: string } {
    if (typeof raw !== 'string') return { error: 'Name required.' }
    const name = raw.trim().replace(/\s+/g, ' ')
    if (name.length < NAME_MIN) return { error: `At least ${NAME_MIN} characters.` }
    if (name.length > NAME_MAX) return { error: `At most ${NAME_MAX} characters.` }
    if (!/^[A-Za-z0-9_ ]+$/.test(name)) return { error: 'Letters, numbers, _ and spaces only.' }
    if (!/[A-Za-z0-9]/.test(name)) return { error: 'Needs at least one letter or number.' }
    if (RESERVED.has(name.toLowerCase().replace(/\s/g, ''))) return { error: 'That name is reserved.' }
    // underscores are a separator here too: "scam_com" must not slip through
    if (NAME_BANNED.test(name.replace(/_/g, ' '))) return { error: 'No links or addresses in names.' }
    return { name }
}
