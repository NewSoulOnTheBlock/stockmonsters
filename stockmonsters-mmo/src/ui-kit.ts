/*
 * ui-kit.ts — the shared pixel-window vocabulary for the in-game DOM UI.
 *
 * Everything the HUD (hud.ts) and the marketplace (marketplace.ts) draw is
 * plain DOM styled from here, so the two never drift apart: one palette, one
 * button, one window chrome, one focus ring.
 *
 * Three things in here are load-bearing beyond styling:
 *
 *  1. `guardKeys` — the game engine listens for keys on `window`, so any text
 *     input that does not stop propagation makes the player walk while you
 *     type. chat-ui.ts does the same thing by hand; this is that pattern,
 *     packaged.
 *  2. `pushLayer` — an escape stack. ESC closes the top-most window only, and
 *     the keystroke never reaches the game.
 *  3. `watchGameDialog` — RPG-JS renders its dialog GUI into
 *     `.rpg-ui-dialog-layer` at z-index 1000+. Our windows sit below that, so
 *     when a dialog opens we hide ourselves rather than fight it.
 *
 * z-index budget (agreed with the rest of the client):
 *   map canvas 0 · battle scene 800 · chat 850 · HUD 700-780 ·
 *   marketplace window 960-990 · RPG-JS dialog layer 1000+.
 */

export const THEME = {
  surface: '#26213a',
  surfaceAlt: '#2f2947',
  dark: '#1b1730',
  darker: '#141024',
  border: '#f6c177',
  text: '#fff1c7',
  muted: '#b9b2d6',
  ok: '#7ecf6b',
  danger: '#e06c75',
  shadow: '#09070f',
  mono: '"Courier New", ui-monospace, monospace',
  display: '"Fredoka", "Trebuchet MS", sans-serif',
} as const

/** z-index constants, kept in one place so the layers stay provably ordered. */
export const Z = {
  hud: 700,
  hudPopover: 780,
  marketWindow: 960,
  marketModal: 985,
  marketToast: 990,
} as const

/* ------------------------------------------------------------------ DOM ---*/

type Attrs = Record<string, string | number | boolean | undefined | null>

/** Tiny element builder: `el('div', { class: 'x' }, [child, 'text'])`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  children?: Array<Node | string | null | undefined>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue
      if (k === 'text') { node.textContent = String(v); continue }
      if (k === 'html') { node.innerHTML = String(v); continue }
      node.setAttribute(k, v === true ? '' : String(v))
    }
  }
  if (children) for (const c of children) {
    if (c === null || c === undefined) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** Idempotent <style> injection — safe to call from every module's mount. */
export function injectStyle(id: string, css: string): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}

/* ----------------------------------------------------------- key guards ---*/

/**
 * Keep the game from reading keys typed into our widgets. The engine binds on
 * `window`, so stopping propagation at the widget is enough; we deliberately
 * do NOT preventDefault, so the input still behaves like an input.
 */
export function guardKeys(node: HTMLElement, onEscape?: () => void): void {
  const stop = (e: Event) => e.stopPropagation()
  node.addEventListener('keydown', (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      if (onEscape) { e.preventDefault(); onEscape() }
      else (e.target as HTMLElement)?.blur?.()
    }
  })
  node.addEventListener('keyup', stop)
  node.addEventListener('keypress', stop)
}

/* --------------------------------------------------------- escape stack ---*/

type Layer = { close: () => void }
const layers: Layer[] = []
let escBound = false

function bindEsc() {
  if (escBound || typeof window === 'undefined') return
  escBound = true
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || layers.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    layers[layers.length - 1].close()
  }, true) // capture: get there before the engine's own window listener
}

/**
 * Register an open window. ESC closes the top-most one. Returns a disposer
 * that must be called when the window closes by any other route.
 */
export function pushLayer(close: () => void): () => void {
  bindEsc()
  const layer: Layer = { close }
  layers.push(layer)
  let done = false
  return () => {
    if (done) return
    done = true
    const i = layers.indexOf(layer)
    if (i >= 0) layers.splice(i, 1)
  }
}

export function layerDepth(): number { return layers.length }

/* -------------------------------------------------------- dialog watcher --*/

/**
 * Calls back with `true` while an RPG-JS dialog is on screen. Our windows sit
 * *below* the dialog layer, so they hide themselves instead of being buried.
 */
export function watchGameDialog(cb: (open: boolean) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  let last: boolean | null = null
  const check = () => {
    const open = !!document.querySelector('.rpg-ui-dialog')
    if (open !== last) { last = open; cb(open) }
  }
  const mo = new MutationObserver(check)
  mo.observe(document.body, { childList: true, subtree: true })
  check()
  return () => mo.disconnect()
}

/* ------------------------------------------------------------- dragging ---*/

