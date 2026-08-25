/*
 * Copies the battle-relevant Studio data into the repo:
 *
 *   node tools/import-studio.mjs
 *
 * The Studio JSON lives in the sibling Stockmonsters/ project; the MMO server
 * must not depend on that checkout at runtime, so the needed fields are
 * extracted into src/data/studio/*.json. Shapes follow docs/psdk-mechanics.md
 * §6 — trimmed to what the battle engine actually reads.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const STUDIO = resolve(ROOT, '../Stockmonsters/Data/Studio')
const OUT = join(ROOT, 'src/data/studio')
mkdirSync(OUT, { recursive: true })

const readAll = (dir) =>
  readdirSync(join(STUDIO, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(STUDIO, dir, f), 'utf8')))

// --- species ---------------------------------------------------------------
const species = {}
for (const s of readAll('pokemon')) {
  const f = s.forms[0]
  species[s.dbSymbol] = {
    id: s.id,
    type1: f.type1,
    type2: f.type2 === '__undef__' ? null : f.type2,
    baseHp: f.baseHp, baseAtk: f.baseAtk, baseDfe: f.baseDfe,
    baseSpd: f.baseSpd, baseAts: f.baseAts, baseDfs: f.baseDfs,
    evHp: f.evHp, evAtk: f.evAtk, evDfe: f.evDfe,
    evSpd: f.evSpd, evAts: f.evAts, evDfs: f.evDfs,
    experienceType: f.experienceType,
    baseExperience: f.baseExperience,
    catchRate: f.catchRate,
    femaleRate: f.femaleRate,
    abilities: f.abilities,
    itemHeld: f.itemHeld,
    moveSet: (f.moveSet ?? [])
      .filter((m) => m.klass === 'LevelLearnableMove')
      .map((m) => ({ level: m.level, move: m.move })),
  }
}

// --- moves -----------------------------------------------------------------
const moves = {}
for (const m of readAll('moves')) {
  moves[m.dbSymbol] = {
    id: m.id,
    type: m.type,
    category: m.category, // physical | special | status
    power: m.power,
    accuracy: m.accuracy, // 0 = never miss
    pp: m.pp,
    priority: m.priority, // already signed
    criticalRate: m.movecriticalRate,
    method: m.battleEngineMethod,
    target: m.battleEngineAimedTarget,
    stageMod: m.battleStageMod ?? [],
    status: m.moveStatus ?? [],
    effectChance: m.effectChance,
    isDirect: m.isDirect,
  }
}

// --- types: 18x18 multiplier matrix, default 1 -----------------------------
const types = {}
for (const t of readAll('types')) {
  if (t.dbSymbol === '__undef__') continue
  types[t.dbSymbol] = Object.fromEntries(
    (t.damageTo ?? []).map((d) => [d.defensiveType, d.factor]),
  )
}

// --- natures ---------------------------------------------------------------
const natures = {}
for (const n of readAll('natures')) natures[n.dbSymbol] = n.stats

writeFileSync(join(OUT, 'species.json'), JSON.stringify(species))
writeFileSync(join(OUT, 'moves.json'), JSON.stringify(moves))
writeFileSync(join(OUT, 'types.json'), JSON.stringify(types))
writeFileSync(join(OUT, 'natures.json'), JSON.stringify(natures))

// referential smoke check (spec §9 step 1)
let broken = 0
for (const [sym, s] of Object.entries(species)) {
  for (const m of s.moveSet) if (!moves[m.move]) { console.warn(`  ! ${sym} learns unknown move ${m.move}`); broken++ }
  for (const t of [s.type1, s.type2].filter(Boolean)) if (!types[t]) { console.warn(`  ! ${sym} has unknown type ${t}`); broken++ }
}
console.log(`species ${Object.keys(species).length}, moves ${Object.keys(moves).length}, types ${Object.keys(types).length}, natures ${Object.keys(natures).length}, broken refs ${broken}`)
