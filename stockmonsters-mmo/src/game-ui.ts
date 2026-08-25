import { RpgClientEngine, WebSocketToken } from "@rpgjs/client";
import { inject } from "@signe/di";
import { applyAutoZoom } from "./zoom";
import { mountBattleScene } from "./battle-scene";
import { mountChatUi } from "./chat-ui";
import { mountHud } from "./hud";
import { mountCharacterDesigner } from "./character-designer";
import { mountMarketplace, openMarketplace } from "./marketplace";

/*
 * Everything the player sees on top of the map: zoom, HUD, chat, battle scene,
 * character designer, marketplace, and the plumbing that applies a chosen
 * character.
 *
 * This lives in its own module because THERE ARE TWO ENTRY POINTS and they are
 * easy to forget: `src/client.ts` is the real MMO client, but the vite dev
 * server boots `src/standalone.ts` instead (server and client in one page).
 * Wiring the UI into only one of them means `npm run dev` shows a bare map with
 * no HUD and no chat, which is exactly what happened. Both entries call this.
 */

export function mountGameUi(ctx: unknown, wallet?: { address?: string; connectionId?: string } | null) {
  applyAutoZoom(ctx);

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
    const claim = () =>
      engine?.processAction?.("auth:wallet", { id: wallet.connectionId, address: wallet.address });
    claim();
    setTimeout(claim, 900); // once more after the room is certainly joined
  }

  try {
    setCharacter(JSON.parse(localStorage.getItem("sm-character") ?? "null"));
  } catch {}
  window.addEventListener("sm:character", (e) => setCharacter((e as CustomEvent).detail));

  const retry = setInterval(() => {
    if (confirmed || !desired) return;
    push();
  }, 700);
  window.addEventListener("beforeunload", () => clearInterval(retry));

  engine?.mapLoadCompleted$?.subscribe?.((done: boolean) => {
    // A map change re-creates the player object server-side, so re-assert.
    if (done && desired) {
      confirmed = false;
      setTimeout(push, 150);
    }
  });

  // The designer only needs the engine, and it must mount even if the socket
  // is missing — otherwise the title screen falls back to the old grid.
  mountCharacterDesigner(engine);

  // In standalone/dev mode the server runs in the page and there may be no
  // websocket token to inject. The panels are still worth showing, so fall back
  // to a socket that simply never delivers anything.
  let socket: any = null;
  try {
    socket = inject(ctx as any, WebSocketToken as any);
  } catch {}
  if (!socket?.on) socket = { on: () => {}, emit: () => {} };

  socket.on("character:accepted", () => {
    confirmed = true;
  });
  // Close the socket before the page goes away.
  const bye = () => {
    try {
      socket.conn?.close?.();
    } catch {}
  };
  window.addEventListener("pagehide", bye);
  window.addEventListener("beforeunload", bye);
  mountBattleScene(socket);
  mountChatUi(engine, socket);
  mountHud(engine, socket);
  mountMarketplace(engine, socket);

  // The title screen's NFT/settings buttons enter the world first and then ask
  // for a panel; the in-game window is the single owner of each.
  window.addEventListener("sm:open", (e) => {
    if ((e as CustomEvent).detail === "marketplace") openMarketplace();
  });

  // The action bar only announced itself before — every button but MARKET did
  // nothing at all, which reads as a broken UI rather than an unbuilt one.
  // Team/Bag/Dex are server-side panels (they need the save), Map is the travel
  // menu, and anything genuinely unbuilt says so instead of staying silent.
  window.addEventListener("sm:hud-action", (e) => {
    const id = (e as CustomEvent).detail?.id;
    if (!id) return;
    if (id === "market") { openMarketplace(); return; }
    if (id === "character") { window.dispatchEvent(new CustomEvent("sm:open-designer")); return; }
    engine?.processAction?.("hud:" + id, {});
  });
}
