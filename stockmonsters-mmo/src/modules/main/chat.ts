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

/*
 * A BURST, THEN A THROTTLE.
 *
 * This was one message every 5 seconds flat, which made an ordinary
 * conversation impossible: two people talking hit the wall on nearly every
 * line, and the game told them to slow down when they were not being fast.
 * Watched it happen live between two real players.
 *
 * A sliding window of 5 messages per 15 seconds lets a real exchange run at
 * its natural pace — including the short back-and-forth that follows a
 * question — while still bounding a spammer to 20 lines a minute. The
 * duplicate-message rule below is what actually stops the copy-paste flood,
 * and it is untouched.
 */
const RATE_WINDOW_MS = 15_000
const RATE_MAX = 5
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

/* ====================================================================== */
/*  HISTORY — so somebody who joins later can read what was said.          */
/* ====================================================================== */
/*
 * Chat used to be broadcast-only: a line reached whoever happened to be
 * connected at that second and then stopped existing. A player logging in five
 * minutes after a conversation saw an empty panel and a game that looked dead.
 *
 * TWO NUMBERS, AND THEY ARE NOT THE SAME DECISION.
 *
 *   - What the DATABASE keeps is one day (chat-log.mjs, KEEP_HOURS). The
 *     user's rule: "günlük temizlesek yeter".
 *   - What a JOINING PLAYER is shown is HISTORY_MAX lines. A busy day can be
 *     hundreds of lines and the panel is 30vh tall — dumping all of it in is
 *     worse than showing nothing, because nobody scrolls back through a wall
 *     of text to find out whether anyone is around. Forty lines is a couple of
 *     screens: enough to read the room and see who is here, short enough that
 *     the newest line is still the one at the bottom.
 *
 * IT IS A DIFFERENT EVENT FROM A LIVE MESSAGE, AND THAT IS LOAD-BEARING.
 * `chat:message` is what src/chat-bubbles.ts listens to, and it draws whatever
 * arrives as a speech bubble over the sender's head. Replaying twenty old
 * lines on that channel would put twenty bubbles over people who are standing
 * silently — so history goes out as `chat:history` instead, which the bubble
 * module does not listen to and never has. There is no flag to forget: a
 * bubble cannot be drawn from a channel nobody is reading. History entries
 * also carry no player `id` at all, so even a future listener has nothing to
 * hang a bubble on.
 */
export const HISTORY_MAX = 40
/** Never show a line older than this. Matches chat-log.mjs's retention. */
export const HISTORY_WINDOW_MS = 24 * 3600_000
/** A little headroom over what is served, so the window is never short. */
const RING_MAX = 80
/**
 * How many times one session may be handed the backlog. The first is the
 * server volunteering it (once per session, from the first onJoinMap); the
 * rest are for the client's backstop ask, which exists because an emit sent
 * while the client is still mounting reaches nobody. Serving is free — it
 * reads this ring, not Postgres — but a client stuck in a loop should still
 * hit a wall.
 */
const HISTORY_SERVE_MAX = 3

export interface ChatHistoryEntry {
    /** The name AS IT WAS SAID. See the migration for why it is not looked up. */
    from: string
    text: string
    /** ms since epoch. */
    at: number
}

/** The store injected by server.mjs, or nothing. Never imported directly. */
interface ChatLogStore {
    append(msg: { walletId?: string | null; name: string; text: string }): void
    recent(limit?: number, windowMs?: number): Promise<ChatHistoryEntry[]>
}

/**
 * chat-log.mjs is Node-only (it imports `pg`) and this file is bundled into
 * the BROWSER as well, so the seam is a global — exactly the arrangement
 * profile.ts uses. Absent means live-only chat, which is precisely the
 * behaviour this game had before history existed.
 */
function chatLog(): ChatLogStore | null {
    const injected = (globalThis as Record<string, unknown>).__smChatLog as ChatLogStore | undefined
    return injected && typeof injected.recent === 'function' ? injected : null
}

/** Said since this process started, newest last. */
const ring: ChatHistoryEntry[] = []
/** Transport player id -> how many times we have handed it the backlog. */
const historyServed = new Map<string, number>()
let primed = false
let priming: Promise<void> | null = null

/**
 * Pull what was said before this process started into the ring, once.
 *
 * WHY IT IS SAFE TO MERGE WITHOUT DEDUPING. The load only ever runs while the
 * ring is EMPTY — that is, before anybody has said anything since boot — so
 * every row it can return is older than everything the ring will ever hold.
 * A message said while the query is in flight cannot be in the result either:
 * it is inserted after the query's snapshot. (This reasoning assumes ONE game
 * process, which is what this game runs. A second one would need real ids.)
 */
function prime(): Promise<void> {
    if (primed) return Promise.resolve()
    if (priming) return priming
    const store = chatLog()
    if (!store || ring.length) {
        primed = true
        return Promise.resolve()
    }
    priming = store
        .recent(HISTORY_MAX, HISTORY_WINDOW_MS)
        .then((rows) => {
            if (Array.isArray(rows) && rows.length) ring.unshift(...rows.filter(isEntry))
            if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
        })
        .catch(() => {
            /* live chat does not depend on this; a missing backlog is not an error */
        })
        .then(() => {
            primed = true
            priming = null
        })
    return priming
}
/** Kick the load off early, so the first joiner is not waiting on a query. */
export const warmChatHistory = (): void => void prime()

