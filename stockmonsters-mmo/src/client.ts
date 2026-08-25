import { startGame, provideMmorpg, RpgClientEngine, WebSocketToken } from "@rpgjs/client";
import configClient from "./config/config.client";
import { mergeConfig, inject } from "@signe/di";
import { applyAutoZoom } from "./zoom";
import { mountBattleScene } from "./battle-scene";
import { mountChatUi } from "./chat-ui";
import { mountHud } from "./hud";
import { mountCharacterDesigner } from "./character-designer";
import { mountMarketplace, openMarketplace } from "./marketplace";

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
      // (see 'auth:wallet' below) instead of as the transport id.
      provideMmorpg({ connectionIdScope: "ephemeral" as const }),
    ],
  })
).then((ctx) => {
  applyAutoZoom(ctx);

  // "Create Your Character" seam: the picker lives in index.html (pure DOM,
  // like the title curtain) and the game boots independently at module load,
  // so a CustomEvent is the bridge. The server validates ids against its
  // whitelist and persists them per wallet ('CHARACTER' variable).
  const engine: any = inject(ctx as any, RpgClientEngine);
  // Debug handle: the only way to inspect live player/graphic state from a
  // headless browser test. Harmless in production, invaluable when a sprite
  // shows up wrong.
  (window as any).__engine = engine;
  // Applying the chosen character is not fire-and-forget: an action sent
  // before the room is joined is dropped with no error, which is why a
  // reloaded page used to come back as the default hero. So we keep sending
  // until the server acknowledges, and re-apply after every map load.
  let desired: string[] | null = null;
  let confirmed = false;
  const push = () => {
    if (!desired || confirmed) return;
    engine?.processAction?.("character:set", { layers: desired });
  };
  const setCharacter = (ids: unknown) => {
    if (!Array.isArray(ids) || !ids.length) return;
    desired = ids as string[];
    confirmed = false;
    push();
  };

  // Announce the wallet identity, if the server verified one earlier.
  if (wallet?.connectionId) {
    const claim = () => engine?.processAction?.("auth:wallet", {
      id: wallet!.connectionId, address: wallet!.address,
    });
    claim();
    setTimeout(claim, 900); // once more after the room is certainly joined
  }

  try {
    setCharacter(JSON.parse(localStorage.getItem("sm-character") ?? "null"));
  } catch {}
  window.addEventListener("sm:character", (e) => setCharacter((e as CustomEvent).detail));

  // retry until acknowledged, then stop
  const retry = setInterval(() => {
    if (confirmed || !desired) return;
    push();
  }, 700);
  window.addEventListener("beforeunload", () => clearInterval(retry));

  engine?.mapLoadCompleted$?.subscribe?.((done: boolean) => {
    // A map change re-creates the player object server-side, so re-assert.
    if (done && desired) { confirmed = false; setTimeout(push, 150); }
  });

  // Battle visual scene: server pushes battle:state / battle:end over the
  // custom-event socket channel; the overlay renders them.
  try {
    const socket: any = inject(ctx as any, WebSocketToken as any);
    if (socket?.on) {
      socket.on("character:accepted", () => { confirmed = true; });
      // Close the socket before the page goes away. Reusing a connectionId
      // whose previous session is still open server-side leaves the new
      // connection able to RECEIVE state but unable to SEND actions — the
      // player renders, and then nothing they do reaches the server.
      const bye = () => { try { socket.conn?.close?.() } catch {} };
      window.addEventListener("pagehide", bye);
      window.addEventListener("beforeunload", bye);
      mountBattleScene(socket);
      mountChatUi(engine, socket);
      mountHud(engine, socket);
      mountCharacterDesigner(engine);
      mountMarketplace(engine, socket);
      // The title screen's NFT/settings buttons enter the world first and then
      // ask for a panel; the in-game window is the single owner of each.
      window.addEventListener("sm:open", (e) => {
        if ((e as CustomEvent).detail === "marketplace") openMarketplace();
      });
    }
  } catch {}
});
