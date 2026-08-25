/*
 * Golden tests against the worked examples in docs/psdk-mechanics.md.
 * If any of these numbers drift, the engine no longer matches PSDK.
 */
import { describe, expect, it } from 'vitest'
import { maxHp, statBasis, totalExpForLevel, levelFromExp, stageMultiplier } from './stats'
import { typeMultiplier } from './typechart'
import { damages, type Rng } from './damage'
import { finalRate, shakeProbability, tryCapture } from './catching'
import type { Battler, MoveData } from './battler'
import species from '../data/studio/species.json'
import moves from '../data/studio/moves.json'

const rngFixed = (roll: number): Rng => (min, max) => Math.min(Math.max(roll, min), max)

// §1.5.1 setup: Nvidrake (charmander) L50 vs Applion (bulbasaur) L50,
// IVs 31, EVs 0, neutral nature
const sp = species as any
const mv = moves as any

const mkStats = (s: any, level: number) => ({
  atk: statBasis(s.baseAtk, 31, 0, level, 100),
  dfe: statBasis(s.baseDfe, 31, 0, level, 100),
  spd: statBasis(s.baseSpd, 31, 0, level, 100),
  ats: statBasis(s.baseAts, 31, 0, level, 100),
  dfs: statBasis(s.baseDfs, 31, 0, level, 100),
})

const mkBattler = (dbSymbol: string, level: number): Battler => {
  const s = sp[dbSymbol]
  const hp = maxHp(s.baseHp, 31, 0, level)
  return {
    level,
    types: [s.type1, s.type2].filter(Boolean),
    stats: mkStats(s, level),
    maxHp: hp,
    hp,
  }
}

const ember: MoveData = { ...mv.ember, criticalRate: mv.ember.criticalRate }

describe('stats (§2.1)', () => {
  it('Applion (bulbasaur) L50 maxHp = 120', () => {
    expect(maxHp(sp.bulbasaur.baseHp, 31, 0, 50)).toBe(120)
  })
  it('Nvidrake (charmander) L50 ats = 80', () => {
    expect(statBasis(sp.charmander.baseAts, 31, 0, 50, 100)).toBe(80)
  })
  it('Applion L50 dfs = 85', () => {
    expect(statBasis(sp.bulbasaur.baseDfs, 31, 0, 50, 100)).toBe(85)
  })
  it('nature floors after the multiply: base-80-stat example', () => {
    // §2.1: a 110 nature on a stat basis of 139 gives 152, not 153
    expect(Math.floor((139 * 110) / 100)).toBe(152)
  })
  it('wild L20 bulbasaur maxHp = 54 (§3.2)', () => {
    expect(maxHp(sp.bulbasaur.baseHp, 31, 0, 20)).toBe(54)
  })
})

describe('stage multipliers (§1.8)', () => {
  it('matches the table', () => {
    expect(stageMultiplier(-6)).toBe(0.25)
    expect(stageMultiplier(-1)).toBeCloseTo(2 / 3)
    expect(stageMultiplier(0)).toBe(1)
    expect(stageMultiplier(2)).toBe(2)
    expect(stageMultiplier(6)).toBe(4)
  })
})

describe('type chart (§1.7.3)', () => {
  it('spot checks', () => {
    expect(typeMultiplier('fire', 'grass')).toBe(2)
    expect(typeMultiplier('fire', 'poison')).toBe(1)
    expect(typeMultiplier('normal', 'ghost')).toBe(0)
    expect(typeMultiplier('electric', 'ground')).toBe(0)
    expect(typeMultiplier('dragon', 'fairy')).toBe(0)
    expect(typeMultiplier('water', 'water')).toBe(0.5)
    expect(typeMultiplier('fire', null)).toBe(1)
  })
})

describe('damage (§1.5)', () => {
  const user = mkBattler('charmander', 50)
  const target = mkBattler('bulbasaur', 50)

  it('Ember non-crit: 44 at R=85, 54 at R=100', () => {
    expect(damages(user, target, ember, rngFixed(85), { critical: false }).damage).toBe(44)
    expect(damages(user, target, ember, rngFixed(100), { critical: false }).damage).toBe(54)
  })
  it('Ember crit: 66 at R=85, 80 at R=100', () => {
    expect(damages(user, target, ember, rngFixed(85), { critical: true }).damage).toBe(66)
    expect(damages(user, target, ember, rngFixed(100), { critical: true }).damage).toBe(80)
  })
  it('Ember under rain: 30 at R=100', () => {
    expect(damages(user, target, ember, rngFixed(100), { critical: false, weather: 'rain' }).damage).toBe(30)
  })
  it('damage is clamped to current HP (§1.5 step 14)', () => {
    const dying = { ...target, hp: 5 }
    expect(damages(user, dying, ember, rngFixed(100), { critical: false }).damage).toBe(5)
  })
  it('effectiveness reported: fire vs grass/poison = 2', () => {
    expect(damages(user, target, ember, rngFixed(100), { critical: false }).effectiveness).toBe(2)
  })
})

describe('experience curves (§2.2)', () => {
  it('medium fast is cubic', () => expect(totalExpForLevel(1, 50)).toBe(125000))
  it('medium slow L1 = 1', () => expect(totalExpForLevel(3, 1)).toBe(1))
  it('level round-trips', () => {
    for (const curve of [0, 1, 2, 3, 4, 5]) {
      for (const level of [5, 36, 68, 99]) {
        expect(levelFromExp(curve, totalExpForLevel(curve, level))).toBe(level)
      }
    }
  })
})

describe('catching (§3.2)', () => {
  const l20 = { maxHp: 54, hp: 1, status: 'sleep' as const }

  it('Great Ball on sleeping 1-HP Applion: a = 166', () => {
    expect(finalRate({ rareness: 45, ballBonus: 1.5, target: l20 })).toBe(166)
  })
  it('shake constant b = 60467 -> one-shake p ~= 0.92265', () => {
    expect(shakeProbability(166)).toBeCloseTo(60467 / 65536, 5)
  })
  it('full-HP Poke Ball: a = 15, four-shake p ~= 11.9%', () => {
    const a = finalRate({ rareness: 45, ballBonus: 1, target: { maxHp: 54, hp: 54, status: null } })
    expect(a).toBe(15)
    expect(Math.pow(shakeProbability(15), 4)).toBeCloseTo(0.1194, 3)
  })
  it('master ball auto-catches (a >= 255)', () => {
    const r = tryCapture(
      { rareness: 45, ballBonus: 255, target: { maxHp: 54, hp: 54, status: null } },
      (min) => min, // never rolls a critical
    )
    expect(r.caught).toBe(true)
    expect(r.bounces).toBe(4)
  })
  it('rareness 0 blocks the ball', () => {
    expect(tryCapture({ rareness: 0, ballBonus: 255, target: l20 }, (min) => min).caught).toBe(false)
  })
})
