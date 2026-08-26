import type { RpgPlayer } from '@rpgjs/server'

/*
 * friends.ts — friend requests, the friend list, and who is online.
 *
 * WHAT THIS IS
 * You type someone's name, they get an ask, and NOTHING happens until they
 * press ACCEPT. Once they have, you can see when they are online and message
 * them from anywhere in the world — which is the one privilege a friendship
 * buys: dm.ts otherwise refuses any message between players who are not
 * standing next to each other (see NEAR_PX there).
 *
 * WHY ACCEPTANCE IS THE WHOLE FEATURE
 * Remote messaging is exactly the thing proximity was protecting the player
 * from. Handing it out on one player's say-so would recreate the open whisper
 * channel dm.ts deliberately refuses to be. So the gate is mutual consent, and
 * it is enforced on the SERVER: the client is never asked whether two people
 * are friends, and a client that claims to be one is ignored.
 *
 * WHERE IT LIVES
 * Friendships are relational rows in Postgres (db/migrations/0004_friends.sql),
 * not part of the player's save blob — a friendship belongs to two players at
 * once, and half of it written by one player's flush is not a friendship. They
 * are keyed by WALLET ID, so they survive a reload, a different browser and a
 * different device.
 *
 * WITHOUT A DATABASE
 * This file falls back to a session-only store so the feature still works in
 * dev (vite has no Node process, so no Postgres). The client is told
 * `persistent: false` and the panel says so on screen — a feature that quietly
 * forgets everything on restart reads as broken.
 *
 * THE THREE TRAPS THIS FILE ALREADY WALKED INTO (see chat.ts and dm.ts)
 * 1. The roster is refreshed in onJoinMap, not only on connect: the engine
 *    hands each room a FRESH RpgPlayer, and `emit` on a stale one silently
 *    does nothing.
 * 2. The wallet id arrives LATER than the connection (it comes with
 *    `auth:wallet`), so registration hangs off that, not off onConnected.
 * 3. This file is bundled into the BROWSER as well as the server, like
 *    everything under src/modules. No node:*, no pg — the database is reached
 *    only through the object server.mjs injects at globalThis.__smProfiles.
 */

/* ------------------------------------------------------------- tuning ---- */

/** A list nobody can read is not a feature; this is a sanity bound, not a rule. */
const MAX_FRIENDS = 200
/** Pending asks one player may have out at once. Caps drive-by request spam. */
const MAX_OUTGOING = 30
/** One request every 2 seconds, charged to the wallet. */
const REQUEST_WINDOW_MS = 2_000

/* -------------------------------------------------------------- types ---- */

/** One row as the client sees it. `key` is the wallet id — the stable identity. */
export interface FriendRef {
    key: string
    name: string
}

export interface FriendEntry extends FriendRef {
    online: boolean
    /** Current connection id, for opening a DM. Null while they are offline. */
    id: string | null
    /** Whether a gift is even possible with them. Never the address itself. */
    hasWallet: boolean
}

export interface FriendState {
    /** False when this server has no database: friendships last until restart. */
    persistent: boolean
    /** False when the player has no wallet — friends need a stable identity. */
    identified: boolean
    friends: FriendEntry[]
    incoming: FriendRef[]
    outgoing: FriendRef[]
}

interface StoreRow { walletId: string; name: string | null }
interface StoreState { friends: StoreRow[]; incoming: StoreRow[]; outgoing: StoreRow[] }

/**
 * The slice of the injected profile store this module uses. Every method
 * returns null when the database could not answer — never confuse that with
 * "no", which is why nothing here uses `?? []`.
 */
interface FriendStore {
    findPlayerByName(name: string): Promise<{ walletId: string | null; name: string | null } | null>
    friendState(walletId: string): Promise<StoreState | null>
    requestFriend(from: string, to: string): Promise<{ status: string } | null>
    acceptFriend(me: string, other: string): Promise<{ ok: boolean; reason?: string } | null>
    dropRequest(from: string, to: string): Promise<{ ok: boolean } | null>
    removeFriend(me: string, other: string): Promise<{ ok: boolean } | null>
}

