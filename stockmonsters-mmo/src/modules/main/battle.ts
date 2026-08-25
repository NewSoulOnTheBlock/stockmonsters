import { RpgPlayer } from '@rpgjs/server'
import dexRaw from '../../data/dex.json'
import speciesRaw from '../../data/studio/species.json'
import { createWildCreature, type CreatureInstance } from '../../battle/factory'
import { runTurn, attemptFlee, newBattle, onBattleStart, type Combatant } from '../../battle/turn'
import { tryCapture } from '../../battle/catching'
import { totalExpForLevel, levelFromExp, maxHp } from '../../battle/stats'
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

    await player.showText(`A wild ${nameOf(wild)} (L${wild.level}) appeared!`)

    // entry abilities (Intimidate)
    const entry = onBattleStart([
      { battler: mine, state: myState, move: 'splash' },
      { battler: wild, state: wildState, move: 'splash' },
    ])
    if (entry.length) await player.showText(describe(entry, mine, wild))

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
          await player.showText(describe(events, mine, wild))
          if (wild.hp <= 0) {
            bag.balls++ // win faucet until shops/money arrive
            await player.showText(awardExp(mine, wild) + '\nFound a Ball! (+1)')
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
          if (r.caught) {
            const box = (player.getVariable('BOX') as CreatureInstance[] | undefined) ?? []
            box.push(wild)
            player.setVariable('BOX', box)
            await player.showText(
              `Gotcha! ${nameOf(wild)} was caught${r.criticalCapture ? ' (critical capture!)' : ''}!\n` +
              `It was sent to your Box. (${box.length} in Box)`,
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
    inBattle.delete(id)
  }
}
