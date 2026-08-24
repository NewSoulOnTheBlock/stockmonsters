#!/usr/bin/env node
/**
 * Reskin the Stockmonsters text database into The Marketlands.
 *
 *   node reskin.js                 # dry run: report what would change
 *   node reskin.js --apply         # rewrite the CSVs and drop stale .dat files
 *   node reskin.js --verify        # prove CSV parse/serialize round-trips byte-safe
 *   node reskin.js --file 100000   # limit to one text file
 *   node reskin.js --sample 12     # how many example changes to print per file
 *
 * Why the .dat deletion matters: PSDK's Studio::Text tries the compiled
 * Marshal file BEFORE the CSV and only checks File.exist? - there is no mtime
 * comparison (pokemonsdk/scripts/3_Studio.rb:290-309). A stale .dat therefore
 * silently wins over an edited .csv. Removing it makes PSDK fall back to
 * try2get_csv_dialog and read the new text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse, serialize } from './csv.js';
import { VOCAB, PRE_VOCAB, FILE_OVERRIDES, OVERRIDE_ONLY_FILES, BLANK_IDS, PER_CREATURE_FILES } from './vocab.js';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const DIALOGS = path.join(PROJECT, 'Data', 'Text', 'Dialogs');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERIFY = args.includes('--verify');
const onlyFile = (() => {
  const i = args.indexOf('--file');
  return i >= 0 ? Number(args[i + 1]) : null;
})();
const SAMPLE = (() => {
  const i = args.indexOf('--sample');
  return i >= 0 ? Number(args[i + 1]) : 6;
})();

/* ------------------------------------------------------------------ *
 * Control-code protection
 *
 * PSDK text is full of escapes that must survive untouched:
 *   \v[103]  \n[1]  \c[18]  \f[a§b]   backslash codes
 *   [VAR PKNICK(0000)]  [WAIT 60]     bracket codes
 *   %<box>s                           format specifiers
 *   \nl                               hard line break (see 3_Studio.rb:337)
 * ------------------------------------------------------------------ */
const CONTROL = [
  /\\[a-zA-Z]\[[^\]]*\]/g,
  /\[VAR [^\]]*\]/g,
  /\[WAIT \d+\]/g,
  /%<[^>]*>[a-z]/g,
  /\\nl/g,
];

function mask(text) {
  const kept = [];
  let out = text;
  for (const re of CONTROL) {
    out = out.replace(re, (m) => {
      kept.push(m);
      return `\u0000${kept.length - 1}\u0000`;
    });
  }
  return { out, kept };
}

const unmask = (text, kept) => text.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Prose all over the game names creatures directly ("Bulbasaur can be seen
 * napping..."). Derive old-name -> new-name pairs from the pre-reskin backup
 * of 100000.csv so dex entries, move text and dialogue follow the rename.
 */
function creatureNameRules() {
  const backup = process.env.STOCKMONSTERS_BACKUP
    || 'C:\\Users\\roota\\Downloads\\Stockmonsters.backup-2026-08-19\\Text\\Dialogs\\100000.csv';
  if (!fs.existsSync(backup)) {
    console.warn(`no backup at ${backup}; skipping creature-name prose rules`);
    return [];
  }
  const rows = parse(fs.readFileSync(backup, 'utf8'));
  const en = rows[0].findIndex((h) => String(h).trim().toLowerCase() === 'en');
  const rules = [];
  for (const [textId, newName] of Object.entries(FILE_OVERRIDES[100000] || {})) {
    const oldName = rows[Number(textId) + 1]?.[en];
    // "Egg" is already handled by the global vocabulary.
    if (!oldName || oldName === newName || oldName === 'Egg') continue;
    rules.push({
      re: new RegExp(`\\b${escapeRe(oldName)}\\b`, 'g'),
      to: newName,
      from: `${oldName} -> ${newName}`,
    });
  }
  return rules;
}

// Word-boundary only where the edge character is actually a word character,
// so "Poké Ball" and "Prof." still match.
// Creature names run first: they are the most specific tokens in the text.
const VOCAB_RULES = creatureNameRules().concat(VOCAB.map(([from, to]) => {
  const body = from.startsWith('Prof\\.') ? from : escapeRe(from);
  const left = /^\w/.test(from) ? '\\b' : '';
  const right = /\w$/.test(from) ? '\\b' : '';
  return { re: new RegExp(`${left}${body}${right}`, 'g'), to, from };
}));

function applyVocab(text, hits) {
  let raw = text;
  for (const [re, to] of PRE_VOCAB) {
    raw = raw.replace(re, (...a) => {
      if (hits) hits.set('price format', (hits.get('price format') || 0) + 1);
      return typeof to === 'function' ? to(...a) : to;
    });
  }
  const { out, kept } = mask(raw);
  let result = out;
  for (const rule of VOCAB_RULES) {
    result = result.replace(rule.re, () => {
      if (hits) hits.set(rule.from, (hits.get(rule.from) || 0) + 1);
      return rule.to;
    });
  }
  return unmask(result, kept);
}

/* ------------------------------------------------------------------ *
 * Per-file transform
 * ------------------------------------------------------------------ */
function transformFile(fileId) {
  const csvPath = path.join(DIALOGS, `${fileId}.csv`);
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw);
  if (rows.length === 0) return null;

  const header = rows[0];
  const en = header.findIndex((h) => String(h).trim().toLowerCase() === 'en');
  if (en < 0) return { fileId, skipped: 'no en column' };

  const overrides = FILE_OVERRIDES[fileId] || null;
  const overrideOnly = OVERRIDE_ONLY_FILES.has(fileId);
  const hits = new Map();
  const changes = [];

  for (let r = 1; r < rows.length; r += 1) {
    const before = rows[r][en];
    if (before == null) continue;
    // text_id is 0-based from the second CSV line (3_Studio.rb:271).
    const textId = r - 1;

    let after;
    if (PER_CREATURE_FILES.has(fileId) && BLANK_IDS.has(textId)) {
      // This creature was cut from the roster; leave nothing behind.
      after = '';
    } else if (overrides && Object.prototype.hasOwnProperty.call(overrides, textId)) {
      after = overrides[textId];
    } else if (overrideOnly) {
      continue;
    } else {
      after = applyVocab(before, hits);
    }

    if (after !== before) {
      rows[r][en] = after;
      changes.push({ textId, before, after });
    }
  }

  return { fileId, rows, changes, hits, raw, csvPath };
}

