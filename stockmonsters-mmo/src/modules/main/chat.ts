import type { RpgPlayer } from '@rpgjs/server'
import { filterChat } from './chat-filter'

/*
 * Global chat. Messages are validated and filtered server-side (never trust the
 * client's filtering) and broadcast to every connected player.
 *
 * "Global" is deliberate: the world is 171 maps, so a per-map channel would be
 * an empty room almost every time anyone typed.
 *
 * The rate limit is keyed by WALLET, not by connection. Keying it by the
 * connection id — which is thrown away and regenerated on every page load —
 * hands a fresh budget to anyone who presses F5, which is exactly what a
 * spammer does.
 */

/** One message every 5 seconds. Chat is cheap to spam and expensive to moderate. */
const RATE_WINDOW_MS = 5_000
const RATE_MAX = 1
/** Repeating yourself is the cheapest spam there is; hold it for longer. */
const REPEAT_WINDOW_MS = 30_000
const PRUNE_AFTER_MS = 5 * 60_000

interface Talker {
    hits: number[]
    lastText: string
    lastTextAt: number
    seenAt: number
}
const talkers = new Map<string, Talker>()

/** Everyone currently connected, so chat can reach past the sender's map. */
const connected = new Map<string, RpgPlayer>()

export function addChatMember(player: RpgPlayer) {
    connected.set(String(player.id), player)
}
export function removeChatMember(player: RpgPlayer) {
    connected.delete(String(player.id))
}
/** Exposed for tests and for anything that wants a headcount. */
export const chatMemberCount = () => connected.size

/**
 * Who this message is charged to. The wallet outlives reloads; without one
 * (anonymous play) the connection is all there is, which is a weaker limit but
 * still better than none.
 */
function chargeTo(player: RpgPlayer): string {
    const wallet = player.getVariable?.('WALLET_ID') as string | undefined
    return wallet ?? String(player.id)
}

function prune(now: number) {
    if (talkers.size < 200) return // cheap enough to skip until it matters
    for (const [key, t] of talkers) {
        if (now - t.seenAt > PRUNE_AFTER_MS) talkers.delete(key)
    }
}

type Refusal = { reason: string } | null

function checkLimits(key: string, text: string): Refusal {
    const now = Date.now()
    prune(now)
    const t = talkers.get(key) ?? { hits: [], lastText: '', lastTextAt: 0, seenAt: now }
    t.seenAt = now
    t.hits = t.hits.filter((at) => now - at < RATE_WINDOW_MS)

    if (t.hits.length >= RATE_MAX) {
        talkers.set(key, t)
        const wait = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - t.hits[0])) / 1000))
        return { reason: `Slow down — one message every ${RATE_WINDOW_MS / 1000}s. Try again in ${wait}s.` }
    }
    if (text === t.lastText && now - t.lastTextAt < REPEAT_WINDOW_MS) {
        talkers.set(key, t)
        return { reason: 'You just said that.' }
    }

    t.hits.push(now)
    t.lastText = text
    t.lastTextAt = now
    talkers.set(key, t)
    return null
}

export function handleChat(player: RpgPlayer, data: unknown) {
    const result = filterChat((data as { text?: unknown })?.text)
    if (!result.ok) {
        player.emit('chat:message', { system: true, text: result.reason })
        return
    }

    // A nameless player would appear as "Trader" alongside every other nameless
    // player, which makes chat unreadable and impersonation free. Names are
    // mandatory anyway; this is the backstop.
    const name = (player.getVariable?.('NAME') as string | undefined) ?? null
    if (!name) {
        player.emit('chat:message', { system: true, text: 'Choose a name before chatting.' })
        return
    }

    const refusal = checkLimits(chargeTo(player), result.text)
    if (refusal) {
        player.emit('chat:message', { system: true, text: refusal.reason })
        return
    }

    const payload = { from: name, text: result.text }
    const audience = connected.size ? [...connected.values()] : [player]
    for (const peer of audience) peer.emit?.('chat:message', payload)
}

/** Test seam: forget every rate-limit bucket. */
export function resetChatLimits() {
    talkers.clear()
    connected.clear()
}
