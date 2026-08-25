// Pulls the canonical 254-species roster out of the live Stockmonsters game data
// (base stats + catch rate from PSDK, names/tickers/types from the reskin mapping files)
// and writes a clean data/species.json used by the NFT trait/catch-rate system.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const GAME_ROOT = 'C:/Users/roota/Downloads/Stockmonsters';
const RESKIN_ROOT = 'C:/Users/roota/Downloads/stockmonsters-reskin';

const TYPE_RENAME = {
  normal: 'Neutral', fighting: 'Combat', flying: 'Wind', poison: 'Toxic',
  ground: 'Terra', rock: 'Stone', bug: 'Swarm', ghost: 'Spectre', steel: 'Alloy',
  fire: 'Blaze', water: 'Tide', grass: 'Flora', electric: 'Volt', psychic: 'Psionic',
  ice: 'Frost', dragon: 'Wyrm', dark: 'Shadow', fairy: 'Fae',
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const tokenMap = readJson(join(RESKIN_ROOT, 'token-map.json'));
const memeRoster = readJson(join(RESKIN_ROOT, 'meme-roster.json'));

const stockEntries = tokenMap.map((e) => ({
  dexId: e.dexId,
  ticker: e.ticker,
  name: e.stockmonster,
  dbSymbol: e.dbSymbol,
  roster: 'stock',
}));
const memeEntries = memeRoster.map((e) => ({
  dexId: e.dexId,
  ticker: e.ticker,
  name: e.name,
  dbSymbol: e.dbSymbol,
  roster: 'meme',
}));

const all = [...stockEntries, ...memeEntries];
console.log(`Canonical roster: ${stockEntries.length} stock + ${memeEntries.length} meme = ${all.length} total`);

const seenDbSymbols = new Set();
const species = [];
for (const entry of all) {
  if (seenDbSymbols.has(entry.dbSymbol)) {
    console.error(`DUPLICATE dbSymbol: ${entry.dbSymbol} (${entry.name})`);
    continue;
  }
  seenDbSymbols.add(entry.dbSymbol);

  const specPath = join(GAME_ROOT, 'Data/Studio/pokemon', `${entry.dbSymbol}.json`);
  let spec;
  try {
    spec = readJson(specPath);
  } catch (err) {
    console.error(`MISSING species file for ${entry.dbSymbol} (${entry.name}, dexId ${entry.dexId})`);
    continue;
  }
  const form = spec.forms[0];
  // PSDK represents "no second type" as the literal sentinel string "__undef__", not JSON null.
  const hasType2 = form.type2 && form.type2 !== '__undef__';

  species.push({
    dexId: entry.dexId,
    ticker: entry.ticker,
    name: entry.name,
    dbSymbol: entry.dbSymbol,
    roster: entry.roster,
    type1: TYPE_RENAME[form.type1] ?? form.type1,
    type2: hasType2 ? (TYPE_RENAME[form.type2] ?? form.type2) : null,
    baseStats: {
      hp: form.baseHp,
      attack: form.baseAtk,
      defense: form.baseDfe,
      spAttack: form.baseAts,
      spDefense: form.baseDfs,
      speed: form.baseSpd,
    },
    catchRate: form.catchRate,
  });
}

console.log(`Resolved ${species.length} species with full stat data.`);
if (species.length !== 254) {
  console.warn(`WARNING: expected 254, got ${species.length}`);
}

writeFileSync(
  join(import.meta.dirname, '..', 'data', 'species.json'),
  JSON.stringify(species, null, 2),
);
console.log('Wrote data/species.json');
