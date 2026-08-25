import { defineModule } from "@rpgjs/common";
import { RpgServer } from "@rpgjs/server";
import { player } from './player'
// import { Npc } from "./event";

export default defineModule<RpgServer>({
  player,
  maps: [
    // Imported from the PSDK game with tools/import-maps.mjs. 64x64 tiles at
    // 32px, so 2048x2048 world pixels.
    {
      id: 'simplemap'
    }
  ]
});
