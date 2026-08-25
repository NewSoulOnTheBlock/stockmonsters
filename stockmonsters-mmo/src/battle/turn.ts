/*
 * Minimal 1v1 turn engine — docs/psdk-mechanics.md §1.2/§1.3, s_basic tier.
 * Covers: order by signed priority then live Speed (paralysis x0.25) with a
 * coin flip on exact ties, accuracy, type immunity, damage, faint. Status
 * moves and bespoke battleEngineMethods come in later tranches (§9 step 5+).
 */
import movesRaw from '../data/studio/moves.json'
import { damages, type Rng } from './damage'
import { accuracyCheck } from './accuracy'
import { effectiveness } from './typechart'
import { stageMultiplier } from './stats'
import { stage, type Battler, type MoveData } from './battler'

const moveDb = movesRaw as Record<string, any>

export const getMove = (dbSymbol: string): MoveData & { method: string } => {
  const m = moveDb[dbSymbol]
  if (!m) throw new Error(`unknown move: ${dbSymbol}`)
  return m
}

export interface Combatant {
  battler: Battler
  move: string // move dbSymbol chosen this turn
}

export type TurnEvent =
  | { type: 'used'; side: 0 | 1; move: string }
  | { type: 'missed'; side: 0 | 1 }
  | { type: 'immune'; side: 0 | 1 } // the DEFENDER was immune
  | { type: 'damage'; side: 0 | 1; amount: number; critical: boolean; effectiveness: number; targetHp: number }
  | { type: 'skipped'; side: 0 | 1; reason: 'no-damage-method' }
  | { type: 'fainted'; side: 0 | 1 }

export function liveSpeed(b: Battler): number {
  let spd = Math.floor(b.stats.spd * stageMultiplier(stage(b, 'spd')))
  if (b.status === 'paralysis') spd = Math.floor(spd * 0.25)
  return spd
}

/** Returns the acting order for this turn: sides 0/1 sorted per §1.2. */
export function turnOrder(a: Combatant, b: Combatant, rng: Rng): (0 | 1)[] {
  const pa = getMove(a.move).priority
  const pb = getMove(b.move).priority
  if (pa !== pb) return pa > pb ? [0, 1] : [1, 0]
  const sa = liveSpeed(a.battler)
  const sb = liveSpeed(b.battler)
  if (sa !== sb) return sa > sb ? [0, 1] : [1, 0]
  return rng(0, 1) === 0 ? [0, 1] : [1, 0] // [INFERRED] coin flip on exact tie
}

/** Runs one full turn; mutates battler hp. */
export function runTurn(sides: [Combatant, Combatant], rng: Rng): TurnEvent[] {
  const events: TurnEvent[] = []
  for (const side of turnOrder(sides[0], sides[1], rng)) {
    const user = sides[side].battler
    const target = sides[side === 0 ? 1 : 0].battler
    const targetSide = (side === 0 ? 1 : 0) as 0 | 1
    if (user.hp <= 0) continue

    const move = getMove(sides[side].move)
    events.push({ type: 'used', side, move: sides[side].move })

    // damaging s_basic tier only, for now
    if (move.category === 'status' || move.power <= 0) {
      events.push({ type: 'skipped', side, reason: 'no-damage-method' })
      continue
    }
    if (!accuracyCheck(user, target, move, rng)) {
      events.push({ type: 'missed', side })
      continue
    }
    if (effectiveness(move.type, target.types) === 0) {
      events.push({ type: 'immune', side: targetSide })
      continue
    }
    const r = damages(user, target, move, rng)
    target.hp = Math.max(0, target.hp - r.damage)
    events.push({
      type: 'damage', side: targetSide, amount: r.damage,
      critical: r.critical, effectiveness: r.effectiveness, targetHp: target.hp,
    })
    if (target.hp <= 0) {
      events.push({ type: 'fainted', side: targetSide })
      break
    }
  }
  return events
}
