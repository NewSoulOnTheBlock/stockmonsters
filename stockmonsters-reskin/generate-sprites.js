#!/usr/bin/env node
/**
 * Generate all Stockmonster sprites from SPRITE-BRIEF.md / designs.js.
 *
 * Pipeline (matches the brief):
 *   1. Front 96×96 from the creature prompt  (text → image)
 *   2. Back, shinies, icon, footprint, overworld derived from that front
 *      (image → image) so each creature stays on-model
 *   3. Nearest-neighbour downscale + magenta chroma-key → RGBA PNG
 *   4. Write into the live PSDK project at the exact graphics/ paths
 *
 * Usage:
 *   set XAI_API_KEY=xai-...
 *   npm install
 *   node generate-sprites.js --dry-run
 *   node generate-sprites.js --stage fronts --limit 5
 *   node generate-sprites.js --stage full
 *   node generate-sprites.js --only AAPL,NVDA
 *   node generate-sprites.js --from 1 --to 20 --force
 *
 * Stages:
 *   fronts  — battle fronts only (ship these first)
 *   derived — everything else, requires fronts already on disk
 *   full    — fronts then derived (default)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGNS } from './designs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.env.STOCKMONSTERS_PROJECT
  || 'C:\\Users\\roota\\Downloads\\Stockmonsters';
const GRAPHICS = path.join(PROJECT, 'graphics');
const WORK = path.join(HERE, 'sprite-work');
const MANIFEST = path.join(HERE, 'sprite-manifest.json');

const API = process.env.PPQ_API_BASE || 'https://api.ppq.ai/v1';
const MODEL = process.env.PPQ_IMAGE_MODEL || 'grok-imagine';
const EDIT_MODEL = process.env.PPQ_EDIT_MODEL || 'grok-imagine-edit';
const KEY = process.env.PPQ_API_KEY || process.env.XAI_API_KEY || '';

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

const SUFFIX = {
  front: 'full body, facing viewer, three-quarter view',
  back: 'rear view of the exact same creature, same palette, same proportions, same outline style, facing away from the viewer',
  shiny: 'same creature, identical pose and proportions, alternate colourway: shift hue 120-180 degrees, keep value structure identical',
  icon: 'simplified chibi bust of this exact creature, chunky shapes, minimal detail, still original pixel-art style, facing viewer',
  footprint: 'solid near-black silhouette of this creature\'s feet or ground-contact only, no interior detail, no body, just the print',
  overworldDown: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing down toward the viewer',
  overworldLeft: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing left',
  overworldRight: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing right',
  overworldUp: 'tiny overworld walking sprite of this exact creature, 3/4 overhead view, extremely simplified, facing away / up',
  overworldStep: 'same tiny overworld sprite, same facing, opposite-leg walk pose, one foot lifted',
};

const PATHS = {
  front: (id) => path.join(GRAPHICS, 'pokedex', 'pokefront', `${id}.png`),
  frontShiny: (id) => path.join(GRAPHICS, 'pokedex', 'pokefrontshiny', `${id}s.png`),
  back: (id) => path.join(GRAPHICS, 'pokedex', 'pokeback', `${id}.png`),
  backShiny: (id) => path.join(GRAPHICS, 'pokedex', 'pokebackshiny', `${id}s.png`),
  icon: (id) => path.join(GRAPHICS, 'pokedex', 'pokeicon', `${id}.png`),
  footprint: (id) => path.join(GRAPHICS, 'pokedex', 'footprints', `${id}.png`),
  overworld: (id) => path.join(GRAPHICS, 'characters', `${id}.png`),
};

function parseArgs(argv) {
  const out = {
    stage: 'full',
    dryRun: false,
    force: false,
    limit: Infinity,
    from: 1,
    to: Infinity,
    only: null,
    concurrency: 2,
    quality: 'medium',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--stage') out.stage = next();
    else if (a === '--limit') out.limit = Number(next());
    else if (a === '--from') out.from = Number(next());
    else if (a === '--to') out.to = Number(next());
    else if (a === '--only') out.only = next().split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--concurrency') out.concurrency = Number(next());
    else if (a === '--quality') out.quality = next();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const pad = (n) => String(n).padStart(4, '0');

function loadRoster() {
  const rows = JSON.parse(fs.readFileSync(path.join(HERE, 'creature-types.json'), 'utf8'));
  const missing = rows.filter((r) => !DESIGNS[r.ticker]);
  if (missing.length) {
    throw new Error(`designs.js missing: ${missing.map((r) => r.ticker).join(', ')}`);
  }
  return rows.map((r) => ({
    ...r,
    id: pad(r.dexId),
    subject: DESIGNS[r.ticker],
    prompt: `${STYLE}, ${DESIGNS[r.ticker]}`,
  }));
}

function subjectPrompt(creature, suffix) {
  return [
    creature.prompt,
    suffix,
    `Do not draw any text or logos. Magenta #FF00FF background only.`,
    `Avoid: ${NEGATIVE}.`,
  ].join('. ');
}

function shouldWrite(dest, { force, dryRun }) {
  if (dryRun) return true;
  return force || !fs.existsSync(dest);
}

async function sharp() {
  const mod = await import('sharp');
  return mod.default;
}

/** Knock magenta (and near-magenta / near-white corners) to alpha. */
async function chromaToPng(inputBuf, { size, nearest = true } = {}) {
  const s = await sharp();
  let img = s(inputBuf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const magenta = r > 180 && b > 180 && g < 80;
    const hotPink = r > 220 && g < 40 && b > 180;
    if (magenta || hotPink) px[i + 3] = 0;
  }
  let out = s(px, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (size) {
    out = out.resize(size.w, size.h, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: nearest ? 'nearest' : 'lanczos3',
    });
  }
  return out.png().toBuffer();
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

async function generateImage(prompt, { aspectRatio = '1:1', quality = 'medium' } = {}) {
  const res = await fetch(`${API}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size: aspectRatio,
      aspect_ratio: aspectRatio,
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

async function editImage(prompt, sourcePng, { quality = 'medium' } = {}) {
  const form = new FormData();
  form.set('model', EDIT_MODEL);
  form.set('prompt', prompt);
  form.set('quality', quality);
  form.set('response_format', 'b64_json');
  form.set('image', new Blob([sourcePng], { type: 'image/png' }), 'source.png');

  const res = await fetch(`${API}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
    },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`edit ${res.status}: ${body.slice(0, 400)}`);
  }
  return resultToBuffer(await res.json());
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return { creatures: {} };
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}

