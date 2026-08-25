/*
 * Generation VI capture, as PSDK implements it — docs/psdk-mechanics.md §3.
 * Conditional ball behaviours (§3.1) are injected via ballRareness so the
 * core stays context-free.
 */
import type { Battler, NonVolatileStatus } from './battler'
import type { Rng } from './damage'

const STATUS_MODIFIER: Record<NonVolatileStatus, number> = {
  poison: 1.5, toxic: 1.5, paralysis: 1.5, burn: 1.5, sleep: 2.5, freeze: 2.5,
}

export interface CatchInput {
  /** form.catchRate (0..255); 0 blocks the ball entirely. */
  rareness: number
  /** Ball JSON catchRate multiplier (great 1.5, ultra 2, master 255...). */
  ballBonus: number
  target: Pick<Battler, 'maxHp' | 'hp' | 'status'>
  /** Distinct species ever caught (critical-capture tiers). */
  speciesCaught?: number
}

export interface CatchResult {
  caught: boolean
  criticalCapture: boolean
  /** 0..4 ball shakes, for the client animation. */
  bounces: number
  finalRate: number
}

export function finalRate({ rareness, ballBonus, target }: CatchInput): number {
  const bonusStatus = target.status ? STATUS_MODIFIER[target.status] ?? 1 : 1
  return Math.floor(
    ((3 * target.maxHp - 2 * target.hp) * rareness * ballBonus) / (3 * target.maxHp) * bonusStatus,
  )
}

function criticalMultiplier(speciesCaught: number): number {
  if (speciesCaught > 600) return 2.5
  if (speciesCaught >= 451) return 2
  if (speciesCaught >= 301) return 1.5
  if (speciesCaught >= 151) return 1
  if (speciesCaught >= 31) return 0.5
  return 0
}

export function tryCapture(input: CatchInput, rng: Rng): CatchResult {
  if (input.rareness === 0) return { caught: false, criticalCapture: false, bounces: 0, finalRate: 0 }
  const a = finalRate(input)

  const c = (a * criticalMultiplier(input.speciesCaught ?? 0)) / 6
  if (rng(0, 255) < c) return { caught: true, criticalCapture: true, bounces: 1, finalRate: a }

  if (a >= 255) return { caught: true, criticalCapture: false, bounces: 4, finalRate: a }

  const b = Math.floor(65536 / Math.pow(255 / a, 0.1875))
  let bounces = 0
  for (let i = 0; i < 4; i++) {
    if (rng(0, 65535) < b) bounces++
    else break
  }
  return { caught: bounces === 4, criticalCapture: false, bounces, finalRate: a }
}

/** Per-shake probability, for tests and UI. */
export function shakeProbability(a: number): number {
  if (a >= 255) return 1
  return Math.floor(65536 / Math.pow(255 / a, 0.1875)) / 65536
}
