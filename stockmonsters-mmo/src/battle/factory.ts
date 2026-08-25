/*
 * Wild-creature instantiation — docs/psdk-mechanics.md §2.1.
 * IVs randInt(0,31) per stat, uniform nature, 49/49/2 ability slots,
 * moveset = the 4 highest-level level-learnable moves at or below `level`.
 */
import speciesRaw from '../data/studio/species.json'
import naturesRaw from '../data/studio/natures.json'
import { maxHp, statBasis, type Ivs } from './stats'
import type { Battler } from './battler'
import type { Rng } from './damage'

const species = speciesRaw as Record<string, any>
const natures = naturesRaw as Record<string, Record<string, number>>
const NATURE_NAMES = Object.keys(natures)

export interface CreatureInstance extends Battler {
  dbSymbol: string
  ivs: Ivs
  nature: string
  moves: string[]
  gender: 'male' | 'female' | 'none'
  shiny: boolean
  catchRate: number
}

export function createWildCreature(dbSymbol: string, level: number, rng: Rng): CreatureInstance {
  const s = species[dbSymbol]
  if (!s) throw new Error(`unknown specie: ${dbSymbol}`)

  const ivs: Ivs = {
    hp: rng(0, 31), atk: rng(0, 31), dfe: rng(0, 31),
    spd: rng(0, 31), ats: rng(0, 31), dfs: rng(0, 31),
  }
  const nature = NATURE_NAMES[rng(0, NATURE_NAMES.length - 1)]
  const n = natures[nature]

  // §2.1: slots 49% / 49% / 2%
  const abilityRoll = rng(0, 99)
  const ability = s.abilities[abilityRoll < 49 ? 0 : abilityRoll < 98 ? 1 : 2] ?? s.abilities[0]

  const gender = s.femaleRate < 0 ? 'none' : rng(0, 99) < s.femaleRate ? 'female' : 'male'
  const shiny = rng(0, 65535) < 16

  const learnable = (s.moveSet as { level: number; move: string }[])
    .filter((m) => m.level <= level)
    .sort((a, b) => a.level - b.level)
  const moves = learnable.slice(-4).map((m) => m.move)

  const hp = maxHp(s.baseHp, ivs.hp, 0, level)
  return {
    dbSymbol,
    level,
    types: [s.type1, s.type2].filter(Boolean),
    stats: {
      atk: statBasis(s.baseAtk, ivs.atk, 0, level, n.atk),
      dfe: statBasis(s.baseDfe, ivs.dfe, 0, level, n.dfe),
      spd: statBasis(s.baseSpd, ivs.spd, 0, level, n.spd),
      ats: statBasis(s.baseAts, ivs.ats, 0, level, n.ats),
      dfs: statBasis(s.baseDfs, ivs.dfs, 0, level, n.dfs),
    },
    maxHp: hp,
    hp,
    ivs,
    nature,
    moves,
    gender,
    shiny,
    catchRate: s.catchRate,
    status: null,
  }
}
