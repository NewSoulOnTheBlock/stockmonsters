import { provideClientGlobalConfig, provideClientModules, Presets } from "@rpgjs/client";
import { provideMain } from "../modules/main";
import { provideTiledMap } from "@rpgjs/tiledmap/client";
import { OW_TICKERS } from "../data/ow-spritesheets";

export default {
  providers: [
    provideTiledMap({
      basePath: "map",
    }),
    provideClientGlobalConfig(),
    provideMain(),
    provideClientModules([
      {
        spritesheets: [
          {
            id: 'hero',
            image: 'spritesheets/hero.png',
            ...Presets.RMSpritesheet(3, 4)
          },
          {
            id: 'female',
            image: 'spritesheets/female.png',
             ...Presets.RMSpritesheet(3, 4)
          },
          // 128x128 RPG Maker charsets: 4 frames x 4 directions
          ...OW_TICKERS.map((t) => ({
            id: `ow-${t}`,
            image: `spritesheets/ow/${t}.png`,
            ...Presets.RMSpritesheet(4, 4),
          }))
        ]
      }
    ])
  ],
};
