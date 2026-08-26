// Type-only: nothing here constructs an RpgPlayer, and a value import would
// drag the whole server package (and through it canvasengine, which needs a
// `window`) into any test that wants to drive a battle.
import type { RpgPlayer } from '@rpgjs/server'
import dexRaw from '../../data/dex.json'
import speciesRaw from '../../data/studio/species.json'
import { createWildCreature, type CreatureInstance } from '../../battle/factory'
import { runTurn, attemptFlee, newBattle, onBattleStart, type Combatant } from '../../battle/turn'
import { tryCapture } from '../../battle/catching'
import { totalExpForLevel, levelFromExp, maxHp } from '../../battle/stats'
import { credit } from './earnings'
import type { Rng } from '../../battle/damage'
import type { StatusState } from '../../battle/status'

/*
 * Wild battles over the dialog GUI (showText/showChoices) — the proven RPC
 * surface. A proper battle scene replaces the presentation later; the rules
 * all live in src/battle/ and stay untouched when it does.
 */

const dex = dexRaw as any[]
const species = speciesRaw as Record<string, any>

const dbSymbolByDexId: Record<number, string> = {}
for (const [sym, s] of Object.entries(species)) dbSymbolByDexId[s.id] = sym
const dexByTicker = Object.fromEntries(dex.map((e) => [e.ticker, e]))
const nameOf = (inst: CreatureInstance) => {
  const entry = dex.find((e) => dbSymbolByDexId[e.dexId] === inst.dbSymbol)
  return entry?.name ?? inst.dbSymbol
}

const rng: Rng = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

// --- battle visual scene -----------------------------------------------------
// The client mounts a DOM overlay (src/battle-scene.ts) fed over the custom
// websocket channel. Two channels, in this order:
//
//   battle:turn  { events }              the turn's EVENT LIST, straight out of
//                                        runTurn() — the overlay plays it beat
//                                        by beat. Sent BEFORE the text so the
//                                        animation starts as the line appears.
//   battle:state { mine, wild, intro? }  the full snapshot, the source of truth
//                                        for HP. Sent right after, and the
//                                        overlay holds it until the burst has
//                                        finished playing (or the player
//                                        fast-forwards), then reconciles.
//   battle:end   {}                      teardown + exit wipe.
//
// Two event types the rules never produce are synthesised here so the whole
// scene speaks one language: `appear` (a wild creature arriving) and `ball`
// (a capture attempt). Everything else is a verbatim TurnEvent.
const entryOf = (inst: CreatureInstance) => dex.find((e) => dbSymbolByDexId[e.dexId] === inst.dbSymbol)
const viewOf = (inst: CreatureInstance) => ({
  name: nameOf(inst),
  level: inst.level,
  hp: inst.hp,
  maxHp: inst.maxHp,
  sprite: entryOf(inst)?.sprite ?? '',
  status: inst.status ?? undefined,
})
const emitScene = (player: RpgPlayer, mine: CreatureInstance, wild: CreatureInstance, intro = false) =>
  player.emit('battle:state', { mine: viewOf(mine), wild: viewOf(wild), intro })
/** Push a turn's beats. `side` 0 is the player's creature, 1 is the wild one. */
const emitTurn = (player: RpgPlayer, events: unknown[]) => {
  if (events.length) player.emit('battle:turn', { events })
}

const STARTERS = [
  { ticker: 'AAPL', label: 'Applion ($AAPL) — Flora' },
  { ticker: 'NVDA', label: 'Nvidrake ($NVDA) — Blaze' },
  { ticker: 'TSLA', label: 'Teslazar ($TSLA) — Tide' },
]

const inBattle = new Set<string>()

const hpBar = (c: CreatureInstance) => `${nameOf(c)} L${c.level}  HP ${c.hp}/${c.maxHp}`

function make(ticker: string, level: number): CreatureInstance {
  return createWildCreature(dbSymbolByDexId[dexByTicker[ticker].dexId], level, rng)
}

async function ensureParty(player: RpgPlayer): Promise<CreatureInstance[]> {
  let party = player.getVariable('PARTY') as CreatureInstance[] | undefined
  if (party?.length) return party
  const choice = await player.showChoices(
    'Welcome to Exchange City! Choose your first Stockmonster:',
    STARTERS.map((s, i) => ({ text: s.label, value: i })),
  )
  const pick = STARTERS[(choice?.value as number) ?? 0]
  const starter = make(pick.ticker, 10)
  party = [starter]
  player.setVariable('PARTY', party)
  await player.showText(`${nameOf(starter)} joined your team!`)
  return party
}

