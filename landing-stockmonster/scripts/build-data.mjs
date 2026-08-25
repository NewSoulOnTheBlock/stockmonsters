/**
 * build-data.mjs
 *
 * Joins every source of truth in the repo into two static JSON files that the
 * landing page imports at build time. Nothing here runs at request time.
 *
 * Sources (all read-only, never written to):
 *   ../Stockmonsters/stockmonsters-token-map.json   194 ticker -> creature -> contract
 *   ../stockmonsters-reskin/creature-types.json     elemental types per ticker
 *   ../stockmonsters-reskin/dex-text.json           species + flavour, keyed by dexId
 *   ../stockmonsters-reskin/meme-roster.json        60 meme-coin monsters
 *   ../stockmonsters-reskin/meme-dex-text.json      species + flavour for those
 *   ../Stockmonsters/Data/Studio/pokemon/*.json     REAL base stats / height / weight
 *   ../Stockmonsters/Data/Studio/types/*.json       REAL 18x18 effectiveness chart
 *
 * `dbSymbol` is the engine's internal join key and is deliberately NOT emitted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = path.resolve(HERE, "../src/data");

const read = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));

/* ------------------------------------------------------------------ *
 * Type chart — pulled straight out of the shipped game data.
 * vocab.js documents the rename map positionally (textId 0..17).
 * ------------------------------------------------------------------ */
const TYPE_NAMES = [
  "Neutral", "Combat", "Wind", "Toxic", "Terra", "Stone",
  "Swarm", "Spectre", "Alloy", "Blaze", "Tide", "Flora",
  "Volt", "Psionic", "Frost", "Wyrm", "Shadow", "Fae",
];

const TYPE_FILES = [
  "normal", "fighting", "flying", "poison", "ground", "rock",
  "bug", "ghost", "steel", "fire", "water", "grass",
  "electric", "psychic", "ice", "dragon", "dark", "fairy",
];

/** A one-line trader gloss for each element. Editorial copy, not game data. */
const TYPE_BLURB = {
  Neutral: "Index funds. Boring, everywhere, impossible to kill.",
  Combat: "Hostile takeovers and proxy fights.",
  Wind: "Momentum. Gone before the fill confirms.",
  Toxic: "Toxic assets. The damage shows up three quarters later.",
  Terra: "Hard assets. Land, rigs, rails.",
  Stone: "Balance-sheet fortresses. Slow, immovable.",
  Swarm: "Retail. Individually tiny, collectively lethal.",
  Spectre: "Dark pools. You never see the counterparty.",
  Alloy: "Industrials. Heavy, defensive, low beta.",
  Blaze: "Runaway growth burning cash to do it.",
  Tide: "Liquidity. A rising one lifts everything.",
  Flora: "Compounders. Slow green, decades deep.",
  Volt: "Volatility. Nothing between the two prints.",
  Psionic: "Narrative. It moves because everyone believes it moves.",
  Frost: "Frozen assets. Locked, halted, illiquid.",
  Wyrm: "Mega caps. The market is their weather.",
  Shadow: "The shortsellers.",
  Fae: "Meme energy. Rules do not apply.",
};

const symbolToName = Object.fromEntries(TYPE_FILES.map((f, i) => [f, TYPE_NAMES[i]]));

const types = TYPE_FILES.map((file, i) => {
  const raw = read(`Stockmonsters/Data/Studio/types/${file}.json`);
  const damageTo = {};
  for (const d of raw.damageTo) {
    const to = symbolToName[d.defensiveType];
    if (to) damageTo[to] = d.factor;
  }
  return {
    name: TYPE_NAMES[i],
    color: raw.color,
    blurb: TYPE_BLURB[TYPE_NAMES[i]],
    // multiplier when ATTACKING each of the 18 types; unlisted == 1
    damageTo,
    index: i,
  };
});

/* ------------------------------------------------------------------ *
 * Creatures
 * ------------------------------------------------------------------ */
const tokenMap = read("Stockmonsters/stockmonsters-token-map.json");
const creatureTypes = read("stockmonsters-reskin/creature-types.json");
const dexText = read("stockmonsters-reskin/dex-text.json");

const typesByTicker = Object.fromEntries(creatureTypes.map((e) => [e.ticker, e]));

function studioForm(dbSymbol) {
  const p = `Stockmonsters/Data/Studio/pokemon/${dbSymbol}.json`;
  if (!fs.existsSync(path.join(REPO, p))) return null;
  return read(p).forms[0];
}

/** Deterministic 0..1 from a string — used only for cosmetic market flavour. */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const missingType = [];
// NOTE: dex-text.json is keyed by 1-based POSITION in the token map, not by
// dexId. Verified: with this keying all 194 descriptions name their own
// creature; keying by dexId only matches 106 of them.
const creatures = tokenMap.map((t, i) => {
  const ct = typesByTicker[t.ticker];
  if (!ct) missingType.push(t.ticker);
  const text = dexText[String(i + 1)] || {};
  const f = studioForm(t.dbSymbol);

  const stats = f
    ? { hp: f.baseHp, atk: f.baseAtk, def: f.baseDfe, spa: f.baseAts, spd: f.baseDfs, spe: f.baseSpd }
    : null;

  return {
    id: t.dexId,
    ticker: t.ticker,
    name: t.stockmonster,
    company: t.company,
    address: t.address,
    types: [ct?.t1, ct?.t2].filter(Boolean),
    species: text.species ?? null,
    description: text.description ?? null,
    stats,
    bst: stats ? Object.values(stats).reduce((a, b) => a + b, 0) : null,
    height: f?.height ?? null,
    weight: f?.weight ?? null,
    catchRate: f?.catchRate ?? null,
    // cosmetic only, stable across builds, never presented as a real quote
    drift: Math.round((hash01(t.address) * 2 - 1) * 1840) / 100,
  };
});

/* ------------------------------------------------------------------ *
 * Meme-coin roster
 * ------------------------------------------------------------------ */
const memeRoster = read("stockmonsters-reskin/meme-roster.json");
const memeText = read("stockmonsters-reskin/meme-dex-text.json");

const memes = memeRoster.map((m) => {
  const text = memeText[String(m.dexId)] || {};
  const f = studioForm(m.dbSymbol);
  const stats = f
    ? { hp: f.baseHp, atk: f.baseAtk, def: f.baseDfe, spa: f.baseAts, spd: f.baseDfs, spe: f.baseSpd }
    : null;
  return {
    id: m.dexId,
    ticker: m.ticker,
    name: m.name,
    company: m.coin,
    types: m.types ?? [],
    species: text.species ?? null,
    description: text.description ?? null,
    subject: m.subject ?? null,
    stats,
    bst: stats ? Object.values(stats).reduce((a, b) => a + b, 0) : null,
  };
});

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "types.json"), JSON.stringify(types, null, 1));
fs.writeFileSync(path.join(OUT, "creatures.json"), JSON.stringify(creatures));
fs.writeFileSync(path.join(OUT, "memes.json"), JSON.stringify(memes));

const noStats = creatures.filter((c) => !c.stats).length;
const noText = creatures.filter((c) => !c.description).length;
console.log(
  `[data] ${creatures.length} stockmonsters, ${memes.length} meme monsters, ${types.length} types`
);
console.log(`[data] missing types: ${missingType.length}, missing stats: ${noStats}, missing flavour: ${noText}`);
