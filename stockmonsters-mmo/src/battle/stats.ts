/*
 * Stat and experience math, straight from docs/psdk-mechanics.md §2.
 * Framework-independent on purpose (see HANDOVER.md): plain data in,
 * numbers out. All formulas are [V-ENGINE] unless noted.
 */

/** Ruby-style integer division for non-negative operands. */
export const idiv = (a: number, b: number) => Math.floor(a / b)

export type StatKey = 'atk' | 'dfe' | 'spd' | 'ats' | 'dfs'

export interface SpecieStats {
  baseHp: number; baseAtk: number; baseDfe: number
  baseSpd: number; baseAts: number; baseDfs: number
}

export interface Ivs { hp: number; atk: number; dfe: number; spd: number; ats: number; dfs: number }
export type Evs = Ivs

export const ZERO_EVS: Evs = { hp: 0, atk: 0, dfe: 0, spd: 0, ats: 0, dfs: 0 }
export const MAX_IVS: Ivs = { hp: 31, atk: 31, dfe: 31, spd: 31, ats: 31, dfs: 31 }

export function maxHp(baseHp: number, iv: number, ev: number, level: number): number {
  return idiv((iv + 2 * baseHp + idiv(ev, 4)) * level, 100) + 10 + level
}

/** naturePercent is the raw 90/100/110 integer from natures.json. */
export function statBasis(base: number, iv: number, ev: number, level: number, naturePercent: number): number {
  return idiv((idiv((2 * base + idiv(ev, 4) + iv) * level, 100) + 5) * naturePercent, 100)
}

/** Stage multiplier for atk/dfe/spd/ats/dfs, stage in -6..+6. */
export function stageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage)
}

// --- experience curves (§2.2) ----------------------------------------------

export function totalExpForLevel(experienceType: number, level: number): number {
  const L = level
  switch (experienceType) {
    case 0: return Math.floor((4 * L ** 3) / 5)
    case 1: return L ** 3
    case 2: return Math.floor((5 * L ** 3) / 4)
    case 3: return L <= 1 ? 1 : Math.floor((6 * L ** 3) / 5 - 15 * L ** 2 + 100 * L - 140)
    case 4: // Erratic
      if (L <= 50) return Math.floor((L ** 3 * (100 - L)) / 50)
      if (L <= 68) return Math.floor((L ** 3 * (150 - L)) / 100)
      if (L <= 98) return Math.floor((L ** 3 * Math.floor((1911 - 10 * L) / 3)) / 500)
      return Math.floor((L ** 3 * (160 - L)) / 100)
    case 5: // Fluctuating
      if (L <= 15) return Math.floor((L ** 3 * (24 + Math.floor((L + 1) / 3))) / 50)
      if (L <= 35) return Math.floor((L ** 3 * (14 + L)) / 50)
      return Math.floor((L ** 3 * (32 + Math.floor(L / 2))) / 50)
    default: return L ** 3
  }
}

export function levelFromExp(experienceType: number, exp: number, maxLevel = 100): number {
  let level = 1
  while (level < maxLevel && totalExpForLevel(experienceType, level + 1) <= exp) level++
  return level
}
