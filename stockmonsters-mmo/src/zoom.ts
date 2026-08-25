import { inject } from "@signe/di";
import { RpgClientEngine } from "@rpgjs/client";

// Client-side view polish, applied after startGame():
// - Pixel-art at 32px tiles is unreadably small at 1:1, and the client config
//   has no zoom option (checked dist/module.js) — so zoom the pixi-viewport
//   directly after each map load. 1.5x reads well without hiding too much.
// - During a map transfer the engine resets camera follow and scene data, so
//   for a few frames the camera sits at the map's (0,0) corner before the
//   player syncs in. A black cover over the transfer hides that flash.
export function applyAutoZoom(ctx: unknown) {
  const engine: any = inject(ctx as any, RpgClientEngine);
  if (!engine) return;
  const zoom = () => {
    const vp = engine.findViewportInstance?.();
    if (vp?.setZoom) vp.setZoom(1.5, true);
  };
  engine.mapLoadCompleted$?.subscribe?.((done: boolean) => {
    if (done) setTimeout(zoom, 50);
  });
  window.addEventListener("resize", zoom);

  // --- transfer cover ------------------------------------------------------
  const cover = document.createElement("div");
  cover.style.cssText =
    "position:fixed;inset:0;background:#000;z-index:900;pointer-events:none;" +
    "opacity:0;transition:opacity .25s ease";
  document.body.appendChild(cover);
  let raf = 0;
  const watch = () => {
    const inTransfer = !!engine.mapTransitionInProgress || !engine.sceneMap?.data?.();
    cover.style.opacity = inTransfer ? "1" : "0";
    raf = requestAnimationFrame(watch);
  };
  raf = requestAnimationFrame(watch);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
}