/* ------------------------------------------------- session-only fallback -- */
/*
 * Same interface, backed by three Maps. Used when no store is injected: the
 * browser bundle, the vite dev server, and any deployment without
 * DATABASE_URL. Behaviour is identical; only the lifetime is shorter, and the
 * client is told so.
 */

const memFriends = new Map<string, Set<string>>()
const memRequests = new Set<string>() // `${from}->${to}`
const memNames = new Map<string, string>()

/**
 * Display names we have seen, so an OFFLINE friend still has a name in the
 * list. Bounded: a long-lived process must not grow one entry per player who
 * ever logged in. Evicting only costs a name — never a friendship.
 */
const NAME_MAX = 1000
function remember(walletId: string, name: string | null | undefined) {
    if (!walletId || !name) return
    memNames.set(walletId, name)
    if (memNames.size <= NAME_MAX) return
    for (const k of memNames.keys()) {
        if (memNames.size <= NAME_MAX) break
        if (!online.has(k)) memNames.delete(k)
    }
}

const edge = (from: string, to: string) => `${from}->${to}`
const setOf = (m: Map<string, Set<string>>, k: string) => {
    let s = m.get(k)
    if (!s) { s = new Set(); m.set(k, s) }
    return s
}

const memoryStore: FriendStore = {
    async findPlayerByName(name: string) {
        const wanted = name.trim().toLowerCase()
        for (const [walletId, known] of memNames) {
            if (known.toLowerCase() === wanted) return { walletId, name: known }
        }
        return { walletId: null, name: null }
    },
    async friendState(walletId: string) {
        const row = (key: string): StoreRow => ({ walletId: key, name: memNames.get(key) ?? null })
        const incoming: StoreRow[] = []
        const outgoing: StoreRow[] = []
        for (const e of memRequests) {
            const [from, to] = e.split('->')
            if (to === walletId) incoming.push(row(from))
            else if (from === walletId) outgoing.push(row(to))
        }
        return { friends: [...setOf(memFriends, walletId)].map(row), incoming, outgoing }
    },
    async requestFriend(from: string, to: string) {
        if (setOf(memFriends, from).has(to)) return { status: 'already-friends' }
        if (memRequests.delete(edge(to, from))) {
            setOf(memFriends, from).add(to)
            setOf(memFriends, to).add(from)
            memRequests.delete(edge(from, to))
            return { status: 'friends' }
        }
        if (memRequests.has(edge(from, to))) return { status: 'duplicate' }
        memRequests.add(edge(from, to))
        return { status: 'requested' }
    },
    async acceptFriend(me: string, other: string) {
        if (!memRequests.delete(edge(other, me))) {
            return setOf(memFriends, me).has(other)
                ? { ok: true }
                : { ok: false, reason: 'no-request' }
        }
        memRequests.delete(edge(me, other))
        setOf(memFriends, me).add(other)
        setOf(memFriends, other).add(me)
        return { ok: true }
    },
    async dropRequest(from: string, to: string) {
        return { ok: memRequests.delete(edge(from, to)) }
    },
    async removeFriend(me: string, other: string) {
        const had = setOf(memFriends, me).delete(other)
        setOf(memFriends, other).delete(me)
        return { ok: had }
    },
}

/** The injected store, or null when this process has none. */
function backing(): FriendStore | null {
    const injected = (globalThis as Record<string, unknown>).__smProfiles as Partial<FriendStore> | undefined
    return injected && typeof injected.friendState === 'function' ? (injected as FriendStore) : null
}

const store = (): FriendStore => backing() ?? memoryStore
/** True when a friendship outlives the server process. Shown to the player. */
export const friendsPersistent = () => !!backing()

/* ------------------------------------------------------------- reading --- */

