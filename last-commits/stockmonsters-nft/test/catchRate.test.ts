import { describe, expect, it } from 'vitest';
import { BALL_CONFIG } from '../src/ballTypes.js';
import { attemptCatch, catchProbability, computeA } from '../src/catchRate.js';

const commonSpecies = { catchRate: 255 }; // easiest possible catch rate
const rareSpecies = { catchRate: 3 }; // near-legendary difficulty

describe('computeA', () => {
  it('rejects invalid inputs', () => {
    expect(() => computeA({ catchRate: 255, maxHp: 0, currentHp: 0, status: 'none', ball: BALL_CONFIG.regular })).toThrow();
    expect(() => computeA({ catchRate: 255, maxHp: 10, currentHp: 11, status: 'none', ball: BALL_CONFIG.regular })).toThrow();
    expect(() => computeA({ catchRate: 0, maxHp: 10, currentHp: 10, status: 'none', ball: BALL_CONFIG.regular })).toThrow();
  });

  it('full-HP, easy species, weakest ball gives a low-but-real a value', () => {
    const a = computeA({ catchRate: commonSpecies.catchRate, maxHp: 100, currentHp: 100, status: 'none', ball: BALL_CONFIG.regular });
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });

  it('low HP + status + ultra ball pushes a well above the guaranteed-catch threshold', () => {
    const a = computeA({ catchRate: commonSpecies.catchRate, maxHp: 100, currentHp: 1, status: 'sleep', ball: BALL_CONFIG.ultra });
    expect(a).toBeGreaterThanOrEqual(255);
  });

  it('rare species at full HP with the weakest ball is much harder than a common one', () => {
    const easy = computeA({ catchRate: commonSpecies.catchRate, maxHp: 100, currentHp: 100, status: 'none', ball: BALL_CONFIG.regular });
    const hard = computeA({ catchRate: rareSpecies.catchRate, maxHp: 100, currentHp: 100, status: 'none', ball: BALL_CONFIG.regular });
    expect(hard).toBeLessThan(easy);
  });

  it('ball bonus strictly improves the odds, all else equal', () => {
    const withRegular = computeA({ catchRate: 120, maxHp: 100, currentHp: 60, status: 'none', ball: BALL_CONFIG.regular });
    const withGreat = computeA({ catchRate: 120, maxHp: 100, currentHp: 60, status: 'none', ball: BALL_CONFIG.great });
    const withUltra = computeA({ catchRate: 120, maxHp: 100, currentHp: 60, status: 'none', ball: BALL_CONFIG.ultra });
    expect(withGreat).toBeGreaterThan(withRegular);
    expect(withUltra).toBeGreaterThan(withGreat);
  });
});

describe('catchProbability', () => {
  it('is 1 once a hits the guaranteed-catch threshold', () => {
    const p = catchProbability({ catchRate: 255, maxHp: 100, currentHp: 1, status: 'freeze', ball: BALL_CONFIG.ultra });
    expect(p).toBe(1);
  });

  it('is 0 for an impossible catch rate at full health with the weakest ball', () => {
    const p = catchProbability({ catchRate: 1, maxHp: 999, currentHp: 999, status: 'none', ball: BALL_CONFIG.regular });
    // catchRate=1 at full HP with a 1x ball rounds a down to 0 (floor), which is an instant break-free
    expect(p).toBe(0);
  });

  it('is always between 0 and 1', () => {
    for (let cr = 1; cr <= 255; cr += 17) {
      for (const ball of Object.values(BALL_CONFIG)) {
        const p = catchProbability({ catchRate: cr, maxHp: 100, currentHp: 50, status: 'none', ball });
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('attemptCatch', () => {
  it('is deterministic given a fixed rng', () => {
    const input = { catchRate: 100, maxHp: 100, currentHp: 40, status: 'poison' as const, ball: BALL_CONFIG.great };
    const fixedRng = () => 0; // always the best possible roll
    const result = attemptCatch(input, fixedRng);
    expect(result.shakes).toBeGreaterThan(0);
  });

  it('a roll of just-below-1 always fails a real (non-guaranteed) shake check', () => {
    const input = { catchRate: 30, maxHp: 100, currentHp: 100, status: 'none' as const, ball: BALL_CONFIG.regular };
    const alwaysWorstRng = () => 0.999999;
    const result = attemptCatch(input, alwaysWorstRng);
    expect(result.caught).toBe(false);
  });

  it('matches catchProbability over many trials within statistical tolerance', () => {
    const input = { catchRate: 90, maxHp: 100, currentHp: 30, status: 'paralyze' as const, ball: BALL_CONFIG.regular };
    const expectedP = catchProbability(input);
    let hits = 0;
    const trials = 20000;
    // simple xorshift-ish seeded PRNG for reproducibility
    let seed = 12345;
    const rng = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed |= 0;
      return ((seed >>> 0) % 1_000_000) / 1_000_000;
    };
    for (let i = 0; i < trials; i++) {
      if (attemptCatch(input, rng).caught) hits++;
    }
    const observedP = hits / trials;
    expect(Math.abs(observedP - expectedP)).toBeLessThan(0.03);
  });
});
