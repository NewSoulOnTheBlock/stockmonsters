// Quick sanity demo: a few catch attempts against a real species, showing the resolved
// metadata JSON. Run with: node --experimental-strip-types scripts/demo.mjs (or after `tsc build`).
import { catchAndMint } from '../dist/mint.js';
import { createCollectionState } from '../dist/collectionState.js';
import { getSpeciesByDexId } from '../dist/species.js';
import { buildMetadata } from '../dist/metadata.js';

const state = createCollectionState();
const species = getSpeciesByDexId(1); // Applion (AAPL)

let seed = 7;
const rng = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed |= 0;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
};

for (let i = 0; i < 5; i++) {
  const result = catchAndMint(
    { species, level: 12, maxHp: 40, currentHp: 3, status: 'sleep', ball: 'ultra' },
    state,
    rng,
  );
  console.log(`\nAttempt ${i + 1}: ${result.outcome}`);
  if (result.outcome === 'minted') {
    console.log(JSON.stringify(buildMetadata(state.totalMinted, species, result.traits, 'ultra'), null, 2));
  }
}
console.log(`\nTotal minted so far: ${state.totalMinted}`);
