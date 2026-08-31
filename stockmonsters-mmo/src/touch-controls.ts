/*
 * touch-controls.ts — playing without a keyboard.
 *
 *   mountTouchControls()   // no-op on a device with a real keyboard
 *
 * ┌──────────────────────────────────────────────┐
 * │                                              │
 * │  ╭───────────╮                     ( B )     │
 * │  │     ▲     │                               │
 * │  │  ◀ (●) ▶  │                   ( A )       │
 * │  │     ▼     │                               │
 * │  ╰───────────╯                               │
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
 * would leave the stick dead. Both, and the whole game answers a thumb.
 *
 * ## Why an analog stick and not a d-pad
 *
 * The square d-pad that used to live here asked a thumb to find a 56px cell it
 * could not see under its own knuckle, and it could only ever be pressed in one
 * place. A stick is aimed instead of aimed at: it appears wherever the thumb
 * lands and is steered by direction, which is the one thing a thumb is good at.
 * The engine still only understands four held keys, so the analog vector is
 * quantised back down — see `steer` for the dead zone and the hysteresis that
 * stops a diagonal thumb from rattling between two directions.
 *
 * ## Three things it is careful about
 *
 * **It never fires while you are typing.** A stick under a focused text field
 * would make the character wander while someone writes a message.
 *
 * **It releases on loss.** `pointercancel`, a backgrounded tab, a pointer the
 * browser handed to someone else — every one of them sends the keyup. A key
 * left down because a browser ate the release means a character walking into a
 * wall forever.
 *
 * **It is multi-touch from the ground up.** Every gesture is keyed by
 * `pointerId`, so the left thumb can steer while the right thumb hits A. Code
 * that assumes one live touch breaks the moment a player does both at once,
 * which is most of the time.
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
  padding: 0 0 calc(10px + env(safe-area-inset-bottom, 0px));
}
#sm-touch.on { display: block; }

/* --- the analog stick ---------------------------------------------------- *
 *
 * .stick is the catchment area, not the widget: a thumb landing anywhere in
 * it summons the base under itself. It stops short of the action bar below and
 * of the chat box above, both of which are laid out against these numbers in
 * MOBILE_CSS — move one and move the other.
 */
#sm-touch .stick {
  position: absolute; left: 0; right: 50%;
  /* An absolutely positioned child is laid out against the padding box, so the
     container's own bottom padding does NOT push it up — the safe area has to
     be spent here, above the action bar, or the two overlap by a thumb. */
  bottom: calc(78px + env(safe-area-inset-bottom, 0px));
  height: 240px;
  /* Not for layout: an abs-positioned child's origin is the padding box's own
     edge, so this shifts nothing. It is how JS reads the notch inset, which is
     otherwise only knowable to CSS. See safeLeft(). */
  padding-left: env(safe-area-inset-left, 0px);
  pointer-events: auto;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
/* Driven entirely by transform: left/top stay at the origin so one translate
   places the CENTRE, which is the only coordinate the maths cares about. */
#sm-touch .stick-base {
  position: absolute; left: 0; top: 0;
  width: 132px; height: 132px; margin: -66px 0 0 -66px;
  /* A resting place for the first frame, before JS has measured the zone. */
  transform: translate3d(94px, 152px, 0);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  /* A ground of its own. The map underneath is anything from black cave to
     white tile, so the ring carries a dark fill AND a dark halo outside its
     amber border — one of the two always separates it from the background. */
  background: rgba(18, 14, 34, .70);
  border: 3px solid rgba(246, 193, 119, .55);
  box-shadow: 0 0 0 3px rgba(9, 7, 15, .55), 4px 4px 0 rgba(9, 7, 15, .40);
  opacity: .62;
  transition: opacity .12s linear, transform .18s ease-out,
              border-color .12s linear, background .12s linear;
}
/* The gate the cap runs in — depth, and it reads as a thing with a mechanism. */
#sm-touch .stick-base::before {
  content: ""; position: absolute; inset: 12px;
  border-radius: 50%;
  border: 2px solid rgba(246, 193, 119, .14);
}
/* Live: full strength, and NO transform transition — the base must appear
   under the thumb, not slide over to meet it. */
