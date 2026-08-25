import { describe, expect, it } from 'vitest';
import { createCollectionState, isShinyAvailable, GLOBAL_SUPPLY_CAP } from '../src/collectionState.js';
import { catchAndMint } from '../src/mint.js';
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

const applion = getSpeciesByDexId(1);
// Applion's real catchRate (45/255, inherited from its underlying species) can never reach the
// guaranteed-catch threshold even with the best ball/status/HP combo - use a synthetic easy-to-catch
// species (catchRate 255) for scenarios that specifically need a guaranteed catch.
const easyCatch = { ...applion, catchRate: 255 };

describe('catchAndMint', () => {
  it('refuses to mint once the global cap is hit', () => {
    const state = createCollectionState();
    state.totalMinted = GLOBAL_SUPPLY_CAP;
    const result = catchAndMint(
      { species: applion, level: 10, maxHp: 100, currentHp: 1, status: 'sleep', ball: 'ultra' },
      state,
      seededRng(1),
    );
    expect(result.outcome).toBe('supply_exhausted');
  });

  it('a guaranteed-catch scenario always mints and increments totalMinted', () => {
    const state = createCollectionState();
    const result = catchAndMint(
      { species: easyCatch, level: 10, maxHp: 100, currentHp: 1, status: 'freeze', ball: 'ultra' },
      state,
      seededRng(2),
    );
    expect(result.outcome).toBe('minted');
    expect(state.totalMinted).toBe(1);
  });

  it('a hopeless catch scenario always breaks free and does not mint', () => {
    const state = createCollectionState();
    const result = catchAndMint(
      { species: getSpeciesByDexId(applion.dexId), level: 10, maxHp: 999, currentHp: 999, status: 'none', ball: 'regular' },
      state,
      () => 0.9999,
    );
    expect(result.outcome).toBe('broke_free');
    expect(state.totalMinted).toBe(0);
  });

  it('once a species shiny is claimed, it can never be minted again for that species', () => {
    const state = createCollectionState();
    // force a guaranteed catch + guaranteed shiny roll (rng always returns 0)
    const first = catchAndMint(
      { species: easyCatch, level: 5, maxHp: 10, currentHp: 1, status: 'freeze', ball: 'ultra' },
      state,
      () => 0,
    );
    expect(first.outcome).toBe('minted');
    if (first.outcome === 'minted') expect(first.traits.shiny).toBe(true);
    expect(isShinyAvailable(state, easyCatch.dexId)).toBe(false);

    // second guaranteed catch + guaranteed shiny roll for the SAME species must NOT produce a second shiny
    const second = catchAndMint(
      { species: easyCatch, level: 5, maxHp: 10, currentHp: 1, status: 'freeze', ball: 'ultra' },
      state,
      () => 0,
    );
    expect(second.outcome).toBe('minted');
    if (second.outcome === 'minted') expect(second.traits.shiny).toBe(false);
  });

  it('never exceeds the global supply cap across many mints', () => {
    const state = createCollectionState();
    const rng = seededRng(99);
    let minted = 0;
    for (let i = 0; i < GLOBAL_SUPPLY_CAP + 50; i++) {
      const result = catchAndMint(
        { species: easyCatch, level: 10, maxHp: 10, currentHp: 1, status: 'freeze', ball: 'ultra' },
        state,
        rng,
      );
      if (result.outcome === 'minted') minted++;
    }
    expect(minted).toBe(GLOBAL_SUPPLY_CAP);
    expect(state.totalMinted).toBe(GLOBAL_SUPPLY_CAP);
  });
});