const WALLET = /^w:[0-9a-f]{32}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export function walletOf(player: unknown): string | null {
    const v = (player as any)?.getVariable?.('WALLET_ID')
    return typeof v === 'string' && WALLET.test(v) ? v : null
}

function nameOf(player: unknown): string | null {
    const p = player as any
    const v = p?.getVariable?.('NAME')
    if (typeof v === 'string' && v) return v
    const n = typeof p?.name === 'function' ? p.name() : p?.name
    return typeof n === 'string' && n ? n : null
}

const hasWallet = (player: unknown): boolean => {
    const v = (player as any)?.getVariable?.('WALLET_ADDRESS')
    return typeof v === 'string' && ADDRESS.test(v)
}

/* -------------------------------------------------------------- roster --- */

/** walletId -> the FRESHEST RpgPlayer object for that player. */
const online = new Map<string, RpgPlayer>()

/**
 * walletId -> their friends' wallet ids, for players who are online.
 *
 * dm.ts asks `areFriends` on every single message, so it has to be a
 * synchronous in-memory answer; a database round trip per line would put a
 * query on the chat path. Loaded when a player identifies, kept in step by the
 * handlers below, and dropped when they leave.
 */
const cache = new Map<string, Set<string>>()

/** Who declined whom this session, so a refusal is not a re-ask every 2s. */
const refused = new Set<string>()

/** Last request time per wallet — the rate limit, keyed like chat's. */
const lastAsk = new Map<string, number>()

/**
 * Pending "went offline" notices, per wallet.
 *
 * A MAP TRANSFER LOOKS EXACTLY LIKE LEAVING: the engine reconnects the socket
 * and builds a fresh RpgPlayer for the new room. Announcing immediately would
 * tell every friend you went offline and came back each time you walked
 * through a door. So the notice waits, and coming back cancels it — which also
 * makes a browser refresh silent, as it should be.
 */
const leaving = new Map<string, ReturnType<typeof setTimeout>>()
// Short, because player.ts already waits out a map transfer before it calls
// this at all. This is the second line of defence, not the first.
const OFFLINE_GRACE_MS = 3_000

/** Cancel a pending offline notice. True when there WAS one (a reconnect). */
function cancelLeaving(walletId: string): boolean {
    const timer = leaving.get(walletId)
    if (!timer) return false
    clearTimeout(timer)
    leaving.delete(walletId)
    return true
}

/**
 * Are these two friends? Synchronous, from cache, server-side only.
 * False for anyone who is not identified by a wallet, which is correct: an
 * anonymous player has no identity to be someone's friend with.
 */
export function areFriends(a: string, b: string): boolean {
    if (!a || !b || a === b) return false
    return !!cache.get(a)?.has(b) || !!cache.get(b)?.has(a)
}

/**
 * Record a new friendship in the synchronous cache.
 *
 * Only for wallets that are ONLINE. An entry for an offline player would never
 * be cleaned up (friendsDisconnected only clears the player who left) and it
 * would be incomplete anyway — their real list is read when they connect.
 */
function link(a: string, b: string) {
    if (online.has(a)) setOf(cache, a).add(b)
    if (online.has(b)) setOf(cache, b).add(a)
}

/** Live player object for a wallet, if they are connected right now. */
export const friendOnline = (walletId: string): RpgPlayer | null => online.get(walletId) ?? null

export const friendCount = () => online.size

/* ------------------------------------------------------------ emitting --- */

const say = (player: unknown, text: string, tone: 'info' | 'warn' | 'ok' = 'info') =>
    (player as any)?.emit?.('friends:system', { text, tone })

function entryFor(walletId: string, name: string | null): FriendEntry {
    const live = online.get(walletId)
    return {
        key: walletId,
        name: (live ? nameOf(live) : null) ?? name ?? memNames.get(walletId) ?? 'Trader',
        online: !!live,
        id: live ? String(live.id) : null,
        hasWallet: live ? hasWallet(live) : false,
    }
}

