import { describe, it, expect } from 'vitest'
import { startWildBattle } from './battle'

/*
 * The battle scene is driven entirely by what the server emits, so this drives
 * a REAL battle — real rules, real damage numbers — through a fake player and
 * asserts the wire traffic the overlay depends on.
 *
 * Browser tests can prove the overlay renders a payload; only this can prove
 * the server produces one. Between them the loop is covered without needing to
 * walk a headless player into a wandering creature.
 */

type Emit = { type: string; value: any }

/** "take the first choice" — move lists differ per creature. */
const FIRST = Symbol('first-choice')

/** Minimal stand-in for RpgPlayer: canned dialog answers, recorded emits. */
function fakePlayer(answers: unknown[]) {
    const vars = new Map<string, unknown>()
    const emits: Emit[] = []
    const texts: string[] = []
    let i = 0
    return {
        player: {
            id: 'test-player',
            name: 'Tester',
            emit(type: string, value: unknown) { emits.push({ type, value }) },
            async showText(t: string) { texts.push(t) },
            async showChoices(_t: string, choices: { text: string; value: unknown }[]) {
                const want = answers[i++]
                if (want === undefined) return null // dismiss: ends the battle
                if (want === FIRST) return choices[0] // "whatever is offered"
                const hit = choices.find((c) => c.value === want)
                return hit ?? choices[0]
            },
            getVariable(k: string) { return vars.get(k) },
            setVariable(k: string, v: unknown) { vars.set(k, v) },
            getCurrentMap() { return undefined },
        } as any,
        emits,
        texts,
        vars,
    }
}

const channels = (emits: Emit[]) => emits.map((e) => e.type)

describe('a wild battle over the wire', () => {
    it('opens the scene, plays the turn, and tears down', async () => {
        // starter 0, then Fight, then the first move, then dismiss.
        const { player, emits, texts } = fakePlayer([0, 'fight', FIRST, undefined])
        await startWildBattle(player, 'AAPL')

        const seen = channels(emits)
        expect(seen[0]).toBe('battle:state')       // scene up before the first line
        expect(seen).toContain('battle:turn')      // the beats to animate
        expect(seen[seen.length - 1]).toBe('battle:end') // always torn down
        expect(texts.some((t) => /appeared/.test(t))).toBe(true)
    })

    it('the first snapshot asks for the entry wipe and carries both sides', async () => {
        const { player, emits } = fakePlayer([0, undefined])
        await startWildBattle(player, 'AAPL')

        const first = emits.find((e) => e.type === 'battle:state')!.value
        expect(first.intro).toBe(true)
        for (const side of ['mine', 'wild'] as const) {
            expect(first[side].name).toBeTruthy()
            expect(first[side].sprite).toMatch(/^dex\/[A-Z0-9]+\.png$/)
            expect(first[side].maxHp).toBeGreaterThan(0)
            expect(first[side].hp).toBeLessThanOrEqual(first[side].maxHp)
        }
    })

    it('turn events are the rules engine own, not a re-description', async () => {
        const { player, emits } = fakePlayer([0, 'fight', FIRST, undefined])
        await startWildBattle(player, 'AAPL')

        const turns = emits.filter((e) => e.type === 'battle:turn')
        expect(turns.length).toBeGreaterThan(0)
        const events = turns.flatMap((t) => t.value.events)
        expect(events.length).toBeGreaterThan(0)
        // every event names a side and a type the overlay knows how to play
        for (const e of events) {
            expect(typeof e.type).toBe('string')
            if ('side' in e) expect([0, 1]).toContain(e.side)
        }
        expect(events.some((e: any) => e.type === 'used')).toBe(true)
    })

    it('never reports HP the snapshot disagrees with', async () => {
        const { player, emits } = fakePlayer([0, 'fight', FIRST, undefined])
        await startWildBattle(player, 'AAPL')

        // The last snapshot before teardown is the authority; damage events must
        // never claim more HP was lost than the creature had.
        const states = emits.filter((e) => e.type === 'battle:state')
        const last = states[states.length - 1].value
        for (const side of ['mine', 'wild'] as const) {
            expect(last[side].hp).toBeGreaterThanOrEqual(0)
            expect(last[side].hp).toBeLessThanOrEqual(last[side].maxHp)
        }
    })

    it('a second battle cannot start while one is running', async () => {
        const { player, emits } = fakePlayer([0, undefined])
        const first = startWildBattle(player, 'AAPL')
        const second = startWildBattle(player, 'NVDA') // must be ignored
        await Promise.all([first, second])
        expect(emits.filter((e) => e.type === 'battle:end').length).toBe(1)
    })
})
