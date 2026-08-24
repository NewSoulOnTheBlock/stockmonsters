/**
 * The Marketlands reskin dictionary.
 *
 * Three layers, applied in this order:
 *   1. FILE_OVERRIDES  - exact row-index -> string, for proper nouns
 *   2. VOCAB           - ordered global word/phrase substitutions
 *   3. (nothing else)  - anything unmatched is left alone
 *
 * Edit this file and re-run `node reskin.js --apply` to change the whole game.
 */

import fs from 'node:fs';
import { INTRO } from './intro.js';

/* ------------------------------------------------------------------ *
 * Types  (file 100003, 18 rows)
 * Every type named in the vision is represented: Tech, Dragon, Electric,
 * Consumer, Earth, Crypto. Kept short - type chips render at 320x240.
 * ------------------------------------------------------------------ */
/**
 * Elemental first, market echo second. These stay recognisably adjacent to the
 * originals so type matchups still read at a glance, while none of them is the
 * original word. Several carry a quiet finance double-meaning (Tide, Toxic,
 * Shadow, Neutral) without becoming sector jargon.
 *
 * Order is positional and load-bearing: index == the type's `textId` in
 * Data/Studio/types/*.json (verified 0..17 = normal..fairy). Do not reorder.
 *
 * All names are <= 7 characters, inside the vanilla maximum of 8 ("Fighting"),
 * so the type chips still fit the 320x240 UI.
 */
export const TYPES = [
  'Neutral',   // Normal
  'Combat',    // Fighting
  'Wind',      // Flying
  'Toxic',     // Poison   - also toxic assets
  'Terra',     // Ground
  'Stone',     // Rock
  'Swarm',     // Bug
  'Spectre',   // Ghost
  'Alloy',     // Steel
  'Blaze',     // Fire
  'Tide',      // Water    - also liquidity, a rising tide
  'Flora',     // Grass
  'Volt',      // Electric
  'Psionic',   // Psychic
  'Frost',     // Ice      - also frozen assets
  'Wyrm',      // Dragon
  'Shadow',    // Dark     - also the Shortseller
  'Fae',       // Fairy
];

/* ------------------------------------------------------------------ *
 * Stockmonsters  (file 100000, row 0 = Egg, then National Dex order)
 *
 * The 20 creatures named in the vision, placed onto whole evolution
 * lines so that evolving never turns one company into another. The
 * vision's own ladder is used for stages: base -> Prime -> Ascendant.
 * ------------------------------------------------------------------ */
export const CREATURES = {
  0: 'IPO',                  // Egg

  1: 'Applion',              // AAPL - cyber-lion, blossom mane
  2: 'Applion Prime',
  3: 'Applion Ascendant',

  4: 'Nvidrake',             // NVDA - dragon that feeds on computation
  5: 'Nvidrake Prime',
  6: 'Nvidrake Ascendant',

  7: 'Teslazar',             // TSLA - electric kaiju
  8: 'Teslazar Prime',
  9: 'Teslazar Ascendant',

  10: 'Amdeon',              // AMD
  11: 'Amdeon Prime',
  12: 'Amdeon Ascendant',

  13: 'Coinraith',           // COIN - spectral, made of shifting coins
  14: 'Coinraith Prime',
  15: 'Coinraith Ascendant',

  16: 'Metamorph',           // META
  17: 'Metamorph Prime',
  18: 'Metamorph Ascendant',

  19: 'Palantheon',          // PLTR
  20: 'Palantheon Prime',

  21: 'Netflixis',           // NFLX
  22: 'Netflixis Prime',

  23: 'Amazorgon',           // AMZN - jungle serpent full of warehouses
  24: 'Amazorgon Prime',

  25: 'Hoodini',             // HOOD - the retail mascot takes the mascot slot
  26: 'Hoodini Prime',

  27: 'Nikeraptor',          // NKE
  28: 'Nikeraptor Prime',

  29: 'Valkyrion',           // V
  30: 'Valkyrion Prime',
  31: 'Valkyrion Ascendant',

  32: 'Mastermorph',         // MA
  33: 'Mastermorph Prime',
  34: 'Mastermorph Ascendant',

  35: 'Disneyra',            // DIS
  36: 'Disneyra Prime',

  37: 'Googolem',            // GOOGL
  38: 'Googolem Prime',

  39: 'Costaurus',           // COST
  40: 'Costaurus Prime',

  41: 'Microstryx',          // MSTR
  42: 'Microstryx Prime',

  43: 'Walmartusk',          // WMT
  44: 'Walmartusk Prime',
  45: 'Walmartusk Ascendant',

  46: 'Jormorgan',           // JPM
  47: 'Jormorgan Prime',

  48: 'Microsoftus',         // MSFT
  49: 'Microsoftus Prime',
};

/* ------------------------------------------------------------------ *
 * Global vocabulary
 *
 * Ordered: longest / most specific first, because they are applied in
 * sequence. `\b` boundaries keep them from eating parts of other words.
 * ------------------------------------------------------------------ */
/**
 * Applied to the raw string BEFORE control codes are masked, because these
 * rules need to see the codes themselves.
 *
 * Shop prices are authored as "$[VAR NUM7(0002,002C)]". Renaming the unit to
 * $AGORA means moving it after the number, or every price would read
 * "$AGORA1,200" with the ticker glued to the digits.
 */
