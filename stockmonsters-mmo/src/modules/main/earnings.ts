import type { RpgPlayer } from '@rpgjs/server'

/*
 * earnings.ts — what a player is owed for playing, in game tokens.
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP: the game never mints money. Every
 * token credited here is paid out of the rewards pool, which is filled by the
 * trading tax and by the treasury buying tokens back with real revenue. It is
 * a claim on a pot that already exists — not new supply. If a reward is ever
 * added whose funding is not obvious, it is a bug in the economy, not a
 * feature. See docs/token-economy.md.
 *
 * SHAPE
 * Earnings are a ledger in the player's save: { "<epoch>": "<base units>" }.
 * An epoch is one UTC day and matches the on-chain budget the rewards contract
 * enforces, so a leaked claim signer can never sign away more than one day of
 * the pool.
 *
 * NOTHING HERE MOVES A TOKEN. It writes a number the player later asks the
 * server to sign a claim for, and submits themselves. This file has no key, no
 * RPC and no idea what the chain thinks — deliberately, because it is bundled
 * into the browser along with everything else under src/modules.
 */

/** Whole tokens per event. Small on purpose: this is a testnet economy. */
export const REWARDS = {
    /** Winning a wild battle. The bread and butter. */
    battleWin: 10,
    /** Catching a species for the first time — the dex is the collection. */
    firstCatch: 50,
    /** Any catch after the first of that species. */
    catch: 5,
    /** Opening a sealed box. */
    boxOpen: 25,
    /** Standing on a map nobody has walked before. Exploration is content. */
    newMap: 2,
} as const

export type RewardKind = keyof typeof REWARDS

const V_EARNED = 'EARNED'
/**
 * Rewards earned before the wallet arrived.
 *
 * ORDER MATTERS AND IT IS NOT THE ORDER YOU EXPECT: the player joins a map —
 * and can already be earning — several hundred milliseconds before the client
 * has told us which wallet they are. Crediting straight to the ledger in that
 * window silently drops the reward AND marks the map visited, so it can never
 * be earned again. Found by driving a fresh wallet through a real session and
 * finding an empty ledger.
 *
 * So an unidentified player accrues here, and `flushPendingRewards` moves it
 * across the moment `auth:wallet` lands.
 */
const V_PENDING = '_PENDING_REWARDS'
/** A hostile client cannot grow this: it is only ever written by the server. */
const MAX_PENDING = 64

/**
 * The server-side bridge to the chain config, injected by server.mjs. Absent in
 * the browser bundle and in a server with no token — in which case earnings
 * still accrue, they just cannot be claimed until one is configured.
 */
interface TokenBridge {
    currentEpoch?: () => number
    decimalsSync?: () => number
}
const bridge = (): TokenBridge | null =>
    ((globalThis as Record<string, unknown>).__smTokens as TokenBridge | undefined) ?? null

export const currentEpoch = (): number => {
    try {
        return bridge()?.currentEpoch?.() ?? 1
    } catch {
        return 1
    }
}

const decimals = (): number => {
    try {
        return bridge()?.decimalsSync?.() ?? 18
    } catch {
        return 18
    }
}

const baseUnits = (whole: number): bigint => BigInt(whole) * 10n ** BigInt(decimals())

type Ledger = Record<string, string>

const readLedger = (player: RpgPlayer): Ledger => {
    const raw = player.getVariable?.(V_EARNED)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    // Scrub through JSON: getVariable hands back the engine's reactive wrapper,
    // and the transport structuredClone()s everything it emits — cloning a
    // function throws DataCloneError and takes the process down. The same trap
    // player.ts documents for CHARACTER.
    try {
        return JSON.parse(JSON.stringify(raw)) as Ledger
    } catch {
        return {}
    }
}

/**
 * Credit a reward. Returns the whole-token amount credited, or 0 when the
 * player has no wallet — an anonymous player has nowhere to be paid.
 */
export function credit(player: RpgPlayer, kind: RewardKind, times = 1): number {
    const whole = REWARDS[kind] * times
    if (whole <= 0) return 0

    const wallet = player.getVariable?.('WALLET_ID')
    if (typeof wallet !== 'string' || !/^w:[0-9a-f]{32}$/.test(wallet)) {
        // Not identified yet — park it rather than lose it.
        const parked = (player.getVariable?.(V_PENDING) as Array<[RewardKind, number]> | undefined) ?? []
        if (parked.length < MAX_PENDING) {
            player.setVariable?.(V_PENDING, [...parked.map((p) => [p[0], p[1]] as [RewardKind, number]), [kind, times]])
        }
        return 0
    }

    const epoch = String(currentEpoch())
    const ledger = readLedger(player)
    const before = BigInt(ledger[epoch] ?? '0')
    ledger[epoch] = (before + baseUnits(whole)).toString()

    // Keep the ledger bounded: a player who plays every day for a year should
    // not carry a year of history in their save. Anything older than a week is
    // either claimed or expired — the on-chain budget for that day is gone.
    const keep = currentEpoch() - 7
    for (const key of Object.keys(ledger)) if (Number(key) < keep) delete ledger[key]

    player.setVariable?.(V_EARNED, ledger)
    player.emit?.('rewards:earned', { kind, amount: whole, epoch: Number(epoch) })
    return whole
}

/**
 * Move anything parked before the wallet was known into the real ledger.
 * Called from the `auth:wallet` handler — the first moment there is somewhere
 * to put it.
 *
 * @returns whole tokens moved across.
 */
export function flushPendingRewards(player: RpgPlayer): number {
    const parked = player.getVariable?.(V_PENDING) as Array<[RewardKind, number]> | undefined
    if (!parked?.length) return 0
    player.setVariable?.(V_PENDING, [])
    let total = 0
    for (const entry of parked) {
        const kind = entry?.[0]
        const times = Number(entry?.[1] ?? 1)
        if (!kind || !(kind in REWARDS)) continue
        total += credit(player, kind as RewardKind, times)
    }
    return total
}

/** Whole tokens earned this epoch, for a message the player can read. */
export function earnedThisEpoch(player: RpgPlayer): string {
    const ledger = readLedger(player)
    const raw = BigInt(ledger[String(currentEpoch())] ?? '0')
    const d = BigInt(decimals())
    const whole = raw / 10n ** d
    return whole.toString()
}
