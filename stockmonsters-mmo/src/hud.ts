/*
 * hud.ts — the always-on game HUD.
 *
 *   mountHud(engine, socket)
 *
 * Layout (matches the reference crypto-MMO screenshots):
 *
 *   ┌ avatar + name + currency chips ─────────── gear · banner slots ┐
 *   │                                                               │
 *   │                      (map canvas, untouched)                  │
 *   │                                                               │
 *   └ chat (chat-ui.ts, NOT ours) ──────── action bar of icon buttons┘
 *
 * The bottom-left corner belongs to the chat panel, so the action bar starts
 * to the right of it (`--sm-chat-w`) and centres itself in what is left.
 *
 * Pointer events: the full-screen container is `pointer-events: none`, and
 * only the clusters that are actually interactive turn them back on — the map
 * must stay clickable everywhere else.
 *
 * DATA SEAM: everything the HUD shows comes from a `HudModel`. The live bits
 * we can already read (player name, chosen character sprite) are pulled from
 * the RPG-JS engine / socket in `readEngine()`; the rest is placeholder data
 * in `demoHudModel()` and is marked PLACEHOLDER. When balances and progression
 * exist server-side, emit them on the socket as `hud:update` with a
 * Partial<HudModel> payload — the wiring for that is already here — or call
 * `api.update(patch)` from wherever the numbers live.
 */

import {
  ensureUiKit, injectStyle, el, escapeHtml, guardKeys, pushLayer, Z,
} from './ui-kit'
import { openMarketplace } from './marketplace'

/* ---------------------------------------------------------------- types ---*/

export interface HudChip {
  id: string
  icon: IconName
  label: string
  value: string
  tone?: 'default' | 'ok' | 'warn'
}

export interface HudBanner {
  id: string
  /** Optional image URL; without one the slot renders as an empty ad frame. */
  image?: string
  caption: string
  href?: string
}

export interface HudModel {
  name: string
  level: number
  xp: number
  xpNext: number
  /** Character sheet URL — 96x128, 3 cols x 4 rows of 32x32. */
  avatarSheet: string
  chips: HudChip[]
  banners: HudBanner[]
}

export interface HudActionDef {
  id: string
  icon: IconName
  label: string
  hotkey?: string
  onSelect?: () => void
}

export interface HudApi {
  update(patch: Partial<HudModel>): void
  getModel(): HudModel
  destroy(): void
  root: HTMLElement
}

interface EngineLike {
  sceneMap?: { getCurrentPlayer?: () => any } | (() => any)
  processAction?: (action: string, data: unknown) => void
}
interface SocketLike {
  on?: (type: string, cb: (data: any) => void) => void
}

/* ---------------------------------------------------------------- icons ---*/

export type IconName =
  | 'bag' | 'dex' | 'team' | 'market' | 'quest' | 'map' | 'gear'
  | 'coin' | 'gem' | 'box' | 'star' | 'bolt'

