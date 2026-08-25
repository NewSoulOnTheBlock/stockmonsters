// Battle visual scene — a DOM overlay driven by `player.emit()` events from
// the server (src/modules/main/battle.ts). The dialog GUI keeps driving the
// flow (choices, text); this layer paints the classic battle picture under it
// and *plays the turn out* instead of snapping to the result.
//
// Two channels:
//   battle:state { mine, wild, intro? }  — the snapshot, the SOURCE OF TRUTH
//   battle:turn  { events }              — the turn's event list, in order
//   battle:end   {}                      — teardown
//
// The events carry their own exact HP (`targetHp` / `hp` straight out of the
// rules engine) so the animation never invents a number, and every burst is
// reconciled against the snapshot that follows it: if a snapshot arrives while
// the queue is still playing it is held and applied the moment the queue
// drains (or the moment the player fast-forwards). The scene therefore can
// never end up disagreeing with the server.
//
// z-index 800 puts it above the map but under the dialog layer (1000).

import type { TurnEvent } from './battle/turn'
import {
    C, FX_CSS, appear, banner, floatNumber, lunge, puff, reducedMotion, shake,
    stageArrows, statusColor, tintPulse, whiteFlash, wipe,
} from './battle-fx'

interface BattlerView {
    name: string
    level: number
    hp: number
    maxHp: number
    sprite: string
    status?: string
}

interface BattleStatePayload {
    wild: BattlerView
    mine: BattlerView
    /** first snapshot of a battle — play the entry wipe */
    intro?: boolean
}

/** The rules' event union plus the two the battle module synthesises. */
type SceneEvent =
    | TurnEvent
    | { type: 'appear'; side: 0 | 1 }
    | { type: 'ball'; side: 0 | 1; bounces: number; caught: boolean }

// side 0 is the player's creature, side 1 is the wild one (battle.ts orders
// `sides` that way and the rules pass the index straight through).
const KEY = ['mine', 'wild'] as const
type SideKey = (typeof KEY)[number]

/** How long each beat holds the stage before the next event plays. */
const BEATS: Record<string, number> = {
    appear: 760,
    used: 260,
    damage: 520,
    'self-hit': 520,
    recoil: 420,
    heal: 480,
    missed: 480,
    immune: 560,
    prevented: 480,
    status: 560,
    'status-failed': 380,
    stage: 460,
    residual: 520,
    hits: 340,
    bound: 400,
    protected: 400,
    charging: 420,
    recharging: 380,
    weather: 420,
    screen: 400,
    ball: 640,
    fainted: 820,
}

const html = `
<div class="bs-bg"></div>
<div class="bs-floor bs-floor-wild"></div>
<div class="bs-floor bs-floor-mine"></div>

<div class="bs-panel bs-panel-wild">
  <div class="bs-name"></div>
  <div class="bs-hpbar"><i></i></div>
</div>
<div class="bs-slot bs-slot-wild">
  <div class="bs-lunge"><div class="bs-shake"><div class="bs-flashwrap">
    <img class="bs-sprite bs-sprite-wild" alt="">
  </div></div></div>
  <div class="bs-fx"></div>
</div>

<div class="bs-panel bs-panel-mine">
  <div class="bs-name"></div>
  <div class="bs-hpbar"><i></i></div>
  <div class="bs-hptext"></div>
</div>
<div class="bs-slot bs-slot-mine">
  <div class="bs-lunge"><div class="bs-shake"><div class="bs-flashwrap">
    <img class="bs-sprite bs-sprite-mine" alt="">
  </div></div></div>
  <div class="bs-fx"></div>
</div>
`

