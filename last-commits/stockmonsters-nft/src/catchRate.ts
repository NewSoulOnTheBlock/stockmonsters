import type { BallConfig } from './ballTypes.js';

export type StatusEffect = 'none' | 'sleep' | 'freeze' | 'paralyze' | 'poison' | 'burn';

/** Classic Gen III+ status catch-bonus multipliers. */
const STATUS_BONUS: Record<StatusEffect, number> = {
  none: 1,
  sleep: 2,
  freeze: 2,
  paralyze: 1.5,
  poison: 1.5,
  burn: 1.5,
};

export interface CatchAttemptInput {
  /** The wild Stockmonster's base catch rate (0-255), pulled from its species data. */
  catchRate: number;
  maxHp: number;
  currentHp: number;
  status: StatusEffect;
  ball: BallConfig;
}

/**
 * The classic Gen III+ "a" value: how favorable this specific catch attempt is.
 * a >= 255 means guaranteed catch.
 */
export function computeA({ catchRate, maxHp, currentHp, status, ball }: CatchAttemptInput): number {
  if (maxHp <= 0) throw new RangeError('maxHp must be positive');
  if (currentHp < 0 || currentHp > maxHp) throw new RangeError('currentHp out of range');
  if (catchRate < 1 || catchRate > 255) throw new RangeError('catchRate must be 1-255');

  const hpFactor = Math.floor(3 * maxHp - 2 * currentHp);
  const base = Math.floor((hpFactor * catchRate * ball.catchBonus) / (3 * maxHp));
  return Math.floor(base * STATUS_BONUS[status]);
}

/**
 * Probability (0-1) that this catch attempt succeeds, using the classic 4-shake-check math.
 * Exposed for UI/EV display - the actual on-chain/off-chain resolution should still roll real
 * randomness via attemptCatch, not just compare against this number, so the shake mechanic
 * (and its "close but broke free" flavor) stays authentic.
 */
export function catchProbability(input: CatchAttemptInput): number {
  const a = computeA(input);
  if (a >= 255) return 1;
  if (a <= 0) return 0;
  const b = 65536 / (255 / a) ** 0.25;
  const perShake = Math.min(b / 65536, 1);
  return perShake ** 4;
}

export interface CatchResult {
  caught: boolean;
  /** How many of the 4 shake checks succeeded before it broke free (4 = caught). */
  shakes: number;
  a: number;
}

/**
 * Resolves one real catch attempt. `rng` must return a fresh uniform [0,1) float per call
 * (inject your own PRNG/VRF source - never Math.random() in anything mint-facing).
 */
export function attemptCatch(input: CatchAttemptInput, rng: () => number): CatchResult {
  const a = computeA(input);
  if (a >= 255) return { caught: true, shakes: 4, a };
  if (a <= 0) return { caught: false, shakes: 0, a };

  const b = 65536 / (255 / a) ** 0.25;
  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    const roll = Math.floor(rng() * 65536);
    if (roll >= b) break;
    shakes++;
  }
  return { caught: shakes === 4, shakes, a };
}
