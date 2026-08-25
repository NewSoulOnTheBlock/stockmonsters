// Battle FX library — the pixel-art effect vocabulary used by battle-scene.ts.
//
// Everything here is DOM + CSS: no canvas, no external assets, no network.
// Effects are one-shot nodes that mount into a slot's `.bs-fx` host and remove
// themselves; the persistent state (HP numbers, status tags, faint) lives in
// battle-scene.ts so a fast-forward can jump straight to it.
//
// Palette (established):
//   surface #26213a  border #f6c177  text #fff1c7  hard shadow #09070f
//   ok #7ecf6b       danger #e06c75  purple #b48ead  dark #1b1730
// Two extensions were needed for status themes and are used nowhere else:
//   ice #9fd8e0 (freeze) and drowsy #8b86b8 (sleep); frame #4a4368 was already
//   in the scene's HP bar border.

export const C = {
    surface: '#26213a',
    border: '#f6c177',
    text: '#fff1c7',
    shadow: '#09070f',
    ok: '#7ecf6b',
    danger: '#e06c75',
    purple: '#b48ead',
    dark: '#1b1730',
    frame: '#4a4368',
    ice: '#9fd8e0',
    drowsy: '#8b86b8',
} as const

/** Themed colour per non-volatile / volatile status. */
export function statusColor(status: string): string {
    switch (status) {
        case 'burn': return C.danger
        case 'poison': case 'toxic': return C.purple
        case 'paralysis': return C.border
        case 'sleep': return C.drowsy
        case 'freeze': return C.ice
        case 'confusion': return C.border
        case 'flinch': return C.text
        case 'bind': return C.purple
        default: return C.text
    }
}

/** Themed colour per stat, for the stage arrows. */
export function statColor(stat: string): string {
    switch (stat) {
        case 'atk': return C.danger
        case 'dfe': return C.ok
        case 'ats': return C.purple
        case 'dfs': return C.ice
        case 'spd': return C.border
        default: return C.text
    }
}

export const reducedMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// ---------------------------------------------------------------------------
// one-shot node helper
// ---------------------------------------------------------------------------

function spawn(host: HTMLElement, node: HTMLElement, lifetimeMs: number) {
    host.appendChild(node)
    const kill = () => node.remove()
    node.addEventListener('animationend', kill)
    setTimeout(kill, lifetimeMs + 400)
    return node
}

/** Restart a CSS animation driven by a class. */
export function retrigger(el: HTMLElement, cls: string) {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
}

// ---------------------------------------------------------------------------
// impact effects
// ---------------------------------------------------------------------------

/** The attacker leans into the target and snaps back. `dir` is a unit-ish vector. */
export function lunge(el: HTMLElement, dx: number, dy: number) {
    if (reducedMotion()) return
    el.style.setProperty('--lx', `${dx}px`)
    el.style.setProperty('--ly', `${dy}px`)
    retrigger(el, 'bs-lunging')
}

/** Target recoil: hard 1-frame-per-step shake. */
export function shake(el: HTMLElement, strength = 1) {
    if (reducedMotion()) return
    el.style.setProperty('--sh', `${Math.round(6 * strength)}px`)
    retrigger(el, 'bs-shaking')
}

/** White silhouette flash — filter on the wrapper hits the whole pixel sprite. */
export function whiteFlash(el: HTMLElement, hard = false) {
    retrigger(el, hard ? 'bs-flash-hard' : 'bs-flash')
}

/** Coloured glow pulse around the sprite silhouette, for status application. */
export function tintPulse(el: HTMLElement, color: string) {
    el.style.setProperty('--tint', color)
    retrigger(el, 'bs-tinting')
}

/** Damage/heal number that pops, rises and fades. */
export function floatNumber(
    host: HTMLElement,
    text: string,
    kind: 'damage' | 'crit' | 'heal' | 'residual' | 'recoil' = 'damage',
    color?: string,
) {
    const n = document.createElement('div')
    n.className = `bs-num bs-num-${kind}`
    n.textContent = text
    if (color) n.style.color = color
    // scatter a little so stacked hits stay readable
    n.style.setProperty('--jx', `${Math.round((Math.random() - 0.5) * 40)}px`)
    return spawn(host, n, 1100)
}

/**
 * Chunky plate that pops in over the target: SUPER EFFECTIVE / NO EFFECT / …
 * `tier` stacks a second plate above the first (crit + effectiveness together).
 */
