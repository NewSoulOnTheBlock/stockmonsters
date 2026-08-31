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

const MAX_MS = 6000
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
   * Where the player was when the transfer began.
   *
   * This is the whole fix for "it throws me somewhere else the moment I move".
   * After a transfer the client is still holding the coordinates from the map
   * it just left, and those coordinates are perfectly STABLE — nothing moves
   * them until the server's spawn lands or the player presses a key. Waiting
   * for the position to stop changing therefore lifted the curtain instantly,
   * on a character standing in the wrong place, and the jump happened in full
   * view. Measured through the exterior door: the client reported (992,1030),
   * the position it held outside, while the server had put the player at
   * (912,1520) inside the hub.
   *
   * So the curtain waits for the position to become something ELSE first.
   */
  let leftFrom: string | null = null

  function show() {
    clearTimers()
    leftFrom = positionOf(engine)
    root.classList.remove('leaving')
    root.classList.add('on')
    // THE DEADLINE. Nothing below is allowed to keep the curtain up past it.
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
    const started = Date.now()
    const tick = () => {
      if (Date.now() - started > MAX_MS) { hide(); return }
      const now = positionOf(engine)
      // Still the old map's coordinates: the spawn has not landed yet.
      if (now !== null && now === leftFrom) { timers.push(setTimeout(tick, SETTLE_MS)); return }
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
        show()
        hideWhenSettled()
      }
      if (seen !== null) lastMap = seen
    } catch {
      /* the scene not being there yet is the normal state at boot */
    }
  }, 150)
}
