/*
 * The minimal battler model the damage/catch math operates on.
 * Deliberately independent of RPG-JS — the server adapter maps its player
 * objects into this shape.
 */
import type { StatKey } from './stats'

export type NonVolatileStatus =
  | 'poison' | 'toxic' | 'burn' | 'paralysis' | 'sleep' | 'freeze'

export interface Battler {
  level: number
  /** Type dbSymbols, e.g. ['fire'] or ['grass','poison']. */
  types: string[]
  /** Precomputed stat bases (statBasis / maxHp outputs). */
  stats: Record<StatKey, number>
  maxHp: number
  hp: number
  /** Stat stages -6..+6; missing = 0. */
  stages?: Partial<Record<StatKey | 'eva' | 'acc', number>>
  status?: NonVolatileStatus | null
  ability?: string | null
}

export interface MoveData {
  type: string
  category: 'physical' | 'special' | 'status'
  power: number
  accuracy: number
  pp: number
  priority: number
  criticalRate: number
}

export type Weather = 'none' | 'rain' | 'sun' | 'sandstorm' | 'hail'

export const stage = (b: Battler, k: StatKey | 'eva' | 'acc') => b.stages?.[k] ?? 0
