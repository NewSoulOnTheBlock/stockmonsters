import { startGame, provideMmorpg } from "@rpgjs/client";
import configClient from "./config/config.client";
import { mergeConfig } from "@signe/di";
import { applyAutoZoom } from "./zoom";

// A connected wallet becomes the stable game identity: its address feeds the
// room connectionId, so saves key by wallet across devices. The signature
// stored next to it is verified server-side in the wallet stage's remaining
// glue (see HANDOVER) — until then this is identity, not yet proof.
let wallet: { address?: string } | null = null;
try {
  wallet = JSON.parse(localStorage.getItem("sm-wallet") ?? "null");
} catch {}

startGame(
  mergeConfig(configClient, {
    providers: [
      provideMmorpg(
        wallet?.address ? { connectionId: "wallet:" + wallet.address.toLowerCase() } : {},
      ),
    ],
  })
).then(applyAutoZoom);
