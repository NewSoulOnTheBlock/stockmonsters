#!/usr/bin/env node
/**
 * Generate SPRITE-BRIEF.md - the art production document for all 194
 * Stockmonsters.
 *
 *   node gen-sprite-doc.js
 *
 * Everything technical in the output is read from the live project, not
 * assumed: dex ids and filenames come from stockmonsters-token-map.json, types
 * come from the creature JSONs, and sprite dimensions were measured off the
 * existing PNGs (96x96 battlers, 64x32 two-frame icons, 16x16 footprints,
 * 128x128 4x4 overworld sheets).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DESIGNS } from './designs.js';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const OUT = path.join(PROJECT, 'SPRITE-BRIEF.md');

const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'creature-types.json'), 'utf8'));
const pad = (n) => String(n).padStart(4, '0');

/** The style contract every sprite shares. Prepended to each subject prompt. */
const STYLE = [
  '16-bit era monster-collector RPG battle sprite',
  'front-facing three-quarter view',
  'clean hard-edged pixel art',
  'limited palette of 12-16 colours with crisp 1px dark outline',
  'soft cel shading with one light source from upper left',
  'no background, fully transparent',
  'no text, no logos, no letters, no watermark',
  'full body centred with a few pixels of margin',
  'original creature design',
].join(', ');

const NEGATIVE = [
  'photorealism', 'blurry', '3d render', 'anti-aliased soft edges', 'drop shadow on background',
  'text', 'logo', 'trademark', 'watermark', 'signature', 'border', 'frame',
  'existing copyrighted characters', 'human figures',
].join(', ');

const lines = [];
const L = (s = '') => lines.push(s);

/* ------------------------------------------------------------------ intro */
L('# Stockmonsters — Sprite Production Brief');
L();
L(`Art briefs and generation prompts for all **${rows.length} Stockmonsters**, one per Robinhood Chain token.`);
L();
L('Every technical value here was read from the live project — dex ids and filenames from');
L('`stockmonsters-token-map.json`, types from `Data/Studio/pokemon/*.json`, and dimensions measured');
L('off the existing PNGs. Drop generated art at the exact paths listed and PSDK picks it up with no');
L('config change, because `resources` in each creature JSON keys sprites by **dex id**, not name.');
L();

/* --------------------------------------------------------------- pipeline */
L('## 1. What each creature needs');
L();
L('| Sprite | Path (under `graphics/`) | Size | Notes |');
L('|---|---|---|---|');
L('| Front | `pokedex/pokefront/NNNN.png` | **96×96** | Battle sprite, faces the player |');
L('| Front shiny | `pokedex/pokefrontshiny/NNNNs.png` | **96×96** | Recoloured variant |');
L('| Back | `pokedex/pokeback/NNNN.png` | **96×96** | Rear view, seen over the player\'s shoulder |');
L('| Back shiny | `pokedex/pokebackshiny/NNNNs.png` | **96×96** | Recoloured variant |');
L('| Icon | `pokedex/pokeicon/NNNN.png` | **64×32** | Two 32×32 frames side by side (bob animation) |');
L('| Footprint | `pokedex/footprints/NNNN.png` | **16×16** | Silhouette only, solid dark on transparent |');
L('| Overworld | `characters/NNNN.png` | **128×128** | 4×4 grid of 32×32 frames: 4 walk frames × 4 facings |');
L();
L('`NNNN` is the zero-padded dex id from each entry below. All files are **PNG with a real alpha');
L('channel** (RGBA) — index-transparency will render with fringing.');
L();
L('All 194 slots currently hold the original placeholder art, so nothing breaks while you replace');
L('them incrementally. Ship fronts first: that is what shows in battle, the dex, and Studio.');
L();

/* ------------------------------------------------------------ style block */
L('## 2. Shared style contract');
L();
L('Prepend this to every subject prompt so the roster reads as one art set:');
L();
L('```text');
L(STYLE);
L('```');
L();
L('Negative prompt:');
L();
L('```text');
L(NEGATIVE);
L('```');
L();
L('**Keep designs original.** These are Stockmonsters, not reskinned existing creatures — the whole');
L('point is a roster nobody else has. Prompts below describe original bodies built from what each');
L('company actually does.');
L();