/* ------------------------------------------------------------------ *
 * Round-trip safety check
 * ------------------------------------------------------------------ */
function verify(files) {
  let bad = 0;
  for (const fileId of files) {
    const csvPath = path.join(DIALOGS, `${fileId}.csv`);
    const raw = fs.readFileSync(csvPath, 'utf8');
    const once = parse(raw);
    const twice = parse(serialize(once));
    const a = JSON.stringify(once);
    const b = JSON.stringify(twice);
    if (a !== b) {
      bad += 1;
      console.log(`ROUND-TRIP MISMATCH  ${fileId}.csv`);
      for (let i = 0; i < Math.max(once.length, twice.length); i += 1) {
        if (JSON.stringify(once[i]) !== JSON.stringify(twice[i])) {
          console.log(`  row ${i}\n    was: ${JSON.stringify(once[i])?.slice(0, 200)}\n    got: ${JSON.stringify(twice[i])?.slice(0, 200)}`);
          break;
        }
      }
    }
  }
  console.log(bad === 0 ? `round-trip OK across ${files.length} files` : `${bad} file(s) failed round-trip`);
  return bad === 0;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */
const files = fs
  .readdirSync(DIALOGS)
  .filter((f) => /^\d+\.csv$/.test(f))
  .map((f) => Number(f.replace('.csv', '')))
  .filter((id) => onlyFile == null || id === onlyFile)
  .sort((a, b) => a - b);

if (VERIFY) {
  process.exit(verify(files) ? 0 : 1);
}

if (!verify(files)) {
  console.error('refusing to continue: CSV round-trip is not safe');
  process.exit(1);
}

let totalChanges = 0;
let touchedFiles = 0;
const globalHits = new Map();
const datRemoved = [];

for (const fileId of files) {
  const result = transformFile(fileId);
  if (!result || result.skipped) continue;
  const { changes, hits, rows, csvPath } = result;
  if (changes.length === 0) continue;

  touchedFiles += 1;
  totalChanges += changes.length;
  for (const [k, v] of hits) globalHits.set(k, (globalHits.get(k) || 0) + v);

  console.log(`\n=== ${fileId}.csv - ${changes.length} row(s) changed ===`);
  for (const c of changes.slice(0, SAMPLE)) {
    const trim = (s) => (s.length > 110 ? `${s.slice(0, 110)}…` : s).replace(/\n/g, '\\n');
    console.log(`  [${c.textId}] ${trim(c.before)}`);
    console.log(`      -> ${trim(c.after)}`);
  }
  if (changes.length > SAMPLE) console.log(`  … ${changes.length - SAMPLE} more`);

  if (APPLY) {
    fs.writeFileSync(csvPath, serialize(rows), 'utf8');
    const dat = path.join(DIALOGS, `${fileId}.en.dat`);
    if (fs.existsSync(dat)) {
      fs.rmSync(dat);
      datRemoved.push(`${fileId}.en.dat`);
    }
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'}: ${totalChanges} rows across ${touchedFiles} files`);
if (globalHits.size) {
  console.log('\nvocabulary hits:');
  [...globalHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([term, n]) => console.log(`  ${String(n).padStart(6)}  ${term}`));
}
if (APPLY) {
  console.log(`\nremoved ${datRemoved.length} stale compiled files so PSDK re-reads the CSVs`);
} else {
  console.log('\nre-run with --apply to write the changes');
}
