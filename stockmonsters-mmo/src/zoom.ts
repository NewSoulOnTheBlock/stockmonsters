import { inject } from "@signe/di";
import { RpgClientEngine } from "@rpgjs/client";

// Pixel-art at 32px tiles is unreadably small at 1:1 on desktop screens.
// There is no zoom option in the client config (checked dist/module.js), so
// zoom the pixi-viewport directly after each map load. 1.5x reads well
// without hiding too much of the map (2x felt too close).
export function applyAutoZoom(ctx: unknown) {
  const engine: any = inject(ctx as any, RpgClientEngine);
  if (!engine) return;
  const zoom = () => {
    const vp = engine.findViewportInstance?.();
    if (vp?.setZoom) vp.setZoom(1.5, true);
  };
  engine.mapLoadCompleted$?.subscribe?.((done: boolean) => { if (done) setTimeout(zoom, 50); });
  window.addEventListener("resize", zoom);
}
