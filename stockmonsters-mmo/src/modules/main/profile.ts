/*
 * Game-side access to server-persisted player profiles.
 *
 * READ THIS BEFORE ADDING AN IMPORT.
 * Everything under src/modules/** is bundled into the CLIENT as well as the
 * server. A `node:fs` import in player.ts once took the entire browser bundle
 * down (HANDOVER). So this file may not import `pg`, `node:*`, profiles.mjs,
 * or anything holding a secret. It contains no database code at all.
 *
 * The seam is a global. server.mjs (Node only) constructs the real store and
 * assigns it to `globalThis.__smProfiles`; this module reads that global and
 * falls back to a no-op implementation when it is absent — which is exactly
 * what happens in the browser, in the vite dev server, and in a server booted
 * without DATABASE_URL. Nothing here changes behaviour when the store is
 * missing; the game just goes back to session-only state.
 */

/** The persisted shape. Mirrors the `state` JSONB blob plus the players row. */
export interface StoredProfile {
    walletId: string
    address: string | null
    name: string | null
    character: string[] | null
    party: unknown[] | null
    box: unknown[] | null
    bag: { balls: number; potions: number } | null
    /** Map ids the player has actually stood on — fast travel is gated on it. */
    visited: string[] | null
    /** Per-epoch reward ledger: { [epoch]: base-unit string }. */
    earned: Record<string, string> | null
    version: number
}

export type ProfilePatch = Partial<Omit<StoredProfile, 'walletId' | 'version'>>

export type NameClaim = { ok: true; name: string } | { ok: false; reason: string }

/** The contract server.mjs must satisfy. Kept structural on purpose. */
export interface ProfileStore {
    readonly enabled: boolean
    loadProfile(walletId: string, meta?: { address?: string | null }): Promise<StoredProfile | null>
    saveProfile(walletId: string, patch: ProfilePatch): void
    claimName(walletId: string, name: string): Promise<NameClaim>
    release(walletId: string): Promise<void>
}

const NO_STORE: ProfileStore = {
    enabled: false,
    async loadProfile() {
        return null
    },
    saveProfile() {
        /* nothing to save to */
    },
    // No database means no global name registry. Accepting is the
    // pre-persistence behaviour and the right failure direction: a duplicate
    // name is a smaller problem than nobody being able to choose one.
    async claimName(_walletId: string, name: string): Promise<NameClaim> {
        return { ok: true, name }
    },
    async release() {
        /* nothing cached */
    },
}

/** The live store, or a no-op that behaves like the pre-persistence game. */
export function profiles(): ProfileStore {
    const injected = (globalThis as Record<string, unknown>).__smProfiles as ProfileStore | undefined
    return injected && typeof injected.loadProfile === 'function' ? injected : NO_STORE
}

/** True only in the Node process that injected a store. */
export const hasProfileStore = () => profiles() !== NO_STORE

/* -------------------------------------------------------------- shapes ----*/
// The blob was written by us, but it may have been written by an older build,
// so nothing from it reaches the game without a shape check.

const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0)

const isList = (v: unknown): v is unknown[] => Array.isArray(v)

/** { "12": "5000000000000000000" } — epoch to base units, both as strings. */
const isLedger = (v: unknown): v is Record<string, string> =>
    !!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.entries(v as Record<string, unknown>).every(
        ([k, amount]) => /^\d+$/.test(k) && typeof amount === 'string' && /^\d+$/.test(amount),
    )

const isBag = (v: unknown): v is { balls: number; potions: number } =>
    !!v &&
    typeof v === 'object' &&
    Number.isFinite((v as { balls?: unknown }).balls) &&
    Number.isFinite((v as { potions?: unknown }).potions)

/* ------------------------------------------------- player-side plumbing ---*/

/**
 * The slice of RpgPlayer this module touches. Structural rather than an
 * `import type { RpgPlayer }` so the file has no engine dependency at all and
 * can be unit-tested with a plain object.
 */
export interface PlayerLike {
    id?: unknown
    name?: string
    getVariable(key: string): unknown
    setVariable(key: string, value: unknown): void
}

/** Variable names the game already uses, in one place. */
export const VARS = {
    character: 'CHARACTER',
    name: 'NAME',
    party: 'PARTY',
    box: 'BOX',
    bag: 'BAG',
    visited: 'VISITED',
    earned: 'EARNED',
    walletId: 'WALLET_ID',
    walletAddress: 'WALLET_ADDRESS',
} as const

