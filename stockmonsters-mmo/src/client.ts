import { startGame, provideMmorpg } from "@rpgjs/client";
import configClient from "./config/config.client";
import { mergeConfig } from "@signe/di";
import { mountGameUi } from "./game-ui";

// A verified wallet becomes the stable game identity. The connectionId is
// NOT the address: the server derives it from the address with a secret only
// it holds, after checking a nonce-bound signature (auth.mjs). So a client
// cannot claim another player's save by naming their address.
let wallet: { address?: string; connectionId?: string } | null = null;
try {
  wallet = JSON.parse(localStorage.getItem("sm-wallet") ?? "null");
} catch {}

startGame(
  mergeConfig(configClient, {
    providers: [
      // ALWAYS a fresh connection id. RPG-JS defaults to storing one in
      // localStorage and reusing it, and reconnecting with an id the server
      // has seen leaves the new socket able to RECEIVE state but unable to
      // SEND anything: the player renders and then arrow keys, chat and
      // character changes all silently do nothing. Verified with a headless
      // browser — ephemeral ids fix it completely.
      // The wallet is still the player's identity; it just travels as a claim
      // ('auth:wallet') instead of as the transport id.
      provideMmorpg({ connectionIdScope: "ephemeral" as const }),
    ],
  })
).then((ctx) => mountGameUi(ctx, wallet));
