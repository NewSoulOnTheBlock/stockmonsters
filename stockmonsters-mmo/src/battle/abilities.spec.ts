import { describe, expect, it } from 'vitest'
import { createWildCreature } from './factory'
import { damages, type Rng } from './damage'
import { runTurn, onBattleStart, liveSpeed, newBattle, type Combatant } from './turn'

const midRng: Rng = (min, max) => Math.floor((min + max) / 2)
const noCrit: Rng = (min, max) => (max === 99999 ? 99999 : Math.floor((min + max) / 2))
const maxRoll: Rng = (min, max) => (max === 99999 ? 99999 : max)
const mk = (sym: string, level: number, move: string): Combatant => ({
  battler: createWildCreature(sym, level, midRng), state: {}, move,
})
const ember = { type: 'fire', category: 'special' as const, power: 40, accuracy: 100, pp: 25, priority: 0, criticalRate: 1 }

describe('abilities', () => {
  it('factory assigns an ability from the specie slots', () => {
    const c = createWildCreature('charmander', 20, midRng)
    expect(typeof c.ability).toBe('string')
  })
  it('blaze boosts fire moves below 1/3 HP', () => {
    const a = createWildCreature('charmander', 50, midRng)
    const b = createWildCreature('bulbasaur', 50, midRng)
    a.ability = 'blaze'
    const full = damages(a, { ...b, hp: b.maxHp }, ember, maxRoll, { critical: false }).damage
    a.hp = Math.floor(a.maxHp / 4)
    const pinch = damages(a, { ...b, hp: b.maxHp }, ember, maxRoll, { critical: false }).damage
    expect(pinch).toBeGreaterThan(full)
  })
  it('levitate grants ground immunity', () => {
    const a = mk('diglett', 30, 'mud_slap')
    const b = mk('clefable', 30, 'harden')
    b.battler.ability = 'levitate'
    a.battler.stats.spd = 999
    const events = runTurn([a, b], noCrit, newBattle())
    expect(events.some((e) => e.type === 'immune')).toBe(true)
  })
  it('sturdy survives a full-HP one-shot at 1 HP', () => {
    const a = createWildCreature('charmander', 90, midRng)
    const b = createWildCreature('caterpie', 3, midRng)
    b.ability = 'sturdy'
    const r = damages(a, b, ember, maxRoll, { critical: false })
    expect(r.damage).toBe(b.hp - 1)
  })
  it('intimidate drops the foe attack on entry', () => {
    const a = mk('ampharos', 30, 'tackle')
    const b = mk('clefable', 30, 'tackle')
    a.battler.ability = 'intimidate'
    const events = onBattleStart([a, b])
    expect(b.battler.stages?.atk).toBe(-1)
    expect(events.length).toBe(1)
  })
  it('swift_swim doubles speed in rain', () => {
    const c = createWildCreature('lotad', 30, midRng)
    c.ability = 'swift_swim'
    expect(liveSpeed(c, 'rain')).toBe(liveSpeed(c, 'none') * 2)
  })
  it('static can paralyze on contact', () => {
    const a = mk('clefable', 30, 'tackle')
    const b = mk('pikachu', 30, 'growl')
    b.battler.ability = 'static'
    a.battler.stats.spd = 999
    // rng: crit-space high (no crit), all 0-99 rolls low -> static triggers
    const rng: Rng = (min, max) => (max === 99999 ? 99999 : min)
    runTurn([a, b], rng, newBattle())
    expect(a.battler.status).toBe('paralysis')
  })
})