const css = `
#battle-scene {
  position: fixed; inset: 0; z-index: 800;
  display: none; overflow: hidden;
  image-rendering: pixelated;
  font-family: "Courier New", ui-monospace, monospace;
}
#battle-scene, #battle-scene * { image-rendering: pixelated; }
#battle-scene.open { display: block; }
#battle-scene .bs-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 70% 45% at 78% 62%, rgba(246,193,119,.22), transparent 60%),
    radial-gradient(ellipse 70% 45% at 22% 92%, rgba(126,207,107,.16), transparent 60%),
    linear-gradient(${C.dark} 0%, ${C.surface} 55%, ${C.dark} 100%);
}
/* weather tints — set on the root by the 'weather' event */
#battle-scene.wx-rain .bs-bg { filter: hue-rotate(-18deg) saturate(.8) brightness(.85); }
#battle-scene.wx-sun .bs-bg { filter: saturate(1.3) brightness(1.15); }
#battle-scene.wx-sandstorm .bs-bg { filter: sepia(.5) saturate(1.1); }
#battle-scene.wx-hail .bs-bg { filter: hue-rotate(140deg) brightness(1.05); }

/* stage discs, so the sprites stand on something */
#battle-scene .bs-floor {
  position: absolute; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 50%, rgba(246,193,119,.20), rgba(27,23,48,0) 70%);
  box-shadow: inset 0 0 0 3px rgba(74,67,104,.35);
}
#battle-scene .bs-floor-wild { right: 6%;  top: 44%;    width: min(42vmin, 320px); height: min(11vmin, 78px); }
#battle-scene .bs-floor-mine { left: 5%;   bottom: 16%; width: min(48vmin, 360px); height: min(13vmin, 92px); }

#battle-scene .bs-slot {
  position: absolute; z-index: 5;
  width: min(34vmin, 240px);
}
#battle-scene .bs-slot-wild { right: 12%; top: 16%; }
#battle-scene .bs-slot-mine { left: 12%; bottom: 22%; }
#battle-scene .bs-lunge, #battle-scene .bs-shake, #battle-scene .bs-flashwrap { display: block; }
#battle-scene .bs-sprite {
  display: block; width: 100%; height: auto;
  filter: drop-shadow(0 6px 0 rgba(9,7,15,.55));
}
#battle-scene .bs-sprite-wild { animation: bs-idle-wild 2.6s steps(4, jump-none) infinite; }
#battle-scene .bs-sprite-mine { transform: scaleX(-1); animation: bs-idle-mine 2.2s steps(4, jump-none) infinite; }
@keyframes bs-idle-wild { 50% { transform: translateY(-6px); } }
@keyframes bs-idle-mine { 0%, 100% { transform: scaleX(-1); } 50% { transform: scaleX(-1) translateY(-5px); } }

#battle-scene .bs-panel {
  position: absolute; z-index: 10;
  min-width: min(280px, 44vw);
  padding: 10px 14px;
  background: ${C.surface};
  border: 3px solid ${C.border};
  box-shadow: 4px 4px 0 ${C.shadow};
  color: ${C.text};
}
#battle-scene .bs-panel-wild { left: 6%; top: 10%; }
#battle-scene .bs-panel-mine { right: 6%; bottom: 24%; }
#battle-scene .bs-name { font-weight: 700; font-size: 14px; letter-spacing: .06em; margin-bottom: 8px; }
#battle-scene .bs-name .bs-status {
  margin-left: 8px; padding: 1px 6px; font-size: 11px;
  background: ${C.purple}; color: ${C.shadow}; border: 2px solid ${C.shadow};
  text-transform: uppercase;
}
#battle-scene .bs-name .bs-status.pulsing { animation: bs-tag-pulse .42s steps(1, jump-end) 5; }
@keyframes bs-tag-pulse { 0% { filter: brightness(2.4); } 50% { filter: none; } 100% { filter: none; } }
#battle-scene .bs-hpbar {
  height: 10px; background: ${C.shadow}; border: 2px solid ${C.frame};
}
#battle-scene .bs-hpbar > i {
  display: block; height: 100%; width: 100%;
  background: ${C.ok};
}
#battle-scene .bs-hpbar > i.low { background: ${C.border}; }
#battle-scene .bs-hpbar > i.critical { background: ${C.danger}; animation: bs-hp-alarm .7s steps(1, jump-end) infinite; }
@keyframes bs-hp-alarm { 0% { filter: none; } 50% { filter: brightness(1.7); } 100% { filter: none; } }
#battle-scene .bs-hptext { margin-top: 6px; font-size: 12px; text-align: right; }
` + FX_CSS

interface SideState {
    hp: number
    maxHp: number
    shown: number
    status?: string
    raf: number
    /** effectiveness banner already shown for this burst */
    banneredThisBurst: boolean
}

