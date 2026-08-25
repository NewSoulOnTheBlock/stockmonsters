/*
 * Accuracy/evasion — docs/psdk-mechanics.md §1.4.
 * accuracy: 0 in the data means NEVER MISSES (241 of 728 moves), not 0%.
 */
import { stage, type Battler, type MoveData } from './battler'
import type { Rng } from './damage'

/** Thirds curve — different from the regular halves curve. */
export function accEvaMultiplier(s: number): number {
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s)
}

export function accuracyCheck(user: Battler, target: Battler, move: MoveData, rng: Rng): boolean {
  if (move.accuracy <= 0) return true
  const hitChance =
    move.accuracy *
    accEvaMultiplier(stage(user, 'acc')) *
    accEvaMultiplier(-stage(target, 'eva'))
  // compared to an integer 0..99, deliberately unclamped above 100
  return rng(0, 99) < hitChance
}