/**
 * Drag `win` (position: fixed, left/top driven) by `handle`. Pointer events so
 * it works with touch; the window is clamped to stay reachable on resize.
 */
export function makeDraggable(win: HTMLElement, handle: HTMLElement): void {
  let dragging = false
  let dx = 0
  let dy = 0

  const clamp = () => {
    const r = win.getBoundingClientRect()
    const maxL = Math.max(0, window.innerWidth - r.width)
    const maxT = Math.max(0, window.innerHeight - r.height)
    const l = Math.min(Math.max(0, parseFloat(win.style.left || '0')), maxL)
    const t = Math.min(Math.max(0, parseFloat(win.style.top || '0')), maxT)
    win.style.left = `${Math.round(l)}px`
    win.style.top = `${Math.round(t)}px`
  }

  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return // close button etc.
    const r = win.getBoundingClientRect()
    // Freeze the geometry: the window may have been laid out by transform.
    win.style.left = `${Math.round(r.left)}px`
    win.style.top = `${Math.round(r.top)}px`
    win.style.transform = 'none'
    win.style.margin = '0'
    dragging = true
    dx = e.clientX - r.left
    dy = e.clientY - r.top
    handle.setPointerCapture(e.pointerId)
    handle.classList.add('is-dragging')
    e.preventDefault()
  })
  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return
    win.style.left = `${Math.round(e.clientX - dx)}px`
    win.style.top = `${Math.round(e.clientY - dy)}px`
    clamp()
  })
  const end = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    handle.classList.remove('is-dragging')
    try { handle.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  window.addEventListener('resize', () => { if (win.style.transform === 'none') clamp() })
}

/* ----------------------------------------------------------------- money --*/

const WEI = 1_000_000_000_000_000_000n

/** wei string -> "0.0420 ETH"-style number (no unit), trimmed but never "0". */
export function formatEth(wei: string, maxFrac = 4): string {
  let v: bigint
  try { v = BigInt(wei) } catch { return '0' }
  const neg = v < 0n
  if (neg) v = -v
  const whole = v / WEI
  const frac = v % WEI
  let fracStr = frac.toString().padStart(18, '0').slice(0, Math.max(0, maxFrac))
  fracStr = fracStr.replace(/0+$/, '')
  // Sub-precision dust should not render as a free item.
  if (!fracStr && whole === 0n && frac > 0n) fracStr = '0'.repeat(maxFrac - 1) + '1'
  return `${neg ? '-' : ''}${whole}${fracStr ? '.' + fracStr : ''}`
}

