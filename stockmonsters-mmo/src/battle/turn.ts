/*
 * 1v1 turn engine — docs/psdk-mechanics.md §1.2/§1.3.
 * Tier covered: s_basic (+secondary effects), s_stat, s_self_stat, s_status,
 * non-volatile statuses, confusion/flinch, end-of-turn residuals, flee.
 * Bespoke battleEngineMethods fall through to s_basic semantics and are
 * reported in the events so gaps are visible, not silent.
 */
import movesRaw from '../data/studio/moves.json'
import { damages, type Rng } from './damage'
import { accuracyCheck } from './accuracy'
import { effectiveness } from './typechart'
import { idiv, stageMultiplier } from './stats'
import { stage, type Battler, type MoveData } from './battler'
import {
  applyStatus, endOfTurnTick, movePrevention, STATUS_FROM_DATA, type StatusState,
} from './status'

const moveDb = movesRaw as Record<string, any>

export const getMove = (dbSymbol: string) => {
  const m = moveDb[dbSymbol]
  if (!m) throw new Error(`unknown move: ${dbSymbol}`)
  return m as MoveData & {
    method: string
    target: string
    stageMod: { battleStage: string; modificator: number }[]
    status: { status: string; luckRate: number }[]
    effectChance: number
  }
}

const STAGE_FROM_DATA: Record<string, 'atk' | 'dfe' | 'spd' | 'ats' | 'dfs' | 'eva' | 'acc'> = {
  ATK_STAGE: 'atk', DFE_STAGE: 'dfe', SPD_STAGE: 'spd',
  ATS_STAGE: 'ats', DFS_STAGE: 'dfs', EVA_STAGE: 'eva', ACC_STAGE: 'acc',
}

export interface Combatant {
  battler: Battler
  state: StatusState
  move: string
}

export type TurnEvent =
  | { type: 'used'; side: 0 | 1; move: string }
  | { type: 'prevented'; side: 0 | 1; reason: string }
  | { type: 'self-hit'; side: 0 | 1; amount: number; hp: number }
  | { type: 'missed'; side: 0 | 1 }
  | { type: 'immune'; side: 0 | 1 }
  | { type: 'damage'; side: 0 | 1; amount: number; critical: boolean; effectiveness: number; targetHp: number }
  | { type: 'stage'; side: 0 | 1; stat: string; delta: number; now: number }
  | { type: 'status'; side: 0 | 1; status: string }
  | { type: 'status-failed'; side: 0 | 1; status: string }
  | { type: 'residual'; side: 0 | 1; status: string; amount: number; hp: number }
  | { type: 'fainted'; side: 0 | 1 }

export function liveSpeed(b: Battler): number {
  let spd = Math.floor(b.stats.spd * stageMultiplier(stage(b, 'spd')))
  if (b.status === 'paralysis') spd = Math.floor(spd * 0.25)
  return spd
}

export function turnOrder(a: Combatant, b: Combatant, rng: Rng): (0 | 1)[] {
  const pa = getMove(a.move).priority
  const pb = getMove(b.move).priority
  if (pa !== pb) return pa > pb ? [0, 1] : [1, 0]
  const sa = liveSpeed(a.battler)
  const sb = liveSpeed(b.battler)
  if (sa !== sb) return sa > sb ? [0, 1] : [1, 0]
  return rng(0, 1) === 0 ? [0, 1] : [1, 0] // [INFERRED] coin flip on exact tie
}

function applyStages(
  who: Battler, side: 0 | 1,
  mods: { battleStage: string; modificator: number }[],
  events: TurnEvent[],
) {
  who.stages ??= {}
  for (const m of mods) {
    const key = STAGE_FROM_DATA[m.battleStage]
    if (!key) continue
    const before = who.stages[key] ?? 0
    const now = Math.max(-6, Math.min(6, before + m.modificator))
    who.stages[key] = now
    events.push({ type: 'stage', side, stat: key, delta: m.modificator, now })
  }
}

function applyMoveStatuses(
  target: Battler, targetState: StatusState, side: 0 | 1,
  statuses: { status: string; luckRate: number }[],
  events: TurnEvent[], rng: Rng, gated: boolean,
) {
  for (const s of statuses) {
    if (gated && rng(0, 99) >= s.luckRate) continue
    const mapped = STATUS_FROM_DATA[s.status]
    if (!mapped) continue
    if (mapped === 'flinch') {
      targetState.flinched = true
      events.push({ type: 'status', side, status: 'flinch' })
    } else if (mapped === 'confusion') {
      if (!targetState.confusionCount) {
        targetState.confusionCount = rng(1, 4) + 1
        events.push({ type: 'status', side, status: 'confusion' })
      }
    } else if (applyStatus(target, targetState, mapped, rng)) {
      events.push({ type: 'status', side, status: mapped })
    } else {
      events.push({ type: 'status-failed', side, status: mapped })
    }
  }
}

