/**
 * Choose which 194 creature slots survive as Stockmonsters.
 *
 * Rules, in priority order:
 *   1. Anything the running game references must survive, or the demo breaks:
 *      every creature in a wild encounter group, plus creatures named by map
 *      events (:azurill from add_egg, :caterpie from add_pokemon).
 *   2. The tickers the vision named by hand keep the creature they were
 *      assigned in the first pass (AAPL -> bulbasaur, NVDA -> charmander, ...).
 *   3. Remaining slots are filled by lowest National Dex id, so the kept set
 *      stays contiguous at the front of the dex wherever it can.
 *
 * Writes selection.json: { ticker -> dbSymbol } plus the delete list.
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const STUDIO = path.join(PROJECT, 'Data', 'Studio');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* --- every creature, with its dex id --- */
const creatures = fs
  .readdirSync(path.join(STUDIO, 'pokemon'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => {
    const j = readJson(path.join(STUDIO, 'pokemon', f));
    return { dbSymbol: j.dbSymbol, id: j.id, file: f };
  })
  .sort((a, b) => a.id - b.id);

const byId = new Map(creatures.map((c) => [c.dbSymbol, c.id]));

/* --- rule 1: referenced by the running game --- */
const referenced = new Set(['azurill', 'caterpie']);
for (const f of fs.readdirSync(path.join(STUDIO, 'groups'))) {
  const g = readJson(path.join(STUDIO, 'groups', f));
  for (const e of g.encounters || []) referenced.add(e.specie);
}
// Trainer parties key the creature as `specie` too, not `dbSymbol`.
for (const f of fs.readdirSync(path.join(STUDIO, 'trainers'))) {
  const t = readJson(path.join(STUDIO, 'trainers', f));
  for (const p of t.party || []) referenced.add(p.specie);
}

/* --- rule 2: hand-placed tickers from the vision that exist on RH Chain --- */
const PINNED = {
  AAPL: 'bulbasaur',
  NVDA: 'charmander',
  TSLA: 'squirtle',
  AMD: 'caterpie',
  COIN: 'weedle',
  META: 'pidgey',
  PLTR: 'rattata',
  NFLX: 'spearow',
  AMZN: 'ekans',
  GOOGL: 'vulpix',
  COST: 'jigglypuff',
  MSTR: 'zubat',
  MSFT: 'venonat',
};

/* --- the token universe --- */
const tokens = fs
  .readFileSync(path.join(HERE, 'robinhood-chain-tokens.txt'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [name, ticker, address] = line.split('\t');
    return { company: name.replace(/\s*•\s*Robinhood Token\s*$/, '').trim(), ticker, address };
  });

/* --- build the kept set --- */
const kept = new Set();
for (const t of Object.values(PINNED)) {
  if (!byId.has(t)) throw new Error(`pinned creature "${t}" does not exist`);
  kept.add(t);
}
for (const r of referenced) {
  if (!byId.has(r)) throw new Error(`referenced creature "${r}" does not exist`);
  kept.add(r);
}
for (const c of creatures) {
  if (kept.size >= tokens.length) break;
  kept.add(c.dbSymbol);
}
if (kept.size !== tokens.length) {
  throw new Error(`kept ${kept.size} creatures for ${tokens.length} tokens`);
}

/* --- assign tickers to creatures --- */
const keptSorted = creatures.filter((c) => kept.has(c.dbSymbol));
const pinnedTickers = new Set(Object.keys(PINNED));
const takenCreatures = new Set(Object.values(PINNED));

const assignment = {};
for (const [ticker, dbSymbol] of Object.entries(PINNED)) assignment[ticker] = dbSymbol;

const freeCreatures = keptSorted.filter((c) => !takenCreatures.has(c.dbSymbol));
const freeTokens = tokens.filter((t) => !pinnedTickers.has(t.ticker));
if (freeCreatures.length !== freeTokens.length) {
  throw new Error(`${freeCreatures.length} free creatures vs ${freeTokens.length} free tokens`);
}
freeTokens.forEach((t, i) => {
  assignment[t.ticker] = freeCreatures[i].dbSymbol;
});

const removed = creatures.filter((c) => !kept.has(c.dbSymbol)).map((c) => c.dbSymbol);

const out = {
  tokenCount: tokens.length,
  keptCount: kept.size,
  removedCount: removed.length,
  referencedByGame: [...referenced].sort(),
  assignment, // ticker -> dbSymbol
  tokens,
  removed,
};

fs.writeFileSync(path.join(HERE, 'selection.json'), JSON.stringify(out, null, 2));

console.log(`tokens:           ${tokens.length}`);
console.log(`creatures total:  ${creatures.length}`);
console.log(`referenced (must keep): ${referenced.size}`);
console.log(`kept:             ${kept.size}`);
console.log(`removed:          ${removed.length}`);
console.log(`\nhighest kept dex id: ${Math.max(...keptSorted.map((c) => c.id))}`);
console.log('\nsample assignment:');
for (const t of tokens.slice(0, 6)) console.log(`  ${t.ticker.padEnd(6)} -> ${assignment[t.ticker]}`);
for (const t of ['AAPL', 'NVDA', 'TSLA', 'COIN']) console.log(`  ${t.padEnd(6)} -> ${assignment[t]}  (pinned)`);
