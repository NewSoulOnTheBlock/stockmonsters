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

// s_recoil fractions are engine-coded per move (docs §6.2); this table is
// the PSDK/vanilla set, defaulting to 1/3 for anything unlisted.
const RECOIL_SHARE: Record<string, number> = {
  take_down: 1 / 4, wild_charge: 1 / 4, submission: 1 / 4,
  double_edge: 1 / 3, brave_bird: 1 / 3, flare_blitz: 1 / 3,
  volt_tackle: 1 / 3, wood_hammer: 1 / 3, head_charge: 1 / 4,
  head_smash: 1 / 2, light_of_ruin: 1 / 2,
}

/** 2-5 hits at 37.5/37.5/12.5/12.5 (§7 — NOT vanilla 35/35/15/15). */
export function rollMultiHitCount(rng: Rng): number {
  const r = rng(1, 8)
  return r <= 3 ? 2 : r <= 6 ? 3 : r === 7 ? 4 : 5
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

/** Mutable battle-level state that survives across turns. */
export interface BattleState {
  weather: import('./battler').Weather
}
export const newBattle = (): BattleState => ({ weather: 'none' })

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
  | { type: 'heal'; side: 0 | 1; amount: number; hp: number }
  | { type: 'recoil'; side: 0 | 1; amount: number; hp: number }
  | { type: 'hits'; side: 0 | 1; count: number }
  | { type: 'protected'; side: 0 | 1 }
  | { type: 'charging'; side: 0 | 1; move: string }
  | { type: 'recharging'; side: 0 | 1 }
  | { type: 'bound'; side: 0 | 1; turns: number }
  | { type: 'weather'; weather: string }
  | { type: 'screen'; side: 0 | 1; screen: 'reflect' | 'light_screen' }
  | { type: 'fainted'; side: 0 | 1 }

export function liveSpeed(b: Battler, weather: import('./battler').Weather = 'none'): number {
  let spd = Math.floor(b.stats.spd * stageMultiplier(stage(b, 'spd')))
  if (b.ability === 'chlorophyll' && weather === 'sun') spd *= 2
  if (b.ability === 'swift_swim' && weather === 'rain') spd *= 2
  if (b.status === 'paralysis') spd = Math.floor(spd * 0.25)
  return spd
}

export function turnOrder(
  a: Combatant, b: Combatant, rng: Rng, battle?: BattleState,
): (0 | 1)[] {
  const pa = getMove(a.move).priority
  const pb = getMove(b.move).priority
  if (pa !== pb) return pa > pb ? [0, 1] : [1, 0]
  const sa = liveSpeed(a.battler, battle?.weather)
  const sb = liveSpeed(b.battler, battle?.weather)
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

/** Entry abilities (Intimidate) — call once when both sides are revealed. */
export function onBattleStart(sides: [Combatant, Combatant]): TurnEvent[] {
  const events: TurnEvent[] = []
  for (const [i, c] of sides.entries()) {
    if (c.battler.ability !== 'intimidate') continue
    const foe = sides[i === 0 ? 1 : 0].battler
    foe.stages ??= {}
    const now = Math.max(-6, (foe.stages.atk ?? 0) - 1)
    foe.stages.atk = now
    events.push({ type: 'stage', side: (i === 0 ? 1 : 0) as 0 | 1, stat: 'atk', delta: -1, now })
  }
  return events
}

const WEATHER_BY_MOVE: Record<string, import('./battler').Weather> = {
  rain_dance: 'rain', sunny_day: 'sun', sandstorm: 'sandstorm', hail: 'hail',
}

/** Runs one full turn including end-of-turn residuals; mutates battlers. */
export function runTurn(
  sides: [Combatant, Combatant], rng: Rng, battle: BattleState = newBattle(),
): TurnEvent[] {
  const events: TurnEvent[] = []
  let someoneFainted = false

  for (const side of turnOrder(sides[0], sides[1], rng, battle)) {
    if (someoneFainted) break
    const otherSide = (side === 0 ? 1 : 0) as 0 | 1
    const me = sides[side]
    const them = sides[otherSide]
    const user = me.battler
    const target = them.battler
    if (user.hp <= 0) continue

    // s_reload: the turn after the hit is spent recharging
    if (me.state.recharging) {
      me.state.recharging = false
      events.push({ type: 'recharging', side })
      continue
    }
    // s_2turns: the charged move executes this turn regardless of choice
    let chargeExecuting = false
    if (me.state.charging) {
      me.move = me.state.charging
      me.state.charging = null
      chargeExecuting = true
    }
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

    // stateful methods that resolve without touching the target
    if (move.method === 's_protect') {
      me.state.protected = true
      events.push({ type: 'protected', side })
      continue
    }
    if (move.method === 's_weather') {
      battle.weather = WEATHER_BY_MOVE[me.move] ?? 'none'
      events.push({ type: 'weather', weather: battle.weather })
      continue
    }
    if (move.method === 's_reflect') {
      if (me.move === 'light_screen') me.state.lightScreenTurns = 5
      else me.state.reflectTurns = 5 // reflect + aurora veil approximation
      events.push({ type: 'screen', side, screen: me.move === 'light_screen' ? 'light_screen' : 'reflect' })
      continue
    }
    if (move.method === 's_2turns' && !chargeExecuting) {
      me.state.charging = me.move
      events.push({ type: 'charging', side, move: me.move })
      continue
    }
    const selfTargeting = move.target === 'user' || move.method === 's_self_stat'
    // §6.2 gotcha: power 0 does not mean no damage — s_ohko computes it
    const dealsDamage = move.method === 's_ohko' || (move.category !== 'status' && move.power > 0)

    // s_protect: the target blocks everything aimed at it this turn
    if (!selfTargeting && them.state.protected && (dealsDamage || move.target !== 'user')) {
      events.push({ type: 'protected', side: otherSide })
      continue
    }
    // §1.3 step 6: accuracy (self-targeting status moves bypass — §1.4)
    if (!(move.category === 'status' && move.target === 'user') &&
        !accuracyCheck(user, target, move, rng)) {
      events.push({ type: 'missed', side })
      continue
    }
    // §1.3 step 8: type immunity — applies to status moves too
    // (thunder_wave vs Ground, growl vs Ghost)
    const abilityImmune = move.type === 'ground' && target.ability === 'levitate'
    if (!selfTargeting && (abilityImmune || effectiveness(move.type, target.types) === 0)) {
      events.push({ type: 'immune', side: otherSide })
      continue
    }

    let targetAlive = true
    let totalDealt = 0
    if (dealsDamage) {
      // s_multi_hit / s_2hits reroll crit per hit (§1.6)
      const hits =
        move.method === 's_multi_hit' ? rollMultiHitCount(rng)
        : move.method === 's_2hits' ? 2
        : move.method === 's_ohko' ? 0
        : 1
      if (move.method === 's_ohko') {
        // §6.2: one-hit KO — damage equals current HP
        totalDealt = target.hp
        target.hp = 0
        events.push({ type: 'damage', side: otherSide, amount: totalDealt, critical: false, effectiveness: 1, targetHp: 0 })
      } else {
        let landed = 0
        for (let h = 0; h < hits && target.hp > 0; h++) {
          const screenMod =
            (move.category === 'physical' && (them.state.reflectTurns ?? 0) > 0) ||
            (move.category === 'special' && (them.state.lightScreenTurns ?? 0) > 0)
              ? 0.5 : undefined
          const r = damages(user, target, move, rng, { weather: battle.weather, screenMod })
          totalDealt += r.damage
          target.hp = Math.max(0, target.hp - r.damage)
          landed++
          events.push({
            type: 'damage', side: otherSide, amount: r.damage,
            critical: r.critical, effectiveness: r.effectiveness, targetHp: target.hp,
          })
        }
        if (hits > 1) events.push({ type: 'hits', side, count: landed })
      }
      if (target.hp <= 0) {
        events.push({ type: 'fainted', side: otherSide })
        someoneFainted = true
        targetAlive = false
      }
      // static: 30% to paralyze on contact (§ability set)
      if (totalDealt > 0 && target.ability === 'static' && (moveDb[me.move]?.isDirect) &&
          user.hp > 0 && rng(0, 99) < 30 && applyStatus(user, me.state, 'paralysis', rng)) {
        events.push({ type: 'status', side, status: 'paralysis' })
      }
      if (move.method === 's_reload' && totalDealt > 0) me.state.recharging = true
      if (move.method === 's_bind' && targetAlive) {
        if (!them.state.bindTurns) {
          them.state.bindTurns = rng(4, 5)
          events.push({ type: 'bound', side: otherSide, turns: them.state.bindTurns })
        }
      }
      if (move.method === 's_recoil' && totalDealt > 0) {
        const share = RECOIL_SHARE[me.move] ?? 1 / 3
        const recoil = Math.max(1, Math.floor(totalDealt * share))
        user.hp = Math.max(0, user.hp - recoil)
        events.push({ type: 'recoil', side, amount: recoil, hp: user.hp })
        if (user.hp <= 0) { events.push({ type: 'fainted', side }); someoneFainted = true }
      }
      if (move.method === 's_absorb' && totalDealt > 0 && user.hp > 0) {
        const gain = Math.min(Math.max(1, Math.floor(totalDealt / 2)), user.maxHp - user.hp)
        if (gain > 0) {
          user.hp += gain
          events.push({ type: 'heal', side, amount: gain, hp: user.hp })
        }
      }
    } else if (move.method === 's_heal') {
      const gain = Math.min(Math.floor(user.maxHp / 2), user.maxHp - user.hp)
      if (gain > 0) {
        user.hp += gain
        events.push({ type: 'heal', side, amount: gain, hp: user.hp })
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
      const st = sides[side].state
      if (b.hp <= 0) continue
      const before = b.status
      const dmg = endOfTurnTick(b, st)
      if (dmg > 0) {
        events.push({ type: 'residual', side, status: before ?? '?', amount: dmg, hp: b.hp })
        if (b.hp <= 0) { events.push({ type: 'fainted', side }); continue }
      }
      if ((st.bindTurns ?? 0) > 0) {
        st.bindTurns!--
        const chip = Math.min(Math.max(1, Math.floor(b.maxHp / 8)), b.hp)
        b.hp -= chip
        events.push({ type: 'residual', side, status: 'bind', amount: chip, hp: b.hp })
        if (b.hp <= 0) events.push({ type: 'fainted', side })
      }
    }
  }
  // effect expiry — protect lasts one turn, screens count down
  for (const [i, c] of sides.entries()) {
    if (c.battler.ability === 'speed_boost' && c.battler.hp > 0) {
      c.battler.stages ??= {}
      const now = Math.min(6, (c.battler.stages.spd ?? 0) + 1)
      if (now !== (c.battler.stages.spd ?? 0)) {
        c.battler.stages.spd = now
        events.push({ type: 'stage', side: i as 0 | 1, stat: 'spd', delta: 1, now })
      }
    }
    c.state.protected = false
    if (c.state.reflectTurns) c.state.reflectTurns--
    if (c.state.lightScreenTurns) c.state.lightScreenTurns--
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
