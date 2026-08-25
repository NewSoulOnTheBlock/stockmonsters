import { defineModule } from "@rpgjs/common";
import { RpgServer } from "@rpgjs/server";
import { player } from './player'
import hubHitboxes from '../../tiled/hub.hitboxes.json'
// import { Npc } from "./event";

type Rect = { x: number; y: number; width: number; height: number }

// Collision rects converted from PSDK's passages layer by tools/import-maps.mjs.
// A map entry's own fields don't reach mapData (only weather/events/sounds/hooks
// are copied), so they are injected through the map.onBeforeUpdate hook — the
// same one @rpgjs/tiledmap uses for tile collision.
const HITBOXES: Record<string, Rect[]> = {
  hub: hubHitboxes,
}
const HITBOX_ID = '__psdk_passages__:'

export default defineModule<RpgServer>({
  player,
  map: {
    onBeforeUpdate(mapData: any) {
      const rects = HITBOXES[String(mapData?.id ?? '').replace(/^map-/, '')]
      if (!rects) return
      // The hook can run again on physics re-init — replace, never append
      const kept = (mapData.hitboxes ?? []).filter(
        (h: any) => !String(h?.id ?? '').startsWith(HITBOX_ID),
      )
      mapData.hitboxes = [...kept, ...rects.map((r, i) => ({ id: HITBOX_ID + i, ...r }))]
    },
  },
  maps: [
    // Imported from the PSDK game with tools/import-maps.mjs. 64x64 tiles at
    // 32px, so 2048x2048 world pixels.
    {
      id: 'hub'
    }
  ]
});