const ICONS: Record<IconName, string> = {
  bag: '<path d="M4 6h8v8H4z"/><path d="M6 3h4v3H8.5V4.5h-1V6H6z"/><path d="M6.5 8h3v1.5h-3z" opacity=".45"/>',
  dex: '<path d="M3 3h9v10H3z"/><path d="M4.5 4.5h6V6h-6zM4.5 7.5h6V9h-6z" opacity=".45"/><path d="M12 3h1v10h-1z" opacity=".7"/>',
  team: '<path d="M4 9h8v4H4z"/><path d="M3 5h2v3H3zM6 3h2v3H6zM9 3h2v3H9zM12 5h2v3h-2z"/>',
  market: '<path d="M2 3h3v1.5H3.5L5 10h8v1.5H4L2.4 4.5H2z"/><path d="M5.5 5h9l-1 3.5h-7z"/><path d="M5 12.5h2V14H5zM10 12.5h2V14h-2z"/>',
  quest: '<path d="M4 2h9v12H4z"/><path d="M5.5 4.5h6V6h-6zM5.5 7h6v1.5h-6zM5.5 9.5h4V11h-4z" opacity=".45"/><path d="M2 2h2v12H2z" opacity=".7"/>',
  map: '<path d="M2 3l4-1v11l-4 1zM6 2l4 1v11l-4-1zM10 3l4-1v11l-4 1z"/><path d="M7.5 6h1.5v1.5H7.5z" opacity=".45"/>',
  gear: '<path d="M6.5 1h3v2h-3zM6.5 13h3v2h-3zM1 6.5h2v3H1zM13 6.5h2v3h-2z"/><path d="M2.8 3.5l1.4-1.4 1.4 1.4-1.4 1.4zM10.4 11.1l1.4-1.4 1.4 1.4-1.4 1.4zM11.8 2.1l1.4 1.4-1.4 1.4-1.4-1.4zM4.2 9.7l1.4 1.4-1.4 1.4-1.4-1.4z"/><path d="M4 4h8v8H4z"/><path d="M6.5 6.5h3v3h-3z" opacity=".55"/>',
  coin: '<path d="M5 1h6v1H5zM3 2h2v1H3zM11 2h2v1h-2zM2 3h1v10H2zM13 3h1v10h-1zM3 13h2v1H3zM11 13h2v1h-2zM5 14h6v1H5zM3 3h10v10H3z"/><path d="M7 4.5h2v7H7z" opacity=".5"/>',
  gem: '<path d="M5 2h6l3 4-6 8-6-8z"/><path d="M5 2l-3 4h12l-3-4z" opacity=".45"/>',
  box: '<path d="M2 4.5h12V13H2z"/><path d="M6.8 4.5h2.4V13H6.8z" opacity=".45"/><path d="M2 2.5h12v2.5H2z" opacity=".7"/>',
  star: '<path d="M8 1l2 4.6 5 .4-3.8 3.3 1.2 4.9L8 11.6 3.6 14.2l1.2-4.9L1 6l5-.4z"/>',
  bolt: '<path d="M9 1L3 9h4l-1 6 7-9H8z"/>',
}

function iconSvg(name: IconName, size = 22): string {
  return `<svg class="sm-ico" viewBox="0 0 16 16" width="${size}" height="${size}" ` +
    `aria-hidden="true" focusable="false" shape-rendering="crispEdges" ` +
    `fill="currentColor">${ICONS[name] ?? ICONS.star}</svg>`
}

/* ------------------------------------------------------------ demo model --*/

/**
 * PLACEHOLDER model. Every number below is invented so the HUD is explorable
 * before the economy exists. Replace by pushing `hud:update` from the server
 * or by calling `api.update()`.
 */
export function demoHudModel(): HudModel {
  return {
    name: 'TRADER',
    level: 12,
    xp: 640,
    xpNext: 1000,
    avatarSheet: 'spritesheets/characters/female-01.png',
    chips: [
      { id: 'eth', icon: 'gem', label: 'ETH', value: '0.482' },      // PLACEHOLDER
      { id: 'smon', icon: 'coin', label: 'SMON', value: '12,400' },  // PLACEHOLDER
      { id: 'boxes', icon: 'box', label: 'BOXES', value: '3' },      // PLACEHOLDER
      { id: 'streak', icon: 'bolt', label: 'STREAK', value: '5d', tone: 'ok' }, // PLACEHOLDER
    ],
    banners: [
      { id: 'b1', caption: 'BANNER SLOT' },
      { id: 'b2', caption: 'BANNER SLOT' },
      { id: 'b3', caption: 'BANNER SLOT' },
    ],
  }
}

/* -------------------------------------------------------- engine reading --*/

/** RPG-JS signals are functions; plain values are not. Read either. */
function sig<T>(v: any): T | undefined {
  try { return typeof v === 'function' ? v() : v } catch { return undefined }
}

function currentPlayer(engine: EngineLike | undefined): any {
  if (!engine) return undefined
  try {
    const scene: any = typeof (engine as any).sceneMap === 'function'
      ? (engine as any).sceneMap()
      : (engine as any).sceneMap
    return scene?.getCurrentPlayer?.()
  } catch { return undefined }
}

/** `ch-female-01` -> `spritesheets/characters/female-01.png` */
function sheetFor(id: string): string {
  const slug = id.replace(/^ch-/, '')
  return `spritesheets/characters/${slug}.png`
}