#sm-touch .stick-base.live {
  opacity: 1;
  background: rgba(18, 14, 34, .80);
  border-color: #f6c177;
  transition: opacity .07s linear, border-color .07s linear, background .07s linear;
}
/*
 * Direction marks sit OUTSIDE the ring, where the cap can never reach them —
 * arrows drawn inside were lit and hidden at the same moment, by the very
 * thumb that lit them.
 */
#sm-touch .stick-base i {
  position: absolute;
  background: rgba(246, 193, 119, .38);
  box-shadow: 2px 2px 0 rgba(9, 7, 15, .55);
  transition: background .06s linear;
}
#sm-touch .stick-base i.n, #sm-touch .stick-base i.s { width: 16px; height: 5px; left: 50%; margin-left: -8px; }
#sm-touch .stick-base i.w, #sm-touch .stick-base i.e { width: 5px; height: 16px; top: 50%; margin-top: -8px; }
#sm-touch .stick-base i.n { top: -13px; }
#sm-touch .stick-base i.s { bottom: -13px; }
#sm-touch .stick-base i.w { left: -13px; }
#sm-touch .stick-base i.e { right: -13px; }
#sm-touch .stick-base.is-up i.n,
#sm-touch .stick-base.is-down i.s,
#sm-touch .stick-base.is-left i.w,
#sm-touch .stick-base.is-right i.e { background: #fff1c7; }
#sm-touch .stick-knob {
  width: 52px; height: 52px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(38, 33, 58, .96);
  border: 3px solid #f6c177;
  box-shadow: 2px 2px 0 rgba(9, 7, 15, .8);
  color: rgba(246, 193, 119, .55);
  font-family: "Courier New", monospace; font-size: 13px; line-height: 1;
  /* Springs home when the thumb lets go; instant while it is being steered. */
  transition: transform .16s cubic-bezier(.22, .9, .3, 1.25),
              background .08s linear, color .08s linear;
}
#sm-touch .stick-base.live .stick-knob {
  background: #f6c177; color: #09070f;
  transition: background .08s linear, color .08s linear;
}
/* A spring that overshoots is a spring, and some people cannot stand it. */
@media (prefers-reduced-motion: reduce) {
  #sm-touch .stick-base, #sm-touch .stick-knob { transition: opacity .07s linear; }
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

const DIRECTIONS: Binding[] = [
  { key: 'ArrowUp', code: 'ArrowUp', label: '▲', cls: 'up', control: 'up' },
  { key: 'ArrowDown', code: 'ArrowDown', label: '▼', cls: 'down', control: 'down' },
  { key: 'ArrowLeft', code: 'ArrowLeft', label: '◀', cls: 'left', control: 'left' },
  { key: 'ArrowRight', code: 'ArrowRight', label: '▶', cls: 'right', control: 'right' },
]

/**
 * Keys currently held by a thumb, so a lost pointer can still release them.
 * The value is the node to un-highlight, and the stick's directions have none —
 * their feedback is the knob, which is not per-key.
 */
const held = new Map<string, HTMLElement | null>()

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
      /* the controls are not up yet — the stick simply does nothing */
    }
  }
}

function press(b: Binding, node: HTMLElement | null) {
  if (typing() || held.has(b.key)) return
  held.set(b.key, node)
  node?.classList.add('pressed')
  fire('keydown', b)
}

function release(b: Binding) {
  if (!held.has(b.key)) return
  const node = held.get(b.key)
  held.delete(b.key)
  node?.classList.remove('pressed')
  fire('keyup', b)
}

