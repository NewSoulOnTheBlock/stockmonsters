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
  ensureUiKit, injectStyle, el, escapeHtml, guardKeys, pushLayer, watchGameDialog, Z,
} from './ui-kit'
import { openMarketplace } from './marketplace'
import { CHARACTER_PRESETS, CHARACTER_LAYERS } from './data/character-catalog'

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
  /**
   * The player's character, as spritesheet URLs in draw order — a built
   * character is up to six of them stacked, exactly like the sprite on the
   * map. One url would show a body with no hair or clothes.
   */
  avatarLayers: string[]
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
  /** Open the gear popover — the title screen's GAME SETTINGS lands here. */
  openSettings(): void
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
  | 'coin' | 'gem' | 'box' | 'star' | 'bolt' | 'friends'

/**
 * Icons are drawn as lists of [x, y, w, h] rectangles on a 16x16 grid — the
 * only way to get shapes that stay crisp when a pixel-art UI scales them.
 * Outlines (rather than solid blobs) keep them readable at 13px in a chip.
 */
type Rect = [number, number, number, number]

const ICON_RECTS: Record<IconName, Rect[]> = {
  // pouch with a handle and a clasp
  bag: [
    [7, 1, 2, 1], [6, 2, 1, 3], [9, 2, 1, 3],
    [4, 5, 8, 1], [4, 5, 1, 8], [11, 5, 1, 8], [4, 12, 8, 1],
    [7, 8, 2, 2],
  ],
  // book with a spine and page lines
  dex: [
    [3, 2, 10, 1], [3, 13, 10, 1], [3, 2, 1, 12], [12, 2, 1, 12],
    [6, 2, 1, 12], [8, 5, 3, 1], [8, 8, 3, 1], [8, 11, 2, 1],
  ],
  // paw print
  team: [
    [3, 5, 2, 3], [6, 3, 2, 3], [9, 3, 2, 3], [12, 5, 2, 3],
    [4, 9, 9, 4], [5, 8, 7, 1],
  ],
  // two people, one behind the other
  friends: [
    [3, 2, 4, 4], [1, 7, 8, 3], [2, 10, 6, 4],
    [9, 4, 4, 3], [8, 8, 7, 2], [9, 10, 5, 4],
  ],
  // shopping cart
  market: [
    [1, 3, 3, 1], [4, 4, 1, 6], [5, 10, 8, 1],
    [5, 5, 9, 1], [5, 5, 1, 5], [13, 5, 1, 5], [6, 9, 7, 1],
    [5, 12, 2, 2], [10, 12, 2, 2],
  ],
  // rolled scroll
  quest: [
    [2, 2, 2, 12],
    [4, 2, 9, 1], [4, 13, 9, 1], [12, 2, 1, 12],
    [6, 5, 5, 1], [6, 7, 5, 1], [6, 9, 4, 1],
  ],
  // folded map with a marker
  map: [
    [2, 3, 12, 1], [2, 12, 12, 1], [2, 3, 1, 10], [13, 3, 1, 10],
    [6, 3, 1, 10], [10, 3, 1, 10], [7, 6, 2, 2],
  ],
  // gear ring with four teeth
  gear: [
    [7, 0, 2, 2], [7, 14, 2, 2], [0, 7, 2, 2], [14, 7, 2, 2],
    [5, 3, 6, 2], [5, 11, 6, 2], [3, 5, 2, 6], [11, 5, 2, 6],
    [4, 4, 1, 1], [11, 4, 1, 1], [4, 11, 1, 1], [11, 11, 1, 1],
  ],
  // coin ring
  coin: [
    [6, 2, 4, 1], [6, 13, 4, 1], [2, 6, 1, 4], [13, 6, 1, 4],
    [4, 3, 2, 1], [10, 3, 2, 1], [3, 4, 1, 2], [12, 4, 1, 2],
    [3, 10, 1, 2], [12, 10, 1, 2], [4, 12, 2, 1], [10, 12, 2, 1],
    [7, 6, 2, 4],
  ],
  gem: [],
  box: [
    [2, 2, 12, 3], [2, 5, 1, 8], [13, 5, 1, 8], [2, 12, 12, 1],
    [7, 5, 2, 7],
  ],
  star: [],
  bolt: [],
}

