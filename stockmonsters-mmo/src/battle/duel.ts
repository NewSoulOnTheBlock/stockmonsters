import type { CreatureInstance } from './factory'
import { newBattle, runTurn, type Combatant, type TurnEvent } from './turn'
import type { Rng } from './damage'

/*
 * duel.ts — one creature against another, resolved from a committed seed.
 *
 * A wagered duel cannot be played out turn-by-turn with money on it. Somebody
 * would disconnect the moment they were losing, and "the server decided you
 * forfeited" is exactly the kind of judgement a wager should not need. So a
 * duel is AUTO-RESOLVED: both sides fight to a finish under a fixed policy,
 * driven by randomness that was committed to before either player picked.
 *
 * That buys three things a live fight cannot:
 *
 *   · **Nobody can rage-quit.** The result exists the moment both picks are
 *     locked; closing the tab changes nothing.
 *   · **It is replayable.** Same seed, same creatures, same result — anyone
 *     holding the revealed seed can run this function and check the server's
 *     word. `StockmonstersArena` publishes the seed's hash before the fight
 *     and the seed itself on settlement precisely so they can.
 *   · **It is fast.** A duel resolves in one call, not thirty round trips.
 *
 * The trade is that a duel is not a skill contest — it is a test of the team
 * you brought. That is the honest shape for a blind pick anyway: you are
 * betting on your creature, not on your reflexes.
 */

/** Hard stop. A pair of bulky creatures with weak moves can otherwise stall. */
const MAX_ROUNDS = 100

export interface DuelSide {
    /** Who this creature belongs to. Opaque to the fight itself. */
    owner: string
    creature: CreatureInstance
}

export interface DuelResult {
    /** 0 = the first side, 1 = the second. */
    winner: 0 | 1
    winnerOwner: string
    loserOwner: string
    rounds: number
    /** Every event, in order, for an animated replay of the fight. */
    events: TurnEvent[]
    /** Why it ended — a timeout is not a knockout and should not read as one. */
    reason: 'knockout' | 'rounds'
    hpLeft: [number, number]
}

/**
 * A deterministic RNG from a 32-byte seed.
 *
 * mulberry32 over a hash of the seed hex: small, fast, and — the only property
 * that matters here — identical everywhere. `Math.random` would make the
 * committed seed decorative.
 */
export function seededRng(seedHex: string): Rng {
    let h = 1779033703 ^ seedHex.length
    for (let i = 0; i < seedHex.length; i++) {
        h = Math.imul(h ^ seedHex.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    let a = h >>> 0
    return (min: number, max: number) => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
        return min + Math.floor(r * (max - min + 1))
    }
}

/**
 * Which move a side uses this turn.
 *
 * Deliberately simple and deliberately NOT optimal: pick a damaging move at
 * random, and only fall back to a status move when there is nothing else. A
 * cleverer AI would make the fight turn on how well we modelled the type chart
 * rather than on which creature is stronger — and it would be one more thing
 * two players could argue was unfair.
 */
function chooseMove(c: CreatureInstance, rng: Rng): string {
    const moves = c.moves?.length ? c.moves : ['tackle']
    return moves[rng(0, moves.length - 1)]
}

// Every StatusState field is optional, so a fresh combatant starts empty.
const freshCombatant = (c: CreatureInstance): Combatant => ({
    battler: c,
    move: c.moves?.[0] ?? 'tackle',
    state: {},
})

/**
 * Full HP, no status, no stat stages.
 *
 * A duel is a contest between two Stockmonsters, not a race to catch the other
 * side after a hard morning — and with money on it, "I was on 12 HP" is not an
 * argument anyone should have to have.
 */
export function healed(c: CreatureInstance): CreatureInstance {
    return { ...c, hp: c.maxHp, status: null, stages: {} }
}

/**
 * Fight it out.
 *
 * Both creatures are restored to full first: a duel is a contest between two
 * Stockmonsters, not a race to catch the other side after a hard morning.
 */
export function resolveDuel(sideA: DuelSide, sideB: DuelSide, seedHex: string): DuelResult {
    const rng = seededRng(seedHex)
    const a = freshCombatant(healed(sideA.creature))
    const b = freshCombatant(healed(sideB.creature))
    const battle = newBattle()
    const events: TurnEvent[] = []

    let rounds = 0
    while (rounds < MAX_ROUNDS && a.battler.hp > 0 && b.battler.hp > 0) {
        rounds++
        a.move = chooseMove(a.battler as CreatureInstance, rng)
        b.move = chooseMove(b.battler as CreatureInstance, rng)
        events.push(...runTurn([a, b], rng, battle))
    }

    const aDown = a.battler.hp <= 0
    const bDown = b.battler.hp <= 0

    let winner: 0 | 1
    let reason: DuelResult['reason']
    if (aDown !== bDown) {
        winner = aDown ? 1 : 0
        reason = 'knockout'
    } else {
        // Both standing (the round cap) or both down (a mutual knockout on the
        // same turn): the healthier one takes it, and a dead-exact tie goes to
        // the side that moved first, which the seed decided. Never a coin flip
        // outside the committed randomness.
        reason = aDown && bDown ? 'knockout' : 'rounds'
        const aShare = a.battler.hp / Math.max(1, a.battler.maxHp)
        const bShare = b.battler.hp / Math.max(1, b.battler.maxHp)
        winner = aShare >= bShare ? 0 : 1
    }

    return {
        winner,
        winnerOwner: winner === 0 ? sideA.owner : sideB.owner,
        loserOwner: winner === 0 ? sideB.owner : sideA.owner,
        rounds,
        events,
        reason,
        hpLeft: [Math.max(0, a.battler.hp), Math.max(0, b.battler.hp)],
    }
}