export function banner(
    host: HTMLElement, text: string,
    kind: 'super' | 'weak' | 'none' | 'crit' | 'info' = 'info',
    tier = 0,
) {
    const n = document.createElement('div')
    n.className = `bs-banner bs-banner-${kind}`
    n.textContent = text
    if (tier) {
        n.style.top = `${-78 - tier * 46}px`
        n.style.animationDelay = `${tier * 90}ms`
    }
    return spawn(host, n, 1200 + tier * 100)
}

/** A miss: the word plus a ring of dust specks blowing outward. */
export function puff(host: HTMLElement, text: string, color = C.text) {
    const n = document.createElement('div')
    n.className = 'bs-puff'
    const label = document.createElement('div')
    label.className = 'bs-puff-label'
    label.textContent = text
    label.style.color = color
    n.appendChild(label)
    for (let i = 0; i < 8; i++) {
        const d = document.createElement('i')
        const a = (i / 8) * Math.PI * 2
        d.style.setProperty('--px', `${Math.round(Math.cos(a) * 54)}px`)
        d.style.setProperty('--py', `${Math.round(Math.sin(a) * 40)}px`)
        d.style.animationDelay = `${i * 18}ms`
        d.style.background = color
        n.appendChild(d)
    }
    return spawn(host, n, 900)
}

/** Stat stage change: chevrons marching up (raise) or down (drop) in stat colour. */
export function stageArrows(host: HTMLElement, stat: string, delta: number) {
    const n = document.createElement('div')
    n.className = `bs-stage ${delta > 0 ? 'up' : 'down'}`
    n.style.setProperty('--sc', statColor(stat))
    const label = document.createElement('div')
    label.className = 'bs-stage-label'
    label.textContent = `${stat.toUpperCase()} ${delta > 0 ? 'UP' : 'DOWN'}${Math.abs(delta) > 1 ? '!' : ''}`
    n.appendChild(label)
    const count = Math.min(3, Math.max(1, Math.abs(delta)) + 1)
    for (let i = 0; i < count; i++) {
        const c = document.createElement('i')
        c.style.animationDelay = `${i * 90}ms`
        c.style.setProperty('--ox', `${(i - (count - 1) / 2) * 22}px`)
        n.appendChild(c)
    }
    return spawn(host, n, 1000)
}

/** A wild creature arriving: it slides in from off-screen with a blow-out flash. */
export function appear(slot: HTMLElement, from: 'right' | 'left') {
    slot.style.setProperty('--ax', from === 'right' ? '62vw' : '-62vw')
    retrigger(slot, 'bs-appearing')
}

/** Full-screen stepped bar wipe. Returns the ms it will take. */
export function wipe(root: HTMLElement, dir: 'in' | 'out'): number {
    const old = root.querySelector('.bs-wipe')
    if (old) old.remove()
    const n = document.createElement('div')
    n.className = `bs-wipe bs-wipe-${dir}`
    const bars = 14
    for (let i = 0; i < bars; i++) {
        const b = document.createElement('i')
        // meet-in-the-middle ordering reads as a deliberate transition, not a sweep
        const order = Math.abs(i - (bars - 1) / 2)
        b.style.animationDelay = `${(dir === 'in' ? order : bars / 2 - order) * 26}ms`
        n.appendChild(b)
    }
    root.appendChild(n)
    const total = 520
    setTimeout(() => n.remove(), total)
    return total
}

// ---------------------------------------------------------------------------
// CSS — appended once by battle-scene.ts
// ---------------------------------------------------------------------------