/**
 * Reads the persistable slice of a player's variables.
 * Only keys that actually hold something are returned, so a freshly connected
 * player cannot blank a stored party with a patch full of undefined.
 */
export function collectState(player: PlayerLike): ProfilePatch {
    const patch: ProfilePatch = {}
    const character = player.getVariable(VARS.character)
    if (isStringArray(character)) patch.character = character
    const party = player.getVariable(VARS.party)
    if (isList(party)) patch.party = party
    const box = player.getVariable(VARS.box)
    if (isList(box)) patch.box = box
    const bag = player.getVariable(VARS.bag)
    if (isBag(bag)) patch.bag = bag
    const visited = player.getVariable(VARS.visited)
    if (isStringArray(visited)) patch.visited = visited
    const earned = player.getVariable(VARS.earned)
    if (isLedger(earned)) patch.earned = earned
    const address = player.getVariable(VARS.walletAddress)
    if (typeof address === 'string') patch.address = address
    return patch
}

/**
 * Copies a loaded profile into the player's variables.
 *
 * PARTY / BOX / BAG are applied unconditionally when present: the server value
 * is the only copy that exists, so there is nothing to lose a race with.
 * CHARACTER and NAME are handled by the caller because they have a client-side
 * claim to beat — see player.ts.
 *
 * @returns which fields were restored, for logging.
 */
export function applyInventory(player: PlayerLike, profile: StoredProfile): string[] {
    const restored: string[] = []
    if (isList(profile.party) && profile.party.length) {
        player.setVariable(VARS.party, profile.party)
        restored.push(`party:${profile.party.length}`)
    }
    if (isList(profile.box) && profile.box.length) {
        player.setVariable(VARS.box, profile.box)
        restored.push(`box:${profile.box.length}`)
    }
    if (isBag(profile.bag)) {
        player.setVariable(VARS.bag, profile.bag)
        restored.push('bag')
    }
    if (isStringArray(profile.visited) && profile.visited.length) {
        player.setVariable(VARS.visited, profile.visited)
        restored.push(`visited:${profile.visited.length}`)
    }
    if (isLedger(profile.earned) && Object.keys(profile.earned).length) {
        player.setVariable(VARS.earned, profile.earned)
        restored.push('earned')
    }
    return restored
}

/** Validated character array from a profile, or null. */
export const profileCharacter = (profile: StoredProfile): string[] | null =>
    isStringArray(profile.character) ? profile.character : null

/* ------------------------------------------------------ background sync ---*/
/*
 * PARTY / BOX / BAG are mutated inside battle.ts, which this change does not
 * touch. Rather than sprinkle save calls through the battle flow, one timer
 * sweeps every connected wallet and hands the store a patch; the store diffs
 * it and writes nothing when nothing changed, so an idle player costs one
 * JSON.stringify every few seconds and zero queries.
 *
 * The timer only ever exists in the process that injected a store, so the
 * client bundle never starts it.
 */

const connected = new Map<string, PlayerLike>()
let sweeper: ReturnType<typeof setInterval> | null = null
const SWEEP_MS = 5000

function sweep() {
    const store = profiles()
    for (const [walletId, player] of connected) store.saveProfile(walletId, collectState(player))
}

/** Registers a player for background saves. Idempotent. */
export function trackPlayer(walletId: string, player: PlayerLike): void {
    if (!hasProfileStore()) return
    connected.set(walletId, player)
    if (sweeper) return
    sweeper = setInterval(sweep, SWEEP_MS)
    // Never hold the process open just to save nothing.
    ;(sweeper as unknown as { unref?: () => void }).unref?.()
}

/** Final save, then stop tracking. Safe to call for an unknown wallet. */
export async function untrackPlayer(walletId: string): Promise<void> {
    const player = connected.get(walletId)
    const store = profiles()
    if (player) store.saveProfile(walletId, collectState(player))
    connected.delete(walletId)
    await store.release(walletId)
    if (!connected.size && sweeper) {
        clearInterval(sweeper)
        sweeper = null
    }
}

/** Save this player's state now (still batched by the store). */
export function syncPlayer(walletId: string, player: PlayerLike): void {
    profiles().saveProfile(walletId, collectState(player))
}

/** Test seam: forget everything this module is holding. */
export function __resetTracking(): void {
    connected.clear()
    if (sweeper) clearInterval(sweeper)
    sweeper = null
}
