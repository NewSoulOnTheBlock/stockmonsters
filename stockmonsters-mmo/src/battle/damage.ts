/*
 * The Gen-4 damage formula, exactly as PSDK computes it.
 * docs/psdk-mechanics.md §1.5–§1.7 — the truncation points are load-bearing;
 * do not "simplify" the floors.
 */
import { idiv, stageMultiplier } from './stats'
import { effectiveness } from './typechart'
import { stage, type Battler, type MoveData, type Weather } from './battler'

/** Uniform integer in [min, max] inclusive. Injectable for determinism. */
export type Rng = (min: number, max: number) => number

// §1.6 — out of 100_000; count >= 4 always crits
const CRITICAL_RATES: Record<number, number> = { 0: 0, 1: 6250, 2: 12500, 3: 50000 }

export function rollCritical(criticalCount: number, rng: Rng): boolean {
  const rate = CRITICAL_RATES[criticalCount] ?? 100000
  return rng(0, 99999) < rate
}

export interface DamageContext {
  weather?: Weather
  /** Number of targets the move hits this use (spread reduction). */
  targetCount?: number
  /** Force the §1.6 crit override behaviour; rolled when undefined. */
  critical?: boolean
}

export interface DamageResult {
  damage: number
  critical: boolean
  effectiveness: number
}

export function damages(
  user: Battler,
  target: Battler,
  move: MoveData,
  rng: Rng,
  ctx: DamageContext = {},
): DamageResult {
  const critical = ctx.critical ?? rollCritical(move.criticalRate, rng)
  const weather = ctx.weather ?? 'none'

  // attack / defense with stage multipliers and the crit overrides:
  // a crit ignores the attacker's negative stages and the defender's
  // positive stages (multiplier clamped toward 1)
  const atkKey = move.category === 'physical' ? 'atk' : 'ats'
  const defKey = move.category === 'physical' ? 'dfe' : 'dfs'
  let atkMul = stageMultiplier(stage(user, atkKey))
  let defMul = stageMultiplier(stage(target, defKey))
  if (critical) {
    atkMul = Math.max(atkMul, 1)
    defMul = Math.min(defMul, 1)
  }
  const atk = Math.floor(user.stats[atkKey] * atkMul)
  const def = Math.floor(target.stats[defKey] * defMul)

  // mod1: burn on physical (Guts excepted), weather, spread (§1.5 table)
  let mod1 = 1
  if (move.category === 'physical' && user.status === 'burn' && user.ability !== 'guts') mod1 *= 0.5
  if (weather === 'rain') {
    if (move.type === 'fire') mod1 *= 0.5
    if (move.type === 'water') mod1 *= 1.5
  } else if (weather === 'sun') {
    if (move.type === 'fire') mod1 *= 1.5
    if (move.type === 'water') mod1 *= 0.5
  }
  if ((ctx.targetCount ?? 1) > 1) mod1 *= 0.75

  const ch = critical ? (user.ability === 'sniper' ? 2.25 : 1.5) : 1
  const stab = user.types.includes(move.type)
    ? (user.ability === 'adaptability' ? 2 : 1.5)
    : 1

  let d = idiv(user.level * 2, 5) + 2 // step 1
  d = Math.floor(d * move.power) // step 2
  d = idiv(Math.floor(d * atk), 50) // step 3
  d = idiv(d, def) // step 4
  d = Math.floor(d * mod1) + 2 // step 5
  d = Math.floor(d * ch) // step 6
  d = Math.floor(d * 1) // step 7 (mod2 — Helping Hand etc., effects later)
  d = idiv(d * rng(85, 100), 100) // step 8
  d = Math.floor(d * stab) // step 9
  const [t1, t2, t3] = [target.types[0], target.types[1], target.types[2]]
  let eff = 1
  for (const t of [t1, t2, t3]) {
    const m = effectiveness(move.type, [t])
    d = Math.floor(d * m) // steps 10-12
    eff *= m
  }
  d = Math.floor(d * 1) // step 13 (mod3 — Filter/Expert Belt etc., effects later)
  const damage = Math.min(Math.max(d, 1), target.hp) // step 14: clamp to current HP
  return { damage, critical, effectiveness: eff }
}