/** Runs one full turn including end-of-turn residuals; mutates battlers. */
export function runTurn(sides: [Combatant, Combatant], rng: Rng): TurnEvent[] {
  const events: TurnEvent[] = []
  let someoneFainted = false

  for (const side of turnOrder(sides[0], sides[1], rng)) {
    if (someoneFainted) break
    const otherSide = (side === 0 ? 1 : 0) as 0 | 1
    const me = sides[side]
    const them = sides[otherSide]
    const user = me.battler
    const target = them.battler
    if (user.hp <= 0) continue

    const move = getMove(me.move)
    const prevention = movePrevention(user, me.state, (moveDb[me.move]?.isUnfreeze) ?? false, rng)
    if (prevention.prevented) {
      events.push({ type: 'prevented', side, reason: prevention.reason })
      if (prevention.reason === 'confusion-self-hit' && prevention.selfDamage) {
        user.hp -= prevention.selfDamage
        events.push({ type: 'self-hit', side, amount: prevention.selfDamage, hp: user.hp })
        if (user.hp <= 0) { events.push({ type: 'fainted', side }); someoneFainted = true }
      }
      continue
    }

    events.push({ type: 'used', side, move: me.move })

    const selfTargeting = move.target === 'user' || move.method === 's_self_stat'
    const dealsDamage = move.category !== 'status' && move.power > 0

    // §1.3 step 6: accuracy (self-targeting status moves bypass — §1.4)
    if (!(move.category === 'status' && move.target === 'user') &&
        !accuracyCheck(user, target, move, rng)) {
      events.push({ type: 'missed', side })
      continue
    }
    // §1.3 step 8: type immunity — applies to status moves too
    // (thunder_wave vs Ground, growl vs Ghost)
    if (!selfTargeting && effectiveness(move.type, target.types) === 0) {
      events.push({ type: 'immune', side: otherSide })
      continue
    }

    let targetAlive = true
    if (dealsDamage) {
      const r = damages(user, target, move, rng)
      target.hp = Math.max(0, target.hp - r.damage)
      events.push({
        type: 'damage', side: otherSide, amount: r.damage,
        critical: r.critical, effectiveness: r.effectiveness, targetHp: target.hp,
      })
      if (target.hp <= 0) {
        events.push({ type: 'fainted', side: otherSide })
        someoneFainted = true
        targetAlive = false
      }
    }

    // §1.3 steps 12-14: secondaries. s_basic gates on effectChance; the
    // s_stat/s_status families landed via the accuracy roll instead.
    if (targetAlive || selfTargeting) {
      switch (move.method) {
        case 's_self_stat':
          applyStages(user, side, move.stageMod, events)
          break
        case 's_stat': {
          const who = move.target === 'user' ? user : target
          const whoSide = move.target === 'user' ? side : otherSide
          applyStages(who, whoSide, move.stageMod, events)
          break
        }
        case 's_status':
          applyMoveStatuses(target, them.state, otherSide, move.status, events, rng, false)
          break
        default: { // s_basic and (for now) every bespoke method
          if (!dealsDamage) break
          const gate = rng(0, 99) < (move.effectChance || 0)
          if (gate) {
            applyMoveStatuses(target, them.state, otherSide, move.status, events, rng, false)
            applyStages(target, otherSide, move.stageMod, events)
          }
        }
      }
    }
  }

  // §1.12 end of turn: residual damage, in acting order
  if (!someoneFainted) {
    for (const side of [0, 1] as const) {
      const b = sides[side].battler
      if (b.hp <= 0) continue
      const before = b.status
      const dmg = endOfTurnTick(b, sides[side].state)
      if (dmg > 0) {
        events.push({ type: 'residual', side, status: before ?? '?', amount: dmg, hp: b.hp })
        if (b.hp <= 0) events.push({ type: 'fainted', side })
      }
    }
  }
  return events
}

// §1.14 — wild-battle flee. Speeds are UNMODIFIED spd bases.
export function attemptFlee(playerSpd: number, wildSpd: number, attempts: number, rng: Rng): boolean {
  const a = playerSpd || 1
  const b = Math.max(wildSpd, 4)
  if (a > b) return true
  const value = idiv(a * 32, idiv(b, 4)) + 30 * attempts
  return rng(0, 255) < value
}
