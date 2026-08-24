#!/usr/bin/env node
/**
 * Cut the creature roster down to the 194 Robinhood Chain tokens.
 *
 *   node purge.js            # dry run
 *   node purge.js --apply    # delete creature data and rewrite references
 *
 * What it does:
 *   - deletes the JSON of every creature not in selection.json
 *   - filters every dex list down to the survivors
 *   - strips evolutions (one token = one creature, so a creature evolving into
 *     a different company makes no sense) and points babyDbSymbol at self
 *   - checks that no encounter group or trainer still references a deleted creature
 *   - emits creature-overrides.json (textId -> Stockmonster name) for reskin.js
 *   - emits token-map.json, the join table between the game and the chain
 *
 * Creature ids are deliberately NOT renumbered: `resources` keys sprites by the
 * original dex id ("0001"), and the name text row is indexed by id too.
 */

import fs from 'node:fs';
import path from 'node:path';
import { NAMES } from './names.js';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const STUDIO = path.join(PROJECT, 'Data', 'Studio');
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const APPLY = process.argv.includes('--apply');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');

const selection = readJson(path.join(HERE, 'selection.json'));
const keptSymbols = new Set(Object.values(selection.assignment));
const symbolToToken = new Map();
for (const [ticker, dbSymbol] of Object.entries(selection.assignment)) {
  const token = selection.tokens.find((t) => t.ticker === ticker);
  symbolToToken.set(dbSymbol, { ...token, name: NAMES[ticker] });
}

/* ------------------------------------------------------------- creatures */
const pokemonDir = path.join(STUDIO, 'pokemon');
const allFiles = fs.readdirSync(pokemonDir).filter((f) => f.endsWith('.json'));

const kept = [];
const toDelete = [];
for (const file of allFiles) {
  const j = readJson(path.join(pokemonDir, file));
  if (keptSymbols.has(j.dbSymbol)) kept.push({ file, json: j });
  else toDelete.push(file);
}

console.log(`creatures: ${allFiles.length} total, ${kept.length} kept, ${toDelete.length} to delete`);
if (kept.length !== selection.tokenCount) {
  console.error(`MISMATCH: ${kept.length} kept vs ${selection.tokenCount} tokens`);
  process.exit(1);
}

/* --- strip evolutions + baby links that would dangle --- */
let evoStripped = 0;
let babyFixed = 0;
for (const { json } of kept) {
  for (const form of json.forms || []) {
    if (form.evolutions && form.evolutions.length) {
      evoStripped += form.evolutions.length;
      form.evolutions = [];
    }
    if (form.babyDbSymbol && form.babyDbSymbol !== json.dbSymbol) {
      form.babyDbSymbol = json.dbSymbol;
      babyFixed += 1;
    }
  }
}
console.log(`evolutions stripped: ${evoStripped}, baby links repointed: ${babyFixed}`);

/* ------------------------------------------------------------------ dex */
const dexDir = path.join(STUDIO, 'dex');
const dexEdits = [];
for (const file of fs.readdirSync(dexDir).filter((f) => f.endsWith('.json'))) {
  const j = readJson(path.join(dexDir, file));
  const before = (j.creatures || []).length;
  j.creatures = (j.creatures || []).filter((c) => keptSymbols.has(c.dbSymbol));
  dexEdits.push({ file, before, after: j.creatures.length, json: j });
}
for (const d of dexEdits) console.log(`dex ${d.file.padEnd(16)} ${d.before} -> ${d.after}`);

/* --------------------------------------------------- dangling reference check */
const dangling = [];
for (const file of fs.readdirSync(path.join(STUDIO, 'groups'))) {
  const g = readJson(path.join(STUDIO, 'groups', file));
  for (const e of g.encounters || []) {
    if (!keptSymbols.has(e.specie)) dangling.push(`group ${file}: ${e.specie}`);
  }
}
for (const file of fs.readdirSync(path.join(STUDIO, 'trainers'))) {
  const t = readJson(path.join(STUDIO, 'trainers', file));
  for (const p of t.party || []) {
    if (!keptSymbols.has(p.specie)) dangling.push(`trainer ${file}: ${p.specie}`);
  }
}
if (dangling.length) {
  console.error(`\n${dangling.length} DANGLING REFERENCES - refusing to apply:`);
  dangling.slice(0, 20).forEach((d) => console.error(`  ${d}`));
  process.exit(1);
}
console.log('no dangling encounter/trainer references');

/* --------------------------------------------------------------- outputs */
// textId for a creature's name is its dex id (row 0 of 100000.csv is the Egg).
const overrides = { 0: 'IPO' };
const tokenMap = [];
for (const { json } of kept) {
  const token = symbolToToken.get(json.dbSymbol);
  overrides[json.id] = token.name;
  tokenMap.push({
    ticker: token.ticker,
    stockmonster: token.name,
    company: token.company,
    address: token.address,
    dbSymbol: json.dbSymbol,
    dexId: json.id,
  });
}
tokenMap.sort((a, b) => a.dexId - b.dexId);

// Every text row belonging to a deleted creature gets blanked.
const removedIds = [];
for (const file of toDelete) {
  const j = readJson(path.join(pokemonDir, file));
  removedIds.push(j.id);
}

console.log(`\nname overrides: ${Object.keys(overrides).length}`);
console.log(`blanked text rows: ${removedIds.length}`);

if (!APPLY) {
  console.log('\nDRY RUN - re-run with --apply');
  process.exit(0);
}

for (const file of toDelete) fs.rmSync(path.join(pokemonDir, file));
for (const { file, json } of kept) writeJson(path.join(pokemonDir, file), json);
for (const d of dexEdits) writeJson(path.join(dexDir, d.file), d.json);

writeJson(path.join(HERE, 'creature-overrides.json'), { names: overrides, blank: removedIds });
writeJson(path.join(HERE, 'token-map.json'), tokenMap);
writeJson(path.join(PROJECT, 'stockmonsters-token-map.json'), tokenMap);

console.log('\nAPPLIED');
console.log(`  deleted ${toDelete.length} creature files`);
console.log(`  rewrote ${kept.length} creature files and ${dexEdits.length} dex files`);
console.log('  wrote creature-overrides.json, token-map.json');
console.log(`  wrote ${path.join(PROJECT, 'stockmonsters-token-map.json')}`);
