#!/usr/bin/env node
/**
 * Generate front battle sprites for the 60 memecoin Stockmonsters via PPQ.ai
 * (grok-imagine), writing into the live PSDK project at pokefront/{dexId}.png
 * — same style contract, same chroma-key pipeline as generate-sprites.js.
 */
import fs from 'node:fs';
import path from 'node:path';

const PROJECT = process.env.STOCKMONSTERS_PROJECT || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const GRAPHICS = path.join(PROJECT, 'graphics');
const WORK = path.join('sprite-work-memes');
const MANIFEST = 'meme-sprite-manifest.json';

const API = process.env.PPQ_API_BASE || 'https://api.ppq.ai/v1';
const MODEL = process.env.PPQ_IMAGE_MODEL || 'grok-imagine';
const KEY = process.env.PPQ_API_KEY || '';

const STYLE = [
  '16-bit era monster-collector RPG battle sprite',
  'front-facing three-quarter view',
  'clean hard-edged pixel art',
  'limited palette of 12-16 colours with crisp 1px dark outline',
  'soft cel shading with one light source from upper left',
  'solid bright magenta background #FF00FF, no other background',
  'no text, no logos, no letters, no watermark',
  'full body centred with a few pixels of margin',
  'original creature design',
].join(', ');

const NEGATIVE = [
  'photorealism, blurry, 3d render, anti-aliased soft edges',
  'drop shadow, text, logo, trademark, watermark, signature',
  'border, frame, existing copyrighted characters, human figures',
  'checkerboard, grid, UI chrome',
].join(', ');

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

async function generateImage(prompt, quality) {
  const res = await fetch(`${API}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: '1:1',
      aspect_ratio: '1:1',
      quality,
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`generate ${res.status}: ${body.slice(0, 400)}`);
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
  const roster = JSON.parse(fs.readFileSync('meme-roster.json', 'utf8'))
    .filter((c) => !opts.only || opts.only.includes(c.ticker));

  console.log(`roster ${roster.length} / 60`);
  console.log(`dest   ${GRAPHICS}`);
  if (!opts.dryRun && !KEY) throw new Error('PPQ_API_KEY not set (and no --dry-run)');

  fs.mkdirSync(WORK, { recursive: true });
  const manifest = loadManifest();
  let done = 0; let failed = 0; let skipped = 0;

  const runOne = async (c) => {
    const id = pad(c.dexId);
    const dest = path.join(GRAPHICS, 'pokedex', 'pokefront', `${id}.png`);
    if (!opts.force && fs.existsSync(dest)) {
      console.log(`  skip ${id} ${c.name} (exists)`);
      skipped += 1;
      return;
    }
    const prompt = `${STYLE}, ${c.subject}. Do not draw any text or logos. Magenta #FF00FF background only. Avoid: ${NEGATIVE}.`;
    if (opts.dryRun) {
      console.log(`\n[${id}] ${c.name}\n${prompt}\n-> ${dest}`);
      return;
    }
    console.log(`  gen  front ${id} ${c.name} (${c.ticker})`);
    try {
      const raw = await generateImage(prompt, opts.quality);
      fs.writeFileSync(path.join(WORK, `${id}-front-raw.png`), raw);
      const png = await chromaToPng(raw, 96);
      fs.writeFileSync(dest, png);
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
