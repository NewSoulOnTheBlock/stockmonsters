import type { RpgPlayer } from '@rpgjs/server'
import { filterChat } from './chat-filter'
import { areFriends } from './friends'
import { playerMapId, playerPos } from './geometry'

/*
 * dm.ts — player-to-player direct messages and gifting.
 *
 * WHAT THIS IS
 * You walk up to someone standing on the same map, press the action key, and a
 * window opens with their name in it. You type, they see it immediately, they
 * can reply or block you. The same window hands you their wallet address so
 * your own wallet can send them coin or an NFT.
 *
 * WHAT THIS IS NOT
 *   · Not a mailbox. Nothing is written to Postgres, to disk, or to any cache.
 *     A message exists exactly as long as the two sockets that carried it. The
 *     client says so on screen, because a chat window that looks like every
 *     other chat window will be assumed to have history.
 *   · Not an open whisper channel. A DM is refused unless the two players are
 *     still standing next to each other — see NEAR_PX. That is the whole
 *     privacy model: to talk to someone you have to be able to see them, and to
 *     escape someone you can walk away. Cross-world whispering to anyone would
 *     turn this into an unmoderatable spam pipe overnight.
 *
 *     FRIENDS ARE THE ONE EXCEPTION, and they are an exception the recipient
 *     granted themselves: friends.ts only makes two people friends after the
 *     OTHER side pressed ACCEPT. Once they have, distance stops mattering for
 *     that pair — that is the entire reward for adding someone. Un-friending
 *     revokes it immediately, because `areFriends` is read on every message
 *     rather than captured when the window opened.
 *   · Not a payment rail. dmGiftInfo hands over an address. That is all it
 *     does. No key on this server ever touches player funds.
 *
 * THREE THINGS THAT LOOK LIKE STYLE AND ARE NOT
 *
 * 1. The roster is refreshed in onJoinMap, not only onConnected. The engine
 *    hands each room a FRESH RpgPlayer object, and `emit` on a stale one
 *    silently does nothing (it needs a current map). chat.ts learned this the
 *    hard way; this file follows it exactly.
 * 2. Proximity is computed HERE, server-side. RPG-JS `onAction` only fires for
 *    EVENTS the player is facing, and players are not events — so the client
 *    sends `dm:nearby` and the server decides who is close. A client is never
 *    allowed to name its own conversation partner.
 * 3. This file is bundled into the BROWSER as well as the server (everything
 *    under src/modules/main is). No node:*, no pg, no secrets. The only import
 *    is the pure text filter.
 */

/* ------------------------------------------------------------- tuning ---- */

/**
 * "Next to each other" is two tiles at 32px/tile, measured centre to centre.
 * One tile is too strict — the physics repulsion pushes two players standing
 * on the same spot apart, and a strict one-tile rule then refuses a DM between
 * two characters that are visibly touching. Three tiles starts to include
 * people you are not actually with.
 */
export const NEAR_PX = 64

/**
 * One message every 2 seconds, charged to the WALLET.
 *
 * Chat is 5s because chat is a broadcast: one line reaches everyone, so the
 * cost of a bad one is the whole server's attention. A DM reaches exactly one
 * person, who is standing next to you, and who can end it with BLOCK. 5s would
 * make a two-way conversation unusable — a real exchange is several short
 * lines in a row — so the limit only has to stop a firehose, not moderate.
 * 2s caps a scripted sender at 30 lines a minute against a single target who
 * already has a one-click off switch.
 *
 * Keyed by WALLET, never by connection: the connection id is regenerated on
 * every page load, so a connection-keyed limit hands a fresh budget to anyone
 * who presses F5 — which is precisely what a spammer does.
 */
const RATE_WINDOW_MS = 2_000
const RATE_MAX = 1
/** Repeating yourself at someone is the cheapest harassment there is. */
const REPEAT_WINDOW_MS = 15_000
const PRUNE_AFTER_MS = 5 * 60_000
/** Bound on the "who have we seen" table, so a long-lived process cannot grow. */
const SEEN_MAX = 500

/* -------------------------------------------------------------- types ---- */

/** What the client is told about the person it may talk to. */
export interface DmPeer {
    id: string
    name: string
    /** Whether gifting is even possible with them. Never the address itself. */
    hasWallet: boolean
}

/** Debug/inspection view of one connected player. */
export interface DmRosterEntry {
    id: string
    name: string
    address: string | null
    map: string | null
    x: number
    y: number
}