export const FX_CSS = `
/* the effect anchor sits high on the sprite so numbers rise clear of the art */
#battle-scene .bs-fx {
  position: absolute; left: 50%; top: 28%;
  width: 0; height: 0; z-index: 6;
  pointer-events: none;
}

/* ---- floating numbers ---------------------------------------------------- */
#battle-scene .bs-num {
  position: absolute; left: 0; top: 0;
  transform: translate(-50%, 0);
  white-space: nowrap;
  font-weight: 700; font-size: 30px; line-height: 1;
  letter-spacing: .04em;
  color: ${C.text};
  text-shadow:
    2px 0 ${C.shadow}, -2px 0 ${C.shadow}, 0 2px ${C.shadow}, 0 -2px ${C.shadow},
    2px 2px ${C.shadow}, -2px 2px ${C.shadow}, 2px -2px ${C.shadow}, -2px -2px ${C.shadow},
    4px 5px rgba(9,7,15,.75);
  animation: bs-rise 1s forwards;
}
#battle-scene .bs-num-crit {
  font-size: 46px; color: ${C.border};
  animation: bs-rise-crit 1.1s forwards;
}
#battle-scene .bs-num-heal { color: ${C.ok}; font-size: 26px; }
#battle-scene .bs-num-residual { font-size: 24px; }
#battle-scene .bs-num-recoil { color: ${C.purple}; font-size: 24px; }
@keyframes bs-rise {
  0%   { transform: translate(calc(-50% + var(--jx,0px)), 16px) scale(.6); opacity: 0;
         animation-timing-function: steps(2, jump-none); }
  14%  { transform: translate(calc(-50% + var(--jx,0px)), -6px) scale(1.25); opacity: 1;
         animation-timing-function: steps(2, jump-none); }
  26%  { transform: translate(calc(-50% + var(--jx,0px)), -14px) scale(1); opacity: 1;
         animation-timing-function: steps(5, jump-none); }
  70%  { transform: translate(calc(-50% + var(--jx,0px)), -44px) scale(1); opacity: 1;
         animation-timing-function: steps(3, jump-none); }
  100% { transform: translate(calc(-50% + var(--jx,0px)), -66px) scale(1); opacity: 0; }
}
@keyframes bs-rise-crit {
  0%   { transform: translate(calc(-50% + var(--jx,0px)), 20px) scale(.4); opacity: 0;
         animation-timing-function: steps(2, jump-none); }
  10%  { transform: translate(calc(-50% + var(--jx,0px)), -10px) scale(1.7); opacity: 1;
         animation-timing-function: steps(2, jump-none); }
  20%  { transform: translate(calc(-50% + var(--jx,0px)), -16px) scale(1.15); opacity: 1;
         animation-timing-function: steps(2, jump-none); }
  30%  { transform: translate(calc(-46% + var(--jx,0px)), -22px) scale(1.3); opacity: 1;
         animation-timing-function: steps(6, jump-none); }
  74%  { transform: translate(calc(-50% + var(--jx,0px)), -56px) scale(1.15); opacity: 1;
         animation-timing-function: steps(3, jump-none); }
  100% { transform: translate(calc(-50% + var(--jx,0px)), -80px) scale(1.15); opacity: 0; }
}

/* ---- banners ------------------------------------------------------------- */
#battle-scene .bs-banner {
  position: absolute; left: 0; top: -78px;
  transform: translate(-50%, 0);
  white-space: nowrap;
  padding: 6px 12px;
  font-weight: 700; font-size: 17px; letter-spacing: .1em;
  background: ${C.dark}; color: ${C.text};
  border: 3px solid ${C.border};
  box-shadow: 4px 4px 0 ${C.shadow};
  animation: bs-banner-pop 1.1s steps(8, jump-none) both;
}
#battle-scene .bs-banner-super { border-color: ${C.border}; color: ${C.border}; font-size: 20px; }
#battle-scene .bs-banner-crit  { border-color: ${C.danger}; color: ${C.danger}; }
#battle-scene .bs-banner-weak  { border-color: ${C.frame}; color: ${C.purple}; font-size: 14px; letter-spacing: .04em; }
#battle-scene .bs-banner-none  { border-color: ${C.frame}; color: ${C.text}; }
@keyframes bs-banner-pop {
  0%   { opacity: 0; transform: translate(-50%, 8px) scaleY(.2); }
  12%  { opacity: 1; transform: translate(-50%, 0) scaleY(1.18); }
  22%  { opacity: 1; transform: translate(-50%, 0) scaleY(.94); }
  30%  { opacity: 1; transform: translate(-50%, 0) scaleY(1); }
  78%  { opacity: 1; transform: translate(-50%, -6px) scaleY(1); }
  100% { opacity: 0; transform: translate(-50%, -14px) scaleY(1); }
}

/* ---- miss / no-effect puff ---------------------------------------------- */
#battle-scene .bs-puff { position: absolute; left: 0; top: 0; }
#battle-scene .bs-puff-label {
  position: absolute; left: 0; top: -14px;
  transform: translate(-50%, 0);
  font-weight: 700; font-size: 28px; letter-spacing: .16em;
  text-shadow:
    2px 0 ${C.shadow}, -2px 0 ${C.shadow}, 0 2px ${C.shadow}, 0 -2px ${C.shadow},
    2px 2px ${C.shadow}, -2px 2px ${C.shadow}, 3px 4px rgba(9,7,15,.8);
  animation: bs-puff-label .95s steps(4, jump-none) forwards;
}
@keyframes bs-puff-label {
  0%   { opacity: 0; transform: translate(-50%, 10px) scale(.7); }
  18%  { opacity: 1; transform: translate(-50%, -4px) scale(1.2); }
  30%  { opacity: 1; transform: translate(-50%, -8px) scale(1); }
  70%  { opacity: 1; transform: translate(-50%, -20px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -34px) scale(1); }
}
#battle-scene .bs-puff > i {
  position: absolute; left: 0; top: 0;
  width: 7px; height: 7px;
  box-shadow: 0 0 0 2px ${C.shadow};
  animation: bs-puff-dot .6s steps(4, jump-none) both;
}
@keyframes bs-puff-dot {
  0%   { opacity: 1; transform: translate(-50%, -50%) scale(.4); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--px)), calc(-50% + var(--py))) scale(1.2); }
}

/* ---- stat stage arrows --------------------------------------------------- */
#battle-scene .bs-stage { position: absolute; left: 0; top: 0; }
#battle-scene .bs-stage-label {
  position: absolute; left: 0; top: -6px;
  transform: translate(-50%, 0);
  white-space: nowrap;
  font-weight: 700; font-size: 15px; letter-spacing: .12em;
  color: var(--sc);
  text-shadow: 2px 0 ${C.shadow}, -2px 0 ${C.shadow}, 0 2px ${C.shadow}, 0 -2px ${C.shadow}, 3px 3px ${C.shadow};
  animation: bs-stage-label .95s steps(4, jump-none) forwards;
}
@keyframes bs-stage-label {
  0% { opacity: 0; transform: translate(-50%, 6px); }
  20% { opacity: 1; transform: translate(-50%, -2px); }
  75% { opacity: 1; transform: translate(-50%, -10px); }
  100% { opacity: 0; transform: translate(-50%, -18px); }
}
#battle-scene .bs-stage > i {
  position: absolute; left: 0; top: 0;
  width: 0; height: 0;
  border-left: 11px solid transparent;
  border-right: 11px solid transparent;
  filter: drop-shadow(2px 2px 0 ${C.shadow});
}
#battle-scene .bs-stage.up > i {
  border-bottom: 15px solid var(--sc);
  animation: bs-arrow-up .85s steps(5, jump-none) both;
}
#battle-scene .bs-stage.down > i {
  border-top: 15px solid var(--sc);
  animation: bs-arrow-down .85s steps(5, jump-none) both;
}
@keyframes bs-arrow-up {
  0%   { opacity: 0; transform: translate(calc(-50% + var(--ox)), 26px); }
  25%  { opacity: 1; transform: translate(calc(-50% + var(--ox)), 6px); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--ox)), -46px); }
}
@keyframes bs-arrow-down {
  0%   { opacity: 0; transform: translate(calc(-50% + var(--ox)), -34px); }
  25%  { opacity: 1; transform: translate(calc(-50% + var(--ox)), -14px); }
  100% { opacity: 0; transform: translate(calc(-50% + var(--ox)), 34px); }
}

/* ---- sprite motion ------------------------------------------------------- */
#battle-scene .bs-lunge.bs-lunging { animation: bs-lunge .42s steps(3, jump-none) 1; }
@keyframes bs-lunge {
  0%   { transform: translate(0, 0); }
  38%  { transform: translate(var(--lx), var(--ly)); }
  56%  { transform: translate(calc(var(--lx) * 1.1), calc(var(--ly) * 1.1)); }
  100% { transform: translate(0, 0); }
}
/*
 * NOTE ON steps(): a timing function applies BETWEEN two keyframes, not across
 * the whole animation. steps(2) on a 0%/50%/100% flash therefore gives a white
 * frame lasting a quarter of the duration, not half — measured, not guessed.
 * Anything that must HOLD a state uses steps(1, jump-end) (= step-end: hold the
 * segment's start value, then jump), and the hold length is set by where the
 * keyframe sits.
 */
#battle-scene .bs-shake.bs-shaking { animation: bs-shake .3s steps(1, jump-end) 3; }
@keyframes bs-shake {
  0%   { transform: translate(calc(var(--sh) * -1), 0); }
  20%  { transform: translate(var(--sh), calc(var(--sh) * -.6)); }
  40%  { transform: translate(calc(var(--sh) * -.7), calc(var(--sh) * .6)); }
  60%  { transform: translate(calc(var(--sh) * .7), calc(var(--sh) * -.3)); }
  80%  { transform: translate(calc(var(--sh) * -.35), 0); }
  100% { transform: translate(0, 0); }
}
/* white for 55% of each iteration — long enough to actually read as an impact */
#battle-scene .bs-flashwrap.bs-flash { animation: bs-flashk .34s steps(1, jump-end) 2; }
#battle-scene .bs-flashwrap.bs-flash-hard { animation: bs-flashk .26s steps(1, jump-end) 3; }
@keyframes bs-flashk {
  0%   { filter: brightness(0) invert(1) drop-shadow(0 6px 0 rgba(9,7,15,.55)); }
  55%  { filter: none; }
  100% { filter: none; }
}
#battle-scene .bs-flashwrap.bs-tinting { animation: bs-tint .42s steps(1, jump-end) 4; }
@keyframes bs-tint {
  0%   { filter: drop-shadow(0 0 0 var(--tint)) drop-shadow(0 0 6px var(--tint)) drop-shadow(0 0 6px var(--tint)) drop-shadow(0 0 6px var(--tint)); }
  50%  { filter: drop-shadow(0 0 0 var(--tint)) drop-shadow(0 0 3px var(--tint)); }
  100% { filter: none; }
}
#battle-scene .bs-slot.bs-appearing { animation: bs-appear .72s 1; }
@keyframes bs-appear {
  /* slide in as a white silhouette in 6 hard steps… */
  0%   { transform: translateX(var(--ax)); filter: brightness(0) invert(1);
         animation-timing-function: steps(6, jump-none); }
  /* …then two blow-out flashes as it lands */
  60%  { transform: translateX(0); filter: brightness(0) invert(1);
         animation-timing-function: steps(1, jump-end); }
  70%  { transform: translateX(0); filter: none; animation-timing-function: steps(1, jump-end); }
  80%  { transform: translateX(0); filter: brightness(0) invert(1);
         animation-timing-function: steps(1, jump-end); }
  90%  { transform: translateX(0); filter: none; animation-timing-function: steps(1, jump-end); }
  100% { transform: translateX(0); filter: none; }
}
#battle-scene .bs-slot.fainted .bs-lunge { animation: bs-faint .8s steps(6, jump-none) forwards; }
@keyframes bs-faint {
  0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
  18%  { transform: translateY(-10px) rotate(-4deg); opacity: 1; }
  100% { transform: translateY(90px) rotate(16deg); opacity: 0; }
}

/* ---- full-screen wipe ---------------------------------------------------- */
#battle-scene .bs-wipe {
  position: absolute; inset: 0; z-index: 40;
  display: flex; pointer-events: none;
}
#battle-scene .bs-wipe > i {
  flex: 1 1 0; height: 100%;
  background: ${C.dark};
  box-shadow: inset 0 0 0 1px ${C.shadow};
  transform-origin: 50% 50%;
}
#battle-scene .bs-wipe-in > i  { transform: scaleY(1); animation: bs-wipe-open .4s steps(4, jump-none) forwards; }
#battle-scene .bs-wipe-out > i { transform: scaleY(0); animation: bs-wipe-shut .4s steps(4, jump-none) forwards; }
@keyframes bs-wipe-open { from { transform: scaleY(1); } to { transform: scaleY(0); } }
@keyframes bs-wipe-shut { from { transform: scaleY(0); } to { transform: scaleY(1); } }

/* ---- reduced motion: keep the information, drop the travel --------------- */
@media (prefers-reduced-motion: reduce) {
  #battle-scene .bs-lunge.bs-lunging,
  #battle-scene .bs-shake.bs-shaking,
  #battle-scene .bs-slot.bs-appearing,
  #battle-scene .bs-sprite,
  #battle-scene .bs-wipe > i { animation: none !important; transform: none !important; }
  #battle-scene .bs-slot.fainted .bs-lunge { animation: none !important; opacity: .15; }
  #battle-scene .bs-wipe { display: none; }
  #battle-scene .bs-num,
  #battle-scene .bs-banner,
  #battle-scene .bs-puff-label,
  #battle-scene .bs-stage-label { animation: bs-static-hold 1s steps(2, jump-none) forwards; }
  #battle-scene .bs-stage > i, #battle-scene .bs-puff > i { display: none; }
  @keyframes bs-static-hold {
    0% { opacity: 1; transform: translate(-50%, 0); }
    85% { opacity: 1; transform: translate(-50%, 0); }
    100% { opacity: 0; transform: translate(-50%, 0); }
  }
}
`