function readEngine(engine: EngineLike | undefined): Partial<HudModel> {
  const out: Partial<HudModel> = {}
  const player = currentPlayer(engine)
  const name = sig<string>(player?.name)
  if (name) out.name = name

  // graphics is a signal holding either ids or {id}/{graphic} layer objects.
  const g: any = sig<any>(player?.graphics)
  const first = Array.isArray(g) ? g[0] : g
  const gid = typeof first === 'string' ? first : (first?.id ?? first?.graphic ?? first?.name)
  if (typeof gid === 'string' && gid) out.avatarSheet = sheetFor(gid)

  // Fallbacks: the picker in index.html and chat-ui.ts both persist locally.
  if (!out.name) {
    try {
      const n = localStorage.getItem('sm-name')
      if (n) out.name = n
    } catch { /* private mode */ }
  }
  if (!out.avatarSheet) {
    try {
      const layers = JSON.parse(localStorage.getItem('sm-character') ?? 'null')
      if (Array.isArray(layers) && typeof layers[0] === 'string') out.avatarSheet = sheetFor(layers[0])
    } catch { /* private mode */ }
  }
  return out
}

/* ----------------------------------------------------------------- CSS ----*/

const CSS = `
#sm-hud {
  position: fixed; inset: 0; z-index: ${Z.hud};
  pointer-events: none;
  /* Keep the action bar clear of the chat panel (chat-ui.ts). */
  --sm-chat-w: min(320px, 34vw);
}
#sm-hud .sm-ico { display: block; }
#sm-hud .hud-cluster { position: absolute; pointer-events: auto; }

/* --- top-left: player card ---------------------------------------------- */
#sm-hud .hud-tl { top: 14px; left: 14px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
#sm-hud .hud-card {
  display: flex; align-items: stretch; gap: 12px;
  padding: 10px;
  background: rgba(38,33,58,.94);
}
#sm-hud .hud-avatar {
  position: relative;
  width: 76px; height: 76px; flex: 0 0 76px;
  background: linear-gradient(#211c38, #171329);
  border: 3px solid var(--sm-border);
  box-shadow: inset 0 0 0 3px rgba(9,7,15,.55);
  overflow: hidden;
}
#sm-hud .hud-avatar i {
  position: absolute; left: 50%; top: 52%;
  width: 32px; height: 32px;
  margin: -16px 0 0 -16px;
  transform: scale(2.1);
  transform-origin: center;
  background-repeat: no-repeat;
  /* idle-facing-down frame = col 1, row 0 of a 3x4 sheet of 32x32 */
  background-position: -32px 0;
  image-rendering: pixelated;
}
#sm-hud .hud-avatar .lvl {
  position: absolute; right: -1px; bottom: -1px;
  background: var(--sm-border); color: #09070f;
  font-size: 10px; font-weight: 700; letter-spacing: .06em;
  padding: 2px 4px; line-height: 1;
  border-left: 2px solid #09070f; border-top: 2px solid #09070f;
}
#sm-hud .hud-meta { display: flex; flex-direction: column; justify-content: center; gap: 7px; min-width: 148px; }
#sm-hud .hud-name {
  font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-weight: 600; font-size: 17px; letter-spacing: .1em; line-height: 1;
  text-shadow: 2px 2px 0 var(--sm-shadow);
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#sm-hud .hud-sub { font-size: 10px; letter-spacing: .1em; color: var(--sm-muted); line-height: 1; }
#sm-hud .hud-xp {
  position: relative; height: 12px;
  background: var(--sm-darker); border: 2px solid var(--sm-border);
}
#sm-hud .hud-xp i {
  position: absolute; inset: 0 auto 0 0;
  background: repeating-linear-gradient(90deg, var(--sm-ok) 0 4px, #6cbc5b 4px 8px);
}
#sm-hud .hud-xp b {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 700; letter-spacing: .08em;
  color: var(--sm-text); text-shadow: 1px 1px 0 var(--sm-shadow);
}
#sm-hud .hud-chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 320px; }
#sm-hud .hud-chips .smui-chip { background: rgba(27,23,48,.94); box-shadow: 2px 2px 0 var(--sm-shadow); padding: 5px 8px; }
#sm-hud .hud-chips .smui-chip .k { color: var(--sm-muted); font-weight: 700; }
#sm-hud .hud-chips .smui-chip .v { color: var(--sm-text); }
#sm-hud .hud-chips .smui-chip.tone-ok .v { color: var(--sm-ok); }
#sm-hud .hud-chips .smui-chip.tone-warn .v { color: var(--sm-danger); }
#sm-hud .hud-chips .smui-chip .sm-ico { color: var(--sm-border); }

/* --- top-right: gear + banner slots ------------------------------------- */
#sm-hud .hud-tr { top: 14px; right: 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
#sm-hud .hud-gear { width: 46px; height: 46px; padding: 0; display: flex; align-items: center; justify-content: center; }
#sm-hud .hud-banners { display: flex; flex-direction: column; gap: 8px; }
#sm-hud .hud-banner {
  width: 168px; height: 58px;
  background: rgba(27,23,48,.72);
  border: 3px dashed rgba(246,193,119,.5);
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; letter-spacing: .18em; color: rgba(185,178,214,.72);
  overflow: hidden;
}
#sm-hud .hud-banner img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }

/* --- settings popover ---------------------------------------------------- */
#sm-hud .hud-settings {
  position: absolute; top: 60px; right: 0; z-index: ${Z.hudPopover};
  width: 232px; padding: 12px;
  background: var(--sm-surface);
  display: none;
}
#sm-hud .hud-settings.open { display: block; }
#sm-hud .hud-settings h4 {
  margin: 0 0 10px; font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-size: 12px; font-weight: 600; letter-spacing: .16em;
  color: var(--sm-border); text-shadow: 2px 2px 0 var(--sm-shadow);
}
#sm-hud .hud-settings .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; }
#sm-hud .hud-settings .row + .row { border-top: 2px solid rgba(246,193,119,.18); }

/* --- bottom action bar --------------------------------------------------- */
#sm-hud .hud-bar-wrap {
  left: calc(var(--sm-chat-w) + 28px); right: 14px; bottom: 14px;
  display: flex; justify-content: center;
}
#sm-hud .hud-bar {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 9px 10px;
  background: rgba(38,33,58,.94);
}
#sm-hud .hud-slot {
  position: relative;
  width: 58px; height: 58px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 0;
}
#sm-hud .hud-slot .cap { font-size: 8px; letter-spacing: .08em; font-weight: 700; }
#sm-hud .hud-slot .key {
  position: absolute; top: -3px; left: -3px;
  min-width: 15px; height: 15px; padding: 0 3px;
  display: flex; align-items: center; justify-content: center;
  background: var(--sm-dark); color: var(--sm-border);
  border: 2px solid var(--sm-border);
  font-size: 9px; font-weight: 700; line-height: 1;
}
#sm-hud .hud-slot.is-accent { background: #3b3260; }
#sm-hud .hud-slot.is-accent .sm-ico { color: var(--sm-border); }

@media (max-width: 1180px) {
  #sm-hud .hud-banners { display: none; }
  #sm-hud .hud-slot { width: 50px; height: 50px; }
  #sm-hud .hud-slot .cap { display: none; }
}
@media (max-height: 700px) {
  #sm-hud .hud-banner { height: 46px; }
}
`

