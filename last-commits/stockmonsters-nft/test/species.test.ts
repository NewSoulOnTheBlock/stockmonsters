import { describe, expect, it } from 'vitest';
import { loadSpecies, TOTAL_SPECIES_COUNT, getSpeciesByDexId } from '../src/species.js';

describe('species data', () => {
  it('has exactly 254 unique species', () => {
    const all = loadSpecies();
    expect(all.length).toBe(TOTAL_SPECIES_COUNT);
    expect(new Set(all.map((s) => s.dexId)).size).toBe(TOTAL_SPECIES_COUNT);
    expect(new Set(all.map((s) => s.dbSymbol)).size).toBe(TOTAL_SPECIES_COUNT);
  });

  it('every species has a valid catch rate and base stats', () => {
    for (const s of loadSpecies()) {
      expect(s.catchRate).toBeGreaterThanOrEqual(1);
      expect(s.catchRate).toBeLessThanOrEqual(255);
      for (const v of Object.values(s.baseStats)) {
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('throws for an unknown dexId', () => {
    expect(() => getSpeciesByDexId(999999)).toThrow();
  });
});
