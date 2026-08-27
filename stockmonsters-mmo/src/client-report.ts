/*
 * client-report.ts — make a failure on somebody else's phone visible here.
 *
 *   mountClientReport()
 *
 * ## Why this exists
 *
 * A player reported the screen going white on iOS after a few seconds. Nothing
 * in the server log said anything, because nothing that goes wrong in a
 * browser reaches a server unless it is sent — so the report was all there was
 * to work with, and an emulated phone on a desktop could not reproduce it.
 * This turns the next occurrence into a line in the journal with a reason.
 *
 * ## The WebGL part is a fix, not just instrumentation
 *
 * iOS Safari drops a page's WebGL context aggressively — on memory pressure,
 * on backgrounding, sometimes on nothing obvious. The browser will hand it
 * back and fire `webglcontextrestored`, but ONLY if something called
 * `preventDefault()` on the loss event. Nothing did. So a dropped context was
 * permanent, and a permanently dead canvas under a live HUD is exactly what a
 * white screen looks like.
 *
 * ## What it does not do
 *
 * It does not send anything about the player: no address, no name, no wallet.
 * A message, a source line and a counter. And it is capped hard — a render
 * loop that throws every frame must not turn into a denial of service against
 * our own server.
 */

const ENDPOINT = '/client-error'
/** A broken frame loop can throw sixty times a second. Send almost none of it. */
const MAX_REPORTS = 12
const MIN_GAP_MS = 3000

let sent = 0
let lastAt = 0
const seen = new Set<string>()

function report(kind: string, detail: Record<string, unknown>): void {
  // The same message repeating is one fault, not a hundred.
  const key = kind + ':' + String(detail.message ?? '')
  if (seen.has(key)) return
  const now = Date.now()
  if (sent >= MAX_REPORTS || now - lastAt < MIN_GAP_MS) return
  seen.add(key)
  sent++
  lastAt = now
  try {
    const body = JSON.stringify({
      kind,
      ...detail,
      ua: navigator.userAgent.slice(0, 180),
      screen: `${window.innerWidth}x${window.innerHeight}`,
      up: Math.round(performance.now() / 1000),
    })
    // sendBeacon survives the page being torn down, which is the exact moment
    // the interesting reports happen. fetch is the fallback for Safari
    // versions that refuse a JSON beacon.
    const blob = new Blob([body], { type: 'application/json' })
    if (!navigator.sendBeacon?.(ENDPOINT, blob)) {
      void fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
    }
  } catch {
    /* reporting an error must never itself throw */
  }
}

/*
 * If the context never comes back, the player is left looking at a white
 * rectangle with the HUD still floating on it — which is indistinguishable
 * from the game having crashed, and gives them nothing to do. This says what
 * happened and offers the one thing that fixes it.
 */
const LOST_CSS = `
#sm-gpu-notice {
  position: fixed; inset: 0; z-index: 1100;
  display: none; align-items: center; justify-content: center;
  background: rgba(9,7,15,.92);
  font-family: "Courier New", ui-monospace, monospace; color: #fff1c7;
  padding: 24px; text-align: center;
}
body.sm-gpu-lost #sm-gpu-notice { display: flex; }
#sm-gpu-notice .box {
  max-width: 420px; display: flex; flex-direction: column; gap: 14px;
  background: #26213a; border: 3px solid #f6c177; box-shadow: 6px 6px 0 #09070f;
  padding: 20px; font-size: 13px; line-height: 1.6;
}
#sm-gpu-notice b { color: #f6c177; letter-spacing: .1em; }
#sm-gpu-notice button {
  font: inherit; font-weight: 700; letter-spacing: .08em;
  padding: 12px; min-height: 44px; cursor: pointer;
  color: #09070f; background: #7ecf6b;
  border: 3px solid #f6c177; border-radius: 0; box-shadow: 3px 3px 0 #09070f;
}
`

function ensureNotice(): void {
  if (document.getElementById('sm-gpu-notice')) return
  const style = document.createElement('style')
  style.textContent = LOST_CSS
  document.head.appendChild(style)
  const root = document.createElement('div')
  root.id = 'sm-gpu-notice'
  root.innerHTML =
    '<div class="box"><b>THE GRAPHICS STOPPED</b>' +
    '<span>Your browser took the game\'s graphics away — usually because the ' +
    'phone needed the memory. Nothing is lost: your character, party and boxes ' +
    'live on the server.</span>' +
    '<button type="button">RELOAD</button></div>'
  root.querySelector('button')?.addEventListener('click', () => location.reload())
  document.body.appendChild(root)
}

/** Find the game canvas, whenever it turns up — it does not exist at boot. */
function whenCanvas(fn: (c: HTMLCanvasElement) => void): void {
  let tries = 0
  const look = () => {
    const c = document.querySelector('canvas')
    if (c) { fn(c as HTMLCanvasElement); return }
    if (++tries > 120) return
    setTimeout(look, 500)
  }
  look()
}

export function mountClientReport(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (e) => {
    report('error', {
      message: String(e.message ?? '').slice(0, 300),
      at: `${String(e.filename ?? '').split('/').pop()}:${e.lineno}`,
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = (e as PromiseRejectionEvent).reason
    report('rejection', { message: String(r?.message ?? r ?? '').slice(0, 300) })
  })

  whenCanvas((canvas) => {
    canvas.addEventListener('webglcontextlost', (e) => {
      // THIS LINE IS THE FIX. Without it the browser never offers the context
      // back and the canvas stays blank for the rest of the session.
      e.preventDefault()
      report('webgl-lost', { message: 'the GPU context was taken away' })
      ensureNotice()
      document.body.classList.add('sm-gpu-lost')
    }, false)

    canvas.addEventListener('webglcontextrestored', () => {
      report('webgl-restored', { message: 'the GPU context came back' })
      document.body.classList.remove('sm-gpu-lost')
      /*
       * A restored context is an EMPTY one: every texture the renderer
       * uploaded is gone, and the engine does not re-upload them. Reloading is
       * blunt, but the alternative is a canvas that is technically alive and
       * draws nothing — which is indistinguishable from the bug we are fixing.
       * The player keeps everything: the world is on the server.
       */
      setTimeout(() => location.reload(), 400)
    }, false)
  })
}
