import { startGame, provideMmorpg, RpgClientEngine, WebSocketToken } from "@rpgjs/client";
import configClient from "./config/config.client";
import { mergeConfig, inject } from "@signe/di";
import { applyAutoZoom } from "./zoom";
import { mountBattleScene } from "./battle-scene";

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
      provideMmorpg(wallet?.connectionId ? { connectionId: wallet.connectionId } : {}),
    ],
  })
).then((ctx) => {
  applyAutoZoom(ctx);

  // "Create Your Character" seam: the picker lives in index.html (pure DOM,
  // like the title curtain) and the game boots independently at module load,
  // so a CustomEvent is the bridge. The server validates ids against its
  // whitelist and persists them per wallet ('CHARACTER' variable).
  const engine: any = inject(ctx as any, RpgClientEngine);
  let pending: string[] | null = null;
  const send = (ids: unknown) => {
    if (!Array.isArray(ids) || !ids.length) return;
    pending = ids as string[];
    engine?.processAction?.("character:set", { layers: ids });
  };
  try {
    send(JSON.parse(localStorage.getItem("sm-character") ?? "null"));
  } catch {}
  window.addEventListener("sm:character", (e) => send((e as CustomEvent).detail));
  // processAction is silently dropped while the player can't act (e.g. before
  // the first map is up) — re-send the last choice after each map load.
  engine?.mapLoadCompleted$?.subscribe?.((done: boolean) => {
    if (done && pending) setTimeout(() => engine.processAction("character:set", { layers: pending }), 100);
  });

  // Battle visual scene: server pushes battle:state / battle:end over the
  // custom-event socket channel; the overlay renders them.
  try {
    const socket: any = inject(ctx as any, WebSocketToken as any);
    if (socket?.on) mountBattleScene(socket);
  } catch {}
});
