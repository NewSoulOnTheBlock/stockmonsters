import { describe, it, expect } from 'vitest'
import { resolveDuel, seededRng, healed, type DuelSide } from './duel'
import { createWildCreature } from './factory'

/*
 * A duel decides who keeps a wager, so the property that matters is not "who
 * wins" — it is that the SAME seed always produces the SAME result, everywhere,
 * for anyone holding it. That is what makes the arena's commit-reveal worth
 * anything: publish keccak(seed) before the fight, reveal the seed after, and
 * a suspicious player can run this function and check.
 */

const rngFor = (seed: string) => seededRng(seed)
const SEED_A = '0x' + 'a1'.repeat(32)
const SEED_B = '0x' + 'b2'.repeat(32)

function side(owner: string, dbSymbol: string, level: number, seed = SEED_A): DuelSide {
    return { owner, creature: createWildCreature(dbSymbol, level, rngFor(seed)) }
}

describe('the seeded rng', () => {
    it('gives the same sequence for the same seed', () => {
        const a = seededRng(SEED_A)
        const b = seededRng(SEED_A)
        const first = Array.from({ length: 20 }, () => a(0, 1000))
        const second = Array.from({ length: 20 }, () => b(0, 1000))
        expect(first).toEqual(second)
    })

    it('gives a different one for a different seed', () => {
        const a = Array.from({ length: 20 }, seededRng(SEED_A).bind(null, 0, 1000))
        const b = Array.from({ length: 20 }, seededRng(SEED_B).bind(null, 0, 1000))
        expect(a).not.toEqual(b)
    })

    it('stays inside the range it was asked for', () => {
        const rng = seededRng(SEED_A)
        for (let i = 0; i < 500; i++) {
            const v = rng(3, 7)
            expect(v).toBeGreaterThanOrEqual(3)
            expect(v).toBeLessThanOrEqual(7)
        }
    })
})

describe('resolving a duel', () => {
    it('is reproducible — the whole basis of the commitment', () => {
        const a = side('alice', 'bulbasaur', 30)
        const b = side('bob', 'charmander', 30)
        const first = resolveDuel(a, b, SEED_A)
        const second = resolveDuel(side('alice', 'bulbasaur', 30), side('bob', 'charmander', 30), SEED_A)
        expect(second.winner).toBe(first.winner)
        expect(second.rounds).toBe(first.rounds)
        expect(second.hpLeft).toEqual(first.hpLeft)
    })

    it('a different seed can produce a different fight', () => {
        // Not "always different" — two seeds may agree on a lopsided matchup.
        // What matters is that the seed is an input at all.
        const runs = [SEED_A, SEED_B].map((seed) =>
            resolveDuel(side('alice', 'bulbasaur', 25), side('bob', 'squirtle', 25), seed))
        expect(runs[0].events.length).not.toBe(runs[1].events.length)
    })

    it('always names a winner', () => {
        for (const seed of [SEED_A, SEED_B, '0x' + '77'.repeat(32)]) {
            const r = resolveDuel(side('alice', 'pikachu', 40), side('bob', 'geodude', 40), seed)
            expect(r.winner === 0 || r.winner === 1).toBe(true)
            expect([r.winnerOwner, r.loserOwner].sort()).toEqual(['alice', 'bob'])
        }
    })

    it('the loser is on the floor when it ends in a knockout', () => {
        const r = resolveDuel(side('alice', 'bulbasaur', 50), side('bob', 'caterpie', 5), SEED_A)
        if (r.reason === 'knockout') expect(r.hpLeft[r.winner === 0 ? 1 : 0]).toBe(0)
    })

    it('a much stronger creature wins', () => {
        // Level 60 against level 5. If this ever flips, the fight is noise.
        const r = resolveDuel(side('alice', 'charizard', 60), side('bob', 'caterpie', 5), SEED_A)
        expect(r.winnerOwner).toBe('alice')
    })

    it('never runs forever', () => {
        // Two identical bulky creatures: the case a round cap exists for.
        const r = resolveDuel(side('alice', 'clefable', 60), side('bob', 'clefable', 60), SEED_A)
        expect(r.rounds).toBeLessThanOrEqual(100)
        expect(['knockout', 'rounds']).toContain(r.reason)
    })

    it('starts both creatures whole', () => {
        const hurt = createWildCreature('bulbasaur', 30, rngFor(SEED_A))
        hurt.hp = 1
        hurt.status = 'burn'
        const fixed = healed(hurt)
        expect(fixed.hp).toBe(fixed.maxHp)
        expect(fixed.status).toBeNull()
        // ...and the original is untouched, so a duel cannot heal a creature
        // that is sitting in someone's party.
        expect(hurt.hp).toBe(1)
    })

    it('produces events a replay can be drawn from', () => {
        const r = resolveDuel(side('alice', 'bulbasaur', 30), side('bob', 'charmander', 30), SEED_A)
        expect(r.events.length).toBeGreaterThan(0)
        expect(r.events.every((e) => typeof e.type === 'string')).toBe(true)
    })
})