/** Let go of everything. The safety net for a pointer the browser took away. */
export function releaseAllTouchKeys(): void {
  resetStick()
  for (const key of [...held.keys()]) {
    const b = [...DIRECTIONS, ACTION, MENU].find((x) => x.key === key)
    if (b) release(b)
  }
}

/*
 * THE CONTROL NAME IS NOT THE KEY NAME, and this button had the key name.
 *
 * The live instance carries both: `boundKeys` is keyed by the KEY — down, up,
 * left, right, space, shift, escape — and `_controlsOptions` by the CONTROL —
 * down, up, left, right, action, dash, back, escape. `applyControl` wants the
 * second. Sending 'space' does nothing at all.
 *
 * So the A button never reached the engine, and since the engine also ignores
 * synthetic keyboard events (the other half of what this file sends), talking
 * to anybody on a phone has never worked. Found by trying to reproduce a stuck
 * NPC conversation and discovering the server's onAction was never called.
 */
const ACTION: Binding = { key: ' ', code: 'Space', label: 'A', cls: 'a', control: 'action' }
const MENU: Binding = { key: 'Escape', code: 'Escape', label: 'B', cls: 'b', control: 'escape' }

/* ============================================================= JOYSTICK ===*/

const STICK = {
  /**
   * Under this fraction of the reach the thumb is resting, not steering. A
   * stick with no dead zone drifts the moment a thumb settles on it.
   */
  dead: 0.28,
  /**
   * Degrees a thumb has to swing PAST a sector boundary before the direction
   * flips. A thumb held on a diagonal sits exactly on a boundary and jitters
   * across it by a degree or two; without this the character would stutter
   * between two directions several times a second.
   */
  slack: 9,
  /** Breathing room between the cap's rim and the ring's inner edge, in px. */
  gate: 4,
  /** How far outside the ring the direction marks sit, plus their own length. */
  marks: 18,
}

/**
 * Measured rather than hard-coded, because the landscape stylesheet shrinks the
 * base and a reach that did not shrink with it would let the cap escape.
 *
 * `reach` is the whole point: the knob's CENTRE travels at most far enough that
 * its rim lands just inside the ring. A reach expressed as a fraction of the
 * radius does not know how big the cap is, and at full deflection the cap sat
 * outside the ring with half of it off the screen — a puck that had fallen out
 * of the joystick.
 *
 * `edge` is what the whole control needs to stay on screen: not the ring, but
 * the ring plus whichever sticks out further, the deflected cap or the marks.
 */
function geometry() {
  const radius = (base?.offsetWidth || 132) / 2
  const knobR = (knob?.offsetWidth || 52) / 2
  const reach = Math.max(12, radius - knobR - STICK.gate)
  return { radius, knobR, reach, edge: Math.max(radius + STICK.marks, reach + knobR) }
}

/**
 * The notch's width on the left, which only CSS knows. The zone carries it as a
 * padding it does not otherwise use, purely so this can read it back.
 */
function safeLeft(): number {
  if (!zone) return 0
  return parseFloat(getComputedStyle(zone).paddingLeft) || 0
}

/**
 * Eight sectors, clockwise from east, in SCREEN coordinates where y grows
 * downwards. A sector never contains two opposing controls, which is what
 * guarantees we can never hold left and right at once.
 */
const SECTORS: ReadonlyArray<readonly string[]> = [
  ['right'],
  ['right', 'down'],
  ['down'],
  ['left', 'down'],
  ['left'],
  ['left', 'up'],
  ['up'],
  ['right', 'up'],
]

let zone: HTMLElement | null = null
let base: HTMLElement | null = null
let knob: HTMLElement | null = null
/** The one pointer steering, by id — any other finger belongs to a button. */
let stickPointer: number | null = null
/** Index into SECTORS, or -1 for "inside the dead zone, holding nothing". */
let sector = -1

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Move the base's centre to a point in the zone's own coordinates. */
function placeBase(x: number, y: number) {
  if (base) base.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
}