const isEntry = (e: unknown): e is ChatHistoryEntry => {
    const v = e as ChatHistoryEntry | null
    return !!v && typeof v.from === 'string' && typeof v.text === 'string' && Number.isFinite(v.at)
}

/** The tail of the backlog, as PLAIN objects — the transport clones them. */
function historyPayload(): ChatHistoryEntry[] {
    const floor = Date.now() - HISTORY_WINDOW_MS
    return ring
        .filter((e) => e.at >= floor)
        .slice(-HISTORY_MAX)
        .map((e) => ({ from: String(e.from), text: String(e.text), at: Number(e.at) }))
}

/**
 * Hand this player the backlog.
 *
 * ONCE PER SESSION, NOT ONCE PER ROOM. A player joins a room on every map
 * change, so the obvious place to call this — onJoinMap — would replay the
 * whole backlog every time somebody walked through a door. The count is keyed
 * by the transport player id, which is stable across a transfer and cleared by
 * onConnected (a fresh session) and by removeChatMember (a departed one).
 *
 * @param onlyOnce the server volunteering it; false is the client asking.
 * @returns whether anything was sent.
 */
export function sendChatHistory(player: RpgPlayer, { onlyOnce = false } = {}): boolean {
    const key = String(player.id)
    const served = historyServed.get(key) ?? 0
    if (onlyOnce && served > 0) return false
    if (served >= HISTORY_SERVE_MAX) return false
    historyServed.set(key, served + 1)

    // ALWAYS answer, even with nothing: the client stops asking once it has
    // heard, and an empty world should not be re-queried every few seconds.
    const deliver = () => {
        try {
            player.emit?.('chat:history', { messages: historyPayload() })
        } catch {
            /* a stale room object; the client's backstop asks again */
        }
    }
    // prime() settles synchronously when there is nothing to load (no store, or
    // already loaded), and only then is the emit synchronous too — which is
    // what the once-per-session guard is tested against.
    const loading = prime()
    if (primed) deliver()
    else void loading.then(deliver)
    return true
}

/** A fresh session inherits nothing — including "already had the backlog". */
export const forgetChatHistory = (playerId: unknown): void => void historyServed.delete(String(playerId))

/** Test seam: forget the backlog itself. */
export function resetChatHistory(): void {
    ring.length = 0
    historyServed.clear()
    primed = false
    priming = null
}

export function addChatMember(player: RpgPlayer) {
    connected.set(String(player.id), player)
    // The first player to connect pays for the backlog load, in the background,
    // long before anyone has typed anything.
    warmChatHistory()
}
export function removeChatMember(player: RpgPlayer) {
    connected.delete(String(player.id))
    // The transport id is recycled, so a session that has really gone must not
    // leave "already had the backlog" behind for whoever inherits its id.
    forgetChatHistory(player.id)
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
        return { reason: `Easy — ${RATE_MAX} messages every ${RATE_WINDOW_MS / 1000}s. ${wait}s.` }
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

    /*
     * WHO SAID IT, not just what their name is.
     *
     * The client draws the same message twice: once in the chat log, and once
     * as a speech bubble over the speaker's sprite (src/chat-bubbles.ts). The
     * bubble needs the sender's PLAYER id, because that is the key the client's
     * scene stores its sprites under — the name would mean a lookup by a
     * string players choose, and a rename mid-session would silently lose the
     * bubble. Everything else about the payload is unchanged, so chat-ui.ts
     * carries on ignoring the extra field.
     */
    const payload = { from: name, text: result.text, id: String(player.id) }
    const audience = connected.size ? [...connected.values()] : [player]
    for (const peer of audience) peer.emit?.('chat:message', payload)

    /*
     * ...and remember it, for whoever logs in next.
     *
     * AFTER the broadcast, and never awaited. Speaking must not wait on a
     * database, and a database that is down must cost the room nothing but its
     * memory: the ring below is what history is actually served from, so chat
     * keeps its backlog for as long as this process lives even with Postgres
     * gone entirely.
     *
     * The name is stored AS IT WAS SAID rather than looked up later — a player
     * can rename, and a freed name can be claimed by somebody else, so
     * resolving an old line through the current name would eventually put
     * words in the wrong person's mouth.
     */
    const entry: ChatHistoryEntry = { from: name, text: result.text, at: Date.now() }
    ring.push(entry)
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
    const wallet = player.getVariable?.('WALLET_ID')
    chatLog()?.append({
        walletId: typeof wallet === 'string' ? wallet : null,
        name: entry.from,
        text: entry.text,
    })
}

/** Test seam: forget every rate-limit bucket. */
export function resetChatLimits() {
    talkers.clear()
    connected.clear()
    resetChatHistory()
}
