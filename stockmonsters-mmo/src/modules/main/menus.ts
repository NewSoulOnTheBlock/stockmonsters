import { RpgPlayer } from '@rpgjs/server'
import dexRaw from '../../data/dex.json'
import speciesRaw from '../../data/studio/species.json'
import type { CreatureInstance } from '../../battle/factory'

/*
 * Lightweight panels over the dialog GUI until real modals arrive with the
 * wallet stage: "1" opens the team, "2" opens the Box (the future NFT mint
 * queue — every caught creature waits here).
 */

const dex = dexRaw as any[]
const species = speciesRaw as Record<string, any>
const dbSymbolByDexId: Record<number, string> = {}
for (const [sym, s] of Object.entries(species)) dbSymbolByDexId[s.id] = sym
const entryOf = (inst: CreatureInstance) => dex.find((e) => dbSymbolByDexId[e.dexId] === inst.dbSymbol)

const line = (c: CreatureInstance) => {
  const e = entryOf(c)
  return `${e?.name ?? c.dbSymbol} ($${e?.ticker ?? '?'}) L${c.level} — HP ${c.hp}/${c.maxHp}${c.shiny ? ' ✨' : ''}`
}

export async function showParty(player: RpgPlayer) {
  const party = (player.getVariable('PARTY') as CreatureInstance[] | undefined) ?? []
  if (!party.length) return player.showText('You have no Stockmonsters yet — touch a wild one!')
  await player.showText('YOUR TEAM\n' + party.map(line).join('\n'))
}

export async function showBox(player: RpgPlayer) {
  const box = (player.getVariable('BOX') as CreatureInstance[] | undefined) ?? []
  if (!box.length) return player.showText('Your Box is empty. Caught Stockmonsters wait here for NFT minting.')
  const pick = await player.showChoices(
    `BOX — ${box.length} Stockmonster(s), waiting for mint:`,
    box.slice(0, 8).map((c, i) => ({ text: line(c), value: i })),
  )
  if (pick == null) return
  const c = box[pick.value as number]
  const e = entryOf(c)
  await player.showText(
    `${e?.name} ($${e?.ticker}) — ${e?.species ?? ''}\n` +
    `L${c.level} ${c.nature} · ${e?.types?.join('/') ?? ''}\n` +
    `${e?.description ?? ''}\n` +
    `Contract: ${e?.address ?? 'n/a'}\n(minting arrives with wallet login)`,
  )
}

const menuOpen = new Set<string>()

export async function openMenu(player: RpgPlayer) {
  const id = String(player.id)
  if (menuOpen.has(id)) return
  menuOpen.add(id)
  try {
    const pick = await player.showChoices('MENU', [
      { text: 'Team', value: 'party' },
      { text: 'Box (NFT queue)', value: 'box' },
      { text: 'Close', value: 'close' },
    ])
    if (pick?.value === 'party') await showParty(player)
    if (pick?.value === 'box') await showBox(player)
  } finally {
    menuOpen.delete(id)
  }
}
