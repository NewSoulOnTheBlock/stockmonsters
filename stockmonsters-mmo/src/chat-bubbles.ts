/*
 * chat-bubbles.ts — what a player says, over their head, in the world.
 *
 *   mountChatBubbles(engine, socket)
 *
 * The chat panel (chat-ui.ts) is a log in the corner; nobody watches it while
 * they walk. So the same message also appears as a bubble above the sprite of
 * whoever said it, for every client that can see them.
 *
 * IT IS THE SAME EVENT. `chat:message` already round-trips through the server
 * to everyone, and the server now stamps it with the sender's player id
 * (modules/main/chat.ts). This module renders that; chat-ui.ts is untouched and
 * still logs it. One channel, two views.
 *
 * WHY DOM AND NOT AN ENGINE COMPONENT. The nameplate is a server-side
 * `setComponentsTop(Components.text('{name}'))`, which the engine lays out as
 * flat rows of pixi text — there is no way to put a panel BEHIND the text, so a
 * bubble drawn that way would be bare letters on top of the map, unreadable
 * over the bright water and the pale ship both. The HUD's own idiom (dark
 * panel, gold border, hard shadow) is DOM, so this is DOM too.
 *
 * HOW IT STAYS ON THE CHARACTER. Nothing is ever attached to a sprite node —
 * the engine rebuilds the character element every few seconds while walking and
 * anything hung off it disappears with it (HANDOVER). Instead, every frame,
 * the sender's position is read from the scene's player record and projected
 * through the pixi-viewport:
 *
 *     world (x + centerX, y + top - LIFT)  --viewport.toScreen-->  canvas px
 *
 * which is the same transform the engine uses for its own pointer maths
 * (RpgClientEngine.setupPointerTracking, in reverse). `x`/`y` are SIGNALS, so
 * they are called, never read (HANDOVER: `Number(player.x)` is NaN); and the
 * sprite's rendered position is these exact values — the client's smoothing
 * signals are configured with duration 0, so there is nothing to lag behind.
 *
 * Measured in a headless browser before any of this was written: for a player
 * at world (784, 2020) the projection of (x+16, y) landed on the top of the
 * character's head at screen (574, 400), and the origin (x, y) did not.
 */

/** Signals are functions, plain values are not. Read either, never throw. */
const sig = <T>(v: unknown): T | undefined => {
  try {
    return (typeof v === 'function' ? (v as () => T)() : v) as T
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------ the text ---*/

/**
 * A bubble is a glance, not a document.
 *
 * The server already caps chat at 140 characters, but 140 characters over a
 * 32px tile is a wall of text that hides the map and whoever is standing
 * behind it. Anything longer than this is cut with an ellipsis — the whole
 * line is still in the chat log, which is where a long message belongs.
 */
export const BUBBLE_MAX_CHARS = 80

export function bubbleText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // Newlines and runs of spaces would stretch the box for nothing.
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length <= BUBBLE_MAX_CHARS) return text
  return text.slice(0, BUBBLE_MAX_CHARS - 1).trimEnd() + '…'
}

/*
 * HOW LONG IT STAYS.
 *
 * Long enough to be read, short enough that a busy dock is not a wall of
 * boxes. A short line is mostly "notice that someone spoke and look up", which
 * is the fixed part; the rest scales with length at roughly 18 characters a
 * second, a comfortable glance-reading pace for a line you did not choose to
 * read. The cap stops a 140-character message from parking a box on the map
 * for ten seconds: past that, the chat log is the place for it.
 */
export const BUBBLE_MIN_MS = 2500
export const BUBBLE_MS_PER_CHAR = 55
export const BUBBLE_MAX_MS = 7000
/** The tail of the lifetime spent fading out (matches the CSS transition). */
export const BUBBLE_FADE_MS = 400

export function bubbleMs(text: string): number {
  const len = typeof text === 'string' ? text.length : 0
  return Math.min(BUBBLE_MAX_MS, BUBBLE_MIN_MS + len * BUBBLE_MS_PER_CHAR)
}

/* ---------------------------------------------------------- the drawing ---*/

