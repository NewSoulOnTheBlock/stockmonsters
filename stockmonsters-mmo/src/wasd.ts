/*
 * WASD, alongside the arrow keys.
 *
 *   mountWasd(() => controls)
 *
 * The engine binds the arrows itself. It does not bind WASD, and it cannot be
 * talked into it from here by dispatching keyboard events: RPG-JS reads its own
 * key state and IGNORES synthetic KeyboardEvents entirely — that is the trap
 * touch-controls.ts documents at length, and the reason its buttons drive
 * `applyControl` directly instead. So this does the same thing: it listens for
 * the letters and pushes the CONTROL name into the engine.
 *
 * The control name is not the key name. `applyControl` wants 'up', 'down',
 * 'left', 'right' — sending 'w' or 'ArrowUp' does nothing at all, silently.
 */

/** letter -> the engine's control name. */
const KEYS: Record<string, string> = {
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
}

type Controls = { applyControl?: (name: string, down?: boolean) => unknown } | null
let controlsOf: (() => Controls) | null = null
let mounted = false

/** Which controls we are currently holding down, so we can let go of them. */
const held = new Set<string>()

function push(control: string, down: boolean) {
  try {
    void controlsOf?.()?.applyControl?.(control, down)
  } catch {
    /* the engine is not up yet — the key simply does nothing */
  }
}

/**
 * Let go of everything.
 *
 * A key held when the tab loses focus never delivers its keyup, and the engine
 * keeps the control pressed — the player walks into a wall for as long as they
 * are looking at another window, and comes back to a character that will not
 * stop. Both this and touch-controls need the same safety net for the same
 * reason.
 */
export function releaseWasd(): void {
  for (const control of [...held]) {
    held.delete(control)
    push(control, false)
  }
}

/** Is the player typing rather than walking? */
function typing(): boolean {
  const a = document.activeElement as HTMLElement | null
  return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)
}

export function mountWasd(controls?: () => Controls): void {
  if (mounted || typeof window === 'undefined') return
  mounted = true
  controlsOf = controls ?? null

  window.addEventListener('keydown', (e) => {
    /*
     * NEVER while a modifier is down. `Ctrl+A` is select-all, `Cmd+S` is save,
     * `Cmd+W` closes the tab — a game that walks the player left every time
     * they press Ctrl+A is worse than one with no WASD at all.
     */
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (typing()) return
    const control = KEYS[e.key.toLowerCase()]
    if (!control) return
    // A held key repeats. The engine tracks state, not presses, so re-sending
    // is noise — and `e.repeat` is the only way to tell the two apart.
    if (e.repeat || held.has(control)) return
    held.add(control)
    push(control, true)
  })

  window.addEventListener('keyup', (e) => {
    const control = KEYS[e.key.toLowerCase()]
    if (!control || !held.has(control)) return
    held.delete(control)
    push(control, false)
  })

  /*
   * Release on anything that can eat a keyup: switching tabs, clicking into
   * another window, or the chat input taking focus mid-stride.
   */
  window.addEventListener('blur', releaseWasd)
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseWasd() })
  document.addEventListener('focusin', () => { if (typing()) releaseWasd() })
}
