import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TYPE_INDEX: Record<string, number> = {
  Neutral: 0, Combat: 1, Wind: 2, Toxic: 3, Terra: 4, Stone: 5, Swarm: 6, Spectre: 7,
  Alloy: 8, Blaze: 9, Tide: 10, Flora: 11, Volt: 12, Psionic: 13, Frost: 14, Wyrm: 15,
  Shadow: 16, Fae: 17,
};

export interface RawSpecies {
  dexId: number;
  ticker: string;
  name: string;
  dbSymbol: string;
  roster: string;
  type1: string;
  type2: string | null;
  baseStats: { hp: number; attack: number; defense: number; spAttack: number; spDefense: number; speed: number };
  catchRate: number;
}

export function loadAllSpecies(): RawSpecies[] {
  return JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'data', 'species.json'), 'utf-8'));
}

/** Shapes a list of species into the exact positional arrays registerSpecies() expects. */
export function toRegisterArgs(list: RawSpecies[]) {
  return [
    list.map((s) => s.dexId),
    list.map((s) => s.name),
    list.map((s) => s.ticker),
    list.map((s) => TYPE_INDEX[s.type1]),
    list.map((s) => (s.type2 ? TYPE_INDEX[s.type2] : -1)),
    list.map((s) => s.catchRate),
    list.map((s) => [
      s.baseStats.hp, s.baseStats.attack, s.baseStats.defense,
      s.baseStats.spAttack, s.baseStats.spDefense, s.baseStats.speed,
    ]),
  ] as const;
}
