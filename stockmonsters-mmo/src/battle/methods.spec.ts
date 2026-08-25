import { describe, expect, it } from 'vitest'
import { createWildCreature } from './factory'
import { runTurn, rollMultiHitCount, type Combatant } from './turn'
import type { Rng } from './damage'

const midRng: Rng = (min, max) => Math.floor((min + max) / 2)
const mk = (sym: string, level: number, move: string): Combatant => ({
  battler: createWildCreature(sym, level, midRng), state: {}, move,
})
// rng that avoids crits (roll 99999 space -> high) but hits accuracy and mid damage
const noCrit: Rng = (min, max) => (max === 99999 ? 99999 : Math.floor((min + max) / 2))

describe('multi-hit (§7: 37.5/37.5/12.5/12.5)', () => {
  it('maps the 1..8 roll to 2/2/2,3/3/3,4,5', () => {
    const seq = (v: number): Rng => () => v
    expect(rollMultiHitCount(seq(1))).toBe(2)
    expect(rollMultiHitCount(seq(3))).toBe(2)
    expect(rollMultiHitCount(seq(4))).toBe(3)
    expect(rollMultiHitCount(seq(6))).toBe(3)
    expect(rollMultiHitCount(seq(7))).toBe(4)
    expect(rollMultiHitCount(seq(8))).toBe(5)
  })
  it('double_kick (s_2hits) hits exactly twice', () => {
    const a = mk('hitmonlee', 30, 'double_kick')
    const b = mk('gloom', 30, 'tackle')
    a.battler.stats.spd = 999
    const events = runTurn([a, b], noCrit)
    expect(events.filter((e) => e.type === 'damage' && e.side === 1).length).toBe(2)
    expect(events.find((e) => e.type === 'hits')).toMatchObject({ count: 2 })
  })
})

describe('recoil (s_recoil)', () => {
  it('take_down costs the user 1/4 of dealt damage', () => {
    const a = mk('ampharos', 40, 'take_down')
    const b = mk('bergmite', 40, 'tackle')
    a.battler.stats.spd = 999
    const events = runTurn([a, b], noCrit)
    const dmg = events.find((e) => e.type === 'damage' && e.side === 1) as any
    const rec = events.find((e) => e.type === 'recoil') as any
    expect(rec.amount).toBe(Math.max(1, Math.floor(dmg.amount / 4)))
    // hp at the moment of recoil (the defender counterattacks afterwards)
    expect(rec.hp).toBe(a.battler.maxHp - rec.amount)
  })
})

describe('absorb (s_absorb)', () => {
  it('giga_drain heals 50% of damage dealt', () => {
    const a = mk('gloom', 40, 'giga_drain')
    a.battler.hp = Math.floor(a.battler.maxHp / 2)
    const b = mk('bergmite', 40, 'tackle')
    a.battler.stats.spd = 999
    const before = a.battler.hp
    const events = runTurn([a, b], noCrit)
    const dmg = events.find((e) => e.type === 'damage' && e.side === 1) as any
    const heal = events.find((e) => e.type === 'heal') as any
    expect(heal.amount).toBe(Math.max(1, Math.floor(dmg.amount / 2)))
    // b's counterattack may hit after; check heal applied at its moment
    expect(heal.hp).toBe(before + heal.amount)
  })
})

describe('heal (s_heal)', () => {
  it('recover restores 50% max HP, capped', () => {
    const a = mk('alakazam', 40, 'recover')
    a.battler.hp = 10
    const b = mk('caterpie', 5, 'string_shot')
    a.battler.stats.spd = 999
    const events = runTurn([a, b], noCrit)
    const heal = events.find((e) => e.type === 'heal') as any
    expect(heal.amount).toBe(Math.floor(a.battler.maxHp / 2))
  })
})

describe('ohko (s_ohko)', () => {
  it('fissure removes all current HP when it lands', () => {
    const a = mk('barboach', 60, 'fissure')
    const b = mk('gloom', 30, 'tackle')
    a.battler.stats.spd = 999
    // accuracy 30: roll below 30 to land
    const rng: Rng = (min, max) => (max === 99 ? 10 : Math.floor((min + max) / 2))
    const events = runTurn([a, b], rng)
    expect(b.battler.hp).toBe(0)
    expect(events.at(-1)).toMatchObject({ type: 'fainted', side: 1 })
  })
})
