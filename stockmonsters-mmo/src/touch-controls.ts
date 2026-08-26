/*
 * touch-controls.ts — playing without a keyboard.
 *
 *   mountTouchControls()   // no-op on a device with a real keyboard
 *
 * ┌──────────────────────────────────────────────┐
 * │                                              │
 * │                                    ( B )     │
 * │      ▲                                       │
 * │   ◀  ●  ▶                        ( A )       │
 * │      ▼                                       │
 * └──────────────────────────────────────────────┘
 *
 * ## How a thumb becomes a held key
 *
 * TWO PATHS, because they reach two different listeners:
 *
 * 1. **The engine** gets `controls.applyControl('left', true/false)` — its own
 *    API, injected by RPG-JS when the player's sprite mounts. Synthesised
 *    `keydown` events do NOT work here: I tried, and the character did not
 *    move a pixel. The engine binds its controls to the canvas directive, not
 *    to the window.
 * 2. **Our own UI** gets a synthetic `keydown`/`keyup` on window and document,
 *    which is what chat's Enter, the DM window's Space and the escape stack
 *    listen for. Those are ordinary DOM handlers and are perfectly happy with
 *    a synthetic event.
 *
 * Doing only the first would leave B unable to open the menu; only the second
 * would leave the d-pad dead. Both, and the whole game answers a thumb.
 *
 * ## Two things it is careful about
 *
 * **It never fires while you are typing.** A d-pad under a focused text field
 * would make the character wander while someone writes a message.
 *
 * **It releases on loss.** `pointercancel`, `pointerleave`, a backgrounded tab
 * — every one of them sends the keyup. A key left down because a browser ate
 * the release means a character walking into a wall forever.
 */

import { injectStyle, el } from './ui-kit'
import { play as sfx } from './sfx'

/** Only mount where there is no keyboard to speak of. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0
    )
  } catch {
    return false
  }
}

const CSS = `
#sm-touch {
  position: fixed; inset: auto 0 0 0; height: 46vh; max-height: 300px;
  z-index: 760; pointer-events: none;
  display: none;
  /* Sits above the action bar's own safe area on a notched phone. */
  padding: 0 14px calc(10px + env(safe-area-inset-bottom, 0px));
}
#sm-touch.on { display: block; }
#sm-touch .pad {
  position: absolute; left: 14px; bottom: 96px;
  width: 168px; height: 168px;
  pointer-events: auto;
  touch-action: none;
  display: grid;
  grid-template-areas: ". up ." "left mid right" ". down .";
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  opacity: .82;
}
#sm-touch .key {
  -webkit-tap-highlight-color: transparent;
  display: flex; align-items: center; justify-content: center;
  background: rgba(38, 33, 58, .92);
  border: 3px solid #f6c177;
  box-shadow: 3px 3px 0 #09070f;
  color: #fff1c7; font-size: 20px; line-height: 1;
  user-select: none;
}
#sm-touch .key.pressed { background: #f6c177; color: #09070f; transform: translate(1px, 1px); box-shadow: 1px 1px 0 #09070f; }
#sm-touch .up { grid-area: up; }
#sm-touch .down { grid-area: down; }
#sm-touch .left { grid-area: left; }
#sm-touch .right { grid-area: right; }
#sm-touch .mid {
  grid-area: mid;
  background: rgba(27, 23, 48, .55); border: 3px solid rgba(246, 193, 119, .35);
  box-shadow: none;
}

#sm-touch .buttons {
  position: absolute; right: 16px; bottom: 104px;
  pointer-events: auto; touch-action: none;
  display: flex; flex-direction: column-reverse; gap: 14px; align-items: center;
  opacity: .9;
}
#sm-touch .round {
  -webkit-tap-highlight-color: transparent;
  width: 76px; height: 76px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(38, 33, 58, .94);
  border: 3px solid #f6c177; box-shadow: 3px 3px 0 #09070f;
  color: #fff1c7; font-family: "Courier New", monospace;
  font-size: 13px; font-weight: 700; letter-spacing: .1em;
  user-select: none;
}
#sm-touch .round.b { width: 62px; height: 62px; font-size: 11px; border-color: #b9b2d6; color: #b9b2d6; }
#sm-touch .round.pressed { background: #f6c177; color: #09070f; transform: translate(1px, 1px); box-shadow: 1px 1px 0 #09070f; }