type Emitter = { emit?: (type: string, value?: unknown) => void }

/* ------------------------------------------------------------ reading ---- */

// posOf/mapIdOf live in geometry.ts now: reading a player wrong
// (`Number(player.x)` is NaN, `String(player.map)` is "[object Object]")
// fails silently, and one copy of that knowledge is enough.
const posOf = playerPos
const mapIdOf = playerMapId

/** Unwrap a v5 reactive signal, or pass a plain value through. */
const read = (v: unknown): unknown => {
    try { return typeof v === 'function' ? (v as () => unknown)() : v } catch { return undefined }
}

function nameOf(player: unknown): string | null {
    const p = player as any
    const v = p?.getVariable?.('NAME')
    if (typeof v === 'string' && v) return v
    const n = read(p?.name)
    return typeof n === 'string' && n ? n : null
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
function addressOf(player: unknown): string | null {
    const v = (player as any)?.getVariable?.('WALLET_ADDRESS')
    return typeof v === 'string' && ADDRESS.test(v) ? v.toLowerCase() : null
}

/**
 * Who a block, and a rate-limit bucket, is charged to.
 *
 * The wallet outlives page reloads, so blocking a wallet actually sticks. A
 * player with no wallet can only be identified by their connection id, which
 * dies when they reload — a weaker block, but the alternative is no block at
 * all. See docs/dm.md.
 */
function identityOf(player: unknown): string {
    const w = (player as any)?.getVariable?.('WALLET_ID')
    if (typeof w === 'string' && w) return w
    return String((player as any)?.id ?? '')
}

/* ------------------------------------------------------------- roster ---- */

/** Everyone connected, by player id. Values are always the FRESHEST object. */
const connected = new Map<string, RpgPlayer>()

/**
 * Identity + name of everyone we have seen this session, by player id.
 *
 * Blocking has to work on someone who has already walked off or closed the tab
 * — that is exactly when you want to press it — so the roster alone is not
 * enough to resolve a block target.
 */
const seen = new Map<string, { key: string; name: string }>()

function remember(player: RpgPlayer) {
    const id = String(player.id)
    seen.set(id, { key: identityOf(player), name: nameOf(player) ?? 'Trader' })
    if (seen.size > SEEN_MAX) {
        // Map iterates in insertion order: drop the oldest entries first.
        for (const k of seen.keys()) {
            if (seen.size <= SEEN_MAX) break
            if (!connected.has(k)) seen.delete(k)
        }
    }
}

/**
 * Add or REPLACE this player in the roster.
 *
 * Call from onConnected AND onJoinMap. The engine builds a new RpgPlayer for
 * every room, and emitting on the previous one is a silent no-op, so a stale
 * entry means a delivered-looking message that nobody ever receives.
 */
export function addDmMember(player: RpgPlayer) {
    connected.set(String(player.id), player)
    remember(player)
}

export function removeDmMember(player: RpgPlayer) {
    connected.delete(String(player.id))
}

export const dmMemberCount = () => connected.size

/** Live snapshot of the roster. Positions are read now, never cached. */
export function dmRoster(): DmRosterEntry[] {
    const out: DmRosterEntry[] = []
    for (const [id, p] of connected) {
        const pos = posOf(p) ?? { x: 0, y: 0 }
        out.push({
            id,
            name: nameOf(p) ?? 'Trader',
            address: addressOf(p),
            map: mapIdOf(p),
            x: pos.x,
            y: pos.y,
        })
    }
    return out
}

/* ------------------------------------------------------------- blocks ---- */

/** blocker identity -> identities they refuse. In memory, process lifetime. */
const blocks = new Map<string, Set<string>>()

const blocksWho = (blocker: string, blocked: string) => !!blocks.get(blocker)?.has(blocked)

/** True if EITHER of the two has blocked the other. */
const eitherBlocks = (a: string, b: string) => blocksWho(a, b) || blocksWho(b, a)

/** Who the client means by `id`, even if they have since disconnected. */
function resolveTarget(id: unknown): { id: string; key: string; name: string } | null {
    if (typeof id !== 'string' || !id) return null
    const live = connected.get(id)
    if (live) return { id, key: identityOf(live), name: nameOf(live) ?? 'Trader' }
    const known = seen.get(id)
    return known ? { id, key: known.key, name: known.name } : null
}

/* --------------------------------------------------------- rate limit ---- */

interface Sender {
    hits: number[]
    lastText: string
    lastTextAt: number
    seenAt: number
}
const senders = new Map<string, Sender>()

function prune(now: number) {
    if (senders.size < 200) return
    for (const [key, s] of senders) {
        if (now - s.seenAt > PRUNE_AFTER_MS) senders.delete(key)
    }
}

function checkLimits(key: string, text: string): string | null {
    const now = Date.now()
    prune(now)
    const s = senders.get(key) ?? { hits: [], lastText: '', lastTextAt: 0, seenAt: now }
    s.seenAt = now
    s.hits = s.hits.filter((at) => now - at < RATE_WINDOW_MS)

    if (s.hits.length >= RATE_MAX) {
        senders.set(key, s)
        const wait = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - s.hits[0])) / 1000))
        return `Slow down — one message every ${RATE_WINDOW_MS / 1000}s. Try again in ${wait}s.`
    }
    if (text === s.lastText && now - s.lastTextAt < REPEAT_WINDOW_MS) {
        senders.set(key, s)
        return 'You just said that.'
    }

    s.hits.push(now)
    s.lastText = text
    s.lastTextAt = now
    senders.set(key, s)
    return null
}