const refFor = (walletId: string, name: string | null): FriendRef => ({
    key: walletId,
    name: name ?? (online.get(walletId) ? nameOf(online.get(walletId)!) : null) ?? memNames.get(walletId) ?? 'Trader',
})

/** Reads the state for one wallet and sends it. Null store answer -> a warning. */
async function pushState(walletId: string): Promise<FriendState | null> {
    const player = online.get(walletId)
    if (!player) return null
    const raw = await store().friendState(walletId)
    if (!raw) {
        // The database could not answer. Say so — a panel that silently shows
        // an empty friend list looks like everyone unfriended you.
        say(player, 'Friends are unavailable right now — the server could not reach its database.', 'warn')
        return null
    }
    const state: FriendState = {
        persistent: friendsPersistent(),
        identified: true,
        friends: raw.friends.map((r) => entryFor(r.walletId, r.name)),
        incoming: raw.incoming.map((r) => refFor(r.walletId, r.name)),
        outgoing: raw.outgoing.map((r) => refFor(r.walletId, r.name)),
    }
    // Keep the synchronous cache honest with what we just read.
    cache.set(walletId, new Set(state.friends.map((f) => f.key)))
    for (const f of state.friends) remember(f.key, f.name)
    player.emit?.('friends:state', state)
    return state
}

/** Tell one player about one friend's presence, without a full re-read. */
function pushPresence(toWallet: string, aboutWallet: string) {
    const to = online.get(toWallet)
    if (!to) return
    to.emit?.('friends:presence', entryFor(aboutWallet, memNames.get(aboutWallet) ?? null))
}

const emptyState = (identified: boolean): FriendState => ({
    persistent: friendsPersistent(),
    identified,
    friends: [],
    incoming: [],
    outgoing: [],
})

/* ------------------------------------------------------ connect / leave --- */

/**
 * Register an identified player and load their friends.
 *
 * Called from the `auth:wallet` handler rather than onConnected: the wallet id
 * — the identity a friendship is keyed to — does not exist yet when the socket
 * connects.
 */
export async function friendsConnected(player: RpgPlayer): Promise<void> {
    const me = walletOf(player)
    if (!me) { player.emit?.('friends:state', emptyState(false)); return }
    // The client sends `auth:wallet` TWICE on purpose (once immediately, once
    // after the room is certainly joined), and every map transfer reconnects
    // the socket. Announcing "X is online" on each of those would ping a
    // friend every time you walked through a door.
    const quiet = online.get(me) === player || cancelLeaving(me)
    online.set(me, player)
    const name = nameOf(player)
    remember(me, name)

    const state = await pushState(me)
    if (!state || quiet) return
    // Everyone who cares that I just arrived.
    for (const f of state.friends) {
        if (!f.online) continue
        pushPresence(f.key, me)
        say(online.get(f.key), `${entryFor(me, name).name} is online.`, 'ok')
    }
    // Someone asked while I was away: that is worth an interruption.
    if (state.incoming.length) {
        say(player, state.incoming.length === 1
            ? `${state.incoming[0].name} wants to be your friend — open FRIENDS to answer.`
            : `${state.incoming.length} friend requests are waiting — open FRIENDS to answer.`, 'ok')
    }
}

/**
 * Replace the roster's player object with this one.
 *
 * onJoinMap hands us a NEW RpgPlayer for the room; emitting on the previous
 * object is a silent no-op, so without this a friend's DM would be "delivered"
 * to nobody after they walk through a door.
 */
export function friendsRefresh(player: RpgPlayer): void {
    const me = walletOf(player)
    if (!me) return
    if (!online.has(me)) { void friendsConnected(player).catch(() => {}); return }
    cancelLeaving(me)
    online.set(me, player)
    remember(me, nameOf(player))
}

