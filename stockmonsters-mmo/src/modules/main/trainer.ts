/*
 * trainer.ts — the TRAINER's level, as opposed to a creature's.
 *
 * The HUD has shown "LV 12 · 640/1000 XP" since the day it was drawn, and
 * every digit of it was invented (`demoHudModel()` in src/hud.ts, marked
 * PLACEHOLDER). This is the real thing behind it.
 *
 * ## What it is not
 *
 * It is NOT money and it never becomes money. Trainer XP buys nothing, cannot
 * be claimed, and has no on-chain representation — which is exactly why it can
 * be generous where `earnings.ts` has to be stingy. A bot that grinds levels
 * has wasted its own electricity.
 *
 * That difference is the whole reason this is a separate module rather than a
 * field on the reward ledger: the two are credited at the same moments and
 * from the same events, but one is bounded by a daily cap and a per-epoch
 * on-chain budget, and the other is bounded by nothing at all. Mixing them
 * would eventually put a cap on the wrong one.
 */
import type { RpgPlayer } from '@rpgjs/server'

/**
 * What each thing a player does is worth.
 *
 * Tuned so that the first evening of play moves fast and the numbers stay
 * readable: a new species is worth five wild wins, and walking into a map
 * nobody has shown you is worth four. Discovery beats grinding, deliberately —
 * grinding is the part a script is good at.
 */
export const XP = {
    /** Winning a wild battle. The floor of the economy, so the smallest. */
    battleWin: 12,
    /** Catching something you already have. */
    catch: 6,
    /** Catching a species for the first time. The dex is the point. */
    firstCatch: 60,
    /** Standing on a map for the first time. */
    newMap: 50,
    /** Opening a sealed box. */
    boxOpen: 20,
    /** Winning a duel. Another player agreed to lose it, so it is worth most. */
    duelWin: 120,
} as const

export type XpKind = keyof typeof XP

const V_XP = 'TRAINER_XP'

/**
 * The curve.
 *
 * Level L costs `100 * L` to leave, so the total to REACH level L is
 * `50 * L * (L - 1)`. Level 2 at 100, level 5 at 1,000, level 10 at 4,500,
 * level 20 at 19,000.
 *
 * Linear-per-level rather than exponential on purpose: an exponential curve
 * makes the bar stop visibly moving after a few hours, and this bar is the
 * only feedback a player gets for the parts of the game that pay nothing.
 */
export const COST_PER_LEVEL = 100

/**
 * A finite, non-negative integer, whatever came in.
 *
 * `Math.floor(NaN)` is NaN and `Math.max(0, NaN)` is NaN, so without this a
 * single bad value propagates all the way to the screen and the HUD renders
 * "LV NaN". Infinity is just as bad in the other direction.
 */
const sane = (n: unknown): number => {
    const v = typeof n === 'number' ? n : Number(n)
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/** Total XP needed to have reached `level`. Level 1 is the start, at 0. */
export function xpForLevel(level: number): number {
    const l = Math.max(1, sane(level) || 1)
    return (COST_PER_LEVEL * l * (l - 1)) / 2
}

/**
 * The level a total of `xp` buys.
 *
 * Solved rather than looped: `xp = 50·L·(L−1)` inverts to
 * `L = (1 + sqrt(1 + 8·xp/100)) / 2`. A loop would be fine at these numbers,
 * but this is called on every HUD push.
 */
export function levelFor(xp: number): number {
    const total = sane(xp)
    const level = Math.floor((1 + Math.sqrt(1 + (8 * total) / COST_PER_LEVEL)) / 2)
    return Math.max(1, level)
}

export interface TrainerProgress {
    xp: number
    level: number
    /** XP earned since reaching this level. */
    into: number
    /** XP this level costs in total — `into / span` fills the bar. */
    span: number
}

export function progressFor(xp: number): TrainerProgress {
    const total = sane(xp)
    const level = levelFor(total)
    const base = xpForLevel(level)
    return {
        xp: total,
        level,
        into: total - base,
        span: xpForLevel(level + 1) - base,
    }
}

/** Whatever is stored, as a number. A corrupt value reads as a fresh trainer. */
export function xpOf(player: RpgPlayer): number {
    return sane((player as unknown as { getVariable?: (k: string) => unknown }).getVariable?.(V_XP))
}

export function progressOf(player: RpgPlayer): TrainerProgress {
    return progressFor(xpOf(player))
}

/**
 * Award XP and tell the client.
 *
 * Unlike `credit()` in earnings.ts this does NOT need a wallet: a player with
 * no wallet still sees their own level climb, it simply is not persisted
 * anywhere — and there is nothing to lose, because XP is not owed to anybody.
 *
 * Returns the amount awarded, and emits `trainer:xp` with the new progress
 * plus whether that award crossed a level, so the HUD can celebrate exactly
 * once instead of guessing from a number that changed.
 */
export function awardXp(player: RpgPlayer, kind: XpKind, times = 1): number {
    const amount = XP[kind] * Math.max(0, Math.floor(times))
    if (amount <= 0) return 0

    const before = progressOf(player)
    const after = progressFor(before.xp + amount)
    const p = player as unknown as {
        setVariable?: (k: string, v: unknown) => void
        emit?: (t: string, v: unknown) => void
    }
    p.setVariable?.(V_XP, after.xp)
    p.emit?.('trainer:xp', {
        kind,
        gained: amount,
        levelUp: after.level > before.level ? after.level : 0,
        ...after,
    })
    return amount
}

/** Restoring a stored profile. Clamped so a bad row cannot set a wild level. */
export function setXp(player: RpgPlayer, xp: unknown): void {
    const n = typeof xp === 'number' ? xp : Number(xp)
    if (!Number.isFinite(n) || n < 0) return
    ;(player as unknown as { setVariable?: (k: string, v: unknown) => void })
        .setVariable?.(V_XP, Math.floor(n))
}

export const TRAINER_XP_VAR = V_XP
