import { mergeConfig } from "@signe/di";
import { provideRpg, startGame } from "@rpgjs/client";
import startServer from "./server";
import configClient from "./config/config.client";
import { applyAutoZoom } from "./zoom";

startGame(
  mergeConfig(configClient, {
    providers: [provideRpg(startServer)],
  })
).then((ctx) => {
  applyAutoZoom(ctx);
  // dev-only introspection hook, used by the headless test scripts
  (window as any).__ctx = ctx;
});