function describe(events: ReturnType<typeof runTurn>, mine: CreatureInstance, wild: CreatureInstance): string {
  const name = (side: 0 | 1) => (side === 0 ? nameOf(mine) : nameOf(wild))
  const lines: string[] = []
  for (const e of events) {
    if (e.type === 'used') lines.push(`${name(e.side)} used ${e.move.replace(/_/g, ' ')}!`)
    else if (e.type === 'damage') {
      let s = `${name(e.side)} took ${e.amount} damage`
      if (e.critical) s += ' (critical!)'
      if (e.effectiveness > 1) s += " — it's super effective!"
      if (e.effectiveness < 1) s += " — it's not very effective..."
      lines.push(s)
    } else if (e.type === 'missed') lines.push('...but it missed!')
    else if (e.type === 'immune') lines.push(`It doesn't affect ${name(e.side)}...`)
    else if (e.type === 'prevented') lines.push(`${name(e.side)} can't move (${e.reason})!`)
    else if (e.type === 'self-hit') lines.push(`${name(e.side)} hurt itself in confusion (${e.amount})!`)
    else if (e.type === 'status') lines.push(`${name(e.side)} is now ${e.status}!`)
    else if (e.type === 'stage') lines.push(`${name(e.side)}'s ${e.stat} ${e.delta > 0 ? 'rose' : 'fell'}!`)
    else if (e.type === 'residual') lines.push(`${name(e.side)} is hurt by ${e.status} (${e.amount})!`)
    else if (e.type === 'fainted') lines.push(`${name(e.side)} fainted!`)
  }
  return lines.join('\n')
}

// v1 EXP: PSDK's base term (§2.4 first factor) without the modifier chain
function awardExp(mine: CreatureInstance, wild: CreatureInstance): string {
  const base = species[wild.dbSymbol].baseExperience
  const gained = Math.max(1, Math.floor((base * wild.level) / 7))
  const curve = species[mine.dbSymbol].experienceType
  const current = totalExpForLevel(curve, mine.level)
  const newLevel = levelFromExp(curve, current + gained)
  let msg = `${nameOf(mine)} gained ${gained} EXP!`
  if (newLevel > mine.level) {
    const s = species[mine.dbSymbol]
    const oldMax = mine.maxHp
    mine.level = newLevel
    mine.maxHp = maxHp(s.baseHp, mine.ivs.hp, 0, newLevel)
    mine.hp += mine.maxHp - oldMax // hpDiff preserved, not the ratio (§2.3)
    msg += ` It grew to level ${newLevel}!`
  }
  return msg
}

