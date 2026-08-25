import { provideClientGlobalConfig, provideClientModules, Presets } from "@rpgjs/client";
import { provideMain } from "../modules/main";
import { provideTiledMap } from "@rpgjs/tiledmap/client";
import { OW_TICKERS } from "../data/ow-spritesheets";
import { CHARACTER_PRESETS, CHARACTER_LAYERS, CHARACTER_PARTS } from "../data/character-catalog";

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
          // Pipoya ready-made characters (96x128, same layout as hero) —
          // registration is lazy, images load only when someone wears one
          ...CHARACTER_PRESETS.map((c) => ({
            id: c.id,
            image: c.image,
            ...Presets.RMSpritesheet(3, 4),
          })),
          // Layered parts for "BUILD YOUR OWN" — same 96x128 geometry. A built
          // character is an array of these ids; RPG-JS stacks one sprite per
          // entry, so every part a player can wear must be registered here or
          // setGraphic silently renders nothing for that layer.
          ...CHARACTER_PARTS.flatMap((part) =>
            CHARACTER_LAYERS[part].map((c) => ({
              id: c.id,
              image: c.image,
              ...Presets.RMSpritesheet(3, 4),
            }))
          ),
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
