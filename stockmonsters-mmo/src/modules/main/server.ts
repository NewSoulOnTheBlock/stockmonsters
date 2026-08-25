import { defineModule } from "@rpgjs/common";
import { RpgServer } from "@rpgjs/server";
import { player } from './player'
import { warpEvents } from './warps'
import { creatureEvents } from './creatures'
import { npcEvents } from './npcs'
import { MAPS as PSDK_MAPS } from '../../tiled/manifest'
import { RMXP_MAPS } from '../../tiled/rmxp-manifest'
import { rmxpWarpEvents } from './rmxp-warps'

// The two map families come from different importers (PSDK .tmx vs RPG Maker
// XP .rxdata) but land in the same hitbox shape, so the game treats them as
// one list. Ids are verified non-colliding by tools/import-rmxp-maps.mjs.
const MAPS = [...PSDK_MAPS, ...RMXP_MAPS.map(({ id, hitboxes }) => ({ id, hitboxes }))]
// import { Npc } from "./event";

// Every map in src/tiled/ is imported from the PSDK game by
// tools/import-maps.mjs, which also converts PSDK's passages layer into
// collision rects and regenerates the manifest. Adding a map to the game is
// just re-running the importer.
const HITBOXES = Object.fromEntries(MAPS.map((m) => [m.id, m.hitboxes]))
const HITBOX_ID = '__psdk_passages__:'

export default defineModule<RpgServer>({
  player,
  map: {
    // A map entry's own fields don't reach mapData (only weather/events/
    // sounds/hooks are copied), so collision rects are injected through the
    // same hook @rpgjs/tiledmap uses for tile collision.
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
  // Kanto/Johto maps join at their edges instead of through doors, so they
  // get their own warp generator; the PSDK generators return [] for them.
  maps: MAPS.map(({ id }) => ({
    id,
    events: [...warpEvents(id), ...rmxpWarpEvents(id), ...creatureEvents(id), ...npcEvents(id)],
  })),
});