/* ---------------------------------------------------------------- mount ---*/

let mounted: HudApi | null = null

export function mountHud(engine?: EngineLike, socket?: SocketLike): HudApi {
  if (mounted) return mounted
  ensureUiKit()
  injectStyle('sm-hud-css', CSS)

  const model: HudModel = { ...demoHudModel(), ...readEngine(engine) }

  const root = el('div', { id: 'sm-hud', class: 'smui' })

  /* --- top-left ---------------------------------------------------------- */
  const tl = el('div', { class: 'hud-cluster hud-tl' })
  const card = el('div', { class: 'hud-card smui-panel' })
  const avatar = el('div', { class: 'hud-avatar' })
  const avatarImg = el('i')
  const lvlTag = el('span', { class: 'lvl' })
  avatar.append(avatarImg, lvlTag)
  const nameEl = el('div', { class: 'hud-name' })
  const subEl = el('div', { class: 'hud-sub' })
  const xp = el('div', { class: 'hud-xp' })
  const xpFill = el('i')
  const xpText = el('b')
  xp.append(xpFill, xpText)
  card.append(avatar, el('div', { class: 'hud-meta' }, [nameEl, subEl, xp]))
  const chips = el('div', { class: 'hud-chips' })
  tl.append(card, chips)

  /* --- top-right --------------------------------------------------------- */
  const tr = el('div', { class: 'hud-cluster hud-tr' })
  const gear = el('button', {
    class: 'smui-btn hud-gear', type: 'button',
    'aria-label': 'Settings', 'aria-expanded': 'false', title: 'Settings',
    html: iconSvg('gear', 22),
  })
  const banners = el('div', { class: 'hud-banners' })
  const settings = el('div', { class: 'hud-settings smui-panel', role: 'dialog', 'aria-label': 'Settings' })
  tr.append(gear, banners, settings)

  /* --- action bar -------------------------------------------------------- */
  const actions: HudActionDef[] = [
    { id: 'bag', icon: 'bag', label: 'BAG', hotkey: '1' },
    { id: 'dex', icon: 'dex', label: 'DEX', hotkey: '2' },
    { id: 'team', icon: 'team', label: 'TEAM', hotkey: '3' },
    { id: 'market', icon: 'market', label: 'MARKET', hotkey: '4', onSelect: () => openMarketplace() },
    { id: 'quests', icon: 'quest', label: 'QUESTS', hotkey: '5' },
    { id: 'map', icon: 'map', label: 'MAP', hotkey: '6' },
  ]
  const barWrap = el('div', { class: 'hud-cluster hud-bar-wrap' })
  const bar = el('div', { class: 'hud-bar smui-panel', role: 'toolbar', 'aria-label': 'Actions' })
  for (const a of actions) {
    const btn = el('button', {
      class: `smui-btn hud-slot${a.id === 'market' ? ' is-accent' : ''}`,
      type: 'button', title: `${a.label}${a.hotkey ? ` (${a.hotkey})` : ''}`,
      'aria-label': a.label, 'data-action': a.id,
      html: iconSvg(a.icon, 24) + `<span class="cap">${escapeHtml(a.label)}</span>` +
        (a.hotkey ? `<span class="key">${escapeHtml(a.hotkey)}</span>` : ''),
    })
    btn.addEventListener('click', () => runAction(a))
    bar.appendChild(btn)
  }
  barWrap.appendChild(bar)

  root.append(tl, tr, barWrap)
  document.body.appendChild(root)

  /* --- settings contents -------------------------------------------------- */
  // PLACEHOLDER toggles: they only persist locally until real settings exist.
  const toggles = [
    { id: 'sfx', label: 'SOUND EFFECTS', def: true },
    { id: 'music', label: 'MUSIC', def: true },
    { id: 'names', label: 'SHOW PLAYER NAMES', def: true },
    { id: 'bars', label: 'SHOW BANNER SLOTS', def: true },
  ]
  settings.appendChild(el('h4', { text: 'SETTINGS' }))
  for (const t of toggles) {
    let on = t.def
    try { const s = localStorage.getItem(`sm-set-${t.id}`); if (s !== null) on = s === '1' } catch { /* ignore */ }
    const input = el('input', { type: 'checkbox', checked: on })
    const label = el('label', { class: `smui-check${on ? ' is-on' : ''}` }, [
      input, el('span', { class: 'box' }), el('span', { text: t.label }),
    ])
    input.addEventListener('change', () => {
      label.classList.toggle('is-on', input.checked)
      try { localStorage.setItem(`sm-set-${t.id}`, input.checked ? '1' : '0') } catch { /* ignore */ }
      if (t.id === 'bars') banners.style.display = input.checked ? '' : 'none'
      window.dispatchEvent(new CustomEvent('sm:setting', { detail: { id: t.id, value: input.checked } }))
    })
    if (t.id === 'bars' && !on) banners.style.display = 'none'
    settings.appendChild(el('div', { class: 'row' }, [label]))
  }
  guardKeys(settings)

  let releaseSettings: (() => void) | null = null
  const closeSettings = () => {
    settings.classList.remove('open')
    gear.setAttribute('aria-expanded', 'false')
    releaseSettings?.()
    releaseSettings = null
  }
  const toggleSettings = () => {
    if (settings.classList.contains('open')) { closeSettings(); return }
    settings.classList.add('open')
    gear.setAttribute('aria-expanded', 'true')
    releaseSettings = pushLayer(closeSettings)
  }
  gear.addEventListener('click', (e) => { e.stopPropagation(); toggleSettings() })
  const onDocClick = (e: MouseEvent) => {
    if (!settings.classList.contains('open')) return
    if (settings.contains(e.target as Node) || gear.contains(e.target as Node)) return
    closeSettings()
  }
  document.addEventListener('click', onDocClick)

  /* --- actions ------------------------------------------------------------ */
  function runAction(a: HudActionDef) {
    // Anything without its own handler is announced for whoever owns it later.
    window.dispatchEvent(new CustomEvent('sm:hud-action', { detail: { id: a.id } }))
    a.onSelect?.()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const t = e.target as HTMLElement | null
    // Never steal a key from a text field (chat included).
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    const a = actions.find((x) => x.hotkey === e.key)
    if (!a) return
    e.preventDefault()
    runAction(a)
  }
  window.addEventListener('keydown', onKey)

  /* --- render ------------------------------------------------------------- */
  function render() {
    nameEl.textContent = model.name || 'TRADER'
    subEl.textContent = `LV ${model.level} · TRAINER`
    lvlTag.textContent = String(model.level)
    avatarImg.style.backgroundImage = `url("${model.avatarSheet}")`
    // 3x the 96x128 sheet, so a 32x32 frame reads crisply in the tile.
    avatarImg.style.backgroundSize = '96px 128px'
    const pct = model.xpNext > 0 ? Math.max(0, Math.min(100, (model.xp / model.xpNext) * 100)) : 0
    xpFill.style.width = `${pct}%`
    xpText.textContent = `${model.xp} / ${model.xpNext} XP`

    chips.textContent = ''
    for (const c of model.chips) {
      chips.appendChild(el('div', {
        class: `smui-chip tone-${c.tone ?? 'default'}`,
        title: `${c.label}: ${c.value}`,
        html: iconSvg(c.icon, 13) +
          `<span class="k">${escapeHtml(c.label)}</span><span class="v">${escapeHtml(c.value)}</span>`,
      }))
    }

    banners.textContent = ''
    for (const b of model.banners) {
      const slot = el('div', { class: 'hud-banner' })
      if (b.image) slot.appendChild(el('img', { src: b.image, alt: b.caption }))
      else slot.textContent = b.caption
      banners.appendChild(slot)
    }
  }
  render()

  /* --- live data ---------------------------------------------------------- */
  socket?.on?.('name:accepted', (d: { name?: string }) => {
    if (d?.name) { model.name = d.name; render() }
  })
  // Forward-looking seam: the server can push a Partial<HudModel> here.
  socket?.on?.('hud:update', (d: Partial<HudModel>) => api.update(d ?? {}))

  // The engine hands us the player asynchronously (map load, character:set),
  // so poll briefly instead of guessing when it is ready.
  const poll = setInterval(() => {
    const live = readEngine(engine)
    let changed = false
    if (live.name && live.name !== model.name) { model.name = live.name; changed = true }
    if (live.avatarSheet && live.avatarSheet !== model.avatarSheet) {
      model.avatarSheet = live.avatarSheet; changed = true
    }
    if (changed) render()
  }, 1000)

  const api: HudApi = {
    root,
    getModel: () => ({ ...model }),
    update(patch) { Object.assign(model, patch); render() },
    destroy() {
      clearInterval(poll)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDocClick)
      releaseSettings?.()
      root.remove()
      mounted = null
    },
  }
  mounted = api
  return api
}

/** The mounted HUD, if any — handy for tests and for the marketplace to ping. */
export function getHud(): HudApi | null { return mounted }