export const PRE_VOCAB = [
  [/\$(\[VAR NUM\d+\([^)]*\)\])/g, (_m, num) => `${num} $AGORA`],
];

export const VOCAB = [
  // --- the engine must never be named in-game ---
  // These run before the generic Pokémon rule, or "Pokémon Studio" would come
  // out as "Stockmonster Studio".
  ['PokémonSDK', 'Stockmonsters'],
  ['PokemonSDK', 'Stockmonsters'],
  ['Pokémon Studio', 'Stockmonsters'],
  ['Pokemon Studio', 'Stockmonsters'],
  ['PSDK', 'Stockmonsters'],

  // --- the cast ---
  // The demo's recurring NPCs, recast for The Marketlands. These run first so
  // they are matched before anything else. Note "Nuri Yuri" is two words and
  // must precede any single-word rule.
  //
  // The PSDK credits screen (Data/configs/credits_config.json) still credits
  // the real engine authors and is deliberately NOT touched by this pass.
  ['SirMalo', 'Kelby'],
  ['Nuri Yuri', 'Trippy'],
  ['Palbolsky', 'Gambino'],
  ['Aerun', 'Ragan'],
  ['Walven', 'Gareth'],
  ['Rey', 'Rez'],

  // --- multi-word institutions, before their component words ---
  ['Pokémon Center', 'Clearing House'],
  ['Pokemon Center', 'Clearing House'],
  ['Poké Center', 'Clearing House'],
  ['Pokémon League', 'Market Council'],
  ['Pokemon League', 'Market Council'],
  ['Gym Leaders', 'Market Makers'],
  ['Gym Leader', 'Market Maker'],
  ['Elite Four', 'Board of Governors'],
  ['Pokémon Storage System', 'Portfolio Vault'],
  ['Storage System', 'Portfolio Vault'],
  ['Day Care', 'Incubator'],
  ['Daycare', 'Incubator'],
  ['Safari Zone', 'Speculation Zone'],
  ['Battle Tower', 'The Exchange Tower'],
  ['Hall of Fame', 'Hall of Legends'],

  // --- balls / capture ---
  ['Master Balls', 'Prime Cores'],
  ['Master Ball', 'Prime Core'],
  ['Poké Balls', 'Cores'],
  ['Poke Balls', 'Cores'],
  ['Pokéballs', 'Cores'],
  ['Poké Ball', 'Core'],
  ['Poke Ball', 'Core'],
  ['Pokéball', 'Core'],

  // --- the dex ---
  ['Pokédex', 'Ledger'],
  ['Pokedex', 'Ledger'],

  // --- creatures and people ---
  ['Pokémon', 'Stockmonster'],
  ['Pokemon', 'Stockmonster'],
  ['Trainers', 'Hunters'],
  ['Trainer', 'Hunter'],
  ['trainers', 'hunters'],
  ['trainer', 'hunter'],
  ['Professor', 'Analyst'],
  ['professor', 'analyst'],
  ['Prof\\.', 'Analyst'],
  ['Breeder', 'Incubator Tech'],
  ['breeder', 'incubator tech'],

  // --- places ---
  ['Gyms', 'Exchanges'],
  ['Gym', 'Exchange'],

  // --- progression ---
  ['Badges', 'Licenses'],
  ['Badge', 'License'],

  // --- economy: the in-game currency is $AGORA ---
  ['Poké Dollars', '$AGORA'],
  ['Poké Dollar', '$AGORA'],
  ['Poké Mart', 'Exchange Post'],
  ['Coins', '$AGORA'],
  ['money', '$AGORA'],
  ['Money', '$AGORA'],

  // --- breeding / items ---
  ['Eggs', 'IPOs'],
  ['Egg', 'IPO'],
  ['Berries', 'Yields'],
  ['Berry', 'Yield'],
  ['berries', 'yields'],
  ['berry', 'yield'],
];

/**
 * Files whose rows are pure proper nouns - global vocabulary is skipped
 * there and only FILE_OVERRIDES apply, so a creature never gets a stray
 * word swapped inside its name.
 */
export const OVERRIDE_ONLY_FILES = new Set([100000, 100003]);

/**
 * purge.js writes creature-overrides.json once the roster is cut to the
 * Robinhood Chain tokens: the full textId -> Stockmonster map, plus the text
 * rows belonging to deleted creatures. Fall back to the hand-written CREATURES
 * table when the purge has not run yet.
 */
function loadCreatureOverrides() {
  const file = new URL('./creature-overrides.json', import.meta.url);
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { names: j.names, blank: new Set(j.blank) };
  } catch {
    return { names: CREATURES, blank: new Set() };
  }
}

const creatureOverrides = loadCreatureOverrides();

/** Text rows of deleted creatures, blanked so nothing stale can surface. */
export const BLANK_IDS = creatureOverrides.blank;

/** Files whose rows are per-creature and therefore need blanking. */
export const PER_CREATURE_FILES = new Set([100000, 100001, 100002]);

export const FILE_OVERRIDES = {
  2: INTRO,
  100000: creatureOverrides.names,
  100003: Object.fromEntries(TYPES.map((name, i) => [i, name])),
};
