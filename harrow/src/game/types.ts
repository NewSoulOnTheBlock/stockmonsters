import type { Bonded, Stash, Supplies } from './save';

export interface RaidConfig {
  /** Partner first, then up to 3 more bonded creatures. */
  party: Bonded[];
  supplies: Supplies;
  /** Feral creatures that may be found in the wild this raid. */
  feral: Bonded[];
  seed: number;
}

export interface Recruit {
  species: string;
  /** Set when the recruit is a feral creature being won back. */
  feralUid?: string;
}

export interface RaidResult {
  outcome: 'extracted' | 'died' | 'swept';
  recruits: Recruit[];
  loot: Stash;
  /** Supplies left unused (only kept on extraction). */
  leftover: Supplies;
  seen: string[];
  kills: number;
  seconds: number;
}
