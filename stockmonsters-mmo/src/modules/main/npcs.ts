import { RpgEvent, RpgPlayer } from '@rpgjs/server'
import npcsRaw from '../../tiled/npcs.json'
import { CHARACTER_PRESETS } from '../../data/character-catalog'

/*
 * Talking NPCs extracted from the PSDK maps by tools/extract-npcs.py, which
 * also curates them: PSDK ships as a demo project whose library/photo-studio
 * NPCs explain engine commands, and those are filtered out along with lines
 * still naming unreskinned species. What is left is capped per map.
 *
 * Graphics come from the same license-clear Pipoya set as the player's
 * character options, picked deterministically per NPC so a given villager
 * always looks the same — for every client, and across restarts.
 */

type Npc = { map: string; x: number; y: number; name: string | null; lines: string[] }
const TILE = 32
const npcs = npcsRaw as Npc[]

// Cats and dogs are charming as pets but odd as shopkeepers — people only.
const NPC_GRAPHICS = CHARACTER_PRESETS
  .map((c) => c.id)
  .filter((id) => id.startsWith('ch-male-') || id.startsWith('ch-female-'))

function graphicFor(npc: Npc): string {
  // FNV-1a over the NPC's identity: stable across runs, well spread
  let h = 0x811c9dc5
  for (const ch of `${npc.map}:${npc.x},${npc.y}:${npc.name ?? ''}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return NPC_GRAPHICS[h % NPC_GRAPHICS.length]
}

function npcEvent(npc: Npc) {
  const graphic = graphicFor(npc)
  return {
    x: npc.x * TILE,
    y: npc.y * TILE,
    event: {
      onInit(this: RpgEvent) {
        this.setGraphic(graphic)
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
