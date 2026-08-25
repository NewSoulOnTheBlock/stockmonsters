import type { Species } from './species.js';

export const SHINY_ODDS = 1 / 8192;
export const IV_MIN = 0;
export const IV_MAX = 31;

export interface IVs {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export interface FinalStats {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

/** The 7 minted traits, plus level (8 total) - matches the spec exactly. */
export interface MintedTraits {
  level: number;
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
  shiny: boolean;
}

function rollIv(rng: () => number): number {
  return Math.floor(rng() * (IV_MAX - IV_MIN + 1)) + IV_MIN;
}

export function rollIvs(rng: () => number): IVs {
  return {
    hp: rollIv(rng),
    attack: rollIv(rng),
    defense: rollIv(rng),
    spAttack: rollIv(rng),
    spDefense: rollIv(rng),
    speed: rollIv(rng),
  };
}

/** Classic Gen III+ stat formula, no nature modifier (kept neutral for now). */
export function computeFinalStats(base: Species['baseStats'], iv: IVs, level: number): FinalStats {
  if (level < 1 || level > 100) throw new RangeError('level must be 1-100');
  const core = (b: number, i: number) => Math.floor(((2 * b + i) * level) / 100);
  return {
    hp: core(base.hp, iv.hp) + level + 10,
    attack: core(base.attack, iv.attack) + 5,
    defense: core(base.defense, iv.defense) + 5,
    spAttack: core(base.spAttack, iv.spAttack) + 5,
    spDefense: core(base.spDefense, iv.spDefense) + 5,
    speed: core(base.speed, iv.speed) + 5,
  };
}

/**
 * Resolves whether this mint is shiny. A successful shiny roll only counts if that species'
 * single shiny slot is still open - if someone already claimed it, the roll is wasted and the
 * mint proceeds as a (very lucky-feeling, but ultimately) regular one rather than failing outright.
 */
export function rollShiny(rng: () => number, shinyAvailableForSpecies: boolean): boolean {
  const hit = rng() < SHINY_ODDS;
  return hit && shinyAvailableForSpecies;
}

export function generateTraits(
  species: Species,
  level: number,
  shinyAvailableForSpecies: boolean,
  rng: () => number,
): MintedTraits {
  const iv = rollIvs(rng);
  const stats = computeFinalStats(species.baseStats, iv, level);
  const shiny = rollShiny(rng, shinyAvailableForSpecies);
  return { level, ...stats, shiny };
}
