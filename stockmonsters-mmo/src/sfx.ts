/*
 * sfx.ts — the game's sound effects.
 *
 *   play('hit-super')      // one shot
 *   setSfxEnabled(false)   // the HUD's SOUND EFFECTS toggle
 *
 * ## Three rules
 *
 * 1. **Silence is the safe failure.** A missing file, a browser that has not
 *    been interacted with yet, an audio element that refuses to play — all of
 *    it is caught and ignored. A game that throws because a sound would not
 *    load is worse than a quiet one.
 *
 * 2. **The player's setting is obeyed the moment it changes**, not on the next
 *    reload. The HUD writes `sm-set-sfx` and fires `sm:setting`; this listens.
 *
 * 3. **Nothing plays before the first click.** Browsers refuse audio until a
 *    page has been interacted with, and the refusal is an unhandled rejection
 *    in the console for every sound until then. We simply do not try.
 *
 * ## Where the sounds came from
 *
 * `new-assets/The Pokémon World Project - Kanto/Audio`, the same fan pack the
 * maps came from — WHICH MEANS THE SAME PROBLEM. These are derived from
 * Nintendo's games. Fine for a testnet and for showing people; they have to be
 * replaced before anything is public, exactly like the tilesets. See HANDOVER.
 */

const FILES = {
  /** A move connecting, at three strengths — the battle scene picks by effect. */
  hit: 'hit.ogg',
  'hit-super': 'hit-super.ogg',
  'hit-weak': 'hit-weak.ogg',
  /** A ball leaving the hand, wobbling, and clicking shut. */
  throw: 'throw.ogg',
  'ball-shake': 'ball-shake.ogg',
  'ball-click': 'ball-click.ogg',
  /** A creature going down. */
  faint: 'faint.ogg',
  /** UI: moving over something, and choosing it. */
  cursor: 'cursor.ogg',
  confirm: 'confirm.ogg',
  /** Fanfares. Longer, louder — used sparingly on purpose. */
  caught: 'caught.ogg',
  win: 'win.ogg',
  lose: 'lose.ogg',
} as const

export type SfxName = keyof typeof FILES

/** Per-sound volume. The fanfares are mastered much hotter than the blips. */
const GAIN: Partial<Record<SfxName, number>> = {
  caught: 0.45,
  win: 0.45,
  lose: 0.45,
  cursor: 0.25,
  confirm: 0.4,
  faint: 0.5,
}
const DEFAULT_GAIN = 0.6

const cache = new Map<SfxName, HTMLAudioElement>()
let enabled = true
let unlocked = false

/** Read the HUD's toggle. Absent means on, which is what a new player expects. */
function readSetting(): boolean {
  try {
    return localStorage.getItem('sm-set-sfx') !== '0'
  } catch {
    return true
  }
}

export function setSfxEnabled(value: boolean): void {
  enabled = value
}

export function isSfxEnabled(): boolean {
  return enabled
}

/**
 * Warm the cache. Optional — `play` loads on demand — but doing it after the
 * first interaction means the first hit of a battle is not a silent one while
 * the file downloads.
 */
export function preloadSfx(names: SfxName[] = Object.keys(FILES) as SfxName[]): void {
  for (const name of names) element(name)
}

function element(name: SfxName): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  let el = cache.get(name)
  if (!el) {
    try {
      el = new Audio(`/audio/${FILES[name]}`)
      el.preload = 'auto'
      el.volume = GAIN[name] ?? DEFAULT_GAIN
      cache.set(name, el)
    } catch {
      return null
    }
  }
  return el
}

/**
 * Play one sound. Never throws, never awaits, never queues: a sound that
 * arrives late is worse than one that does not arrive.
 *
 * Restarting from 0 rather than ignoring an in-flight play is deliberate —
 * three hits in a row should sound like three hits.
 */
export function play(name: SfxName): void {
  if (!enabled || !unlocked) return
  const el = element(name)
  if (!el) return
  try {
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* a browser that will not play is not an error worth surfacing */
  }
}

/**
 * Start listening for the setting, and for the first interaction that lets a
 * browser play anything at all.
 */
export function mountSfx(): void {
  enabled = readSetting()
  window.addEventListener('sm:setting', (e) => {
    const detail = (e as CustomEvent).detail
    if (detail?.id === 'sfx') setSfxEnabled(!!detail.value)
  })
  const unlock = () => {
    if (unlocked) return
    unlocked = true
    // Now that a gesture has happened, pulling the files down is free.
    preloadSfx(['cursor', 'confirm', 'hit', 'hit-super', 'hit-weak', 'faint'])
  }
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, unlock, { once: true, capture: true })
  }

  // The one place worth wiring globally: every button in our own UI clicks.
  // Doing it here rather than in twelve mount functions means a new panel gets
  // it for free, and a button that is added later cannot forget.
  document.addEventListener('pointerdown', (e) => {
    const btn = (e.target as HTMLElement)?.closest?.('.smui-btn, .fr-tab, .d-pick, .title-btn')
    if (btn) play('cursor')
  }, true)
}
