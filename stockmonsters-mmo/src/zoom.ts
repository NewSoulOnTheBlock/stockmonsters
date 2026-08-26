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
  // The cover cannot lift the moment the map exists: the engine re-arms camera
  // follow a few frames later, so the player sees a corner of the new map that
  // only snaps into place once they move. Hold the cover until the local player
  // has a real position, put the camera on them, and only then reveal. One good
  // frame is not enough — the position arrives before it is stable.
  let raf = 0;
  let settled = 0;
  const REVEAL_AFTER_FRAMES = 3;
  const centreOnPlayer = (): boolean => {
    const p = engine.sceneMap?.getCurrentPlayer?.();
    const read = (v: unknown) => (typeof v === "function" ? (v as () => number)() : (v as number));
    const x = read(p?.x);
    const y = read(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return false;
    engine.findViewportInstance?.()?.moveCenter?.(x, y);
    return true;
  };
  const watch = () => {
    const loading = !!engine.mapTransitionInProgress || !engine.sceneMap?.data?.();
    if (loading) {
      settled = 0;
      cover.style.opacity = "1";
    } else if (settled < REVEAL_AFTER_FRAMES) {
      // Only nudge the camera while the cover is up; doing it every frame
      // forever would fight the engine's own follow behaviour.
      settled = centreOnPlayer() ? settled + 1 : 0;
      cover.style.opacity = settled >= REVEAL_AFTER_FRAMES ? "0" : "1";
    } else {
      cover.style.opacity = "0";
    }
    raf = requestAnimationFrame(watch);
  };
  raf = requestAnimationFrame(watch);
  window.addEventListener("beforeunload", () => cancelAnimationFrame(raf));
}
