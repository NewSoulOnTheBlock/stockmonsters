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
    /** The TRAINER's lifetime XP. Level and bar are derived from it. */
    trainerXp: number | null
    /** Where they were standing when they last left a map. */
    position: { map: string; x: number; y: number } | null
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

const isPosition = (v: unknown): v is { map: string; x: number; y: number } => {
    const p = v as { map?: unknown; x?: unknown; y?: unknown } | null
    return !!p && typeof p === 'object' &&
        typeof p.map === 'string' && p.map.length > 0 &&
        Number.isFinite(p.x) && Number.isFinite(p.y)
}

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
    trainerXp: 'TRAINER_XP',
    position: 'POSITION',
    walletId: 'WALLET_ID',
    walletAddress: 'WALLET_ADDRESS',
} as const

/**
 * A plain, engine-free copy of a JSON-shaped value.
 *
 * THIS IS NOT PARANOIA. `getVariable` hands back the engine's REACTIVE
 * wrapper, and the wrapper carries a sync callback. Passing one of those to
 * `setVariable` again — which is exactly what restoring a player's state into
 * a fresh room object does — makes the engine try to structuredClone a
 * function on its next broadcast, and the DataCloneError takes the whole Node
 * process down. It also explains the {"$path": …, "$valuesChanges": {}} that
 * turned up inside a saved bag in production.
 */
const plainCopy = <T>(v: T): T => {
    try { return JSON.parse(JSON.stringify(v)) as T } catch { return v }
}

/**
 * Reads the persistable slice of a player's variables.
 * Only keys that actually hold something are returned, so a freshly connected
 * player cannot blank a stored party with a patch full of undefined.
 */
export function collectState(player: PlayerLike): ProfilePatch {
    const patch: ProfilePatch = {}
    const character = player.getVariable(VARS.character)
    if (isStringArray(character)) patch.character = plainCopy(character)
    const party = player.getVariable(VARS.party)
    if (isList(party)) patch.party = plainCopy(party)
    const box = player.getVariable(VARS.box)
    if (isList(box)) patch.box = plainCopy(box)
    const bag = player.getVariable(VARS.bag)
    if (isBag(bag)) patch.bag = plainCopy(bag)
    const visited = player.getVariable(VARS.visited)
    if (isStringArray(visited)) patch.visited = plainCopy(visited)
    const earned = player.getVariable(VARS.earned)
    if (isLedger(earned)) patch.earned = plainCopy(earned)
    const trainerXp = player.getVariable(VARS.trainerXp)
    if (typeof trainerXp === 'number' && Number.isFinite(trainerXp)) patch.trainerXp = trainerXp
    const position = player.getVariable(VARS.position)
    // Scrubbed to a plain object: what getVariable hands back is the engine's
    // reactive wrapper, and one of those reached Postgres as
    // {"$path": "...", "$valuesChanges": {}} alongside the real fields.
    if (isPosition(position)) patch.position = { map: String(position.map), x: Number(position.x), y: Number(position.y) }
    const name = player.getVariable(VARS.name)
    // Carried so a fresh room object can be given the name back. The store
    // never WRITES a name from a patch — only claimName may, because only
    // claimName can lose the race — but it keeps the cache honest.
    if (typeof name === 'string' && name) patch.name = name
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
export function applyInventory(player: PlayerLike, profile: Partial<StoredProfile>): string[] {
    const restored: string[] = []
    if (isList(profile.party) && profile.party.length) {
        player.setVariable(VARS.party, plainCopy(profile.party))
        restored.push(`party:${profile.party.length}`)
    }
    if (isList(profile.box) && profile.box.length) {
        player.setVariable(VARS.box, plainCopy(profile.box))
        restored.push(`box:${profile.box.length}`)
    }
    if (isBag(profile.bag)) {
        player.setVariable(VARS.bag, plainCopy(profile.bag))
        restored.push('bag')
    }
    if (isStringArray(profile.visited) && profile.visited.length) {
        player.setVariable(VARS.visited, plainCopy(profile.visited))
        restored.push(`visited:${profile.visited.length}`)
    }
    if (isLedger(profile.earned) && Object.keys(profile.earned).length) {
        player.setVariable(VARS.earned, plainCopy(profile.earned))
        restored.push('earned')
    }
    if (typeof profile.trainerXp === 'number' && Number.isFinite(profile.trainerXp)) {
        player.setVariable(VARS.trainerXp, Math.max(0, Math.floor(profile.trainerXp)))
        restored.push(`xp:${Math.floor(profile.trainerXp)}`)
    }
    if (isPosition(profile.position)) {
        player.setVariable(VARS.position, { ...profile.position })
        restored.push('position')
    }
    return restored
}

/** Validated character array from a profile, or null. */
export const profileCharacter = (profile: Partial<StoredProfile>): string[] | null =>
    isStringArray(profile.character) ? profile.character : null

/** Validated position from a profile, or null. */
export const profilePosition = (profile: Partial<StoredProfile>) =>
    isPosition(profile.position) ? profile.position : null

/* --------------------------------------------- state between two rooms ----*/
/*
 * WHY THIS EXISTS, AND IT IS THE BIGGEST TRAP IN THE ENGINE.
 *
 * RpgPlayer VARIABLES DO NOT SURVIVE A MAP CHANGE. The engine builds a fresh
 * RpgPlayer for every room, and everything `setVariable` put on the old one is
 * gone — proven by logging WALLET_ID, NAME and even SPAWNED across one door:
 * all three read as absent on the far side, on a player whose id had not
 * changed.
 *
 * Everything this game keeps about a player was a variable, so walking through
 * a door silently reset the session: the wallet identity (so a duel answered
 * "they have no wallet connected"), the name, the party, the box, the bag, the
 * visited list, the reward ledger and the trainer's XP. It also stopped every
 * save, because the background sweeper is keyed to the object registered at
 * login and that object stops changing the moment the player leaves its room.
 *
 * So the authoritative copy lives HERE, keyed by wallet, and each new room
 * object is handed it back. `carry` is called before the player leaves a map,
 * `carried` gives it back after they arrive.
 */
const carried = new Map<string, Partial<StoredProfile>>()

/** Remember this player's state and hand the same patch to the store. */
export function carryState(walletId: string, player: PlayerLike): Partial<StoredProfile> {
    const patch = collectState(player)
    const merged = { ...(carried.get(walletId) ?? {}), ...patch }
    carried.set(walletId, merged)
    profiles().saveProfile(walletId, patch)
    return merged
}

/** What we are holding for this wallet, or null. */
export const carriedState = (walletId: string): Partial<StoredProfile> | null =>
    carried.get(walletId) ?? null

/** Seed the carried copy from a freshly loaded profile. */
export function seedCarried(walletId: string, profile: Partial<StoredProfile>): void {
    carried.set(walletId, plainCopy({ ...(carried.get(walletId) ?? {}), ...profile }))
}

/** Forget a wallet — only when the player has really gone. */
export const dropCarried = (walletId: string): void => void carried.delete(walletId)

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
    carried.clear()
    if (sweeper) clearInterval(sweeper)
    sweeper = null
}