/**
 * How far above the top of the character the bubble's tail sits, in WORLD
 * pixels — so it scales with the camera zoom exactly like the sprite and the
 * nameplate do. The nameplate is 14px tall with a 6px margin in world units,
 * so 24 clears it with a little air.
 */
const LIFT_WORLD = 24

const css = `
#sm-bubbles {
  position: fixed; inset: 0; z-index: 680;
  /* Never in the way: the map underneath must stay clickable, and the bubble
     must not eat a click meant for a door or an NPC. */
  pointer-events: none;
  font-family: "Courier New", ui-monospace, monospace;
  image-rendering: pixelated;
}
#sm-bubbles .bub {
  position: absolute; left: 0; top: 0;
  max-width: 210px;
  padding: 5px 8px;
  /* The HUD's panel: dark ground, gold border, hard shadow. Opaque enough to
     read over bright water and pale stone, which plain outlined text is not. */
  background: rgba(38,33,58,.92);
  border: 3px solid #f6c177;
  box-shadow: 3px 3px 0 #09070f;
  color: #fff1c7;
  font-size: 12px; font-weight: 700; line-height: 1.35;
  text-align: center;
  /* A long word (an address, a mashed keyboard) must break rather than push
     the box across the screen. */
  white-space: normal; overflow-wrap: anywhere; word-break: break-word;
  opacity: 0;
  transition: opacity .18s ease;
}
#sm-bubbles .bub.in { opacity: 1; }
#sm-bubbles .bub.out { opacity: 0; transition: opacity ${BUBBLE_FADE_MS}ms ease; }
/* The tail, drawn as two stacked blocks so it stays pixel-crisp at any size. */
#sm-bubbles .bub::after {
  content: ''; position: absolute; left: 50%; bottom: -10px;
  width: 14px; height: 7px; margin-left: -7px;
  background: rgba(38,33,58,.92);
  border-left: 3px solid #f6c177; border-right: 3px solid #f6c177;
  border-bottom: 3px solid #f6c177;
}
@media (max-width: 640px) {
  /* A phone screen is mostly map; a narrower box leaves more of it. */
  #sm-bubbles .bub { max-width: 150px; font-size: 11px; }
}
`

interface EngineLike {
  sceneMap?: unknown
  findViewportInstance?: () => any
  mapTransitionInProgress?: unknown
  renderer?: any
  canvasApp?: any
}
interface SocketLike {
  on?: (type: string, cb: (data: any) => void) => void
}

interface Bubble {
  el: HTMLElement
  /** When it should be gone, ms since epoch. */
  until: number
  /** When the fade-out class goes on. */
  fadeAt: number
  faded: boolean
}

export interface ChatBubblesApi {
  /** Show (or replace) a bubble over one player. Exposed for tests and e2e. */
  say(id: string, text: string): void
  /** How many are on screen right now. */
  count(): number
  destroy(): void
}

