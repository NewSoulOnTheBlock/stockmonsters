import { RpgEvent, RpgPlayer } from '@rpgjs/server'
import npcsRaw from '../../tiled/npcs.json'

/*
 * Talking NPCs extracted from the PSDK maps by tools/extract-npcs.py.
 * v1: every NPC uses the starter's safe 'female' charset — the original NPC
 * sprites are unreskinned Nintendo art (see HANDOVER) and stay out until the
 * reskin pipeline produces replacements.
 */

type Npc = { map: string; x: number; y: number; name: string | null; lines: string[] }
const TILE = 32
const npcs = npcsRaw as Npc[]

function npcEvent(npc: Npc) {
  return {
    x: npc.x * TILE,
    y: npc.y * TILE,
    event: {
      onInit(this: RpgEvent) {
        this.setGraphic('female')
      },
      async onAction(this: RpgEvent, player: RpgPlayer) {
        for (const line of npc.lines) {
          await player.showText(npc.name ? `${npc.name}: ${line}` : line)
        }
      },
    },
  }
}

export function npcEvents(mapId: string) {
  return npcs.filter((n) => n.map === mapId).map(npcEvent)
}
