import { describe, it, expect } from 'vitest'
import { XP, awardXp, levelFor, xpForLevel, progressFor, progressOf, setXp, COST_PER_LEVEL } from './trainer'

/*
 * The trainer's level.
 *
 * The HUD invented "LV 12 · 640/1000 XP" for months. What matters here is that
 * the three views of one number — total, level, bar — can never disagree, and
 * that the bar is always drawable: a span of zero divides by zero on screen.
 */

interface Fake {
    vars: Map<string, unknown>
    sent: Array<{ type: string; value: any }>
    getVariable: (k: string) => unknown
    setVariable: (k: string, v: unknown) => void
    emit: (t: string, v: unknown) => void
}

function player(xp?: number): Fake {
    const vars = new Map<string, unknown>()
    if (xp !== undefined) vars.set('TRAINER_XP', xp)
    const sent: Array<{ type: string; value: any }> = []
    return {
        vars,
        sent,
        getVariable: (k) => vars.get(k),
        setVariable: (k, v) => { vars.set(k, v) },
        emit: (type, value) => sent.push({ type, value }),
    }
}
const as = (p: Fake) => p as unknown as Parameters<typeof awardXp>[0]

describe('the curve', () => {
    it('starts everyone at level 1 with nothing', () => {
        expect(levelFor(0)).toBe(1)
        expect(xpForLevel(1)).toBe(0)
        const p = progressFor(0)
        expect(p).toMatchObject({ level: 1, into: 0, span: COST_PER_LEVEL })
    })

    it('agrees with itself at every level for a long way up', () => {
        // The invariant that matters: the level a total buys is the level whose
        // threshold it just passed. A curve and its inverse drifting apart is
        // how a bar ends up showing 130/100.
        for (let level = 1; level <= 200; level++) {
            const at = xpForLevel(level)
            expect(levelFor(at)).toBe(level)
            expect(levelFor(at - 1)).toBe(level - 1 || 1)
            expect(levelFor(at + 1)).toBe(level)
        }
    })

    it('never reports a bar that cannot be drawn', () => {
        for (const xp of [0, 1, 99, 100, 101, 4_499, 4_500, 1_000_000]) {
            const p = progressFor(xp)
            expect(p.span).toBeGreaterThan(0)
            expect(p.into).toBeGreaterThanOrEqual(0)
            expect(p.into).toBeLessThan(p.span)
        }
    })

    it('costs more per level as it goes, but not steeply', () => {
        // Linear-per-level on purpose: the bar has to keep visibly moving,
        // because it is the only feedback for the parts of the game that pay
        // nothing.
        expect(xpForLevel(2)).toBe(100)
        expect(xpForLevel(5)).toBe(1_000)
        expect(xpForLevel(10)).toBe(4_500)
        expect(xpForLevel(20)).toBe(19_000)
    })

    it('treats nonsense as a fresh trainer rather than throwing', () => {
        for (const bad of [-5, NaN, Infinity]) {
            expect(progressFor(bad as number).level).toBe(1)
        }
    })
})

describe('awarding', () => {
    it('adds to the stored total', () => {
        const p = player(0)
        expect(awardXp(as(p), 'battleWin')).toBe(XP.battleWin)
        expect(p.vars.get('TRAINER_XP')).toBe(XP.battleWin)
    })

    it('accumulates', () => {
        const p = player(0)
        awardXp(as(p), 'battleWin')
        awardXp(as(p), 'firstCatch')
        expect(p.vars.get('TRAINER_XP')).toBe(XP.battleWin + XP.firstCatch)
    })

    it('pays a player with no wallet, unlike a reward', () => {
        // Trainer XP is not money and is owed to nobody, so there is no reason
        // to withhold it from someone who has not connected a wallet.
        const p = player()
        expect(awardXp(as(p), 'newMap')).toBe(XP.newMap)
        expect(p.vars.get('TRAINER_XP')).toBe(XP.newMap)
    })

    it('tells the client what happened', () => {
        const p = player(0)
        awardXp(as(p), 'firstCatch')
        expect(p.sent[0]).toMatchObject({
            type: 'trainer:xp',
            value: { kind: 'firstCatch', gained: XP.firstCatch, level: 1 },
        })
    })

    it('flags the level it crossed, and only on the award that crossed it', () => {
        const p = player(xpForLevel(2) - 1)
        awardXp(as(p), 'catch')
        expect(p.sent[0].value.levelUp).toBe(2)
        awardXp(as(p), 'catch')
        // Still level 2 — a second award must not re-announce it.
        expect(p.sent[1].value.levelUp).toBe(0)
    })

    it('values discovery over grinding', () => {
        // A script is good at winning wild battles and bad at finding a species
        // it has never seen, so the curve should not reward the first.
        expect(XP.firstCatch).toBeGreaterThan(XP.battleWin * 4)
        expect(XP.newMap).toBeGreaterThan(XP.battleWin * 3)
        // A duel is worth most: another player had to agree to lose it.
        expect(XP.duelWin).toBeGreaterThan(XP.firstCatch)
    })
})

describe('restoring a stored profile', () => {
    it('takes the stored number', () => {
        const p = player()
        setXp(as(p), 4_500)
        expect(progressOf(as(p))).toMatchObject({ level: 10, into: 0 })
    })

    it('ignores a row that would set an impossible level', () => {
        const p = player(120)
        setXp(as(p), -1)
        setXp(as(p), 'nonsense')
        expect(p.vars.get('TRAINER_XP')).toBe(120)
    })

    it('reads a stored string, because a database round trip may give one', () => {
        const p = player('250' as unknown as number)
        expect(progressOf(as(p)).xp).toBe(250)
    })
})
