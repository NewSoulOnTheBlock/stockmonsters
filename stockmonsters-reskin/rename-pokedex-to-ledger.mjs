import fs from 'node:fs';
import path from 'node:path';
import { parse, serialize } from './csv.js';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const DIALOGS = path.join(PROJECT, 'Data', 'Text', 'Dialogs');

const RULES = [
  [/\bMarketdex\b/g, 'Ledger'],
  [/\bPOKÉDEX\b/g, 'LEDGER'],
];

const files = fs.readdirSync(DIALOGS).filter((f) => /^\d+\.csv$/.test(f));
let touchedFiles = 0;
let totalRows = 0;

for (const f of files) {
  const csvPath = path.join(DIALOGS, f);
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw);
  const header = rows[0];
  const en = header.findIndex((h) => String(h).trim().toLowerCase() === 'en');
  if (en < 0) continue;

  let changed = 0;
  for (let r = 1; r < rows.length; r += 1) {
    const before = rows[r][en];
    if (before == null) continue;
    let after = before;
    for (const [re, to] of RULES) after = after.replace(re, to);
    if (after !== before) {
      rows[r][en] = after;
      changed += 1;
      console.log(`  [${f} row ${r - 1}] ${before} -> ${after}`);
    }
  }

  if (changed) {
    fs.writeFileSync(csvPath, serialize(rows), 'utf8');
    const fileId = Number(f.replace('.csv', ''));
    const dat = path.join(DIALOGS, `${fileId}.en.dat`);
    if (fs.existsSync(dat)) fs.rmSync(dat);
    touchedFiles += 1;
    totalRows += changed;
  }
}

console.log(`\nrenamed Pokédex -> Ledger: ${totalRows} rows across ${touchedFiles} files`);
