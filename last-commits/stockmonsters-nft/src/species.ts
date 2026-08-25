import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export type TypeName =
  | 'Neutral' | 'Combat' | 'Wind' | 'Toxic' | 'Terra' | 'Stone' | 'Swarm' | 'Spectre'
  | 'Alloy' | 'Blaze' | 'Tide' | 'Flora' | 'Volt' | 'Psionic' | 'Frost' | 'Wyrm' | 'Shadow' | 'Fae';

export interface BaseStats {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export interface Species {
  dexId: number;
  ticker: string;
  name: string;
  dbSymbol: string;
  roster: 'stock' | 'meme';
  type1: TypeName;
  type2: TypeName | null;
  baseStats: BaseStats;
  /** Wild catch difficulty, 1 (hardest) - 255 (easiest), from the live game's species data. */
  catchRate: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

let _cache: Species[] | null = null;

export function loadSpecies(): Species[] {
  if (!_cache) {
    _cache = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'species.json'), 'utf-8'));
  }
  return _cache!;
}

export function getSpeciesByDexId(dexId: number): Species {
  const found = loadSpecies().find((s) => s.dexId === dexId);
  if (!found) throw new RangeError(`No species with dexId ${dexId}`);
  return found;
}

export const TOTAL_SPECIES_COUNT = 254;