export function mountBattleScene(socket: { on: (type: string, cb: (data: any) => void) => void }) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = 'battle-scene'
    root.innerHTML = html
    document.body.appendChild(root)

    const el = (sel: string) => root.querySelector(sel) as HTMLElement
    const slot = (k: SideKey) => el(`.bs-slot-${k}`)
    const fxHost = (k: SideKey) => slot(k).querySelector('.bs-fx') as HTMLElement
    const panel = (k: SideKey) => el(`.bs-panel-${k}`)

    const state: Record<SideKey, SideState> = {
        mine: { hp: 0, maxHp: 1, shown: 0, raf: 0, banneredThisBurst: false },
        wild: { hp: 0, maxHp: 1, shown: 0, raf: 0, banneredThisBurst: false },
    }

    // ---- queue ------------------------------------------------------------
    let queue: SceneEvent[] = []
    let timer = 0
    let playing = false
    let pending: BattleStatePayload | null = null

    // ---- HP rendering -----------------------------------------------------

    function renderBar(k: SideKey) {
        const s = state[k]
        const p = panel(k)
        const bar = p.querySelector('.bs-hpbar > i') as HTMLElement
        const ratio = Math.max(0, Math.min(1, s.shown / (s.maxHp || 1)))
        // quantise the bar to whole steps so it drains chunky, not liquid
        const steps = 40
        bar.style.width = `${(Math.ceil(ratio * steps) / steps) * 100}%`
        bar.className = ratio <= 0.2 ? 'critical' : ratio <= 0.5 ? 'low' : ''
        const hptext = p.querySelector('.bs-hptext') as HTMLElement | null
        if (hptext) hptext.textContent = `${Math.max(0, Math.round(s.shown))}/${s.maxHp}`
    }

    /** Drain (or refill) toward `hp`. Stepped, never smooth; instant if asked. */
    function setHp(k: SideKey, hp: number, animate: boolean) {
        const s = state[k]
        s.hp = Math.max(0, hp)
        if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0 }
        if (!animate || reducedMotion() || s.shown === s.hp) {
            s.shown = s.hp
            renderBar(k)
            return
        }
        const from = s.shown
        const to = s.hp
        const t0 = performance.now()
        const dur = 460
        const STEPS = 12
        const tick = (now: number) => {
            const p = Math.min(1, (now - t0) / dur)
            const q = Math.ceil(p * STEPS) / STEPS
            s.shown = from + (to - from) * q
            renderBar(k)
            if (p < 1) s.raf = requestAnimationFrame(tick)
            else { s.raf = 0; s.shown = to; renderBar(k) }
        }
        s.raf = requestAnimationFrame(tick)
    }

    function setStatus(k: SideKey, status: string | undefined, pulse: boolean) {
        state[k].status = status
        const name = panel(k).querySelector('.bs-name') as HTMLElement
        const old = name.querySelector('.bs-status')
        if (old) old.remove()
        if (!status) return
        const tag = document.createElement('span')
        tag.className = 'bs-status'
        tag.textContent = status
        tag.style.background = statusColor(status)
        if (pulse) tag.classList.add('pulsing')
        name.appendChild(tag)
    }

    // ---- event playback ---------------------------------------------------

    const other = (s: 0 | 1) => (s === 0 ? 1 : 0) as 0 | 1
    /** mine attacks up-right toward the wild slot; the wild attacks down-left. */
    const lungeVec = (k: SideKey) => (k === 'mine' ? [64, -46] : [-64, 46])

    function apply(e: SceneEvent, animate: boolean) {
        const k = 'side' in e ? KEY[(e as any).side as 0 | 1] : 'wild'
        const host = fxHost(k)
        const sl = slot(k)
        const flashwrap = sl.querySelector('.bs-flashwrap') as HTMLElement
        const shakewrap = sl.querySelector('.bs-shake') as HTMLElement
        const lungewrap = sl.querySelector('.bs-lunge') as HTMLElement

        switch (e.type) {
            case 'appear': {
                sl.classList.remove('fainted')
                if (animate) appear(sl, k === 'wild' ? 'right' : 'left')
                break
            }
            case 'used': {
                if (animate) {
                    const [dx, dy] = lungeVec(k)
                    lunge(lungewrap, dx, dy)
                    banner(host, e.move.replace(/_/g, ' ').toUpperCase(), 'info')
                }
                break
            }
            case 'damage': {
                setHp(k, e.targetHp, animate)
                if (!animate) break
                shake(shakewrap, e.critical ? 1.6 : e.effectiveness > 1 ? 1.3 : 1)
                whiteFlash(flashwrap, e.critical || e.effectiveness > 1)
                if (e.amount > 0) floatNumber(host, `-${e.amount}`, e.critical ? 'crit' : 'damage')
                // crit and effectiveness stack: the crit plate sits under the
                // effectiveness plate rather than replacing it
                if (e.critical) banner(host, 'CRITICAL!', 'crit')
                if (!state[k].banneredThisBurst && e.effectiveness !== 1 && e.effectiveness > 0) {
                    const sup = e.effectiveness > 1
                    banner(host, sup ? 'SUPER EFFECTIVE!' : 'not very effective', sup ? 'super' : 'weak',
                           e.critical ? 1 : 0)
                    state[k].banneredThisBurst = true
                }
                break
            }
            case 'self-hit': {
                setHp(k, e.hp, animate)
                if (!animate) break
                shake(shakewrap, 1.2)
                whiteFlash(flashwrap)
                tintPulse(flashwrap, statusColor('confusion'))
                floatNumber(host, `-${e.amount}`, 'damage')
                banner(host, 'CONFUSED!', 'info')
                break
            }
            case 'recoil': {
                setHp(k, e.hp, animate)
                if (!animate) break
                shake(shakewrap, 0.7)
                floatNumber(host, `-${e.amount}`, 'recoil')
                banner(host, 'RECOIL', 'weak')
                break
            }
            case 'heal': {
                setHp(k, e.hp, animate)
                if (!animate) break
                tintPulse(flashwrap, C.ok)
                floatNumber(host, `+${e.amount}`, 'heal')
                break
            }
            case 'residual': {
                setHp(k, e.hp, animate)
                if (!animate) break
                shake(shakewrap, 0.5)
                tintPulse(flashwrap, statusColor(e.status))
                floatNumber(host, `-${e.amount}`, 'residual', statusColor(e.status))
                banner(host, e.status.toUpperCase(), 'weak')
                break
            }
            case 'missed': {
                // `side` on a miss is the ATTACKER; the puff belongs on the target
                if (!animate) break
                const tk = KEY[other(e.side)]
                puff(fxHost(tk), 'MISS', C.text)
                break
            }
            case 'immune': {
                if (!animate) break
                puff(host, 'NO EFFECT', C.purple)
                break
            }
            case 'prevented': {
                if (!animate) break
                const st = e.reason.replace('-self-hit', '')
                tintPulse(flashwrap, statusColor(st))
                banner(host, e.reason.replace(/-/g, ' ').toUpperCase(), 'none')
                break
            }
            case 'status': {
                setStatus(k, e.status, animate)
                if (!animate) break
                tintPulse(flashwrap, statusColor(e.status))
                shake(shakewrap, 0.5)
                banner(host, `${e.status.toUpperCase()}!`, 'none')
                break
            }
            case 'status-failed': {
                if (animate) banner(host, 'IT FAILED', 'weak')
                break
            }
            case 'stage': {
                if (animate) stageArrows(host, e.stat, e.delta)
                break
            }
            case 'hits': {
                if (animate) banner(fxHost(KEY[other(e.side)]), `${e.count} HITS!`, 'info')
                break
            }
            case 'protected': {
                if (animate) { whiteFlash(flashwrap); banner(host, 'PROTECTED', 'info') }
                break
            }
            case 'charging': {
                if (animate) { tintPulse(flashwrap, C.border); banner(host, 'CHARGING…', 'info') }
                break
            }
            case 'recharging': {
                if (animate) banner(host, 'RECHARGING', 'none')
                break
            }
            case 'bound': {
                if (animate) { tintPulse(flashwrap, C.purple); banner(host, 'BOUND!', 'none') }
                break
            }
            case 'screen': {
                if (animate) banner(host, e.screen.replace(/_/g, ' ').toUpperCase(), 'info')
                break
            }
            case 'weather': {
                root.className = root.className.replace(/\bwx-\S+/g, '').trim()
                if (e.weather && e.weather !== 'none') root.classList.add(`wx-${e.weather}`)
                break
            }
            case 'ball': {
                if (!animate) break
                shake(shakewrap, 0.8)
                banner(host, e.caught ? 'GOTCHA!' : `SHOOK ${e.bounces}×`, e.caught ? 'super' : 'none')
                break
            }
            case 'fainted': {
                setHp(k, 0, animate)
                sl.classList.add('fainted')
                if (animate) banner(host, 'FAINTED', 'none')
                break
            }
        }
    }

    function step() {
        timer = 0
        const e = queue.shift()
        if (!e) { finish(); return }
        apply(e, true)
        const beat = BEATS[e.type] ?? 300
        timer = window.setTimeout(step, beat)
    }

    function finish(instant = false) {
        playing = false
        state.mine.banneredThisBurst = false
        state.wild.banneredThisBurst = false
        if (pending) { const p = pending; pending = null; applySnapshot(p, !instant) }
    }

    /**
     * Jump to the end of the burst: apply every remaining event with no motion,
     * snap any HP bar still draining, then reconcile against the held snapshot.
     * After this the scene shows exactly what the server last said.
     */
    function fastForward() {
        if (!playing) return
        if (timer) { clearTimeout(timer); timer = 0 }
        const rest = queue
        queue = []
        for (const e of rest) apply(e, false)
        for (const k of KEY) setHp(k, state[k].hp, false)  // kill in-flight tweens
        finish(true)
    }

    function play(events: SceneEvent[]) {
        fastForward()          // a new burst supersedes whatever is still running
        if (!events?.length) return
        queue = events.slice()
        playing = true
        state.mine.banneredThisBurst = false
        state.wild.banneredThisBurst = false
        step()
    }

    // ---- snapshots (the truth) -------------------------------------------

    function applySnapshot(data: BattleStatePayload, animate: boolean) {
        for (const k of KEY) {
            const b = data[k]
            if (!b) continue
            const s = state[k]
            s.maxHp = b.maxHp || 1
            const nameEl = panel(k).querySelector('.bs-name') as HTMLElement
            nameEl.textContent = `${b.name}  L${b.level}`
            setStatus(k, b.status, false)   // rebuilds the tag; never stacks them

            const sprite = slot(k).querySelector('img') as HTMLImageElement
            if (b.sprite && !sprite.src.endsWith(b.sprite)) sprite.src = b.sprite
            slot(k).classList.toggle('fainted', b.hp <= 0)
            setHp(k, b.hp, animate && s.shown !== b.hp)
        }
    }

    // ---- wiring -----------------------------------------------------------

    socket.on('battle:state', (data: BattleStatePayload) => {
        if (!data?.wild || !data?.mine) return
        if (!root.classList.contains('open')) {
            // fresh battle: paint instantly under the wipe, then reveal
            root.className = ''
            root.classList.add('open')
            state.mine.shown = data.mine.hp
            state.wild.shown = data.wild.hp
            applySnapshot(data, false)
            const ms = wipe(root, 'in')
            // let the wipe get out of the way, then slide the wild one in —
            // stacked they cancel each other out and nothing reads
            if (reducedMotion()) play([{ type: 'appear', side: 1 }])
            else setTimeout(() => play([{ type: 'appear', side: 1 }]), ms * 0.55)
            return
        }
        if (playing) { pending = data; return }   // held until the burst drains
        applySnapshot(data, true)
    })

    socket.on('battle:turn', (data: { events?: SceneEvent[] }) => {
        if (!root.classList.contains('open')) return
        play(data?.events ?? [])
    })

    socket.on('battle:end', () => {
        fastForward()
        if (!root.classList.contains('open')) return
        const ms = wipe(root, 'out')
        setTimeout(() => {
            root.classList.remove('open')
            root.className = ''
            for (const k of KEY) {
                slot(k).classList.remove('fainted')
                setStatus(k, undefined, false)
                state[k].shown = 0
                state[k].hp = 0
            }
        }, reducedMotion() ? 0 : ms - 60)
    })

    // The dialog drives the pacing: if the player mashes through the text we
    // must land on the final state immediately rather than lag behind it.
    const hurry = () => { if (playing) fastForward() }
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key === 'e') hurry()
    }, true)
    window.addEventListener('pointerdown', hurry, true)
}
