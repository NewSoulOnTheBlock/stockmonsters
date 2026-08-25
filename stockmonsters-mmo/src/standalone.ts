import { mergeConfig } from "@signe/di";
import { provideRpg, startGame } from "@rpgjs/client";
import startServer from "./server";
import configClient from "./config/config.client";
import { mountGameUi } from "./game-ui";

startGame(
  mergeConfig(configClient, {
    providers: [provideRpg(startServer)],
  })
).then((ctx) => {
  // The dev server boots THIS file, not client.ts — the UI has to be mounted
  // from both or `npm run dev` shows a bare map.
  let wallet: { address?: string; connectionId?: string } | null = null;
  try {
    wallet = JSON.parse(localStorage.getItem("sm-wallet") ?? "null");
  } catch {}
  mountGameUi(ctx, wallet);
  // dev-only introspection hook, used by the headless test scripts
  (window as any).__ctx = ctx;
});