/* ----------------------------------------------------------- proximity --- */

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The closest other player on the same map within NEAR_PX, or null.
 *
 * Blocked players — in either direction — are not offered. If you blocked
 * someone, pressing the action key next to them must not put their name back
 * in front of you; and someone you blocked must not be handed your name either.
 */
export function dmNearby(player: RpgPlayer): DmPeer | null {
    addDmMember(player)
    const mine = identityOf(player)
    const myId = String(player.id)
    const myMap = mapIdOf(player)
    const myPos = posOf(player)
    if (!myMap || !myPos) return null

    let best: { peer: DmPeer; d: number } | null = null
    for (const [id, other] of connected) {
        if (id === myId) continue
        const theirs = identityOf(other)
        if (theirs === mine) continue // same person in a second tab
        if (eitherBlocks(mine, theirs)) continue
        if (mapIdOf(other) !== myMap) continue
        const pos = posOf(other)
        if (!pos) continue
        const d = distance(myPos, pos)
        if (d > NEAR_PX) continue
        if (best && (d > best.d || (d === best.d && id > best.peer.id))) continue
        best = {
            d,
            peer: { id, name: nameOf(other) ?? 'Trader', hasWallet: !!addressOf(other) },
        }
    }
    return best?.peer ?? null
}

/** Are these two still standing together? Re-checked on every single message. */
function stillTogether(a: RpgPlayer, b: RpgPlayer): boolean {
    const am = mapIdOf(a)
    const bm = mapIdOf(b)
    if (!am || am !== bm) return false
    const ap = posOf(a)
    const bp = posOf(b)
    if (!ap || !bp) return false
    return distance(ap, bp) <= NEAR_PX
}

/* ------------------------------------------------------------ handlers --- */

const system = (player: Emitter, text: string, peer?: DmPeer | { id: string; name: string } | null) =>
    player.emit?.('dm:system', { text, peer: peer ? { id: peer.id, name: peer.name } : null })

/** `dm:nearby` -> `dm:nearby-result`. */
export function handleDmNearby(player: RpgPlayer) {
    const peer = dmNearby(player)
    player.emit?.('dm:nearby-result', {
        peer,
        reason: peer ? null : 'Nobody is standing close enough to talk to.',
    })
}

/**
 * `dm:send` -> `dm:message` to BOTH sides (the sender has to see their own
 * line; the alternative is the client echoing optimistically, which then shows
 * text the server refused).
 *
 * Order matters: filter first so a refused link costs no rate budget, and
 * rate-limit LAST so nothing that was going to be refused anyway spends it.
 */
