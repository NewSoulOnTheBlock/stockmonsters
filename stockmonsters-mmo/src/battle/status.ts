/*
 * Non-volatile + volatile statuses — docs/psdk-mechanics.md §1.9/§1.10/§1.12.
 */
import { idiv } from './stats'
import type { Battler, NonVolatileStatus } from './battler'
import type { Rng } from './damage'

/** moveStatus "status" strings in the data -> our model. */
export const STATUS_FROM_DATA: Record<string, NonVolatileStatus | 'flinch' | 'confusion'> = {
  POISONED: 'poison', TOXIC: 'toxic', BURN: 'burn', PARALYZED: 'paralysis',
  ASLEEP: 'sleep', FROZEN: 'freeze', FLINCH: 'flinch', CONFUSED: 'confusion',
}

/** Runtime status state carried next to the Battler. */
export interface StatusState {
  /** sleep turns remaining (decremented on move attempt, §1.9). */
  sleepCount?: number
  /** toxic ramp n — increments every end of turn. */
  toxicCounter?: number
  confusionCount?: number
  flinched?: boolean
  /** s_protect: blocks incoming moves until end of turn. */
  protected?: boolean
  /** s_2turns: move being charged (fly/dig/...), executes next turn. */
  charging?: string | null
  /** s_reload: must spend next turn recharging. */
  recharging?: boolean
  /** s_bind: trap turns remaining; chips maxHp/8 each end of turn. */
  bindTurns?: number
  /** s_reflect family: remaining turns per screen. */
  reflectTurns?: number
  lightScreenTurns?: number
}

const TYPE_IMMUNITY: Record<NonVolatileStatus, string[]> = {
  poison: ['poison', 'steel'], toxic: ['poison', 'steel'],
  burn: ['fire'], paralysis: ['electric'], freeze: ['ice'], sleep: [],
}

export function canApplyStatus(target: Battler, status: NonVolatileStatus): boolean {
  if (target.status) return false // at most one non-volatile (§1.9)
  return !TYPE_IMMUNITY[status].some((t) => target.types.includes(t))
}

export function applyStatus(target: Battler, state: StatusState, status: NonVolatileStatus, rng: Rng): boolean {
  if (!canApplyStatus(target, status)) return false
  target.status = status
  if (status === 'sleep') state.sleepCount = rng(2, 5)
  if (status === 'toxic') state.toxicCounter = 1
  return true
}

export type PreventionResult =
  | { prevented: false }
  | { prevented: true; reason: 'sleep' | 'freeze' | 'paralysis' | 'flinch' | 'confusion-self-hit'; selfDamage?: number }
  | { prevented: false; woke?: boolean; thawed?: boolean; snappedOut?: boolean }

/**
 * §1.3 step 2a — everything that can stop the move before PP is spent.
 * Mutates status counters exactly the way the engine does.
 */
export function movePrevention(
  user: Battler, state: StatusState, moveIsUnfreeze: boolean, rng: Rng,
): PreventionResult {
  if (state.flinched) {
    state.flinched = false
    return { prevented: true, reason: 'flinch' }
  }
  if (user.status === 'sleep') {
    state.sleepCount = (state.sleepCount ?? 1) - 1
    if (state.sleepCount > 0) return { prevented: true, reason: 'sleep' }
    user.status = null // wakes and acts this same turn (§1.9)
  }
  if (user.status === 'freeze') {
    if (moveIsUnfreeze || rng(0, 99) < 20) user.status = null
    else return { prevented: true, reason: 'freeze' }
  }
  if (user.status === 'paralysis' && rng(0, 99) < 25) {
    return { prevented: true, reason: 'paralysis' }
  }
  if (state.confusionCount) {
    state.confusionCount -= 1
    if (state.confusionCount === 0) return { prevented: false, snappedOut: true }
    if (rng(0, 99) < 50) {
      // 40-power typeless physical self-hit: no STAB, no types, no crit (§1.10)
      let d = idiv(user.level * 2, 5) + 2
      d = Math.floor(d * 40)
      d = idiv(Math.floor(d * user.stats.atk), 50)
      d = idiv(d, user.stats.dfe) + 2
      return { prevented: true, reason: 'confusion-self-hit', selfDamage: Math.min(d, user.hp) }
    }
  }
  return { prevented: false }
}

/** End-of-turn residual damage (§1.12). Returns damage dealt (0 for none). */
export function endOfTurnTick(b: Battler, state: StatusState): number {
  let dmg = 0
  if (b.status === 'poison') dmg = Math.max(1, idiv(b.maxHp, 8))
  else if (b.status === 'toxic') {
    const n = state.toxicCounter ?? 1
    dmg = Math.max(1, idiv(b.maxHp * n, 16))
    state.toxicCounter = n + 1 // increments even when damage is skipped (§1.9)
  } else if (b.status === 'burn') dmg = Math.max(1, idiv(b.maxHp, 8))
  dmg = Math.min(dmg, b.hp)
  b.hp -= dmg
  return dmg
}
