import { describe, expect, it } from 'vitest'
import { createWildCreature } from './factory'
import { runTurn, attemptFlee, type Combatant } from './turn'
import { endOfTurnTick, applyStatus, canApplyStatus } from './status'
import type { Rng } from './damage'

const midRng: Rng = (min, max) => Math.floor((min + max) / 2)
const minRng: Rng = (min) => min
const maxRng: Rng = (_, max) => max

const mk = (sym: string, level: number, move: string): Combatant => ({
  battler: createWildCreature(sym, level, midRng),
  state: {},
  move,
})

describe('stat moves (§1.8)', () => {
  it('growl (s_stat) lowers the FOE attack stage', () => {
    const a = mk('bulbasaur', 20, 'growl')
    const b = mk('charmander', 20, 'tackle')
    runTurn([a, b], midRng)
    expect(b.battler.stages?.atk).toBe(-1)
    expect(a.battler.stages?.atk ?? 0).toBe(0)
  })
  it('swords_dance (s_stat, target:user) raises OWN attack by 2 and cannot miss', () => {
    const a = mk('bulbasaur', 20, 'swords_dance')
    const b = mk('charmander', 20, 'tackle')
    runTurn([a, b], midRng)
    expect(a.battler.stages?.atk).toBe(2)
  })
  it('draco_meteor (s_self_stat) damages the foe AND drops own SpA by 2', () => {
    const a = mk('dratini', 60, 'draco_meteor')
    const b = mk('charmander', 20, 'tackle')
    const events = runTurn([a, b], midRng) // maxRng would miss the 90-acc roll
    expect(events.some((e) => e.type === 'damage' && e.side === 1)).toBe(true)
    expect(a.battler.stages?.ats).toBe(-2)
  })
  it('stages clamp at -6/+6', () => {
    const a = mk('bulbasaur', 20, 'swords_dance')
    const b = mk('caterpie', 5, 'string_shot')
    a.battler.stages = { atk: 5 }
    runTurn([a, b], midRng)
    expect(a.battler.stages?.atk).toBe(6)
  })
})

describe('status moves (§1.9)', () => {
  it('thunder_wave paralyzes', () => {
    const a = mk('pikachu', 20, 'thunder_wave')
    const b = mk('bulbasaur', 20, 'tackle')
    // b acts first (order rolled before paralysis lands? no — a faster? force it)
    a.battler.stats.spd = 999
    runTurn([a, b], midRng)
    expect(b.battler.status).toBe('paralysis')
  })
  it('thunder_wave fails against Ground (type immunity, §1.3 step 8)', () => {
    const a = mk('pikachu', 20, 'thunder_wave')
    const d = mk('diglett', 20, 'scratch')
    a.battler.stats.spd = 999
    const events = runTurn([a, d], midRng)
    expect(events.some((e) => e.type === 'immune')).toBe(true)
    expect(d.battler.status ?? null).toBe(null)
  })
  it('electric types cannot be paralyzed; one status at a time', () => {
    const pika = createWildCreature('pikachu', 20, midRng)
    expect(canApplyStatus(pika, 'paralysis')).toBe(false)
    const bulb = createWildCreature('bulbasaur', 20, midRng)
    applyStatus(bulb, {}, 'burn', midRng)
    expect(canApplyStatus(bulb, 'sleep')).toBe(false)
  })
})

describe('residual damage (§1.12)', () => {
  it('poison ticks maxHp/8, min 1', () => {
    const b = createWildCreature('charmander', 20, midRng)
    b.status = 'poison'
    const dmg = endOfTurnTick(b, {})
    expect(dmg).toBe(Math.max(1, Math.floor(b.maxHp / 8)))
  })
  it('toxic ramps 1/16, 2/16, 3/16...', () => {
    const b = createWildCreature('charmander', 50, midRng)
    const state = { toxicCounter: 1 }
    b.status = 'toxic'
    const d1 = endOfTurnTick(b, state)
    const d2 = endOfTurnTick(b, state)
    const d3 = endOfTurnTick(b, state)
    expect(d1).toBe(Math.max(1, Math.floor(b.maxHp / 16)))
    expect(d2).toBe(Math.max(1, Math.floor((b.maxHp * 2) / 16)))
    expect(d3).toBe(Math.max(1, Math.floor((b.maxHp * 3) / 16)))
  })
})

describe('move prevention (§1.9/§1.10)', () => {
  it('sleep skips turns and wakes at counter 0, acting the same turn', () => {
    const a = mk('bulbasaur', 20, 'tackle')
    const b = mk('charmander', 20, 'tackle')
    a.battler.status = 'sleep'
    a.state.sleepCount = 2
    b.battler.stats.spd = 0
    a.battler.stats.spd = 999
    const t1 = runTurn([a, b], minRng)
    expect(t1.some((e) => e.type === 'prevented' && e.side === 0 && e.reason === 'sleep')).toBe(true)
    const t2 = runTurn([a, b], minRng)
    expect(a.battler.status).toBe(null)
    expect(t2.some((e) => e.type === 'used' && e.side === 0)).toBe(true)
  })
  it('flinch loses exactly one turn', () => {
    const a = mk('bulbasaur', 20, 'tackle')
    const b = mk('charmander', 20, 'tackle')
    a.state.flinched = true
    a.battler.stats.spd = 999
    const t = runTurn([a, b], minRng)
    expect(t.some((e) => e.type === 'prevented' && e.reason === 'flinch')).toBe(true)
    expect(a.state.flinched).toBe(false)
  })
})

describe('secondary effects (s_basic gate)', () => {
  it('ember burns when the effectChance roll passes', () => {
    const a = mk('charmander', 30, 'ember')
    const b = mk('bulbasaur', 30, 'tackle')
    a.battler.stats.spd = 999
    // minRng: crit roll 0<6250 => crit... use rng that fails crit but passes gate:
    const rng: Rng = (min, max) => (max === 99999 ? 99999 : min)
    runTurn([a, b], rng)
    expect(b.battler.status).toBe('burn')
  })
  it('ember does not burn when the roll fails', () => {
    const a = mk('charmander', 30, 'ember')
    const b = mk('bulbasaur', 30, 'tackle')
    a.battler.stats.spd = 999
    runTurn([a, b], maxRng) // roll 99 >= 10
    expect(b.battler.status ?? null).toBe(null)
  })
})

describe('flee (§1.14)', () => {
  it('guaranteed when faster', () => {
    expect(attemptFlee(100, 50, 0, minRng)).toBe(true)
  })
  it('formula: spd 50 vs 100 first attempt = 64/256', () => {
    // value = idiv(50*32, idiv(100,4)) + 0 = idiv(1600,25) = 64
    expect(attemptFlee(50, 100, 0, (() => { let called = false; return ((min: number, max: number) => { called = true; return 63 }) as Rng })())).toBe(true)
    expect(attemptFlee(50, 100, 0, ((_m: number, _x: number) => 64) as Rng)).toBe(false)
    expect(attemptFlee(50, 100, 1, ((_m: number, _x: number) => 93) as Rng)).toBe(true) // +30 per attempt
  })
})