/** A few icons read better as free-form shapes than as a rectangle grid. */
const ICON_PATHS: Partial<Record<IconName, string>> = {
  gem: '<path d="M5 2h6l3 4-6 8-6-8z"/><path d="M5 2L2 6h12l-3-4z" opacity=".5"/>',
  star: '<path d="M8 1l2 4.6 5 .4-3.8 3.3 1.2 4.9L8 11.6 3.6 14.2l1.2-4.9L1 6l5-.4z"/>',
  bolt: '<path d="M9 1L3 9h4l-1 6 7-9H8z"/>',
}

const rectsToPath = (rs: Rect[]) =>
  rs.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h${-w}z`).join('')

const ICONS: Record<IconName, string> = Object.fromEntries(
  (Object.keys(ICON_RECTS) as IconName[]).map((k) => [
    k, ICON_PATHS[k] ?? `<path d="${rectsToPath(ICON_RECTS[k])}"/>`,
  ]),
) as Record<IconName, string>

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
    // A new trainer, not an invented one. The server replaces these the
    // moment it knows who is playing (`trainer:xp` at hydrate); showing
    // level 1 in the meantime is true of a player it has never seen.
    level: 1,
    xp: 0,
    xpNext: 100,
    // The engine's default graphic, so the tile is never empty before the
    // real character arrives.
    avatarLayers: ['spritesheets/hero.png'],
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

/**
 * Graphic id -> spritesheet url, from the SAME catalog the designer and the
 * server whitelist use.
 *
 * This used to be string surgery (`ch-` off the front, `.png` on the end),
 * which quietly produced a 404 for every id that is not a ready-made preset:
 * a built character (`chl-body-01`) became `characters/l-body-01.png`, and the
 * two engine defaults live one directory up. Both drew an empty box in the
 * corner of the screen, which is what the player actually saw.
 */
const SHEET_BY_ID = new Map<string, string>()
for (const item of CHARACTER_PRESETS) SHEET_BY_ID.set(item.id, item.image)
for (const items of Object.values(CHARACTER_LAYERS)) {
  for (const item of items) SHEET_BY_ID.set(item.id, item.image)
}
// Predate the imported pack and sit outside characters/.
SHEET_BY_ID.set('hero', 'spritesheets/hero.png')
SHEET_BY_ID.set('female', 'spritesheets/female.png')

/** Every layer we can resolve, in order. Unknown ids are dropped, not guessed. */
function sheetsFor(ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids : [ids]
  const out: string[] = []
  for (const raw of list) {
    const id = typeof raw === 'string' ? raw : (raw as any)?.id ?? (raw as any)?.graphic ?? (raw as any)?.name
    const url = typeof id === 'string' ? SHEET_BY_ID.get(id) : undefined
    if (url) out.push(url)
  }
  return out
}

function readEngine(engine: EngineLike | undefined): Partial<HudModel> {
  const out: Partial<HudModel> = {}
  const player = currentPlayer(engine)
  const name = sig<string>(player?.name)
  if (name) out.name = name

  // graphics is a signal holding either ids or {id}/{graphic} layer objects.
  // ALL of them: the stack is the character.
  const layers = sheetsFor(sig<any>(player?.graphics))
  if (layers.length) out.avatarLayers = layers

  // Fallbacks: the picker in index.html and chat-ui.ts both persist locally.
  if (!out.name) {
    try {
      const n = localStorage.getItem('sm-name')
      if (n) out.name = n
    } catch { /* private mode */ }
  }
  if (!out.avatarLayers) {
    try {
      const stored = sheetsFor(JSON.parse(localStorage.getItem('sm-character') ?? 'null'))
      if (stored.length) out.avatarLayers = stored
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
#sm-hud .hud-cluster { position: absolute; pointer-events: auto; transition: opacity .12s linear; }
/* A game dialog owns the screen while it is up — step back, don't compete. */
#sm-hud.dialog-open .hud-cluster { opacity: .3; pointer-events: none; }

/* --- top-left: player card ---------------------------------------------- */
#sm-hud .hud-tl { top: 14px; left: 14px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
/* A level-up: the card's border flares and settles. Short, and it respects a
   player who has asked the OS for less motion. */
@keyframes sm-hud-levelup {
  0%   { box-shadow: 0 0 0 0 rgba(246,193,119,.85); }
  35%  { box-shadow: 0 0 0 8px rgba(246,193,119,0); }
  100% { box-shadow: 0 0 0 0 rgba(246,193,119,0); }
}
#sm-hud .hud-card.is-levelup { animation: sm-hud-levelup 1.1s ease-out 2; border-color: #fff1c7; }
@media (prefers-reduced-motion: reduce) {
  #sm-hud .hud-card.is-levelup { animation: none; border-color: #fff1c7; }
}
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
#sm-hud .hud-avatar-stack { position: absolute; inset: 0; }
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
#sm-hud .hud-meta { display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 186px; }
#sm-hud .hud-name {
  font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-weight: 600; font-size: 17px; letter-spacing: .1em; line-height: 1;
  text-shadow: 2px 2px 0 var(--sm-shadow);
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#sm-hud .hud-sub { font-size: 10px; letter-spacing: .1em; color: var(--sm-muted); line-height: 1; }
#sm-hud .hud-xpwrap { display: flex; align-items: center; gap: 8px; }
#sm-hud .hud-xp {
  position: relative; flex: 1 1 auto; height: 10px;
  background: var(--sm-darker); border: 2px solid var(--sm-border);
}
#sm-hud .hud-xp i {
  position: absolute; inset: 0 auto 0 0;
  background: linear-gradient(var(--sm-ok) 0 55%, #5fae51 55% 100%);
}
#sm-hud .hud-xp b {
  position: absolute; right: 2px; top: -1px; bottom: 0;
  display: none;
}
#sm-hud .hud-xptext {
  flex: 0 0 auto;
  font-size: 9px; font-weight: 700; letter-spacing: .06em;
  color: var(--sm-muted); line-height: 1; white-space: nowrap;
}
#sm-hud .hud-chips { display: flex; flex-wrap: wrap; gap: 6px; max-width: 300px; }
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
#sm-hud .hud-settings .hud-quit-row { padding-top: 10px; }
#sm-hud .hud-settings .hud-quit-row button { width: 100%; justify-content: center; }

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
  width: 62px; height: 62px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  padding: 0;
}
#sm-hud .hud-slot .cap { font-size: 8px; letter-spacing: .02em; font-weight: 700; }
#sm-hud .hud-slot .key {
  position: absolute; top: -3px; left: -3px;
  min-width: 15px; height: 15px; padding: 0 3px;
  display: flex; align-items: center; justify-content: center;
  background: var(--sm-dark); color: var(--sm-border);
  border: 2px solid var(--sm-border);
  font-size: 9px; font-weight: 700; line-height: 1;
}
#sm-hud .hud-slot.is-accent {
  background: #453a70;
  box-shadow: 3px 3px 0 var(--sm-shadow), inset 0 -4px 0 var(--sm-border);
}
#sm-hud .hud-slot.is-accent:active {
  box-shadow: 1px 1px 0 var(--sm-shadow), inset 0 -4px 0 var(--sm-border);
}
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
  const avatarStack = el('div', { class: 'hud-avatar-stack' })
  const lvlTag = el('span', { class: 'lvl' })
  avatar.append(avatarStack, lvlTag)
  const nameEl = el('div', { class: 'hud-name' })
  const subEl = el('div', { class: 'hud-sub' })
  const xp = el('div', { class: 'hud-xp' })
  const xpFill = el('i')
  xp.appendChild(xpFill)
  const xpText = el('span', { class: 'hud-xptext' })
  const xpWrap = el('div', { class: 'hud-xpwrap' }, [xp, xpText])
  card.append(avatar, el('div', { class: 'hud-meta' }, [nameEl, subEl, xpWrap]))
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
    { id: 'boxes', icon: 'box', label: 'BOXES', hotkey: '7' },
    { id: 'friends', icon: 'friends', label: 'FRIENDS', hotkey: '8' },
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
  // Leaving the world needs a visible, discoverable exit. Escape opens the
  // in-game menu, but the engine samples input per frame and drops a very
  // short tap, so a key alone is not a dependable way out.
  const nameRow = el('div', { class: 'row hud-quit-row' }, [
    el('button', { class: 'smui-btn', type: 'button', text: 'CHANGE NAME' }),
  ])
  nameRow.querySelector('button')?.addEventListener('click', () => {
    closeSettings()
    window.dispatchEvent(new CustomEvent('sm:change-name'))
  })
  settings.appendChild(nameRow)

  const quitRow = el('div', { class: 'row hud-quit-row' }, [
    el('button', {
      class: 'smui-btn', type: 'button', text: 'SAVE & QUIT TO TITLE',
    }),
  ])
  quitRow.querySelector('button')?.addEventListener('click', () => {
    closeSettings()
    window.dispatchEvent(new CustomEvent('sm:hud-action', { detail: { id: 'quit' } }))
  })
  settings.appendChild(quitRow)

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
    if (root.classList.contains('dialog-open')) return // the dialog owns keys
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
    // One <i> per layer, stacked in draw order — the same order the engine
    // uses on the map, so the face in the corner is the character you are
    // walking around as.
    avatarStack.textContent = ''
    for (const url of model.avatarLayers.length ? model.avatarLayers : ['spritesheets/hero.png']) {
      const layer = el('i')
      layer.style.backgroundImage = `url("${url}")`
      // The sheet is 96x128 (3 cols x 4 rows of 32x32); the CSS picks the
      // idle-facing-down frame out of it.
      layer.style.backgroundSize = '96px 128px'
      avatarStack.appendChild(layer)
    }
    const pct = model.xpNext > 0 ? Math.max(0, Math.min(100, (model.xp / model.xpNext) * 100)) : 0
    xpFill.style.width = `${pct}%`
    xpText.textContent = `${model.xp}/${model.xpNext} XP`

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

  /*
   * THE TRAINER'S REAL LEVEL.
   *
   * Until this existed the card showed LV 12 and 640/1000 XP to everyone,
   * forever — invented numbers in `demoHudModel()`. The server sends the real
   * progress once at hydrate and again on every award, so the bar moves when
   * the player does something rather than on a timer.
   */
  socket?.on?.('trainer:xp', (d: { level?: number; into?: number; span?: number; levelUp?: number; gained?: number }) => {
    if (typeof d?.level !== 'number') return
    api.update({ level: d.level, xp: d.into ?? 0, xpNext: d.span ?? 0 })
    // A level-up is worth saying out loud: the bar resetting to nearly empty
    // otherwise reads as progress being lost.
    if (d.levelUp) {
      window.dispatchEvent(new CustomEvent('sm:levelup', { detail: { level: d.levelUp } }))
      card.classList.add('is-levelup')
      setTimeout(() => card.classList.remove('is-levelup'), 2200)
    }
  })

  const stopDialogWatch = watchGameDialog((dialogOpen) => {
    root.classList.toggle('dialog-open', dialogOpen)
    if (dialogOpen) closeSettings()
  })

  // The engine hands us the player asynchronously (map load, character:set),
  // so poll briefly instead of guessing when it is ready.
  const poll = setInterval(() => {
    const live = readEngine(engine)
    let changed = false
    if (live.name && live.name !== model.name) { model.name = live.name; changed = true }
    if (live.avatarLayers?.length && live.avatarLayers.join('|') !== model.avatarLayers.join('|')) {
      model.avatarLayers = live.avatarLayers; changed = true
    }
    if (changed) render()
  }, 1000)

  const api: HudApi = {
    root,
    getModel: () => ({ ...model }),
    openSettings() { if (!settings.classList.contains('open')) toggleSettings() },
    update(patch) { Object.assign(model, patch); render() },
    destroy() {
      clearInterval(poll)
      stopDialogWatch()
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