/**
 * The resting place: bottom-left of the zone, where a right-handed thumb is.
 *
 * A hidden zone measures zero, and homing against zero once at mount put the
 * stick above its own catchment area — visible, and untouchable. So the height
 * has to be real before this means anything, and a ResizeObserver calls it back
 * the moment it becomes real.
 */
function homeBase() {
  if (!zone) return
  const r = zone.getBoundingClientRect()
  if (r.height < 80) return
  const { edge } = geometry()
  // Far enough in that the cap at full left deflection is still on the screen,
  // notch included.
  placeBase(edge + 10 + safeLeft(), r.height - edge - 4)
}

/**
 * Hold exactly these controls and no others. Releases first and presses
 * second, deliberately: applying `right` while `left` is still down is how a
 * character ends up walking on the spot.
 */
function hold(names: readonly string[]) {
  for (const b of DIRECTIONS) if (!names.includes(b.control!) && held.has(b.key)) release(b)
  for (const b of DIRECTIONS) if (names.includes(b.control!)) press(b, null)
}

/** Light the ring's arrows for what the player MEANT, not for the current slice. */
function lights(names: readonly string[]) {
  base?.classList.toggle('is-up', names.includes('up'))
  base?.classList.toggle('is-down', names.includes('down'))
  base?.classList.toggle('is-left', names.includes('left'))
  base?.classList.toggle('is-right', names.includes('right'))
}

/** How long each half of a diagonal owns the character, in ms. */
const WEAVE = 150
let weave: ReturnType<typeof setInterval> | null = null

function stopWeave() {
  if (weave === null) return
  clearInterval(weave)
  weave = null
}

/*
 * AUTO-REPEAT, BECAUSE A HELD CONTROL DIES IN THE ENGINE.
 *
 * Measured, not theorised: a control held through applyControl stops producing
 * movement after about 1.4 seconds of walking and never recovers — somewhere
 * inside the engine the held-key state is wiped while the player moves, and
 * the same wipe recurs every few seconds when the character element's control
 * registration is redone. A real keyboard never notices, because the OS fires
 * auto-repeat keydowns and each one re-arms the state. A thumb has no
 * auto-repeat, so a touch player's walk simply stopped mid-stride.
 *
 * So the stick provides what the OS provides: while a direction is held, the
 * press is re-applied a few times a second. A duplicate press is harmless —
 * key state is a set, not a counter — and each one restores whatever the
 * engine just forgot. This is a workaround for an engine bug and it belongs
 * exactly here, in the layer that synthesises what a keyboard would have done.
 */
const REPEAT_MS = 250
let repeat: ReturnType<typeof setInterval> | null = null
let repeating: readonly string[] = []

function stopRepeat() {
  if (repeat === null) return
  clearInterval(repeat)
  repeat = null
  repeating = []
}

function startRepeat(names: readonly string[]) {
  stopRepeat()
  if (!names.length) return
  repeating = names
  repeat = setInterval(() => {
    // The weave owns diagonals — its own re-holds serve as the repeat there.
    if (weave !== null || typing()) return
    for (const b of DIRECTIONS) {
      if (repeating.includes(b.control!) && held.has(b.key)) fire('keydown', b)
    }
  }, REPEAT_MS)
}

/**
 * Turn a sector into held keys.
 *
 * The engine walks in four directions and only one at a time: holding `right`
 * and `down` together does not go south-east, it argues with itself and travels
 * about 9px in a second and a half — measured. So a diagonal is WOVEN instead.
 * Each direction owns the character for a moment and the path staircases,
 * which is close enough to a diagonal that nobody notices, and is very much
 * closer than standing still.
 */
function applySector(names: readonly string[]) {
  stopWeave()
  stopRepeat()
  lights(names)
  if (names.length < 2) {
    hold(names)
    startRepeat(names)
    return
  }
  let turn = 0
  hold([names[0]])
  weave = setInterval(() => {
    turn ^= 1
    // Release-then-press every turn: the weave doubles as the auto-repeat for
    // diagonals, so the engine's forgetting never outlives one slice.
    hold([names[turn]])
  }, WEAVE)
}

