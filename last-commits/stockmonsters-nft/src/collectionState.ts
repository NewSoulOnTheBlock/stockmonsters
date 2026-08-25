/**
 * Tracks the two hard caps that span the whole collection:
 *   - global supply: at most 5000 Stockmonsters ever minted, across all species combined.
 *   - shiny supply: at most 1 shiny per species (254 max possible shinies total, well under 5000).
 *
 * This is an in-memory reference implementation. A real deployment mirrors this exact shape
 * as contract storage (a uint256 totalSupply counter + a mapping(uint16 dexId => bool) shinyClaimed).
 */
export const GLOBAL_SUPPLY_CAP = 5000;

export interface CollectionState {
  totalMinted: number;
  shinyClaimedByDexId: Set<number>;
}

export function createCollectionState(): CollectionState {
  return { totalMinted: 0, shinyClaimedByDexId: new Set() };
}

export function canMint(state: CollectionState): boolean {
  return state.totalMinted < GLOBAL_SUPPLY_CAP;
}

export function isShinyAvailable(state: CollectionState, dexId: number): boolean {
  return !state.shinyClaimedByDexId.has(dexId);
}

/** Call only after a mint has actually been resolved successfully. */
export function recordMint(state: CollectionState, dexId: number, shiny: boolean): void {
  state.totalMinted++;
  if (shiny) state.shinyClaimedByDexId.add(dexId);
}
