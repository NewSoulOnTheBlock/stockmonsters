import { RpgClientEngine, WebSocketToken, KeyboardControls } from "@rpgjs/client";
import { inject } from "@signe/di";
import { applyAutoZoom } from "./zoom";
import { mountBattleScene } from "./battle-scene";
import { mountChatUi } from "./chat-ui";
import { mountHud, getHud } from "./hud";
import { mountCharacterDesigner } from "./character-designer";
import { mountMarketplace, openMarketplace } from "./marketplace";
import { closeCharacterDesigner, isCharacterDesignerOpen } from "./character-designer";
import { mountMapBrowser, openMapBrowser } from "./map-browser";
import { mountExitHints } from "./exit-hints";
import { mountDmUi } from "./dm-ui";
import { mountBoxShop, openBoxShop } from "./box-shop";
import { mountFriendsUi, getFriendsUi } from "./friends-ui";
import { mountWalletUi, openWallet } from "./wallet-ui";
import { mountDuelUi, openDuelOffer } from "./duel-ui";
import { mountSfx } from "./sfx";
import { mountTouchControls, mountMobileLayout } from "./touch-controls";

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
  // Sound first: it listens for the first interaction, which may be the click
  // that dismissed the title screen a moment ago.
  mountSfx();
  // A phone has no keyboard: a d-pad and two buttons that synthesise one.
  // No-op on anything with a real one.
  // Debug handle, like __engine: the only way to see from a headless browser
  // whether the engine has handed us its controls yet.
  const controlsNow = () => {
    // RPG-JS stores the instance on ITS OWN context, not the one we were
    // handed at boot: setKeyboardControls writes
    // `context.values['inject:KeyboardControls'].values.get('__default__')`
    // when the player's sprite mounts. `inject(ctx, ...)` returns null here —
    // verified in a headless browser — so read where it actually lives, and
    // keep inject as the fallback in case a later version moves it back.
    try {
      const engineCtx = (engine as any)?.context
      const slot = engineCtx?.values?.['inject:KeyboardControls']
      const direct = slot?.values?.get?.('__default__')
      if (direct) return direct
    } catch { /* fall through */ }
    try {
      return inject(ctx as any, KeyboardControls as any) as any
    } catch {
      return null
    }
  };
  (window as any).__controls = controlsNow;
  mountTouchControls(() => {
    // RPG-JS injects this when the player's sprite mounts, so it does not
    // exist at boot — look it up per press rather than capturing it once.
    return controlsNow()
  });

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

  socket.on("character:accepted", (payload: { layers?: unknown }) => {
    confirmed = true;
    // The server is authoritative, and on a clean device it knows a returning
    // player's look before the browser does. Repair localStorage so the title
    // screen stops treating them as a first-timer, and close the picker if it
    // was opened only because the browser had nothing.
    const layers = payload?.layers;
    if (!Array.isArray(layers) || !layers.length) return;
    const restored = JSON.stringify(layers);
    let hadNone = false;
    try {
      hadNone = !localStorage.getItem("sm-character");
      localStorage.setItem("sm-character", restored);
    } catch {}
    if (hadNone && isCharacterDesignerOpen()) {
      closeCharacterDesigner();
      window.dispatchEvent(new CustomEvent("sm:character-restored", { detail: layers }));
    }
  });
  // Close the socket before the page goes away.
  const bye = () => {
    try {
      socket.conn?.close?.();
    } catch {}
  };
  window.addEventListener("pagehide", bye);
  window.addEventListener("beforeunload", bye);
  // Quitting to the title. The server has already flushed the save by the time
  // this arrives; a full reload is the honest way back — it rebuilds the title
  // screen and drops the socket, so nothing from the old session lingers.
  // The engine samples input per frame and misses a very short Escape tap, so
  // the in-game menu could be unreachable by keyboard. Forward it ourselves
  // when nothing else owns the key; the server's own menu guard makes a
  // double-fire harmless.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (document.querySelector(".rpg-ui-dialog")) return;
    engine?.processAction?.("escape", {});
  });

  socket.on("game:quit", () => {
    try { sessionStorage.setItem("sm-returned-to-title", "1"); } catch {}
    location.reload();
  });

  mountBattleScene(socket);
  mountChatUi(engine, socket);
  mountHud(engine, socket);
  mountMarketplace(engine, socket);
  mountMapBrowser(engine, socket);
  mountExitHints(engine);
  mountBoxShop(engine, socket);
  mountDmUi(engine, socket);
  // The friends panel owns the left edge. It mounts collapsed, but its tab is
  // always visible: a friend request that only shows up in a panel you happen
  // to have open is a request that never arrives.
  mountFriendsUi(engine, socket);
  // Reads /token and replaces the HUD's invented ETH/SMON numbers with the
  // real ones — or removes those chips when this server has no currency.
  void mountWalletUi();
  // Duels: offered to whoever you are standing next to, escrowed on chain.
  mountDuelUi(engine, socket);

  // LAST, deliberately. Every panel injects its own stylesheet when it mounts,
  // and equal-specificity rules are won by whichever came later in the
  // document. Injected first, the phone layout was silently overruled by the
  // HUD — the media queries matched and did nothing.
  mountMobileLayout();

  // The title screen's NFT/settings buttons enter the world first and then ask
  // for a panel; the in-game window is the single owner of each.
  window.addEventListener("sm:duel", () => openDuelOffer());

  window.addEventListener("sm:open", (e) => {
    const what = (e as CustomEvent).detail;
    if (what === "marketplace") openMarketplace();
    if (what === "boxes") openBoxShop();
    // Without this GAME SETTINGS just dropped the player into the world and
    // did nothing else, which reads as a broken button.
    if (what === "settings") getHud()?.openSettings();
  });

  // The action bar only announced itself before — every button but MARKET did
  // nothing at all, which reads as a broken UI rather than an unbuilt one.
  // Team/Bag/Dex are server-side panels (they need the save), Map is the travel
  // menu, and anything genuinely unbuilt says so instead of staying silent.
  window.addEventListener("sm:hud-action", (e) => {
    const id = (e as CustomEvent).detail?.id;
    if (!id) return;
    if (id === "market") { openMarketplace(); return; }
    if (id === "map") { openMapBrowser(); return; }
    if (id === "boxes") { openBoxShop(); return; }
    if (id === "quit") { engine?.processAction?.("hud:quit", {}); return; }
    if (id === "friends") { getFriendsUi()?.toggle(); return; }
    if (id === "wallet") { openWallet(); return; }
    if (id === "duel") { openDuelOffer(); return; }
    if (id === "character") { window.dispatchEvent(new CustomEvent("sm:open-designer")); return; }
    engine?.processAction?.("hud:" + id, {});
  });
}