function steer(dx: number, dy: number) {
  if (Math.hypot(dx, dy) < STICK.dead * geometry().reach) {
    if (sector !== -1) { sector = -1; applySector([]) }
    return
  }
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (sector >= 0) {
    // Signed difference folded into (-180, 180] so 350° and 10° are 20° apart.
    const off = Math.abs(((deg - sector * 45 + 540) % 360) - 180)
    if (off <= 22.5 + STICK.slack) return
  }
  sector = ((Math.round(deg / 45) % 8) + 8) % 8
  applySector(SECTORS[sector])
}

function grab(e: PointerEvent) {
  if (!zone || !base || !knob) return
  // A second finger in the zone is a mis-grab, not a second stick.
  if (stickPointer !== null || typing()) return
  e.preventDefault()
  stickPointer = e.pointerId
  try { zone.setPointerCapture(e.pointerId) } catch { /* touch captures itself */ }
  const r = zone.getBoundingClientRect()
  const { edge } = geometry()
  // Clamped by the WHOLE control's half-width, so that a thumb at the very edge
  // of the screen still gets a stick whose cap stays on screen at full
  // deflection. The base may end up a little to the side of the thumb, which
  // nobody notices; a cap sliced off by the bezel is all anyone notices.
  // To the right there is no bezel, only the middle of the screen, so it may
  // lean further that way.
  const lo = edge + safeLeft()
  placeBase(
    clamp(e.clientX - r.left, lo, Math.max(lo, r.width - edge + 30)),
    clamp(e.clientY - r.top, edge, Math.max(edge, r.height - edge)),
  )
  knob.style.transform = 'translate3d(0, 0, 0)'
  base.classList.add('live')
  sfx('cursor')
}

function drag(e: PointerEvent) {
  if (e.pointerId !== stickPointer || !zone || !base || !knob) return
  e.preventDefault()
  // The base was placed by transform, so its own rect is where it really is.
  const b = base.getBoundingClientRect()
  const dx = e.clientX - (b.left + b.width / 2)
  const dy = e.clientY - (b.top + b.height / 2)
  const dist = Math.hypot(dx, dy)
  const { reach } = geometry()
  const scale = dist > reach ? reach / dist : 1
  knob.style.transform = `translate3d(${Math.round(dx * scale)}px, ${Math.round(dy * scale)}px, 0)`
  steer(dx, dy)
}

function drop(e: PointerEvent) {
  if (e.pointerId !== stickPointer) return
  resetStick()
}

/** Everything the stick holds, let go of. Safe to call when it is not mounted. */
function resetStick() {
  if (!zone || !base || !knob) return
  stickPointer = null
  sector = -1
  applySector([])
  base.classList.remove('live')
  knob.style.transform = 'translate3d(0, 0, 0)'
  homeBase()
}

