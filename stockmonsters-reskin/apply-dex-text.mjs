import fs from 'node:fs';
import path from 'node:path';
import { parse, serialize } from './csv.js';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const DIALOGS = path.join(PROJECT, 'Data', 'Text', 'Dialogs');

const dexText = JSON.parse(fs.readFileSync('dex-text.json', 'utf8'));

const TARGETS = [
  { fileId: 100001, key: 'species' },
  { fileId: 100002, key: 'description' },
];

for (const { fileId, key } of TARGETS) {
  const csvPath = path.join(DIALOGS, `${fileId}.csv`);
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw);
  const header = rows[0];
  const en = header.findIndex((h) => String(h).trim().toLowerCase() === 'en');
  if (en < 0) throw new Error(`${fileId}.csv: no en column`);

  let changed = 0;
  for (const [dexIdStr, entry] of Object.entries(dexText)) {
    const dexId = Number(dexIdStr);
    const rowIdx = dexId + 1; // rows[0] = header, rows[1] = textId 0, rows[N+1] = textId N
    if (!rows[rowIdx]) {
      console.warn(`  ${fileId}.csv: no row at index ${rowIdx} (dexId ${dexId})`);
      continue;
    }
    const before = rows[rowIdx][en];
    const after = entry[key];
    if (before !== after) {
      rows[rowIdx][en] = after;
      changed += 1;
    }
  }

  fs.writeFileSync(csvPath, serialize(rows), 'utf8');
  const dat = path.join(DIALOGS, `${fileId}.en.dat`);
  if (fs.existsSync(dat)) fs.rmSync(dat);
  console.log(`${fileId}.csv: ${changed} rows updated, stale .dat ${fs.existsSync(dat) ? 'still present!' : 'removed/absent'}`);
}
