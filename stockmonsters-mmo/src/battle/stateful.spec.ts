import { describe, expect, it } from 'vitest'
import { createWildCreature } from './factory'
import { runTurn, newBattle, type Combatant } from './turn'
import type { Rng } from './damage'

const midRng: Rng = (min, max) => Math.floor((min + max) / 2)
const noCrit: Rng = (min, max) => (max === 99999 ? 99999 : Math.floor((min + max) / 2))
const mk = (sym: string, level: number, move: string): Combatant => ({
  battler: createWildCreature(sym, level, midRng), state: {}, move,
})

describe('s_protect', () => {
  it('blocks the incoming hit for one turn only', () => {
    const a = mk('gloom', 30, 'protect')
    const b = mk('clefable', 30, 'tackle')
    a.battler.stats.spd = 999
    const battle = newBattle()
    const t1 = runTurn([a, b], noCrit, battle)
    expect(t1.some((e) => e.type === 'protected' && e.side === 0)).toBe(true)
    expect(a.battler.hp).toBe(a.battler.maxHp)
    a.move = 'absorb'
    runTurn([a, b], noCrit, battle)
    expect(a.battler.hp).toBeLessThan(a.battler.maxHp) // protection expired
  })
})

describe('s_2turns', () => {
  it('fly charges one turn and hits the next', () => {
    const a = mk('altaria', 40, 'fly')
    const b = mk('clefable', 40, 'tackle')
    a.battler.stats.spd = 999
    const battle = newBattle()
    const t1 = runTurn([a, b], noCrit, battle)
    expect(t1.some((e) => e.type === 'charging')).toBe(true)
    expect(b.battler.hp).toBe(b.battler.maxHp)
    a.move = 'growl' // ignored: the charged fly must execute
    const t2 = runTurn([a, b], noCrit, battle)
    expect(t2.some((e) => e.type === 'used' && e.side === 0 && (e as any).move === 'fly')).toBe(true)
    expect(b.battler.hp).toBeLessThan(b.battler.maxHp)
  })
})

describe('s_reload', () => {
  it('hyper_beam forces a recharge turn', () => {
    const a = mk('clefable', 50, 'hyper_beam')
    const b = mk('bergmite', 50, 'harden')
    a.battler.stats.spd = 999
    const battle = newBattle()
    runTurn([a, b], noCrit, battle)
    const hpAfter = b.battler.hp
    const t2 = runTurn([a, b], noCrit, battle)
    expect(t2.some((e) => e.type === 'recharging' && e.side === 0)).toBe(true)
    expect(b.battler.hp).toBe(hpAfter)
  })
})

describe('s_weather + damage interaction', () => {
  it('rain_dance halves a later fire hit', () => {
    const battle = newBattle()
    const a = mk('lotad', 40, 'rain_dance')
    const b = mk('charmander', 40, 'ember')
    a.battler.stats.spd = 999
    const t1 = runTurn([a, b], noCrit, battle)
    expect(battle.weather).toBe('rain')
    const c = mk('lotad', 40, 'growl')
    const d = mk('charmander', 40, 'ember')
    c.battler.stats.spd = 999
    const base = runTurn([c, d], noCrit, newBattle())
    const wet = (t1.find((e) => e.type === 'damage' && e.side === 0) as any).amount
    const dry = (base.find((e) => e.type === 'damage' && e.side === 0) as any).amount
    expect(wet).toBeLessThan(dry)
  })
})

describe('s_reflect', () => {
  it('reflect halves physical damage for its holder', () => {
    const battle = newBattle()
    const a = mk('alakazam', 40, 'reflect')
    const b = mk('clefable', 40, 'tackle')
    a.battler.stats.spd = 999
    const t1 = runTurn([a, b], noCrit, battle)
    const shielded = (t1.find((e) => e.type === 'damage' && e.side === 0) as any).amount
    const c = mk('alakazam', 40, 'flash')
    const d = mk('clefable', 40, 'tackle')
    c.battler.stats.spd = 999
    const base = runTurn([c, d], noCrit, newBattle())
    const raw = (base.find((e) => e.type === 'damage' && e.side === 0) as any).amount
    expect(shielded).toBeLessThan(raw)
  })
})

describe('s_bind', () => {
  it('traps and chips maxHp/8 at end of turn', () => {
    const battle = newBattle()
    const a = mk('dhelmise', 40, 'wrap')
    const b = mk('clefable', 40, 'harden')
    a.battler.stats.spd = 999
    const t1 = runTurn([a, b], noCrit, battle)
    expect(t1.some((e) => e.type === 'bound' && e.side === 1)).toBe(true)
    expect(t1.some((e) => e.type === 'residual' && (e as any).status === 'bind')).toBe(true)
  })
})
