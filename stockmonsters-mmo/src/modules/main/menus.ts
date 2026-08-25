import { RpgPlayer } from '@rpgjs/server'
import dexRaw from '../../data/dex.json'
import speciesRaw from '../../data/studio/species.json'
import type { CreatureInstance } from '../../battle/factory'
import { profiles, hasProfileStore, collectState } from './profile'
import { snapFree, TILE } from './geometry'
import { MAPS as PSDK_MAPS } from '../../tiled/manifest'
import { RMXP_MAPS } from '../../tiled/rmxp-manifest'

const HOME_MAP = 'exterior'
const KNOWN_MAPS = new Set<string>([
  ...PSDK_MAPS.map((m) => m.id),
  ...RMXP_MAPS.map((m) => m.id),
])
const MAP_SIZE = new Map(RMXP_MAPS.map((m) => [m.id, { w: m.width, h: m.height }]))

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

/*
 * Travel: the Kanto/Johto region is a second, self-contained world — its maps
 * join at their edges but nothing links it to the PSDK island yet. Until a
 * proper ship/route exists, this is how a player reaches it (and gets back).
 * Arrival tiles are the middle of each map, snapped away from the borders so
 * the player never lands on an edge trigger.
 */
const DESTINATIONS: { text: string; map: string; tx: number; ty: number }[] = [
  { text: 'Exchange City (home)', map: 'exterior', tx: 24, ty: 62 },
  { text: 'New Bark Town', map: 'new-bark-town', tx: 11, ty: 24 },
  { text: 'Cherrygrove City', map: 'cherrygrove-city', tx: 43, ty: 27 },
  { text: 'Violet City', map: 'violet-city', tx: 35, ty: 24 },
  { text: 'Goldenrod City', map: 'goldenrod-city', tx: 32, ty: 23 },
]

export async function showTravel(player: RpgPlayer) {
  const seen = visitedMaps(player)
  const open = DESTINATIONS.filter((d) => seen.has(d.map))
  if (!open.length) {
    await player.showText('Nowhere to travel yet — explore on foot first.')
    return
  }
  const pick = await player.showChoices(
    'TRAVEL — where to?',
    open.map((d) => ({ text: d.text, value: DESTINATIONS.indexOf(d) })),
  )
  if (pick == null) return
  const d = DESTINATIONS[pick.value as number]
  await player.showText(`Travelling to ${d.text}...`)
  const at = snapFree(d.map, d.tx, d.ty)
  player.changeMap(d.map, { x: at.x * TILE, y: at.y * TILE })
}

/**
 * The HUD action bar. Everything here opens a dialog the player can read —
 * including the parts that are not built yet, which say what they will be
 * instead of silently doing nothing.
 */
export async function openHudPanel(player: RpgPlayer, id: string) {
  const key = String(player.id)
  if (menuOpen.has(key)) return
  menuOpen.add(key)
  try {
    if (id === 'team') { await showParty(player); return }
    if (id === 'bag') { await showBag(player); return }
    if (id === 'dex') { await showDex(player); return }
    if (id === 'map') { await showTravel(player); return }
    if (id === 'quests' || id === 'quest') {
      await player.showText('QUESTS\nNo contracts on the board yet — the questline arrives with the story port.')
      return
    }
    await player.showText('That panel is not built yet.')
  } finally {
    menuOpen.delete(key)
  }
}

export async function showBag(player: RpgPlayer) {
  const bag = (player.getVariable('BAG') as { balls: number; potions: number } | undefined) ??
    { balls: 5, potions: 3 }
  await player.showText(`BAG\nBalls: ${bag.balls}\nPotions: ${bag.potions}`)
}

export async function showDex(player: RpgPlayer) {
  // Seen/caught tracking comes with the story port; until then the Ledger
  // reports what the player actually holds, which is honest and still useful.
  const box = (player.getVariable('BOX') as CreatureInstance[] | undefined) ?? []
  const party = (player.getVariable('PARTY') as CreatureInstance[] | undefined) ?? []
  const owned = new Set([...party, ...box].map((c) => c.dbSymbol))
  await player.showText(
    `LEDGER\n${owned.size} of ${dex.length} Stockmonsters recorded.\n` +
    (owned.size ? 'Open the Box to inspect them.' : 'Touch a wild Stockmonster to begin.'),
  )
}

/**
 * Leaving the world. The save is not a courtesy here: party, box and bag only
 * exist in the profile store, so quitting without a write would lose whatever
 * happened since the last sweep. Write first, tell the client second — if the
 * write fails the player stays put and is told, rather than silently losing a
 * session.
 */
export async function quitToTitle(player: RpgPlayer) {
  const walletId = player.getVariable('WALLET_ID') as string | undefined
  if (walletId && hasProfileStore()) {
    try {
      profiles().saveProfile(walletId, collectState(player))
      await profiles().release(walletId) // forces the pending write out
    } catch (err) {
      await player.showText('Could not save just now — staying in the world so nothing is lost.')
      console.error('[quit] save failed', err)
      return
    }
    await player.showText('Progress saved.')
  }
  player.emit('game:quit', {})
}

/**
 * Fast travel from the world-map window. The client sends only a map id — the
 * arrival tile is the server's business, because a client-chosen coordinate is
 * a free teleport into any sealed room. The id itself is checked against the
 * manifests: an unknown map would drop the player into a room that does not
 * exist.
 */
/** Map ids the player has stood on. The spawn always counts. */
export function visitedMaps(player: RpgPlayer): Set<string> {
  const raw = player.getVariable('VISITED')
  const list = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  return new Set([HOME_MAP, ...list])
}

/** Records a map as visited; returns true when it was new. */
export function markVisited(player: RpgPlayer, mapId: string): boolean {
  if (!mapId || !KNOWN_MAPS.has(mapId)) return false
  const seen = visitedMaps(player)
  if (seen.has(mapId)) return false
  seen.add(mapId)
  player.setVariable('VISITED', [...seen])
  return true
}

export async function travelTo(player: RpgPlayer, mapId: unknown) {
  if (typeof mapId !== 'string' || !KNOWN_MAPS.has(mapId)) return
  // Fast travel is a shortcut back, not a way in: you have to have walked
  // there once. Checked on the server because the client's list is only a
  // mirror — and a client-chosen destination would otherwise skip the whole
  // world.
  if (!visitedMaps(player).has(mapId)) {
    await player.showText("You have not been there yet — find it on foot first.")
    return
  }
  const size = MAP_SIZE.get(mapId)
  // Middle of the map, nudged off anything solid. Maps we have no size for
  // (the PSDK set) keep their own default entry point.
  if (size) {
    const at = snapFree(mapId, Math.floor(size.w / 2), Math.floor(size.h / 2), 12)
    player.changeMap(mapId, { x: at.x * TILE, y: at.y * TILE })
  } else {
    player.changeMap(mapId)
  }
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
      { text: 'Travel', value: 'travel' },
      { text: 'Save & quit to title', value: 'quit' },
      { text: 'Close', value: 'close' },
    ])
    if (pick?.value === 'party') await showParty(player)
    if (pick?.value === 'box') await showBox(player)
    if (pick?.value === 'travel') await showTravel(player)
    if (pick?.value === 'quit') await quitToTitle(player)
  } finally {
    menuOpen.delete(id)
  }
}
