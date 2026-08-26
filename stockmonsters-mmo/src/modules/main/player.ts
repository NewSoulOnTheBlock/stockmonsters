import { RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server'
import { openMenu, openHudPanel, quitToTitle, travelTo, markVisited, visitedMaps } from './menus'
import { CHARACTER_IDS } from '../../data/character-catalog'
import { validateName } from './names'
import { handleChat, addChatMember, removeChatMember } from './chat'
import {
    friendsConnected,
    friendsRefresh,
    friendsDisconnected,
    handleFriendsList,
    handleFriendAdd,
    handleFriendAccept,
    handleFriendDecline,
    handleFriendCancel,
    handleFriendRemove,
} from './friends'
import {
    addDmMember,
    removeDmMember,
    handleDmNearby,
    handleDmSend,
    handleDmBlock,
    handleDmUnblock,
    handleDmGiftInfo,
} from './dm'
import { Components } from '@rpgjs/server'
import {
    applyInventory,
    collectState,
    profileCharacter,
    profiles,
    syncPlayer,
    trackPlayer,
    untrackPlayer,
    type StoredProfile,
} from './profile'

const DEFAULT_GRAPHIC = 'hero'

// The engine's default text component renders large and anti-aliased, which
// sat on top of the sprite and read as a browser overlay rather than part of
// the game. Small, monospaced and hard-outlined matches the pixel theme; the
// margin lifts it clear of the character's head.
function applyNameTag(player: RpgPlayer) {
    player.setComponentsTop(
        Components.text('{name}', {
            fontFamily: 'Courier New, monospace',
            fontSize: 11,
            fontWeight: 'bold',
            fill: '#fff1c7',
            stroke: '#09070f',
            strokeThickness: 4,
            align: 'center',
        }),
        { width: 96, height: 14, marginBottom: 6 },
    )
}

// The whole character-selector security model: the client sends graphic ids,
// the server accepts only whitelisted ones. An unknown id would render the
// player invisible to everyone with no error (engine has no fallback), so
// this gate is anti-griefing, not cosmetics.
function sanitizeCharacter(input: unknown): string[] | null {
    if (!Array.isArray(input) || input.length < 1 || input.length > 6) return null
    const ids = input.filter((v): v is string => typeof v === 'string' && v.length > 0)
    if (ids.length !== input.length) return null
    if (!ids.every((id) => id === DEFAULT_GRAPHIC || id === 'female' || CHARACTER_IDS.has(id))) return null
    return ids
}

/* ------------------------------------------------------------ profiles ----*/
/*
 * WHY THIS IS MORE THAN "load, then apply".
 *
 * The transport connection id is ephemeral by design (HANDOVER: reusing one
 * left the socket able to receive but not send). The client therefore replays
 * its own CHARACTER and NAME out of localStorage on every load, and keeps
 * re-asserting the character after each map change. That replay predates
 * server persistence and is now a competing, forgeable source of truth.
 *
 * The rule is: once a wallet is proven and the server has a stored value, the
 * SERVER value wins and the client's replay is discarded. Discarding it has to
 * survive the client's retry loop, so a claim the server has already rejected
 * stays rejected for the session (PROFILE_STALE) instead of being re-evaluated
 * every time the player walks through a door.
 *
 * A genuine change made later — the player opens the designer and picks
 * something new — sends a value that is not in that stale set and is accepted
 * and persisted normally.
 */

// Internal player variables. Prefixed so they are obviously not game state.
const V_STATE = '_PROFILE_STATE' // 'loading' | 'ready'
const V_SERVER_CHARACTER = '_PROFILE_CHARACTER'
const V_SERVER_NAME = '_PROFILE_NAME'
const V_LOCK_UNTIL = '_PROFILE_LOCK_UNTIL'
const V_STALE = '_PROFILE_STALE'
const V_PENDING_CHARACTER = '_PROFILE_PENDING_CHARACTER'
const V_PENDING_NAME = '_PROFILE_PENDING_NAME'

// How long after the wallet claim the client's boot replay is still assumed to
// be a replay rather than a deliberate choice. The player must click through
// the title screen and the designer to make a real change, which cannot happen
// inside this window.
const BOOT_WINDOW_MS = 8000

const MAX_STALE = 8

const walletOf = (player: RpgPlayer) => {
    const id = player.getVariable('WALLET_ID')
    return typeof id === 'string' && /^w:[0-9a-f]{32}$/.test(id) ? id : null
}

const key = (ids: string[]) => JSON.stringify(ids)

/**
 * A plain array of plain strings.
 *
 * `getVariable` hands back the engine's reactive wrapper, and the transport
 * structuredClone()s everything it emits — a wrapper carries a sync callback,
 * and cloning a function throws DataCloneError, which killed the whole Node
 * process the first time this code round-tripped a character through a
 * variable. Anything that came out of getVariable is scrubbed before it is
 * emitted or stored.
 */
const plain = (ids: readonly string[]): string[] => Array.from(ids, (id) => String(id))

/**
 * Every profile call from an input handler is fire-and-forget, and Node exits
 * on an unhandled rejection. Nothing about persistence is allowed to end the
 * server process, so every one of them lands here instead.
 */
const logProfileError = (err: unknown) => console.error('[profile]', err)

function markStale(player: RpgPlayer, ids: string[]) {
    const list = (player.getVariable(V_STALE) as string[] | undefined) ?? []
    const k = key(ids)
    if (list.includes(k)) return
    // Bounded: a hostile client could otherwise grow this forever.
    player.setVariable(V_STALE, [...list, k].slice(-MAX_STALE))
}

const isStale = (player: RpgPlayer, ids: string[]) =>
    ((player.getVariable(V_STALE) as string[] | undefined) ?? []).includes(key(ids))

const inBootWindow = (player: RpgPlayer) =>
    Date.now() < ((player.getVariable(V_LOCK_UNTIL) as number | undefined) ?? 0)

/** Apply a character to the player and tell the client it stuck. */
function useCharacter(player: RpgPlayer, input: readonly string[]) {
    // THREE SEPARATE COPIES, ON PURPOSE. setVariable hands the array to the
    // engine's reactive store, which makes it reactive IN PLACE — the array
    // object you passed in comes back carrying a sync callback. Emitting that
    // same object then hits structuredClone, which cannot clone a function, and
    // the DataCloneError kills the Node process rather than one request. So the
    // value that goes over the wire is built fresh, after the stores are done
    // with theirs.
    player.setVariable('CHARACTER', plain(input))
    player.setGraphic(plain(input))
    // The client retries character:set until it sees this, because an action
    // sent before the room is joined is dropped silently.
    player.emit('character:accepted', { layers: plain(input) })
}

/** Apply a name to the player and tell the client it stuck. */
function useName(player: RpgPlayer, input: string) {
    const name = String(input)
    player.setVariable('NAME', name)
    player.name = name
    applyNameTag(player)
    // chat-ui.ts writes this into localStorage, so pushing the server's name
    // here also repairs a client that was holding a stale one.
    player.emit('name:accepted', { name })
}

/**
 * The wallet has been proven; pull the profile and make the server the source
 * of truth. Runs once per session — the client sends `auth:wallet` twice on
 * purpose (once immediately, once after the room is certainly joined).
 */
async function hydrate(player: RpgPlayer, walletId: string, address: string | null) {
    if (player.getVariable(V_STATE)) return
    player.setVariable(V_STATE, 'loading')
    player.setVariable(V_LOCK_UNTIL, Date.now() + BOOT_WINDOW_MS)

    let profile: StoredProfile | null = null
    try {
        profile = await profiles().loadProfile(walletId, { address })
    } catch (err) {
        // The store swallows its own failures; this is belt and braces so a
        // database problem can never stop a player entering the world.
        console.error('[profile] load failed', err)
    }
    player.setVariable(V_STATE, 'ready')

    const parked = player.getVariable(V_PENDING_CHARACTER) as string[] | undefined
    const pendingCharacter = parked?.length ? plain(parked) : undefined
    const pendingName = player.getVariable(V_PENDING_NAME) as string | undefined
    player.setVariable(V_PENDING_CHARACTER, null)
    player.setVariable(V_PENDING_NAME, null)

    // --- no profile (no database, or first ever login) --------------------
    // Nothing to beat, so the client's boot claim is the best information we
    // have. This is exactly the pre-persistence behaviour.
    if (!profile) {
        if (pendingCharacter) useCharacter(player, pendingCharacter)
        if (pendingName) void applyName(player, pendingName).catch(logProfileError)
        trackPlayer(walletId, player)
        return
    }

    const restored = applyInventory(player, profile)

    const stored = profileCharacter(profile)
    if (stored) {
        useCharacter(player, stored)
        player.setVariable(V_SERVER_CHARACTER, stored)
        restored.push('character')
        // The client's localStorage copy lost. Remember it so its retry loop
        // and its post-map-change re-assert do not quietly win later.
        if (pendingCharacter && key(pendingCharacter) !== key(stored)) markStale(player, pendingCharacter)
    } else if (pendingCharacter) {
        useCharacter(player, pendingCharacter)
        profiles().saveProfile(walletId, { character: pendingCharacter })
    }

    if (profile.name) {
        player.setVariable(V_SERVER_NAME, profile.name)
        useName(player, profile.name)
        restored.push('name')
    } else if (pendingName) {
        void applyName(player, pendingName).catch(logProfileError)
    }

    trackPlayer(walletId, player)
    // First write of the session: persists whatever the player already had
    // that the profile did not (e.g. a starter chosen before logging in).
    profiles().saveProfile(walletId, collectState(player))
    if (restored.length) console.log(`[profile] ${walletId} restored ${restored.join(' ')}`)
}

/**
 * Name changes go through the database so the uniqueness index — not a
 * read-then-write in here — decides who gets a contested name.
 */
async function applyName(player: RpgPlayer, name: string) {
    const walletId = walletOf(player)
    if (!walletId) {
        // No wallet: unchanged pre-persistence behaviour, session-local name.
        useName(player, name)
        return
    }
    const serverName = player.getVariable(V_SERVER_NAME) as string | undefined
    // The client re-sends its localStorage name on every boot. If the server
    // knows a different one, the server's is correct and the reply repairs the
    // client's copy.
    if (serverName && serverName !== name && inBootWindow(player)) {
        useName(player, serverName)
        return
    }
    const claim = await profiles().claimName(walletId, name)
    if (!claim.ok) {
        player.emit('name:rejected', { reason: claim.reason })
        return
    }
    player.setVariable(V_SERVER_NAME, claim.name)
    useName(player, claim.name)
}

/* ------------------------------------------------------------ leaving ----*/
/*
 * WHO NOTICES WHEN A PLAYER GOES AWAY.
 *
 * `onDisconnected` is documented by RPG-JS and NEVER CALLED in beta.33 — the
 * engine dispatches `server-player-onConnected`, `-onJoinMap` and
 * `-onLeaveMap`, and nothing else. Verified by instrumenting it and closing a
 * real browser: the hook did not fire. Everything hung off it was therefore
 * dead code: the chat roster, the DM roster and the final profile save.
 *
 * So leaving is detected from `onLeaveMap` instead. That fires for a MAP
 * TRANSFER as well — the engine reconnects the socket and builds a fresh
 * player for the new room — so acting on it immediately would drop a walking
 * player out of chat and tell their friends they had logged off every time
 * they went through a door.
 *
 * Hence the delay: leaving schedules the goodbye, arriving cancels it. A
 * transfer takes well under a second; a player who is really gone never
 * arrives anywhere.
 */
const GOODBYE_MS = 5000
const goodbyes = new Map<string, ReturnType<typeof setTimeout>>()

function cancelGoodbye(player: RpgPlayer) {
    const key = String(player.id)
    const timer = goodbyes.get(key)
    if (!timer) return
    clearTimeout(timer)
    goodbyes.delete(key)
}

function scheduleGoodbye(player: RpgPlayer) {
    const key = String(player.id)
    cancelGoodbye(player)
    const timer = setTimeout(() => {
        goodbyes.delete(key)
        removeChatMember(player)
        removeDmMember(player)
        friendsDisconnected(player)
        // The last write of the session. The store batches, so without this
        // the final few seconds of a battle are lost on a clean exit — and
        // untrackPlayer is also what stops the background sweeper holding a
        // player who left forever.
        const walletId = walletOf(player)
        if (walletId) void untrackPlayer(walletId).catch(logProfileError)
    }, GOODBYE_MS)
    // Never hold the process open just to say goodbye.
    ;(timer as unknown as { unref?: () => void }).unref?.()
    goodbyes.set(key, timer)
}

export const player: RpgPlayerHooks = {
    onConnected(player: RpgPlayer) {
        // Restore the chosen look on EVERY connect — map transfers reconnect
        // the socket, and the graphic must survive them.
        const saved = sanitizeCharacter(player.getVariable('CHARACTER'))
        player.setGraphic(saved ?? [DEFAULT_GRAPHIC])

        // Chat reaches everyone connected, not just this map, so the roster has
        // to be kept here rather than read off a single room.
        addChatMember(player)
        // DMs need the same roster for the opposite reason: to know who is
        // standing where. Both are refreshed again in onJoinMap.
        addDmMember(player)

        // Name tag above every character — synced to all clients by the engine
        player.name = (player.getVariable('NAME') as string | undefined) ?? 'Trader'
        applyNameTag(player)

        // Every map transfer reconnects the socket and fires onConnected
        // again — spawning unconditionally here yanks the player back to the
        // hub mid-transfer and ping-pongs them between maps forever.
        if (player.getVariable('SPAWNED')) return
        player.setVariable('SPAWNED', true)
        // The PSDK game starts you on the Exterior map: System.rxdata says
        // start = Map002 (intro cutscene) and the intro's transfer drops you
        // at exterior tile (24,60) — the ship deck, which the passages layer
        // marks blocked because you leave it via a scripted walk. (24,62) is
        // the first open cell below it: the dock where you step ashore.
        player.changeMap('exterior', {
            x: 784,
            y: 2000
        })
    },
    /**
     * Dead in beta.33 — see the note above. Kept wired so the behaviour is
     * correct if a later version starts calling it, and harmless if both fire:
     * the goodbye is keyed by player id and re-scheduling only resets it.
     */
    onDisconnected(player: RpgPlayer) {
        scheduleGoodbye(player)
    },
    /**
     * Fires for a real disconnect AND for every map transfer, which is why it
     * schedules rather than acts.
     */
    onLeaveMap(player: RpgPlayer) {
        scheduleGoodbye(player)
    },
    /**
     * Standing on a map is what unlocks fast travel to it later, so record it
     * the moment the player arrives. Saving only on a NEW map keeps this off
     * the write path for ordinary movement.
     */
    onJoinMap(player: RpgPlayer, map: { id?: string }) {
        // They arrived somewhere, so they did not leave: this is the other
        // half of the goodbye above.
        cancelGoodbye(player)
        // Refresh the chat roster with THIS object: the engine hands each room
        // a fresh RpgPlayer, and `emit` on a stale one silently does nothing
        // (it needs a current map), so a broadcast would reach nobody.
        addChatMember(player)
        // Same object, same reason — and the DM roster additionally reads this
        // object's position, so a stale one would place the player on the map
        // they just left.
        addDmMember(player)
        // Third roster, same trap: a friend's remote DM is emitted through the
        // object held here.
        friendsRefresh(player)

        const id = String(map?.id ?? '').replace(/^map-/, '')
        const isNew = markVisited(player, id)
        if (isNew) {
            const walletId = player.getVariable('WALLET_ID') as string | undefined
            if (walletId) {
                profiles().saveProfile(walletId, { visited: [...visitedMaps(player)] })
            }
        }
        // Always tell the client the full set, not just the delta: a client
        // that connected mid-session (or reloaded) has no way to rebuild it,
        // and it would show every place as undiscovered.
        player.emit('travel:unlocked', { map: id, isNew, visited: [...visitedMaps(player)] })
    },
    onInput(player: RpgPlayer, { action, data }) {
        // Escape opens our menu (the built-in main menu comes later with
        // proper GUIs); hotbar keys never reach onInput in beta.33.
        if (action == 'escape') { void openMenu(player); return }
        if (action == 'character:set') {
            const ids = sanitizeCharacter((data as { layers?: unknown })?.layers)
            if (!ids) return // silently ignore garbage
            const walletId = walletOf(player)

            if (walletId) {
                const state = player.getVariable(V_STATE)
                // The profile is still in flight. Park the claim rather than
                // applying it — otherwise the player visibly flips from their
                // local character to their real one a moment later.
                if (state === 'loading') {
                    player.setVariable(V_PENDING_CHARACTER, ids)
                    return
                }
                const serverIds = player.getVariable(V_SERVER_CHARACTER) as string[] | undefined
                const sameAsServer = serverIds && key(serverIds) === key(ids)
                if (serverIds && !sameAsServer && (isStale(player, ids) || inBootWindow(player))) {
                    // Stale localStorage replay. Server wins, and say so, or
                    // the client retries this forever.
                    markStale(player, ids)
                    useCharacter(player, serverIds)
                    return
                }
            }

            useCharacter(player, ids)                       // -> @sync() graphics -> every peer
            if (walletId) {
                // This is now the authoritative look for the session.
                player.setVariable(V_SERVER_CHARACTER, ids)
                profiles().saveProfile(walletId, { character: ids }) // -> Postgres, keyed by wallet
            }
            return
        }
        if (action == 'name:set') {
            const result = validateName((data as { name?: unknown })?.name)
            if ('error' in result) {
                player.emit('name:rejected', { reason: result.error })
                return
            }
            // Park it if the profile has not arrived: the stored name must get
            // the chance to win before we claim the client's.
            if (walletOf(player) && player.getVariable(V_STATE) === 'loading') {
                player.setVariable(V_PENDING_NAME, result.name)
                return
            }
            void applyName(player, result.name).catch(logProfileError)
            return
        }
        if (action == 'auth:wallet') {
            // The id is an HMAC only the server can produce (auth.mjs), so a
            // client presenting one has proven wallet ownership at some point.
            // It is the identity we key player-owned things to; the transport
            // connection id is deliberately throwaway.
            const id = (data as { id?: unknown })?.id
            const address = (data as { address?: unknown })?.address
            if (typeof id !== 'string' || !/^w:[0-9a-f]{32}$/.test(id)) return
            player.setVariable('WALLET_ID', id)
            let addr: string | null = null
            if (typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address)) {
                addr = address.toLowerCase()
                player.setVariable('WALLET_ADDRESS', addr)
            }
            // hydrate() is fire-and-forget, so an unhandled rejection in it
            // would take the whole Node process down with it. It must not be
            // possible for a database hiccup to end the server.
            void hydrate(player, id, addr).catch(logProfileError)
            // Friends key off the wallet, which only exists from here on — so
            // this, not onConnected, is where a player joins the friend roster.
            void friendsConnected(player).catch(logProfileError)
            return
        }
        // HUD action bar. Each of these owns a dialog the player can actually
        // read; an unbuilt one says so rather than doing nothing.
        if (action === 'hud:quit') { void quitToTitle(player); return }
        if (action === 'travel:to') {
            void travelTo(player, (data as { map?: unknown })?.map)
            return
        }
        if (typeof action === 'string' && action.startsWith('hud:')) {
            void openHudPanel(player, action.slice(4))
            return
        }
        if (action == 'chat:send') {
            handleChat(player, data)
            return
        }
        // Direct messages. The action key is handled CLIENT-side (dm-ui.ts)
        // because an RPG-JS onAction only fires for events the player faces,
        // and players are not events — so the client asks and the server
        // decides who is close enough. See docs/dm.md.
        if (action == 'dm:nearby') { handleDmNearby(player); return }
        if (action == 'dm:send') { handleDmSend(player, data); return }
        if (action == 'dm:block') { handleDmBlock(player, data); return }
        if (action == 'dm:unblock') { handleDmUnblock(player, data); return }
        if (action == 'dm:gift-info') { handleDmGiftInfo(player, data); return }
        // Friends. Every one of these is a database round trip, so they are
        // async and fire-and-forget — and every rejection lands in the logger,
        // because an unhandled one would take the whole Node process down.
        if (action == 'friends:list') { void handleFriendsList(player).catch(logProfileError); return }
        if (action == 'friends:add') { void handleFriendAdd(player, data).catch(logProfileError); return }
        if (action == 'friends:accept') { void handleFriendAccept(player, data).catch(logProfileError); return }
        if (action == 'friends:decline') { void handleFriendDecline(player, data).catch(logProfileError); return }
        if (action == 'friends:cancel') { void handleFriendCancel(player, data).catch(logProfileError); return }
        if (action == 'friends:remove') { void handleFriendRemove(player, data).catch(logProfileError); return }
        // Anything else the player did is a decent moment to persist whatever
        // battle.ts has been mutating. The store diffs and batches, so this is
        // free when nothing changed.
        const walletId = walletOf(player)
        if (walletId && player.getVariable(V_STATE) === 'ready') syncPlayer(walletId, player)
    }
}