export function friendsDisconnected(player: RpgPlayer): void {
    const me = walletOf(player)
    if (!me) return
    // A second tab for the same wallet may have replaced this object already;
    // only clear the roster if we are still the one in it.
    if (online.get(me) !== player) return
    online.delete(me)
    const friends = cache.get(me)
    cache.delete(me)
    if (!friends?.size) return

    cancelLeaving(me)
    const timer = setTimeout(() => {
        leaving.delete(me)
        if (online.has(me)) return // they came back on a new socket
        for (const other of friends) {
            if (!online.has(other)) continue
            pushPresence(other, me)
            say(online.get(other), `${memNames.get(me) ?? 'A friend'} went offline.`)
        }
    }, OFFLINE_GRACE_MS)
    // Never hold the process open just to tell someone a friend left.
    ;(timer as unknown as { unref?: () => void }).unref?.()
    leaving.set(me, timer)
}

/* ------------------------------------------------------------ handlers --- */

/** `friends:list` — the panel asking for a fresh snapshot. */
export async function handleFriendsList(player: RpgPlayer): Promise<void> {
    const me = walletOf(player)
    if (!me) { player.emit?.('friends:state', emptyState(false)); return }
    online.set(me, player)
    await pushState(me)
}

/** `friends:add` {name} — ask someone, by the name they chose. */
export async function handleFriendAdd(player: RpgPlayer, data: unknown): Promise<void> {
    const me = walletOf(player)
    if (!me) {
        say(player, 'Connect your wallet before adding friends — a friendship needs an identity that survives a reload.', 'warn')
        return
    }
    if (!nameOf(player)) { say(player, 'Choose a name first, so they know who is asking.', 'warn'); return }

    const wanted = String((data as { name?: unknown })?.name ?? '').trim()
    if (!wanted) { say(player, 'Type the name of the player you want to add.', 'warn'); return }

    const now = Date.now()
    const last = lastAsk.get(me) ?? 0
    if (now - last < REQUEST_WINDOW_MS) { say(player, 'Slow down — one friend request at a time.', 'warn'); return }
    lastAsk.set(me, now)

    const found = await store().findPlayerByName(wanted)
    if (!found) { say(player, 'Friends are unavailable right now — the server could not reach its database.', 'warn'); return }
    if (!found.walletId) {
        // Deliberately the same answer whether the name is free or belongs to
        // someone who has never logged in: this endpoint must not become a way
        // to enumerate which names exist.
        say(player, `No player called "${wanted}" — names are exact, and they must have played at least once.`, 'warn')
        return
    }
    const other = found.walletId
    if (other === me) { say(player, 'You cannot add yourself.', 'warn'); return }
    remember(other, found.name)

    const current = await store().friendState(me)
    if (!current) { say(player, 'Friends are unavailable right now — try again in a moment.', 'warn'); return }
    if (current.friends.length >= MAX_FRIENDS) { say(player, `You already have ${MAX_FRIENDS} friends.`, 'warn'); return }
    if (current.outgoing.length >= MAX_OUTGOING) {
        say(player, `You have ${MAX_OUTGOING} requests waiting for an answer. Cancel one first.`, 'warn')
        return
    }
    if (refused.has(edge(me, other))) {
        // Honest, and it stops a decline being a two-second speed bump.
        say(player, `${found.name ?? wanted} declined a request from you. Ask them in person.`, 'warn')
        return
    }

    const result = await store().requestFriend(me, other)
    if (!result) { say(player, 'That request could not be sent — the server could not reach its database.', 'warn'); return }

    const theirName = refFor(other, found.name).name
    if (result.status === 'already-friends') { say(player, `You and ${theirName} are already friends.`); return }
    if (result.status === 'duplicate') { say(player, `${theirName} already has your request. It is up to them now.`); return }

    if (result.status === 'friends') {
        // They had already asked us: two yeses, so it is a friendship.
        link(me, other)
        say(player, `You and ${theirName} are now friends.`, 'ok')
        say(online.get(other), `${refFor(me, nameOf(player)).name} accepted your friend request.`, 'ok')
        await pushState(me)
        await pushState(other)
        return
    }

    say(player, `Asked ${theirName}. Nothing happens until they accept.`, 'ok')
    await pushState(me)
    if (online.has(other)) {
        say(online.get(other), `${refFor(me, nameOf(player)).name} wants to be your friend — open FRIENDS to answer.`, 'ok')
        await pushState(other)
    }
}

