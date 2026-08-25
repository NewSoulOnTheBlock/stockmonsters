import { startGame, provideMmorpg } from "@rpgjs/client";
import configClient from "./config/config.client";
import { mergeConfig } from "@signe/di";
import { applyAutoZoom } from "./zoom";

startGame(
  mergeConfig(configClient, {
    providers: [provideMmorpg({})],
  })
).then(applyAutoZoom);