export async function startWildBattle(player: RpgPlayer, ticker: string) {
  const id = String(player.id)
  if (inBattle.has(id)) return
  inBattle.add(id)
  try {
    const party = await ensureParty(player)
    const mine = party[0]
    if (mine.hp <= 0) mine.hp = mine.maxHp // v1: auto-heal a fainted team
    const level = rng(8, 14)
    const wild = make(ticker, level)
    const myState: StatusState = {}
    const wildState: StatusState = {}
    const battleState = newBattle()
    let fleeAttempts = 0

    // Scene up before the first line of text: the snapshot opens the overlay
    // with the entry wipe and the wild creature slides in.
    emitScene(player, mine, wild, true)
    await player.showText(`A wild ${nameOf(wild)} (L${wild.level}) appeared!`)

    // entry abilities (Intimidate)
    const entry = onBattleStart([
      { battler: mine, state: myState, move: 'splash' },
      { battler: wild, state: wildState, move: 'splash' },
    ])
    if (entry.length) {
      emitTurn(player, entry)
      emitScene(player, mine, wild)
      await player.showText(describe(entry, mine, wild))
    }

    // simple v1 bag: finite balls, a few potions; +1 ball per win as a
    // faucet until shops/money arrive
    const bag = (player.getVariable('BAG') as { balls: number; potions: number }) ?? { balls: 5, potions: 3 }

    battle: while (true) {
      const action = await player.showChoices(
        `${hpBar(wild)}\n${hpBar(mine)}`,
        [
          { text: 'Fight', value: 'fight' },
          { text: `Throw Ball (${bag.balls})`, value: 'ball' },
          { text: `Potion (${bag.potions})`, value: 'potion' },
          { text: 'Run', value: 'run' },
        ],
      )
      switch (action?.value) {
        case 'fight': {
          const pick = await player.showChoices(
            'Which move?',
            mine.moves.map((m) => ({ text: m.replace(/_/g, ' '), value: m })),
          )
          if (pick == null) continue
          const wildMove = wild.moves[rng(0, wild.moves.length - 1)]
          const sides: [Combatant, Combatant] = [
            { battler: mine, state: myState, move: pick.value as string },
            { battler: wild, state: wildState, move: wildMove },
          ]
          fleeAttempts = 0 // §1.14: reset when the player attacks
          const events = runTurn(sides, rng, battleState)
          emitTurn(player, events)      // beats first — the overlay starts playing
          emitScene(player, mine, wild) // …then the truth, held until it drains
          await player.showText(describe(events, mine, wild))
          if (wild.hp <= 0) {
            bag.balls++ // win faucet until shops/money arrive
            // Winning pays, out of the rewards pool — never newly minted.
            const won = credit(player, 'battleWin')
            await player.showText(
              awardExp(mine, wild) + '\nFound a Ball! (+1)' +
                (won ? `\nEarned ${won} tokens — claim them from the wallet panel.` : ''),
            )
            break battle
          }
          if (mine.hp <= 0) {
            await player.showText(`You have no Stockmonsters left! You rush back to safety.`)
            break battle
          }
          break
        }
        case 'potion': {
          if (bag.potions <= 0) { await player.showText('No Potions left!'); break }
          if (mine.hp >= mine.maxHp) { await player.showText(`${nameOf(mine)} is already at full HP!`); break }
          bag.potions--
          const heal = Math.min(20, mine.maxHp - mine.hp) // Potion = 20 HP (§5.3)
          mine.hp += heal
          emitTurn(player, [{ type: 'heal', side: 0, amount: heal, hp: mine.hp }])
          emitScene(player, mine, wild)
          await player.showText(`${nameOf(mine)} recovered ${heal} HP! (${mine.hp}/${mine.maxHp})`)
          break
        }
        case 'ball': {
          if (bag.balls <= 0) { await player.showText('No Balls left!'); break }
          bag.balls--
          const r = tryCapture(
            { rareness: wild.catchRate, ballBonus: 1, target: wild, speciesCaught: 0 },
            rng,
          )
          emitTurn(player, [{ type: 'ball', side: 1, bounces: r.bounces, caught: r.caught }])
          if (r.caught) {
            const box = (player.getVariable('BOX') as CreatureInstance[] | undefined) ?? []
            // Is this a species they have never had? The dex IS the
            // collection, so the first of each is worth far more than the
            // fifth — and it cannot be farmed twice.
            const party = (player.getVariable('PARTY') as CreatureInstance[] | undefined) ?? []
            const isNew = ![...box, ...party].some((c) => c?.dbSymbol === wild.dbSymbol)
            box.push(wild)
            player.setVariable('BOX', box)
            const paid = credit(player, isNew ? 'firstCatch' : 'catch')
            await player.showText(
              `Gotcha! ${nameOf(wild)} was caught${r.criticalCapture ? ' (critical capture!)' : ''}!\n` +
              `It was sent to your Box. (${box.length} in Box)` +
              (paid ? `\n${isNew ? 'A new species! ' : ''}Earned ${paid} tokens.` : ''),
            )
            break battle
          }
          await player.showText(`The ball shook ${r.bounces} time(s)... ${nameOf(wild)} broke free!`)
          break
        }
        case 'run': {
          if (attemptFlee(mine.stats.spd, wild.stats.spd, fleeAttempts++, rng)) {
            await player.showText('Got away safely!')
            break battle
          }
          await player.showText("Can't escape!")
          break
        }
        default:
          break battle // dialog dismissed
      }
    }
    player.setVariable('PARTY', party)
    player.setVariable('BAG', bag)
  } finally {
    player.emit('battle:end', {})
    inBattle.delete(id)
  }
}
