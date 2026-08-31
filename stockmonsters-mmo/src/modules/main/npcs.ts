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

/** Players currently mid-conversation, by transport id. See onAction below. */
const talking = new Set<string>()
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
      /*
       * ONE CONVERSATION AT A TIME, AND IT ALWAYS ENDS.
       *
       * This awaited a showText per line with nothing stopping a second press
       * starting the whole loop again. Players tap the action key — that is
       * how you talk to somebody — and every tap began another conversation
       * with the same NPC, each awaiting its own dialog. They queue, so the
       * box keeps reopening with lines the player has already read and there
       * is no way to reach the end of it. Reported as chatting getting stuck.
       *
       * The guard is keyed by player id, like every other roster here: the
       * engine hands each room a fresh RpgPlayer, so anything keyed by the
       * object forgets on the first door.
       *
       * try/finally, not a plain reset: if a line rejects — the player left,
       * the map changed under them — the flag has to come off anyway, or that
       * player can never talk to anyone again for the rest of the session.
       */
      async onAction(this: RpgEvent, player: RpgPlayer) {
        const id = String(player.id)
        if (talking.has(id)) return
        talking.add(id)
        try {
          for (const line of npc.lines) {
            await player.showText(npc.name ? `${npc.name}: ${line}` : line)
          }
        } catch (err) {
          console.error('[npc] conversation ended early', err)
        } finally {
          talking.delete(id)
        }
      },
    },
  }
}

export function npcEvents(mapId: string) {
  return npcs.filter((n) => n.map === mapId).map(npcEvent)
}