function saveManifest(m) {
  m.updatedAt = new Date().toISOString();
  fs.writeFileSync(MANIFEST, `${JSON.stringify(m, null, 2)}\n`);
}

function mark(manifest, id, key, dest) {
  manifest.creatures[id] ??= {};
  manifest.creatures[id][key] = { path: dest, at: new Date().toISOString() };
}

async function writePng(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function processSquare(raw, size) {
  return chromaToPng(raw, { size: { w: size, h: size }, nearest: true });
}

async function makeIcon(raw) {
  const frame = await chromaToPng(raw, { size: { w: 32, h: 32 }, nearest: true });
  const s = await sharp();
  // Two-frame bob: frame A, then A shifted up 1px for a cheap idle bob.
  const a = frame;
  const b = await s(frame)
    .extend({ top: 0, bottom: 1, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extract({ left: 0, top: 1, width: 32, height: 32 })
    .png()
    .toBuffer();
  return s({
    create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: a, left: 0, top: 0 },
      { input: b, left: 32, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function makeOverworldSheet(frames /* {down,left,right,up, downStep?} */) {
  const s = await sharp();
  const cell = 32;
  const dirs = ['down', 'left', 'right', 'up'];
  const composites = [];
  for (let row = 0; row < 4; row++) {
    const idle = frames[dirs[row]];
    const step = frames[`${dirs[row]}Step`] || idle;
    const sequence = [idle, step, idle, step];
    for (let col = 0; col < 4; col++) {
      composites.push({
        input: sequence[col],
        left: col * cell,
        top: row * cell,
      });
    }
  }
  return s({
    create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
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

function printHelp() {
  console.log(`Stockmonsters sprite generator — ${194} creatures × 7 files

  node generate-sprites.js [options]

  --stage fronts|derived|full   default full
  --dry-run                     print prompts, write nothing
  --force                       overwrite existing PNGs
  --limit N                     process at most N creatures
  --from N --to N               dex-id inclusive range
  --only AAPL,NVDA              tickers only
  --concurrency N               parallel API calls (default 2)
  --quality low|medium          Imagine quality (default medium)

Requires XAI_API_KEY. Writes into:
  ${GRAPHICS}
Work files:
  ${WORK}
`);
}

async function generateFront(creature, opts, manifest) {
  const dest = PATHS.front(creature.id);
  const work = path.join(WORK, creature.id, 'front-raw.png');
  if (!shouldWrite(dest, opts)) {
    console.log(`  skip front ${creature.id} (exists)`);
    return fs.readFileSync(dest);
  }
  const prompt = subjectPrompt(creature, SUFFIX.front);
  if (opts.dryRun) {
    console.log(`\n[${creature.id}] ${creature.stockmonster} FRONT\n${prompt}\n→ ${dest}`);
    return null;
  }
  console.log(`  gen  front ${creature.id} ${creature.stockmonster}`);
  const raw = await generateImage(prompt, { quality: opts.quality });
  fs.mkdirSync(path.dirname(work), { recursive: true });
  fs.writeFileSync(work, raw);
  const png = await processSquare(raw, 96);
  await writePng(dest, png);
  mark(manifest, creature.id, 'front', dest);
  saveManifest(manifest);
  return png;
}

async function derive(creature, opts, manifest, frontPng) {
  const id = creature.id;
  const jobs = [];

  const editTo = async (key, dest, promptSuffix, size) => {
    if (!shouldWrite(dest, opts)) {
      console.log(`  skip ${key} ${id} (exists)`);
      return fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    }
    const prompt = [
      'Keep this exact creature — same body plan, markings, palette, outline, proportions.',
      'Change only the view or treatment described next.',
      promptSuffix + '.',
      STYLE + '.',
      'Solid bright magenta background #FF00FF. No text, no logos.',
    ].join(' ');
    if (opts.dryRun) {
      console.log(`\n[${id}] ${key}\n${prompt}\n→ ${dest}`);
      return null;
    }
    console.log(`  edit ${key} ${id}`);
    const raw = await editImage(prompt, frontPng, { quality: opts.quality });
    fs.mkdirSync(path.join(WORK, id), { recursive: true });
    fs.writeFileSync(path.join(WORK, id, `${key}-raw.png`), raw);
    const png = size === 'icon'
      ? await makeIcon(raw)
      : await chromaToPng(raw, { size: { w: size, h: size }, nearest: true });
    await writePng(dest, png);
    mark(manifest, id, key, dest);
    saveManifest(manifest);
    return png;
  };

  jobs.push(() => editTo('back', PATHS.back(id), SUFFIX.back, 96));
  jobs.push(() => editTo('frontShiny', PATHS.frontShiny(id), SUFFIX.shiny, 96));
  jobs.push(() => editTo('icon', PATHS.icon(id), SUFFIX.icon, 'icon'));
  jobs.push(() => editTo('footprint', PATHS.footprint(id), SUFFIX.footprint, 16));

  const [backPng] = await pool(jobs.slice(0, 1), 1, (fn) => fn());
  await pool(jobs.slice(1), opts.concurrency, (fn) => fn());

  if (backPng && shouldWrite(PATHS.backShiny(id), opts)) {
    if (opts.dryRun) {
      console.log(`[${id}] backShiny → ${PATHS.backShiny(id)}`);
    } else {
      console.log(`  edit backShiny ${id}`);
      const prompt = [
        'Keep this exact creature — same body plan, markings, outline, proportions, rear view.',
        SUFFIX.shiny,
        STYLE,
        'Solid bright magenta background #FF00FF. No text, no logos.',
      ].join(' ');
      const raw = await editImage(prompt, backPng, { quality: opts.quality });
      fs.writeFileSync(path.join(WORK, id, 'backShiny-raw.png'), raw);
      const png = await processSquare(raw, 96);
      await writePng(PATHS.backShiny(id), png);
      mark(manifest, id, 'backShiny', PATHS.backShiny(id));
      saveManifest(manifest);
    }
  } else if (!shouldWrite(PATHS.backShiny(id), opts)) {
    console.log(`  skip backShiny ${id} (exists)`);
  }

  const owDest = PATHS.overworld(id);
  if (!shouldWrite(owDest, opts)) {
    console.log(`  skip overworld ${id} (exists)`);
    return;
  }
  if (opts.dryRun) {
    console.log(`[${id}] overworld sheet → ${owDest}`);
    return;
  }

  const facing = async (key, suffix) => {
    const prompt = [
      'Keep this exact creature identity and colours.',
      suffix,
      STYLE,
      'Solid bright magenta background #FF00FF. No text, no logos.',
    ].join(' ');
    console.log(`  edit ${key} ${id}`);
    const raw = await editImage(prompt, frontPng, { quality: opts.quality });
    fs.writeFileSync(path.join(WORK, id, `${key}-raw.png`), raw);
    return chromaToPng(raw, { size: { w: 32, h: 32 }, nearest: true });
  };

  const down = await facing('owDown', SUFFIX.overworldDown);
  const [left, right, up] = await Promise.all([
    facing('owLeft', SUFFIX.overworldLeft),
    facing('owRight', SUFFIX.overworldRight),
    facing('owUp', SUFFIX.overworldUp),
  ]);
  const downStep = await facing('owDownStep', `${SUFFIX.overworldDown}. ${SUFFIX.overworldStep}`);
  const sheet = await makeOverworldSheet({
    down, left, right, up, downStep,
  });
  await writePng(owDest, sheet);
  mark(manifest, id, 'overworld', owDest);
  saveManifest(manifest);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (!['fronts', 'derived', 'full'].includes(opts.stage)) {
    throw new Error(`unknown --stage ${opts.stage}`);
  }

  const roster = loadRoster().filter((c) => {
    if (opts.only) return opts.only.includes(c.ticker);
    if (c.dexId < opts.from || c.dexId > opts.to) return false;
    return true;
  }).slice(0, opts.limit);

  console.log(`roster ${roster.length} / ${JSON.parse(fs.readFileSync(path.join(HERE, 'creature-types.json'), 'utf8')).length}`);
  console.log(`stage  ${opts.stage}${opts.dryRun ? ' (dry-run)' : ''}`);
  console.log(`dest   ${GRAPHICS}`);

  if (!opts.dryRun && !KEY) {
    throw new Error('XAI_API_KEY is not set. Export it, or pass --dry-run to preview prompts.');
  }

  fs.mkdirSync(WORK, { recursive: true });
  const manifest = loadManifest();
  let done = 0;
  let failed = 0;

  const runOne = async (creature) => {
    console.log(`\n== ${creature.id} ${creature.ticker} ${creature.stockmonster}`);
    try {
      let frontPng = null;
      if (opts.stage === 'fronts' || opts.stage === 'full') {
        frontPng = await generateFront(creature, opts, manifest);
      }
      if (opts.stage === 'derived' || opts.stage === 'full') {
        if (!frontPng) {
          const dest = PATHS.front(creature.id);
          if (!fs.existsSync(dest)) {
            console.warn(`  no front for ${creature.id}; skip derived`);
            return;
          }
          frontPng = fs.readFileSync(dest);
        }
        if (frontPng) await derive(creature, opts, manifest, frontPng);
      }
      done++;
    } catch (err) {
      failed++;
      console.error(`  FAIL ${creature.id}: ${err.message}`);
      manifest.creatures[creature.id] ??= {};
      manifest.creatures[creature.id].error = err.message;
      saveManifest(manifest);
    }
  };

  if (opts.stage === 'fronts') {
    await pool(roster, opts.concurrency, runOne);
  } else {
    for (const creature of roster) await runOne(creature);
  }

  console.log(`\nfinished: ${done} ok, ${failed} failed, ${roster.length} attempted`);
  console.log(`manifest: ${MANIFEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
