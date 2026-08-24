#!/usr/bin/env node
/**
 * Generate the overworld walking sprite (characters/{dexId}.png, 128x128,
 * 4x4 grid of 32x32 frames: 4 facings x 2 walk frames) for every creature in
 * creature-types.json, by editing each creature's existing front sprite via
 * PPQ (grok-imagine-edit). Only down-facing gets a genuine second walk frame
 * (matches generate-sprites.js's makeOverworldSheet, which reuses the idle
 * frame twice for left/right/up).
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const GRAPHICS = path.join(PROJECT, 'graphics');
const WORK = 'sprite-work-overworld';
const MANIFEST = 'overworld-manifest.json';

const API = process.env.PPQ_API_BASE || 'https://api.ppq.ai/v1';
const EDIT_MODEL = process.env.PPQ_EDIT_MODEL || 'grok-imagine-edit';
const KEY = process.env.PPQ_API_KEY || '';

const STYLE = [
  '16-bit era monster-collector RPG battle sprite',
  'clean hard-edged pixel art',
  'limited palette of 12-16 colours with crisp 1px dark outline',
  'soft cel shading with one light source from upper left',
  'solid bright magenta background #FF00FF, no other background',
  'no text, no logos, no letters, no watermark',
].join(', ');

const SUFFIX = {
  down: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing down toward the viewer',
  left: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing left',
  right: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing right',
  up: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing away / up',
  downStep: 'same tiny overworld sprite, same facing down toward the viewer, opposite-leg walk pose, one foot lifted',
};

const pad = (n) => String(n).padStart(4, '0');

function parseArgs(argv) {
  const out = { dryRun: false, force: false, only: null, concurrency: 2, quality: 'medium' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--only') out.only = next().split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--concurrency') out.concurrency = Number(next());
    else if (a === '--quality') out.quality = next();
  }
  return out;
}

async function sharp() {
  const mod = await import('sharp');
  return mod.default;
}

async function chromaToPng(inputBuf, size) {
  const s = await sharp();
  const img = s(inputBuf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]; const g = px[i + 1]; const b = px[i + 2];
    const magenta = r > 180 && b > 180 && g < 80;
    const hotPink = r > 220 && g < 40 && b > 180;
    if (magenta || hotPink) px[i + 3] = 0;
  }
  return s(px, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest' })
    .png()
    .toBuffer();
}

async function makeOverworldSheet(frames) {
  const s = await sharp();
  const cell = 32;
  const dirs = ['down', 'left', 'right', 'up'];
  const composites = [];
  for (let row = 0; row < 4; row++) {
    const idle = frames[dirs[row]];
    const step = frames[`${dirs[row]}Step`] || idle;
    const sequence = [idle, step, idle, step];
    for (let col = 0; col < 4; col++) {
      composites.push({ input: sequence[col], left: col * cell, top: row * cell });
    }
  }
  return s({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png()
    .toBuffer();
}

async function resultToBuffer(json) {
  const entry = json.data?.[0];
  if (!entry) throw new Error('no data[0] in response');
  if (entry.b64_json) return Buffer.from(entry.b64_json, 'base64');
  if (entry.url) {
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`fetch result url ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('response had neither b64_json nor url');
}

async function editImage(prompt, sourcePng, quality) {
  const form = new FormData();
  form.set('model', EDIT_MODEL);
  form.set('prompt', prompt);
  form.set('quality', quality);
  form.set('response_format', 'b64_json');
  form.set('image', new Blob([sourcePng], { type: 'image/png' }), 'source.png');
  const res = await fetch(`${API}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`edit ${res.status}: ${body.slice(0, 400)}`);
  }
  return resultToBuffer(await res.json());
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}
function saveManifest(m) {
  fs.writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

async function pool(items, n, fn) {
  const pending = new Set();
  const results = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    pending.add(p);
    p.finally(() => pending.delete(p));
    if (pending.size >= n) await Promise.race(pending);
  }
  return Promise.all(results);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const roster = Object.values(JSON.parse(fs.readFileSync('creature-types.json', 'utf8')))
    .filter((c) => !opts.only || opts.only.includes(c.ticker));

  console.log(`roster ${roster.length} / 254`);
  if (!opts.dryRun && !KEY) throw new Error('PPQ_API_KEY not set (and no --dry-run)');

  fs.mkdirSync(WORK, { recursive: true });
  const manifest = loadManifest();
  let done = 0; let failed = 0; let skipped = 0;

  const runOne = async (c) => {
    const id = pad(c.dexId);
    const dest = path.join(GRAPHICS, 'characters', `${id}.png`);
    if (!opts.force && fs.existsSync(dest)) {
      console.log(`  skip ${id} ${c.stockmonster} (exists)`);
      skipped += 1;
      return;
    }
    const frontPath = path.join(GRAPHICS, 'pokedex', 'pokefront', `${id}.png`);
    if (!fs.existsSync(frontPath)) {
      console.warn(`  NO FRONT ${id} ${c.stockmonster}; skipping`);
      failed += 1;
      return;
    }
    if (opts.dryRun) {
      console.log(`[${id}] ${c.stockmonster} -> ${dest} (dry run)`);
      return;
    }
    const frontPng = fs.readFileSync(frontPath);
    console.log(`  gen  overworld ${id} ${c.stockmonster} (${c.ticker})`);
    try {
      const facing = async (key, suffix) => {
        const prompt = `Keep this exact creature identity and colours. ${suffix} ${STYLE}. Solid bright magenta background #FF00FF. No text, no logos.`;
        const raw = await editImage(prompt, frontPng, opts.quality);
        fs.writeFileSync(path.join(WORK, `${id}-${key}-raw.png`), raw);
        return chromaToPng(raw, 32);
      };
      const down = await facing('owDown', SUFFIX.down);
      const [left, right, up] = await Promise.all([
        facing('owLeft', SUFFIX.left),
        facing('owRight', SUFFIX.right),
        facing('owUp', SUFFIX.up),
      ]);
      const downStep = await facing('owDownStep', SUFFIX.downStep);
      const sheet = await makeOverworldSheet({ down, left, right, up, downStep });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, sheet);
      manifest[c.ticker] = { dexId: c.dexId, path: dest, at: new Date().toISOString() };
      saveManifest(manifest);
      done += 1;
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${id} ${c.ticker}: ${err.message}`);
      manifest[c.ticker] = { dexId: c.dexId, error: err.message };
      saveManifest(manifest);
    }
  };

  await pool(roster, opts.concurrency, runOne);
  console.log(`\nfinished: ${done} ok, ${skipped} skipped, ${failed} failed, ${roster.length} attempted`);
}

main().catch((err) => { console.error(err); process.exit(1); });
