import { describe, expect, it } from 'vitest'
import { createWildCreature } from './factory'
import { runTurn, turnOrder, liveSpeed } from './turn'
import { accEvaMultiplier } from './accuracy'
import type { Rng } from './damage'

// deterministic rng: consumes a queue, falls back to max roll
const seq = (...vals: number[]): Rng => {
  const q = [...vals]
  return (min, max) => Math.min(Math.max(q.length ? q.shift()! : max, min), max)
}
const maxRng: Rng = (_, max) => max
const midRng: Rng = (min, max) => Math.floor((min + max) / 2)

describe('factory (§2.1)', () => {
  it('builds a legal wild creature', () => {
    const c = createWildCreature('charmander', 20, midRng)
    expect(c.maxHp).toBeGreaterThan(0)
    expect(c.hp).toBe(c.maxHp)
    expect(c.types).toEqual(['fire'])
    expect(c.moves.length).toBeGreaterThan(0)
    expect(c.moves.length).toBeLessThanOrEqual(4)
    expect(c.ivs.atk).toBeGreaterThanOrEqual(0)
    expect(c.ivs.atk).toBeLessThanOrEqual(31)
  })
  it('is deterministic under a fixed rng', () => {
    const a = createWildCreature('bulbasaur', 30, midRng)
    const b = createWildCreature('bulbasaur', 30, midRng)
    expect(a).toEqual(b)
  })
})

describe('turn order (§1.2)', () => {
  const slow = createWildCreature('bulbasaur', 20, midRng)
  const fast = createWildCreature('charmander', 20, midRng)
  it('priority beats speed: quick_attack first even from the slower side', () => {
    slow.stats.spd = 1
    fast.stats.spd = 999
    expect(turnOrder(
      { battler: slow, state: {}, move: 'quick_attack' },
      { battler: fast, state: {}, move: 'tackle' },
      maxRng,
    )).toEqual([0, 1])
  })
  it('speed decides inside a bracket', () => {
    expect(turnOrder(
      { battler: { ...slow, stats: { ...slow.stats, spd: 10 } }, state: {}, move: 'tackle' },
      { battler: { ...fast, stats: { ...fast.stats, spd: 20 } }, state: {}, move: 'tackle' },
      maxRng,
    )).toEqual([1, 0])
  })
  it('paralysis quarters live speed', () => {
    const p = createWildCreature('charmander', 20, midRng)
    const base = liveSpeed(p)
    p.status = 'paralysis'
    expect(liveSpeed(p)).toBe(Math.floor(base * 0.25))
  })
})

describe('accuracy (§1.4)', () => {
  it('thirds curve', () => {
    expect(accEvaMultiplier(3)).toBe(2)
    expect(accEvaMultiplier(-3)).toBe(0.5)
    expect(accEvaMultiplier(0)).toBe(1)
  })
})

describe('runTurn (§1.3, s_basic)', () => {
  it('a full exchange deals damage both ways', () => {
    const a = createWildCreature('charmander', 20, midRng)
    const b = createWildCreature('bulbasaur', 20, midRng)
    const events = runTurn([{ battler: a, state: {}, move: 'scratch' }, { battler: b, state: {}, move: 'tackle' }], midRng)
    const dmg = events.filter((e) => e.type === 'damage')
    expect(dmg.length).toBe(2)
    expect(a.hp).toBeLessThan(a.maxHp)
    expect(b.hp).toBeLessThan(b.maxHp)
  })
  it('type immunity aborts the hit (electric vs ground)', () => {
    const a = createWildCreature('pikachu', 20, midRng)
    const d = createWildCreature('diglett', 20, midRng)
    const events = runTurn([{ battler: a, state: {}, move: 'thunder_shock' }, { battler: d, state: {}, move: 'scratch' }], midRng)
    expect(events.some((e) => e.type === 'immune' && e.side === 1)).toBe(true)
    expect(d.hp).toBe(d.maxHp)
  })
  it('faint ends the turn before the victim acts', () => {
    const a = createWildCreature('charmander', 50, midRng)
    const b = createWildCreature('caterpie', 2, midRng)
    b.stats.spd = 0
    const events = runTurn([{ battler: a, state: {}, move: 'ember' }, { battler: b, state: {}, move: 'tackle' }], midRng)
    expect(events.at(-1)).toEqual({ type: 'fainted', side: 1 })
    expect(events.filter((e) => e.type === 'used').length).toBe(1)
    expect(b.hp).toBe(0)
  })
})