export function handleDmSend(player: RpgPlayer, data: unknown) {
    addDmMember(player)
    const to = (data as { to?: unknown })?.to
    const target = resolveTarget(to)

    const result = filterChat((data as { text?: unknown })?.text)
    if (!result.ok) { system(player, result.reason, target); return }

    const myName = nameOf(player)
    if (!myName) { system(player, 'Choose a name before messaging.', target); return }

    if (!target) { system(player, 'That player is not here any more.'); return }

    const recipient = connected.get(target.id)
    if (!recipient) { system(player, `${target.name} has left.`, target); return }

    const mine = identityOf(player)
    if (blocksWho(mine, target.key)) {
        system(player, `You blocked ${target.name}. Unblock them to send a message.`, target)
        return
    }
    if (blocksWho(target.key, mine)) {
        // Honest but neutral. "They blocked you" is an invitation to go and
        // find out why in person; this says the message did not land and stops.
        system(player, `${target.name} is not accepting messages from you.`, target)
        return
    }

    // Distance, unless they have accepted each other as friends. Checked per
    // message, not once per window: removing a friend has to cut the line
    // immediately, and two friends who fall out mid-conversation must not keep
    // a remote channel open because the window was opened while they were.
    if (!stillTogether(player, recipient) && !areFriends(mine, target.key)) {
        system(player,
            `You have walked away from ${target.name}. Stand next to them to talk, ` +
            'or add them as a friend to message them from anywhere.', target)
        return
    }

    const refusal = checkLimits(mine, result.text)
    if (refusal) { system(player, refusal, target); return }

    const at = Date.now()
    // Two payloads, not one shared object: each side is told who the OTHER
    // person is, so the client never has to know its own player id to file a
    // message into the right conversation.
    player.emit?.('dm:message', {
        peer: { id: target.id, name: target.name },
        from: myName,
        text: result.text,
        mine: true,
        at,
    })
    recipient.emit?.('dm:message', {
        peer: { id: String(player.id), name: myName },
        from: myName,
        text: result.text,
        mine: false,
        at,
    })
}

/** `dm:block` -> `dm:blocked`. */
export function handleDmBlock(player: RpgPlayer, data: unknown) {
    addDmMember(player)
    const target = resolveTarget((data as { id?: unknown })?.id)
    if (!target) { system(player, 'That player is not here any more.'); return }
    const mine = identityOf(player)
    if (target.key === mine) { system(player, 'You cannot block yourself.'); return }
    const set = blocks.get(mine) ?? new Set<string>()
    set.add(target.key)
    blocks.set(mine, set)
    player.emit?.('dm:blocked', { id: target.id, name: target.name, blocked: true })
}

/** `dm:unblock` -> `dm:blocked`. */
export function handleDmUnblock(player: RpgPlayer, data: unknown) {
    addDmMember(player)
    const target = resolveTarget((data as { id?: unknown })?.id)
    if (!target) { system(player, 'That player is not here any more.'); return }
    blocks.get(identityOf(player))?.delete(target.key)
    player.emit?.('dm:blocked', { id: target.id, name: target.name, blocked: false })
}

/**
 * `dm:gift-info` -> `dm:gift-result`.
 *
 * THE SERVER NEVER MOVES VALUE. All this returns is the recipient's wallet
 * address; the player's own wallet builds, signs and pays for the transfer.
 *
 * It does disclose an address to whoever is standing next to you — or to a
 * friend, from anywhere. That is inherent to gifting — you cannot send to an
 * address you are not told — and the mitigations are that the other player
 * either stood next to you or accepted your friend request, and that a block
 * cuts it off. Said plainly in docs/dm.md rather than hidden.
 */
export function handleDmGiftInfo(player: RpgPlayer, data: unknown) {
    addDmMember(player)
    const target = resolveTarget((data as { id?: unknown })?.id)
    const fail = (error: string) => player.emit?.('dm:gift-result', { error })

    if (!target) { fail('That player is not here any more.'); return }
    const recipient = connected.get(target.id)
    if (!recipient) { fail(`${target.name} has left.`); return }

    const mine = identityOf(player)
    if (eitherBlocks(mine, target.key)) { fail('You cannot send anything to a blocked player.'); return }
    if (!stillTogether(player, recipient) && !areFriends(mine, target.key)) {
        fail(
            `You have walked away from ${target.name}. Stand next to them to send a gift, ` +
            'or add them as a friend to send one from anywhere.')
        return
    }
    if (!addressOf(player)) { fail('Connect your wallet before sending a gift.'); return }
    const address = addressOf(recipient)
    if (!address) { fail(`${target.name} has no wallet connected, so there is nowhere to send it.`); return }

    player.emit?.('dm:gift-result', { id: target.id, name: target.name, address })
}

/* --------------------------------------------------------------- tests --- */

/** Test seam: forget the roster, every block and every rate-limit bucket. */
export function resetDm() {
    connected.clear()
    seen.clear()
    blocks.clear()
    senders.clear()
}
