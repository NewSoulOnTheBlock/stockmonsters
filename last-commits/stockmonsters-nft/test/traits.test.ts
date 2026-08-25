import { describe, expect, it } from 'vitest';
import { computeFinalStats, generateTraits, IV_MAX, IV_MIN, rollIvs, rollShiny, SHINY_ODDS } from '../src/traits.js';
import { getSpeciesByDexId } from '../src/species.js';

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s |= 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

describe('rollIvs', () => {
  it('every stat is within 0-31 across many rolls', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 5000; i++) {
      const iv = rollIvs(rng);
      for (const v of Object.values(iv)) {
        expect(v).toBeGreaterThanOrEqual(IV_MIN);
        expect(v).toBeLessThanOrEqual(IV_MAX);
      }
    }
  });
});

describe('computeFinalStats', () => {
  it('rejects out-of-range levels', () => {
    const base = { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 };
    const iv = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
    expect(() => computeFinalStats(base, iv, 0)).toThrow();
    expect(() => computeFinalStats(base, iv, 101)).toThrow();
  });

  it('higher IVs never produce a lower stat than lower IVs, all else equal', () => {
    const base = { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 };
    const low = computeFinalStats(base, { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 }, 20);
    const high = computeFinalStats(base, { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 }, 20);
    expect(high.hp).toBeGreaterThanOrEqual(low.hp);
    expect(high.attack).toBeGreaterThanOrEqual(low.attack);
  });

  it('level 100 max IVs matches the known Gen III reference stat line for a 45-base HP species', () => {
    const stats = computeFinalStats(
      { hp: 45, attack: 45, defense: 45, spAttack: 45, spDefense: 45, speed: 45 },
      { hp: 31, attack: 31, defense: 31, spAttack: 31, spDefense: 31, speed: 31 },
      100,
    );
    // floor((2*45+31)*100/100) + 100 + 10 = 121 + 110 = 231
    expect(stats.hp).toBe(231);
    // floor((2*45+31)*100/100) + 5 = 121 + 5 = 126
    expect(stats.attack).toBe(126);
  });
});

describe('rollShiny', () => {
  it('never returns true if the species slot is already claimed', () => {
    const alwaysHitRng = () => 0;
    expect(rollShiny(alwaysHitRng, false)).toBe(false);
  });

  it('can return true when the roll hits and the slot is open', () => {
    const alwaysHitRng = () => 0;
    expect(rollShiny(alwaysHitRng, true)).toBe(true);
  });

  it('frequency roughly matches SHINY_ODDS over many trials', () => {
    const rng = seededRng(42);
    let hits = 0;
    const trials = 200_000;
    for (let i = 0; i < trials; i++) {
      if (rollShiny(rng, true)) hits++;
    }
    const observed = hits / trials;
    expect(Math.abs(observed - SHINY_ODDS)).toBeLessThan(SHINY_ODDS); // within 100% relative tolerance (rare-event trial size)
  });
});

describe('generateTraits', () => {
  it('produces all 8 traits (level + 6 stats + shiny)', () => {
    const species = getSpeciesByDexId(1);
    const traits = generateTraits(species, 12, true, seededRng(7));
    expect(traits).toHaveProperty('level', 12);
    expect(traits).toHaveProperty('hp');
    expect(traits).toHaveProperty('attack');
    expect(traits).toHaveProperty('defense');
    expect(traits).toHaveProperty('spAttack');
    expect(traits).toHaveProperty('spDefense');
    expect(traits).toHaveProperty('speed');
    expect(traits).toHaveProperty('shiny');
    expect(typeof traits.shiny).toBe('boolean');
  });
});
