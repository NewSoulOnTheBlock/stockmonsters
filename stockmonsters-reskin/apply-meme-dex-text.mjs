import fs from 'node:fs';
import path from 'node:path';
import { parse, serialize } from './csv.js';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const DIALOGS = path.join(PROJECT, 'Data', 'Text', 'Dialogs');

const roster = JSON.parse(fs.readFileSync('meme-roster.json', 'utf8'));
const dexText = JSON.parse(fs.readFileSync('meme-dex-text.json', 'utf8'));

const names = {};
for (const c of roster) names[c.dexId] = c.name;

const TARGETS = [
  { fileId: 100000, values: names },
  { fileId: 100001, values: Object.fromEntries(Object.entries(dexText).map(([id, e]) => [id, e.species])) },
  { fileId: 100002, values: Object.fromEntries(Object.entries(dexText).map(([id, e]) => [id, e.description])) },
];

for (const { fileId, values } of TARGETS) {
  const csvPath = path.join(DIALOGS, `${fileId}.csv`);
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw);
  const header = rows[0];
  const en = header.findIndex((h) => String(h).trim().toLowerCase() === 'en');
  if (en < 0) throw new Error(`${fileId}.csv: no en column`);

  let changed = 0;
  for (const [dexIdStr, value] of Object.entries(values)) {
    const dexId = Number(dexIdStr);
    const rowIdx = dexId + 1;
    if (!rows[rowIdx]) {
      console.warn(`  ${fileId}.csv: no row at index ${rowIdx} (dexId ${dexId})`);
      continue;
    }
    if (rows[rowIdx][en] !== value) {
      rows[rowIdx][en] = value;
      changed += 1;
    }
  }

  fs.writeFileSync(csvPath, serialize(rows), 'utf8');
  const dat = path.join(DIALOGS, `${fileId}.en.dat`);
  if (fs.existsSync(dat)) fs.rmSync(dat);
  console.log(`${fileId}.csv: ${changed} rows updated`);
}