/** "0.042" -> wei string. Returns null when the text is not a positive amount. */
export function parseEth(text: string): string | null {
  const t = text.trim()
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null
  const [w, f = ''] = t.split('.')
  const frac = (f + '0'.repeat(18)).slice(0, 18)
  const wei = BigInt(w || '0') * WEI + BigInt(frac)
  return wei > 0n ? wei.toString() : null
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

/* --------------------------------------------------------------- styles ---*/

const KIT_CSS = `
:root {
  --sm-surface: ${THEME.surface};
  --sm-surface-alt: ${THEME.surfaceAlt};
  --sm-dark: ${THEME.dark};
  --sm-darker: ${THEME.darker};
  --sm-border: ${THEME.border};
  --sm-text: ${THEME.text};
  --sm-muted: ${THEME.muted};
  --sm-ok: ${THEME.ok};
  --sm-danger: ${THEME.danger};
  --sm-shadow: ${THEME.shadow};
}
.smui, .smui * { box-sizing: border-box; }
.smui {
  font-family: ${THEME.mono};
  color: var(--sm-text);
  image-rendering: pixelated;
  -webkit-font-smoothing: none;
}
.smui-display {
  font-family: ${THEME.display};
  font-weight: 600;
  letter-spacing: .12em;
  text-shadow: 2px 2px 0 var(--sm-shadow);
}

/* --- panels -------------------------------------------------------------- */
.smui-panel {
  background: var(--sm-surface);
  border: 3px solid var(--sm-border);
  border-radius: 0;
  box-shadow: 3px 3px 0 var(--sm-shadow);
}
.smui-inset {
  background: var(--sm-darker);
  border: 3px solid var(--sm-border);
  border-radius: 0;
}

/* --- buttons ------------------------------------------------------------- */
.smui-btn {
  font-family: ${THEME.mono};
  font-weight: 700;
  letter-spacing: .08em;
  font-size: 12px;
  color: var(--sm-text);
  background: var(--sm-surface-alt);
  border: 3px solid var(--sm-border);
  border-radius: 0;
  box-shadow: 3px 3px 0 var(--sm-shadow);
  padding: 8px 14px;
  cursor: pointer;
  line-height: 1;
  text-transform: uppercase;
  transition: background .08s linear;
}
.smui-btn:hover:not(:disabled) { background: #3a3358; }
.smui-btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--sm-shadow); }
.smui-btn:disabled { opacity: .42; cursor: default; }
.smui-btn.is-primary { background: var(--sm-ok); color: #09070f; }
.smui-btn.is-primary:hover:not(:disabled) { background: #93df80; }
.smui-btn.is-danger { background: var(--sm-danger); color: #170a0c; }
.smui-btn.is-danger:hover:not(:disabled) { background: #ef7d86; }
.smui-btn.is-ghost { background: transparent; }
.smui-btn.is-ghost:hover:not(:disabled) { background: rgba(246,193,119,.14); }

/* Square icon button — the action bar and the window title bar use it. */
.smui-icon-btn {
  width: 52px; height: 52px;
  padding: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 2px;
  font-size: 20px;
  line-height: 1;
}

.smui :is(button, input, select, [tabindex]):focus-visible {
  outline: 3px solid var(--sm-ok);
  outline-offset: 2px;
}

/* --- inputs -------------------------------------------------------------- */
.smui-input {
  font-family: ${THEME.mono};
  font-size: 12px;
  color: var(--sm-text);
  background: var(--sm-dark);
  border: 3px solid var(--sm-border);
  border-radius: 0;
  padding: 9px 10px;
  outline: none;
  width: 100%;
}
.smui-input::placeholder { color: #6f6790; }

/* --- checkbox ------------------------------------------------------------ */
.smui-check {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 2px;
  font-size: 11px; letter-spacing: .04em;
  color: var(--sm-muted);
  cursor: pointer;
  user-select: none;
}
.smui-check:hover { color: var(--sm-text); }
.smui-check input { position: absolute; opacity: 0; width: 0; height: 0; }
.smui-check .box {
  width: 14px; height: 14px; flex: 0 0 14px;
  background: var(--sm-dark);
  border: 2px solid var(--sm-border);
  display: flex; align-items: center; justify-content: center;
}
.smui-check input:checked + .box::after {
  content: ''; width: 6px; height: 6px; background: var(--sm-ok);
}
.smui-check input:focus-visible + .box { outline: 2px solid var(--sm-ok); outline-offset: 2px; }
.smui-check.is-on { color: var(--sm-text); }

/* --- chips / badges ------------------------------------------------------ */
.smui-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--sm-dark);
  border: 2px solid var(--sm-border);
  padding: 3px 7px;
  font-size: 11px; font-weight: 700; letter-spacing: .06em;
  line-height: 1;
  white-space: nowrap;
}
.smui-badge {
  display: inline-block;
  padding: 3px 6px;
  font-size: 9px; font-weight: 700; letter-spacing: .1em;
  line-height: 1;
  border: 2px solid var(--sm-shadow);
  color: #09070f;
  background: var(--sm-muted);
}
.smui-badge.is-sealed { background: var(--sm-border); }
.smui-badge.is-opened { background: var(--sm-ok); }
.smui-badge.is-shiny  { background: #8fd0ff; }

/* --- scrollbars ---------------------------------------------------------- */
.smui-scroll { overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--sm-border) var(--sm-darker); }
.smui-scroll::-webkit-scrollbar { width: 12px; height: 12px; }
.smui-scroll::-webkit-scrollbar-track { background: var(--sm-darker); }
.smui-scroll::-webkit-scrollbar-thumb { background: var(--sm-border); border: 3px solid var(--sm-darker); }

/* --- window chrome ------------------------------------------------------- */
.smui-win {
  position: fixed;
  background: var(--sm-surface);
  border: 3px solid var(--sm-border);
  box-shadow: 6px 6px 0 var(--sm-shadow);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.smui-titlebar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px 9px 14px;
  background: var(--sm-dark);
  border-bottom: 3px solid var(--sm-border);
  cursor: grab;
  touch-action: none;
}
.smui-titlebar.is-dragging { cursor: grabbing; }
.smui-titlebar .title {
  font-family: ${THEME.display};
  font-weight: 600; font-size: 15px; letter-spacing: .14em;
  text-shadow: 2px 2px 0 var(--sm-shadow);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.smui-titlebar .spacer { flex: 1 1 auto; }
.smui-close {
  width: 28px; height: 28px; flex: 0 0 28px;
  padding: 0; font-size: 14px;
  box-shadow: 2px 2px 0 var(--sm-shadow);
}
.smui-close:active { transform: translate(2px,2px); box-shadow: 0 0 0 var(--sm-shadow); }

.smui-hidden { display: none !important; }
`

/** Injects the shared stylesheet once. Every mount() calls this first. */
export function ensureUiKit(): void {
  injectStyle('sm-ui-kit', KIT_CSS)
}
