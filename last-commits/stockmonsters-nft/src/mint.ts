import type { BallType } from './ballTypes.js';
import { BALL_CONFIG } from './ballTypes.js';
import { attemptCatch, type StatusEffect, type CatchResult } from './catchRate.js';
import type { CollectionState } from './collectionState.js';
import { canMint, isShinyAvailable, recordMint, GLOBAL_SUPPLY_CAP } from './collectionState.js';
import type { Species } from './species.js';
import { generateTraits, type MintedTraits } from './traits.js';

export interface CatchAndMintInput {
  species: Species;
  level: number;
  maxHp: number;
  currentHp: number;
  status: StatusEffect;
  ball: BallType;
}

export type CatchAndMintResult =
  | { outcome: 'supply_exhausted' }
  | { outcome: 'broke_free'; catchResult: CatchResult }
  | { outcome: 'minted'; catchResult: CatchResult; traits: MintedTraits };

/**
 * The single entry point tying together: ball-throw catch resolution, the global 5000 cap,
 * the per-species shiny cap, and trait generation. `rng` must be a fresh uniform [0,1) source
 * per call (a real deployment feeds this from a VRF/oracle, never client-supplied randomness).
 *
 * Mint price for the chosen ball is charged regardless of outcome (that's the cost of the
 * throw, same as the real games spending an item) - the caller/contract is responsible for
 * collecting BALL_CONFIG[ball].priceEth before calling this.
 */
export function catchAndMint(input: CatchAndMintInput, state: CollectionState, rng: () => number): CatchAndMintResult {
  if (!canMint(state)) return { outcome: 'supply_exhausted' };

  const ball = BALL_CONFIG[input.ball];
  const catchResult = attemptCatch(
    { catchRate: input.species.catchRate, maxHp: input.maxHp, currentHp: input.currentHp, status: input.status, ball },
    rng,
  );
  if (!catchResult.caught) return { outcome: 'broke_free', catchResult };

  const shinyAvailable = isShinyAvailable(state, input.species.dexId);
  const traits = generateTraits(input.species, input.level, shinyAvailable, rng);
  recordMint(state, input.species.dexId, traits.shiny);

  return { outcome: 'minted', catchResult, traits };
}

export { GLOBAL_SUPPLY_CAP };