export function mountChatBubbles(engine: EngineLike, socket: SocketLike): ChatBubblesApi {
  const style = document.createElement('style')
  style.id = 'sm-bubbles-css'
  style.textContent = css
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'sm-bubbles'
  document.body.appendChild(root)

  const bubbles = new Map<string, Bubble>()
  let raf = 0
  let canvas: HTMLCanvasElement | null = null

  const gameCanvas = (): HTMLCanvasElement | null => {
    // The engine's own canvas, not just any canvas on the page. Re-looked-up
    // when it goes away, because the renderer is rebuilt on a hard scene reset.
    if (canvas?.isConnected) return canvas
    canvas =
      (engine as any)?.renderer?.canvas ??
      (engine as any)?.canvasApp?.canvas ??
      (document.querySelector('canvas') as HTMLCanvasElement | null)
    return canvas
  }

  const scene = (): any => {
    try {
      const s: any = (engine as any)?.sceneMap
      return typeof s === 'function' ? s() : s
    } catch {
      return null
    }
  }

  /** Screen position (CSS px) for the tail of this player's bubble, or null. */
  function anchorOf(id: string): { x: number; y: number } | null {
    const s = scene()
    const player = s?.players?.()?.[id]
    if (!player) return null
    const x = sig<number>(player.x)
    const y = sig<number>(player.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    // The engine keeps the sprite's drawn extent here for exactly this kind of
    // thing ("transient sprite effects such as damage popups"); it is missing
    // for the frames in which the character element is being rebuilt, and a
    // 32x32 tile is the right guess in the meantime.
    const bounds = sig<any>(player.__rpgjsGraphicBounds)
    const centerX = Number.isFinite(bounds?.centerX) ? bounds.centerX : 16
    const top = Number.isFinite(bounds?.top) ? bounds.top : 0

    const viewport = (engine as any)?.findViewportInstance?.()
    if (!viewport?.toScreen) return null
    const point = viewport.toScreen(x! + centerX, y! + top - LIFT_WORLD)
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null

    const el = gameCanvas()
    const rect = el?.getBoundingClientRect()
    // The engine treats canvas CSS pixels and renderer pixels as the same
    // thing for pointer input, so this does too — verified: an 1100x800
    // viewport gave a canvas of exactly 1100x800.
    return { x: (rect?.left ?? 0) + point.x, y: (rect?.top ?? 0) + point.y }
  }

  /** The map is being swapped: the world under the bubbles is not there. */
  const worldHidden = (): boolean => {
    try {
      const s = scene()
      return !!(engine as any)?.mapTransitionInProgress || !s?.data?.()
    } catch {
      return false
    }
  }

  function drop(id: string) {
    const bubble = bubbles.get(id)
    if (!bubble) return
    bubble.el.remove()
    bubbles.delete(id)
    if (!bubbles.size && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }

  function frame() {
    raf = 0
    const now = Date.now()
    const hidden = worldHidden()
    for (const [id, bubble] of [...bubbles]) {
      if (now >= bubble.until) {
        drop(id)
        continue
      }
      if (!bubble.faded && now >= bubble.fadeAt) {
        bubble.faded = true
        bubble.el.classList.remove('in')
        bubble.el.classList.add('out')
      }
      const at = hidden ? null : anchorOf(id)
      if (!at) {
        // Off this map, or between maps: keep the timer running (the message
        // is no fresher for being invisible) and simply do not draw it.
        bubble.el.style.visibility = 'hidden'
        continue
      }
      bubble.el.style.visibility = 'visible'
      // translate(-50%,-100%) LAST so the box is centred on the anchor and
      // sits above it; transforms apply right to left.
      bubble.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -100%)`
    }
    if (bubbles.size) raf = requestAnimationFrame(frame)
  }

  function say(id: string, raw: string) {
    const text = bubbleText(raw)
    if (!id || !text) return
    const life = bubbleMs(text)
    const now = Date.now()

    // ONE BUBBLE PER PLAYER. Somebody typing three lines in three seconds must
    // replace their own bubble, not build a tower of them: the element is
    // reused, so the box moves nowhere and only its words change.
    let bubble = bubbles.get(id)
    if (!bubble) {
      const el = document.createElement('div')
      el.className = 'bub'
      el.style.visibility = 'hidden'
      el.dataset.player = id
      root.appendChild(el)
      bubble = { el, until: 0, fadeAt: 0, faded: false }
      bubbles.set(id, bubble)
    }
    bubble.el.textContent = text
    bubble.el.classList.remove('out')
    bubble.el.classList.add('in')
    bubble.faded = false
    bubble.until = now + life
    bubble.fadeAt = now + Math.max(0, life - BUBBLE_FADE_MS)
    if (!raf) raf = requestAnimationFrame(frame)
  }

  socket?.on?.('chat:message', (d: { id?: unknown; text?: unknown; system?: boolean }) => {
    // System lines belong to nobody, so there is no head to put them over.
    if (!d || d.system) return
    if (typeof d.id !== 'string' || typeof d.text !== 'string') return
    say(d.id, d.text)
  })

  const destroy = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    bubbles.clear()
    root.remove()
    style.remove()
  }
  window.addEventListener('beforeunload', destroy)

  const api: ChatBubblesApi = { say, count: () => bubbles.size, destroy }
  // Debug handle, like __engine: the only way for a headless browser to prove
  // the renderer works independently of the socket.
  ;(window as any).__bubbles = api
  return api
}