/* Out of the way while a window or a dialog owns the screen. */
#sm-touch.hidden { display: none !important; }
`

interface Binding {
  key: string
  code: string
  label: string
  cls: string
  /** The engine's own control name, when it has one. */
  control?: string
}

/** Set by mountTouchControls; the engine's injected KeyboardControls. */
let controlsOf: (() => { applyControl?: (name: string, down?: boolean) => unknown } | null) | null = null

const DPAD: Binding[] = [
  { key: 'ArrowUp', code: 'ArrowUp', label: '▲', cls: 'up', control: 'up' },
  { key: 'ArrowDown', code: 'ArrowDown', label: '▼', cls: 'down', control: 'down' },
  { key: 'ArrowLeft', code: 'ArrowLeft', label: '◀', cls: 'left', control: 'left' },
  { key: 'ArrowRight', code: 'ArrowRight', label: '▶', cls: 'right', control: 'right' },
]

/** Keys currently held by a thumb, so a lost pointer can still release them. */
const held = new Map<string, HTMLElement>()

function typing(): boolean {
  const a = document.activeElement as HTMLElement | null
  return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)
}

function fire(type: 'keydown' | 'keyup', b: Binding) {
  const init: KeyboardEventInit = {
    key: b.key,
    code: b.code,
    bubbles: true,
    cancelable: true,
    composed: true,
  }
  // Both targets: which one the engine bound to is not ours to assume, and a
  // duplicate keydown is harmless — key state is a set, not a counter.
  window.dispatchEvent(new KeyboardEvent(type, init))
  document.dispatchEvent(new KeyboardEvent(type, init))

  // ...and the engine, which does not listen to either of those.
  if (b.control) {
    try {
      void controlsOf?.()?.applyControl?.(b.control, type === 'keydown')
    } catch {
      /* the controls are not up yet — the d-pad simply does nothing */
    }
  }
}

function press(b: Binding, node: HTMLElement) {
  if (typing() || held.has(b.key)) return
  held.set(b.key, node)
  node.classList.add('pressed')
  fire('keydown', b)
}

function release(b: Binding) {
  const node = held.get(b.key)
  if (!node) return
  held.delete(b.key)
  node.classList.remove('pressed')
  fire('keyup', b)
}

/** Let go of everything. The safety net for a pointer the browser took away. */
export function releaseAllTouchKeys(): void {
  for (const key of [...held.keys()]) {
    const b = [...DPAD, ACTION, MENU].find((x) => x.key === key)
    if (b) release(b)
  }
}

// The engine's control names, read off the live instance rather than guessed:
// down, up, left, right, space, shift, escape.
const ACTION: Binding = { key: ' ', code: 'Space', label: 'A', cls: 'a', control: 'space' }
const MENU: Binding = { key: 'Escape', code: 'Escape', label: 'B', cls: 'b', control: 'escape' }

function bind(node: HTMLElement, b: Binding) {
  const down = (e: PointerEvent) => {
    e.preventDefault()
    node.setPointerCapture?.(e.pointerId)
    press(b, node)
    sfx('cursor')
  }
  const up = (e: PointerEvent) => {
    e.preventDefault()
    release(b)
  }
  node.addEventListener('pointerdown', down)
  node.addEventListener('pointerup', up)
  node.addEventListener('pointercancel', up)
  node.addEventListener('pointerleave', up)
  // A context menu on a long press would freeze the key down.
  node.addEventListener('contextmenu', (e) => e.preventDefault())
}

let root: HTMLElement | null = null

export function mountTouchControls(
  controls?: () => { applyControl?: (name: string, down?: boolean) => unknown } | null,
): void {
  if (root || typeof document === 'undefined') return
  if (!isTouchDevice()) return
  controlsOf = controls ?? null
  injectStyle('sm-touch-css', CSS)

  root = el('div', { id: 'sm-touch', class: 'on', 'aria-hidden': 'true' })

  const pad = el('div', { class: 'pad' })
  for (const b of DPAD) {
    const node = el('div', { class: `key ${b.cls}`, text: b.label })
    bind(node, b)
    pad.appendChild(node)
  }
  pad.appendChild(el('div', { class: 'mid' }))

  const a = el('div', { class: 'round a', text: 'A' })
  const bBtn = el('div', { class: 'round b', text: 'B' })
  bind(a, ACTION)
  bind(bBtn, MENU)
  const buttons = el('div', { class: 'buttons' }, [a, bBtn])

  root.append(pad, buttons)
  document.body.appendChild(root)

  // A backgrounded tab never delivers pointerup.
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllTouchKeys() })
  window.addEventListener('blur', releaseAllTouchKeys)

  // Step aside whenever something is on top: a d-pad over a marketplace is
  // both useless and in the way.
  const watch = () => {
    const busy =
      !!document.querySelector('.rpg-ui-dialog') ||
      !!document.querySelector('#sm-market.open, #sm-boxshop.open, #sm-duel.open, #sm-map.open') ||
      !!document.getElementById('title-screen')
    if (busy) releaseAllTouchKeys()
    root!.classList.toggle('hidden', busy)
  }
  watch()
  setInterval(watch, 400)
}


/* ============================================================== LAYOUT ===*/
/*
 * The whole UI was laid out for a desktop window, and a phone is not one. All
 * the overrides live HERE rather than scattered through eight files: mobile is
 * one concern, it is easier to reason about in one place, and a panel written
 * later gets the sensible default without its author having to remember.
 *
 * Measured on a 390x844 screen — an iPhone 14 — where the action bar was
 * 482px wide on a 390px screen and the chat box sat under the d-pad.
 */
const MOBILE_CSS = `
@media (max-width: 720px) {
  /* --- the HUD ---------------------------------------------------------- */
  #sm-hud .hud-tl { top: 8px; left: 8px; gap: 6px; }
  #sm-hud .hud-card { padding: 6px; gap: 8px; }
  #sm-hud .hud-avatar { width: 52px; height: 52px; flex-basis: 52px; }
  #sm-hud .hud-avatar i { transform: scale(1.5); }
  #sm-hud .hud-meta { min-width: 0; gap: 5px; }
  #sm-hud .hud-name { font-size: 14px; max-width: 40vw; }
  #sm-hud .hud-chips { max-width: 62vw; gap: 4px; }
  #sm-hud .hud-chips .smui-chip { font-size: 9px; padding: 3px 6px; }
  /* Banner slots are advertising space nobody has sold yet; on a phone they
     are just three boxes over the game. */
  #sm-hud .hud-banners { display: none; }
  #sm-hud .hud-tr { top: 8px; right: 8px; }
  #sm-hud .hud-gear { width: 40px; height: 40px; }

  /* The action bar was 482px wide on a 390px screen. Full width, and it
     scrolls rather than spilling off the side. */
  #sm-hud .hud-bar-wrap { left: 0; right: 0; bottom: 0; transform: none; width: 100%; }
  #sm-hud .hud-bar {
    width: 100%; border-left: none; border-right: none;
    overflow-x: auto; justify-content: flex-start;
    padding: 6px calc(6px + env(safe-area-inset-left, 0px)) calc(6px + env(safe-area-inset-bottom, 0px));
    gap: 6px; scrollbar-width: none;
  }
  #sm-hud .hud-bar::-webkit-scrollbar { display: none; }
  #sm-hud .hud-slot { flex: 0 0 auto; width: 56px; }
  #sm-hud .hud-slot .cap { font-size: 7px; }
  #sm-hud .hud-settings { right: 0; width: min(280px, 84vw); }

  /* --- chat ------------------------------------------------------------- */
  /*
   * The vertical budget on a 390x844 screen, from the bottom up:
   *   0-68     the action bar
   *   96-264   the d-pad (bottom: 96px, 168px tall)
   *   264+     everything else
   * so chat clears the thumb at 272px and no higher — measured, not guessed.
   */
  #chat-panel {
    left: 8px; right: auto;
    bottom: calc(272px + env(safe-area-inset-bottom, 0px));
    width: min(58vw, 240px);
  }
  #chat-log { max-height: 18vh; font-size: 11px; }
  #chat-input { font-size: 16px; } /* 16px stops iOS zooming on focus */

  /* --- side panels become sheets ---------------------------------------- */
  #sm-friends { top: 42%; }
  #sm-friends .fr-panel { width: min(300px, 82vw); max-height: 52vh; }

  /* --- windows become full screen --------------------------------------- */
  #sm-market, #sm-boxshop, #sm-map, #sm-duel, #sm-wallet, #sm-dm {
    left: 0 !important; right: 0 !important; top: 0 !important; bottom: 0 !important;
    width: 100% !important; max-width: 100% !important;
    height: 100% !important; max-height: 100% !important;
    transform: none !important;
  }
  #sm-duel .d-picks { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 7px; }
  #sm-duel .d-pick .art { width: 64px; height: 64px; }
  #sm-duel .d-pick .art img { width: 58px; height: 58px; }
  /* A dragged titlebar is useless when the window is the screen, and it
     steals the scroll. */
  .smui-titlebar { cursor: default; }
  .smui-input, .smui-btn { font-size: 16px; }

  /* --- the battle scene ------------------------------------------------- */
  #battle-scene .bs-sprite { width: 96px; height: 96px; }
}

/* Landscape on a phone: short and wide, so the vertical budget is the scarce
   one. Pull everything in tighter. */
@media (max-height: 480px) and (pointer: coarse) {
  #sm-hud .hud-chips { display: none; }
  #chat-panel { bottom: 78px; width: min(40vw, 200px); }
  #sm-touch .pad { width: 132px; height: 132px; bottom: 74px; }
  #sm-touch .round { width: 60px; height: 60px; }
  #sm-touch .round.b { width: 50px; height: 50px; }
  #sm-touch .buttons { bottom: 80px; gap: 10px; }
}
`

/**
 * The phone layout. Applied whenever the screen is small OR the pointer is
 * coarse — a small window on a desktop gets it too, which is the right answer
 * for anyone testing.
 */
export function mountMobileLayout(): void {
  if (typeof document === 'undefined') return
  injectStyle('sm-mobile-css', MOBILE_CSS)
}
