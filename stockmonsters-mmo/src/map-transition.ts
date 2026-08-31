/*
 * map-transition.ts — the curtain between two maps.
 *
 *   mountMapTransition(engine)
 *
 * ## What it is covering up, and why that is honest
 *
 * Walking through a door does two ugly things.
 *
 * The first is cosmetic: the canvas goes black while the new map's tilesets
 * and objects load. On a phone over a mobile connection that is a second or
 * more of a screen that looks like the game has died.
 *
 * The second is not cosmetic. The client draws the player before the server's
 * authoritative position for the new map has been applied, so for a moment the
 * character stands somewhere they are not — usually the position they held on
 * the old map — and only snaps to the doorway when the first input forces a
 * sync. Players read that as being "thrown somewhere random".
 *
 * Fixing the second properly means reaching into the engine's spawn ordering.
 * This does something narrower and more reliable: it holds the curtain until
 * the position has stopped changing, so the snap happens behind it. The jump
 * still occurs; nobody sees it, and the player arrives where they should be.
 *
 * ## The rule that matters
 *
 * A curtain that can get stuck is far worse than the black screen it replaced.
 * Every path out of here is timed: if the map never finishes loading, if the
 * player object never appears, if the position never settles — the curtain
 * lifts anyway and the player gets their game back.
 */

/*
 * The longest the curtain may ever stay up.
 *
 * Measured: the destination map is READY in 0.3–2.2 seconds, but the main
 * thread then freezes for up to 1.6s in a single block while it finishes, so a
 * timer set for N fires at N + up to 1.6s and the settle loop cannot run at
 * all. The deadline is therefore what actually ends most transfers, and every
 * second of it is a second of black screen on a map that is already there.
 *
 * Two seconds, because past that point showing a briefly frozen world beats
 * showing a loading screen — the player can see where they are.
 */
const MAX_MS = 2000
/** Two identical reads this far apart means the engine has stopped moving it. */
const SETTLE_MS = 120
const SETTLE_READS = 3

interface EngineLike {
  mapLoadCompleted$?: { subscribe?: (fn: (done: boolean) => void) => unknown }
  sceneMap?: unknown
}

const CSS = `
#sm-transit {
  position: fixed; inset: 0; z-index: 995;
  display: none; align-items: center; justify-content: center;
  background: #09070f;
  font-family: "Courier New", ui-monospace, monospace;
  color: #f6c177; letter-spacing: .22em; font-size: 13px;
  image-rendering: pixelated;
}
#sm-transit.on { display: flex; }
/* Fading OUT rather than in: the curtain must appear instantly to cover the
   black frame, and may leave at its leisure. */
#sm-transit.leaving { opacity: 0; transition: opacity .28s ease-out; }
#sm-transit .box { display: flex; flex-direction: column; align-items: center; gap: 14px; }
#sm-transit .dots { display: flex; gap: 8px; }
#sm-transit .dots i {
  width: 10px; height: 10px; background: #f6c177;
  animation: sm-transit-pulse 1s infinite ease-in-out;
}
#sm-transit .dots i:nth-child(2) { animation-delay: .15s; }
#sm-transit .dots i:nth-child(3) { animation-delay: .3s; }
@keyframes sm-transit-pulse { 0%, 100% { opacity: .25 } 50% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  #sm-transit .dots i { animation: none; opacity: .7 }
  #sm-transit.leaving { transition: none }
}
`

/** The player's position, or null while there is nobody to ask about. */
function positionOf(engine: EngineLike): string | null {
  try {
    const e = engine as any
    const scene = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
    const p = scene?.getCurrentPlayer?.()
    if (!p) return null
    const read = (v: unknown) => (typeof v === 'function' ? (v as () => number)() : v)
    const x = read(p.x)
    const y = read(p.y)
    if (typeof x !== 'number' || typeof y !== 'number') return null
    return `${Math.round(x)},${Math.round(y)}`
  } catch {
    return null
  }
}

export function mountMapTransition(engine?: EngineLike): void {
  if (typeof document === 'undefined' || !engine) return
  if (document.getElementById('sm-transit')) return

  const style = document.createElement('style')
  style.id = 'sm-transit-css'
  style.textContent = CSS
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'sm-transit'
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'polite')
  root.innerHTML =
    '<div class="box"><div class="dots"><i></i><i></i><i></i></div><span>TRAVELLING</span></div>'
  document.body.appendChild(root)

  let timers: Array<ReturnType<typeof setTimeout>> = []
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = [] }

  function hide() {
    clearTimers()
    if (!root.classList.contains('on')) return
    root.classList.add('leaving')
    timers.push(setTimeout(() => {
      root.classList.remove('on', 'leaving')
    }, 300))
  }

  /**
   * When the curtain went up for THIS transfer.
   *
   * The deadline is measured from here and is never extended. Both triggers —
   * the engine's own signal and the map-id watcher — used to call `show()`,
   * and every call re-armed the timeout, so a transfer whose second trigger
   * landed two seconds in got two more seconds of black. Measured: the map was
   * ready in 1.4s and the screen stayed dark for ten.
   */
  let shownAt = 0

  function show() {
    if (root.classList.contains('on')) return // already up; do not extend it
    clearTimers()
    shownAt = Date.now()
    root.classList.remove('leaving')
    root.classList.add('on')
    timers.push(setTimeout(hide, MAX_MS))
  }

  /**
   * Wait for the position to stop changing, then lift.
   *
   * Reading the same coordinates several times running is the signal that the
   * server's spawn has landed and the client has applied it — which is exactly
   * the moment after which nobody would see a jump.
   */
  function hideWhenSettled() {
    let last: string | null = null
    let stable = 0
    const tick = () => {
      // From when the curtain went up, not from when this chain started —
      // otherwise a second trigger restarts the clock.
      if (Date.now() - (shownAt || Date.now()) > MAX_MS) { hide(); return }
      const now = positionOf(engine)
      if (now && now === last) stable++
      else stable = 0
      last = now
      if (now && stable >= SETTLE_READS) { hide(); return }
      timers.push(setTimeout(tick, SETTLE_MS))
    }
    tick()
  }

  engine.mapLoadCompleted$?.subscribe?.((done: boolean) => {
    if (done) hideWhenSettled()
    else show()
  })

  /*
   * A second, independent trigger.
   *
   * `mapLoadCompleted$` is the engine's own signal and it is the right one —
   * but it is the only one, and if a version stops emitting `false` when a
   * load begins the curtain would never rise and the black frame would be back
   * with no way to notice. Watching the scene's map id costs one property read
   * every 150ms and covers that.
   */
  let lastMap: string | null = null
  setInterval(() => {
    try {
      const e = engine as any
      const scene = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
      const id = scene?.id ?? scene?.mapId ?? scene?.data?.id ?? null
      const seen = id == null ? null : String(id)
      if (seen !== null && lastMap !== null && seen !== lastMap) {
        /*
         * ONLY IF THE CURTAIN IS NOT ALREADY UP.
         *
         * `show()` re-arms the deadline, and this watcher fires when the map id
         * changes — which is a second or two INTO a transfer the subscription
         * already covered. Measured: the map was ready in 1.4–2.4s and the
         * black screen lasted 8.6–10s, because the deadline kept being pushed
         * out from here.
         */
        if (!root.classList.contains('on')) show()
        hideWhenSettled()
      }
      if (seen !== null) lastMap = seen
    } catch {
      /* the scene not being there yet is the normal state at boot */
    }
  }, 150)
}
