import { describe, expect, it } from 'vitest';
import { buildMetadata } from '../src/metadata.js';
import { getSpeciesByDexId } from '../src/species.js';

describe('buildMetadata', () => {
  it('prefixes the name with Shiny only when shiny is true', () => {
    const species = getSpeciesByDexId(1);
    const traits = { level: 10, hp: 30, attack: 20, defense: 20, spAttack: 20, spDefense: 20, speed: 20, shiny: false };
    const regular = buildMetadata(1, species, traits, 'regular');
    const shiny = buildMetadata(2, species, { ...traits, shiny: true }, 'ultra');
    expect(regular.name.startsWith('Shiny')).toBe(false);
    expect(shiny.name.startsWith('Shiny')).toBe(true);
  });

  it('includes all 8 minted traits plus species/ticker/types/ball in attributes', () => {
    const species = getSpeciesByDexId(1);
    const traits = { level: 10, hp: 30, attack: 20, defense: 20, spAttack: 20, spDefense: 20, speed: 20, shiny: false };
    const meta = buildMetadata(1, species, traits, 'great');
    const traitTypes = meta.attributes.map((a) => a.trait_type);
    for (const expected of ['Species', 'Ticker', 'Level', 'HP', 'Attack', 'Defense', 'Special Attack', 'Special Defense', 'Speed', 'Shiny', 'Ball Used']) {
      expect(traitTypes).toContain(expected);
    }
  });

  it('omits Type 2 when the species is single-typed', () => {
    const singleType = { ...getSpeciesByDexId(1), type2: null };
    const traits = { level: 10, hp: 30, attack: 20, defense: 20, spAttack: 20, spDefense: 20, speed: 20, shiny: false };
    const meta = buildMetadata(1, singleType, traits, 'regular');
    expect(meta.attributes.map((a) => a.trait_type)).not.toContain('Type 2');
  });
});