const otherKey = (data: unknown): string | null => {
    const key = (data as { key?: unknown })?.key
    return typeof key === 'string' && WALLET.test(key) ? key : null
}

/** `friends:accept` {key} — the half of the feature that makes it a feature. */
export async function handleFriendAccept(player: RpgPlayer, data: unknown): Promise<void> {
    const me = walletOf(player)
    const other = otherKey(data)
    if (!me || !other) return
    const result = await store().acceptFriend(me, other)
    if (!result) { say(player, 'That could not be accepted — the server could not reach its database.', 'warn'); return }
    if (!result.ok) { say(player, 'That request is no longer there.', 'warn'); await pushState(me); return }

    link(me, other)
    refused.delete(edge(other, me))
    const theirName = refFor(other, null).name
    say(player, `You and ${theirName} are now friends. You can message each other from anywhere.`, 'ok')
    say(online.get(other), `${refFor(me, nameOf(player)).name} accepted your friend request.`, 'ok')
    await pushState(me)
    await pushState(other)
}

/** `friends:decline` {key} — refuse an incoming request. */
export async function handleFriendDecline(player: RpgPlayer, data: unknown): Promise<void> {
    const me = walletOf(player)
    const other = otherKey(data)
    if (!me || !other) return
    const result = await store().dropRequest(other, me)
    if (!result) { say(player, 'That could not be declined — the server could not reach its database.', 'warn'); return }
    // Remembered for the session so declining is not a two-second speed bump.
    refused.add(edge(other, me))
    say(player, `Declined. ${refFor(other, null).name} is not told why.`)
    await pushState(me)
    // The sender's list must lose the pending row, or it hangs there forever.
    if (online.has(other)) await pushState(other)
}

/** `friends:cancel` {key} — withdraw a request I sent. */
export async function handleFriendCancel(player: RpgPlayer, data: unknown): Promise<void> {
    const me = walletOf(player)
    const other = otherKey(data)
    if (!me || !other) return
    const result = await store().dropRequest(me, other)
    if (!result) { say(player, 'That could not be cancelled — the server could not reach its database.', 'warn'); return }
    say(player, `Withdrew your request to ${refFor(other, null).name}.`)
    await pushState(me)
    if (online.has(other)) await pushState(other)
}

/** `friends:remove` {key} — end a friendship, from either side. */
export async function handleFriendRemove(player: RpgPlayer, data: unknown): Promise<void> {
    const me = walletOf(player)
    const other = otherKey(data)
    if (!me || !other) return
    const result = await store().removeFriend(me, other)
    if (!result) { say(player, 'That could not be removed — the server could not reach its database.', 'warn'); return }
    cache.get(me)?.delete(other)
    cache.get(other)?.delete(me)
    const theirName = refFor(other, null).name
    say(player, `You and ${theirName} are no longer friends.`)
    await pushState(me)
    if (online.has(other)) {
        // Neutral wording on purpose, but NOT silence: a friend disappearing
        // from the list with no explanation reads as a bug.
        say(online.get(other), `You and ${refFor(me, nameOf(player)).name} are no longer friends.`)
        await pushState(other)
    }
}

/* --------------------------------------------------------------- tests --- */

/** Test seam: forget the roster, the cache and the session-only store. */
export function resetFriends(): void {
    for (const timer of leaving.values()) clearTimeout(timer)
    leaving.clear()
    online.clear()
    cache.clear()
    refused.clear()
    lastAsk.clear()
    memFriends.clear()
    memRequests.clear()
    memNames.clear()
}
