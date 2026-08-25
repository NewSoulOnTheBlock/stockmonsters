import type { BallType } from './ballTypes.js';
import { BALL_CONFIG } from './ballTypes.js';
import type { Species } from './species.js';
import type { MintedTraits } from './traits.js';

export interface ErcAttribute {
  trait_type: string;
  value: string | number;
}

export interface Erc721Metadata {
  name: string;
  description: string;
  image: string;
  attributes: ErcAttribute[];
}

/**
 * IPFS image path convention: one folder per species (by dbSymbol), with a regular.png and
 * a shiny.png inside. Swap IMAGE_BASE_URI for the real pinned CID root at deploy time.
 */
const IMAGE_BASE_URI = 'ipfs://REPLACE_WITH_COLLECTION_CID';

export function imageUriFor(species: Species, shiny: boolean): string {
  return `${IMAGE_BASE_URI}/${species.dbSymbol}/${shiny ? 'shiny' : 'regular'}.png`;
}

export function buildMetadata(
  tokenId: number,
  species: Species,
  traits: MintedTraits,
  ball: BallType,
): Erc721Metadata {
  const displayName = traits.shiny ? `Shiny ${species.name}` : species.name;
  const attributes: ErcAttribute[] = [
    { trait_type: 'Species', value: species.name },
    { trait_type: 'Ticker', value: species.ticker },
    { trait_type: 'Type 1', value: species.type1 },
    ...(species.type2 ? [{ trait_type: 'Type 2', value: species.type2 }] : []),
    { trait_type: 'Level', value: traits.level },
    { trait_type: 'HP', value: traits.hp },
    { trait_type: 'Attack', value: traits.attack },
    { trait_type: 'Defense', value: traits.defense },
    { trait_type: 'Special Attack', value: traits.spAttack },
    { trait_type: 'Special Defense', value: traits.spDefense },
    { trait_type: 'Speed', value: traits.speed },
    { trait_type: 'Shiny', value: traits.shiny ? 'Yes' : 'No' },
    { trait_type: 'Ball Used', value: BALL_CONFIG[ball].name },
  ];

  return {
    name: `${displayName} #${tokenId}`,
    description: `A wild ${species.name} (${species.ticker}), caught and minted on the Stock Monster Collection. ` +
      `${traits.shiny ? 'One of exactly one shiny of this species that will ever exist. ' : ''}` +
      `Market Core forces: ${species.type1}${species.type2 ? ` / ${species.type2}` : ''}.`,
    image: imageUriFor(species, traits.shiny),
    attributes,
  };
}