/* ------------------------------------------------------------- per-sprite */
L('## 3. Per-sprite prompt suffixes');
L();
L('Generate the **front** first, then derive the rest from it so a creature stays on-model:');
L();
L('| Sprite | Append to the subject prompt |');
L('|---|---|');
L('| Front | `full body, facing viewer, 96x96 pixel canvas` |');
L('| Back | `rear view of the same creature, same palette and proportions, 96x96 pixel canvas` |');
L('| Shiny | `same creature, alternate colourway: shift hue 120-180 degrees, keep value structure identical` |');
L('| Icon | `simplified chibi bust, readable at 32x32, chunky shapes, minimal detail` |');
L('| Footprint | `solid dark silhouette of the creature\'s foot or ground contact only, 16x16, no interior detail` |');
L('| Overworld | `tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified` |');
L();

/* ------------------------------------------------------------ the roster */
L('## 4. The roster');
L();

let current = null;
for (const r of rows) {
  const id = pad(r.dexId);
  const types = r.t2 ? `${r.t1} / ${r.t2}` : r.t1;
  const design = DESIGNS[r.ticker];
  if (!design) throw new Error(`no design brief for ${r.ticker}`);

  L(`### ${r.dexId}. ${r.stockmonster}`);
  L();
  L(`**${r.ticker}** · ${r.company} · type **${types}** · dex id \`${id}\``);
  L();
  L('```text');
  L(`${STYLE}, ${design}`);
  L('```');
  L();
  L(`<sub>Files: \`pokefront/${id}.png\` · \`pokefrontshiny/${id}s.png\` · \`pokeback/${id}.png\` · \`pokebackshiny/${id}s.png\` · \`pokeicon/${id}.png\` · \`footprints/${id}.png\` · \`characters/${id}.png\`</sub>`);
  L();
  current = r;
}
void current;

/* ------------------------------------------------------------- appendix */
L('## 5. Batch manifest');
L();
L('Machine-readable version of the same data, for scripting a generation run:');
L();
L('```csv');
L('dex_id,ticker,stockmonster,company,type1,type2,front_path,subject_prompt');
for (const r of rows) {
  const id = pad(r.dexId);
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  L([
    id,
    r.ticker,
    esc(r.stockmonster),
    esc(r.company),
    r.t1,
    r.t2 || '',
    `graphics/pokedex/pokefront/${id}.png`,
    esc(DESIGNS[r.ticker]),
  ].join(','));
}
L('```');
L();

/* ---------------------------------------------------------------- caveat */
L('## 6. About the types');
L();
L('The 18 types are elemental, sitting one step away from the classic set so matchups still read at');
L('a glance while none of the names is the original word:');
L();
L('| | | | |');
L('|---|---|---|---|');
L('| Neutral | Combat | Wind | Toxic |');
L('| Terra | Stone | Swarm | Spectre |');
L('| Alloy | Blaze | Tide | Flora |');
L('| Volt | Psionic | Frost | Wyrm |');
L('| Shadow | Fae | | |');
L();
L('Several carry a quiet second meaning — Tide (liquidity), Toxic (toxic assets), Frost (frozen');
L('assets), Shadow (the Shortseller), Neutral (a flat position) — without turning the type chart');
L('into sector jargon.');
L();
L('Each creature keeps the type pairing of the slot it occupies, so the type chart stays balanced');
L('and every matchup already works. Types describe the **creature**, not the company: Applion is');
L('`Flora / Toxic` because it is a blossom-maned lion, not because Apple is agricultural. Design');
L('to the creature and the palette will agree with the type.');
L();

fs.writeFileSync(OUT, `${lines.join('\n')}\n`, 'utf8');
fs.writeFileSync(path.join(HERE, 'SPRITE-BRIEF.md'), `${lines.join('\n')}\n`, 'utf8');

const bytes = fs.statSync(OUT).size;
console.log(`wrote ${OUT}`);
console.log(`  ${rows.length} creatures, ${lines.length} lines, ${(bytes / 1024).toFixed(1)} KB`);
console.log(`  ${rows.length * 7} sprite files specified`);