function buildStick(): HTMLElement {
  zone = el('div', { class: 'stick' })
  knob = el('div', { class: 'stick-knob', text: '●' })
  base = el('div', { class: 'stick-base' }, [
    el('i', { class: 'n' }),
    el('i', { class: 'e' }),
    el('i', { class: 's' }),
    el('i', { class: 'w' }),
    knob,
  ])
  zone.appendChild(base)

  zone.addEventListener('pointerdown', grab)
  zone.addEventListener('pointermove', drag)
  zone.addEventListener('pointerup', drop)
  zone.addEventListener('pointercancel', drop)
  // Chrome fires this when a touch is cancelled by a gesture higher up the
  // page; without it the character keeps the last direction forever.
  zone.addEventListener('lostpointercapture', drop)
  zone.addEventListener('contextmenu', (e) => e.preventDefault())
  // The capture can be lost before the release ever reaches the zone, so the
  // window gets the last word on whether the thumb is still down.
  window.addEventListener('pointerup', drop)
  window.addEventListener('pointercancel', drop)
  // The zone's home depends on its measured height, which a rotation changes —
  // and so does the panel being hidden for a dialog and coming back.
  window.addEventListener('resize', homeBase)
  window.addEventListener('orientationchange', homeBase)
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (stickPointer === null) homeBase() }).observe(zone)
  }
  return zone
}

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

  const stick = buildStick()

  const a = el('div', { class: 'round a', text: 'A' })
  const bBtn = el('div', { class: 'round b', text: 'B' })
  bind(a, ACTION)
  bind(bBtn, MENU)
  const buttons = el('div', { class: 'buttons' }, [a, bBtn])

  root.append(stick, buttons)
  document.body.appendChild(root)
  // Only now does the zone have a height to measure a resting place against.
  homeBase()

  // A backgrounded tab never delivers pointerup.
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllTouchKeys() })
  window.addEventListener('blur', releaseAllTouchKeys)

  // Step aside whenever something is on top: a joystick over a marketplace is
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
   *   78-318   the joystick's catchment zone (CSS: bottom 78px, 240px tall)
   *   318+     everything else
   * so chat clears the thumb at 330px and no lower — measured, not guessed.
   * The zone is a touch target, not a picture: anything overlapping it is
   * unreachable even where nothing is drawn.
   */
  /*
   * CHAT IS A SHEET BEHIND A BADGE, NOT A PANEL ON THE WORLD.
   *
   * It used to sit permanently at the left, and on a 390px screen that is the
   * middle of the playfield: on a real handset the log covered the other
   * player entirely, so the person being talked to was hidden behind the words
   * "Tap to chat". There is no arrangement of a always-on log that does not
   * cost world — the screen is simply too small — so it is hidden until asked
   * for.
   */
  #chat-panel {
    display: none;
    left: 0; right: 0; bottom: 0; width: auto;
    max-height: min(62vh, 460px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: #1b1730;
    border-top: 3px solid #f6c177;
    z-index: 960;
  }
  #chat-panel.open { display: flex; }
  #chat-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px;
    font-weight: 700; letter-spacing: .1em; font-size: 12px; color: #f6c177;
    border-bottom: 2px solid rgba(246,193,119,.35);
  }
  #chat-close {
    background: #3a2230; color: #fff1c7;
    border: 2px solid #f6c177; border-radius: 0;
    padding: 4px 10px; font: inherit; font-size: 14px; line-height: 1;
    min-width: 44px; min-height: 32px; cursor: pointer;
  }
  #chat-log {
    flex: 1; max-height: none; font-size: 13px;
    border: none; background: transparent;
    padding: 10px 12px;
  }
  /* :empty hides it on desktop, which would collapse the sheet to a strip. */
  #chat-log:empty { display: block; }
  #chat-row { padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)); }
  #chat-input { font-size: 16px; } /* 16px stops iOS zooming on focus */

  /*
   * The pill. Top-right, under the HUD's gear and clear of the player card,
   * where nothing else lives and a thumb can still reach it.
   */
  #chat-badge {
    display: flex; align-items: center; gap: 6px;
    position: fixed; z-index: 970;
    right: calc(8px + env(safe-area-inset-right, 0px));
    top: calc(76px + env(safe-area-inset-top, 0px));
    min-width: 44px; min-height: 44px; padding: 0 10px;
    background: rgba(27,23,48,.94); color: #fff1c7;
    border: 3px solid #f6c177; border-radius: 0;
    box-shadow: 3px 3px 0 #09070f;
    font-family: "Courier New", ui-monospace, monospace;
    font-size: 15px; line-height: 1; cursor: pointer;
  }
  #chat-badge .n { font-weight: 700; font-size: 12px; color: #09070f; }
  #chat-badge.has-unread { background: #7ecf6b; }
  #chat-badge.has-unread .ic { filter: grayscale(1) brightness(.2); }
  #chat-badge:not(.has-unread) .n { display: none; }
  #chat-badge:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #09070f; }

  /* --- side panels become bottom sheets ---------------------------------
   *
   * A vertical FRIENDS tab down the middle of a phone screen is a desktop
   * idea wearing a costume. On a phone the panel comes up from the bottom —
   * where the thumb already is — and it is opened from the action bar, which
   * has a FRIENDS button anyway. The tab itself is hidden entirely.
   */
  #sm-friends {
    left: 0; right: 0; top: auto; bottom: 0;
    transform: none;
    display: block;
    z-index: 900;
    pointer-events: none;
  }
  #sm-friends .fr-tab { display: none; }
  #sm-friends .fr-panel {
    width: 100%; max-height: 74vh;
    border-left: none; border-right: none; border-bottom: none;
    box-shadow: 0 -6px 0 rgba(9, 7, 15, .45);
    pointer-events: auto;
    /* Off screen until it is opened, so it slides rather than appears. */
    transform: translateY(100%);
    transition: transform .18s ease-out;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  #sm-friends.open .fr-panel { transform: translateY(0); }
  /* A grab bar, so it reads as something that came up and can go back down. */
  #sm-friends .fr-head::before {
    content: "";
    position: absolute; left: 50%; top: 5px; transform: translateX(-50%);
    width: 44px; height: 4px; background: var(--sm-muted, #b9b2d6); opacity: .5;
  }
  #sm-friends .fr-head { position: relative; padding-top: 16px; }
  /* Bigger tap target for the way out, since the sheet covers the button
     that opened it. */
  #sm-friends .fr-head .smui-close { font-size: 14px; padding: 6px 12px; }
  #sm-friends .fr-body { max-height: 52vh; }
  #sm-friends .fr-row { padding: 10px 10px; }
  #sm-friends .fr-row .smui-btn { font-size: 11px; padding: 7px 10px; }

  /* The count moves to the action bar, which is the only way in now. */
  #sm-hud .hud-slot[data-badge]:not([data-badge="0"])::after {
    content: attr(data-badge);
    position: absolute; top: -6px; right: -6px;
    min-width: 16px; padding: 1px 4px;
    background: var(--sm-danger, #e06c75); color: #fff;
    font-size: 9px; font-weight: 700; line-height: 1.3; text-align: center;
    box-shadow: 2px 2px 0 var(--sm-shadow, #09070f);
  }
  #sm-hud .hud-slot { position: relative; }

  /* --- the rest become sheets or full screen ----------------------------- */
  /* Big, browsable things take the screen. */
  #sm-market, #sm-boxshop, #sm-map, #sm-duel {
    left: 0 !important; right: 0 !important; top: 0 !important; bottom: 0 !important;
    width: 100% !important; max-width: 100% !important;
    height: 100% !important; max-height: 100% !important;
    transform: none !important;
  }
  /* Small, glanceable ones sit at the bottom where the thumb is. */
  #sm-wallet, #sm-dm {
    left: 0 !important; right: 0 !important; top: auto !important; bottom: 0 !important;
    width: 100% !important; max-width: 100% !important;
    max-height: 76vh !important;
    transform: none !important;
    border-left: none; border-right: none; border-bottom: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
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
  /* Chat is a sheet here too, just a shorter one — landscape has almost no
     vertical budget, and the old rule put it back over the world. */
  #chat-panel { max-height: 76vh; }
  #chat-badge { top: calc(8px + env(safe-area-inset-top, 0px)); }
  #sm-touch .stick { bottom: 44px; height: 150px; right: 56%; }
  #sm-touch .stick-base { width: 104px; height: 104px; margin: -52px 0 0 -52px; }
  #sm-touch .stick-knob { width: 42px; height: 42px; }
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
