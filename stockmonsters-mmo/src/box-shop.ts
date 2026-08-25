/*
 * box-shop.ts — the in-game sealed-box shop.
 *
 *   mountBoxShop(engine, socket)   // create it (hidden) at boot
 *   openBoxShop()                  // open it from anywhere (HUD, an NPC…)
 *
 * Structure
 *   ┌ titlebar (draggable) · wallet chip · close ───────────────────────────┐
 *   │ tabs: BUY A BOX | MY BOXES                                            │
 *   ├ three tier cards (price · odds · BUY) ────────────────────────────────┤
 *   │ or: this wallet's boxes, sealed and opened, with OPEN                 │
 *   ├ fairness strip: the server seed commitment for the next purchase      │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 * Sibling of marketplace.ts by construction: same ui-kit (`ensureUiKit`, `el`,
 * `guardKeys`, `pushLayer`, `watchGameDialog`, `makeDraggable`), same THEME,
 * same Z budget, same sealed-box drawing so a box looks like a box wherever it
 * appears.
 *
 * ── THREE RULES THIS FILE KEEPS ─────────────────────────────────────────────
 *
 * 1. NEVER render creature art for a sealed box. The seal is the product. The
 *    only place contents appear is a box the server has told us is OPEN.
 *
 * 2. The reveal animation is THEATRE OVER FACT, never instead of it. It plays
 *    while the reveal request is in flight and lands on exactly what the server
 *    returned. It does not roll anything, does not pre-guess, and if the
 *    request fails it says so instead of inventing a creature.
 *
 * 3. The player's wallet pays. The server signs a voucher; `window.ethereum`
 *    sends `mintCaught` with the fee as msg.value and `open` on reveal. No
 *    server-side key ever touches player funds, and the client never sees a
 *    private key.
 *
 * ── WHY HAND-ENCODED CALLDATA ───────────────────────────────────────────────
 * viem is a server dependency; pulling it into the browser bundle for two
 * function calls is not worth ~60 KB. Both signatures are simple enough to
 * encode by hand (see `encodeMintCaught` / `encodeOpen`), and the selectors are
 * pinned as constants that test/lootbox.test.mjs checks against the compiled
 * artifact's methodIdentifiers — so a contract change breaks a test rather than
 * a player's transaction.
 */

import {
  ensureUiKit, injectStyle, el, guardKeys, pushLayer,
  makeDraggable, watchGameDialog, formatEth, shortAddr, Z, THEME,
} from './ui-kit'

/* ================================================================= TYPES ===*/

export type BoxTier = 'standard' | 'prime' | 'apex'
export type BoxStatus = 'issued' | 'minted' | 'revealed' | 'opened' | 'expired' | 'voided'

export interface TierBand {
  id: string; label: string; pct: number; bst: string; species: number
}
export interface TierQuote {
  id: BoxTier
  label: string
  priceWei: string
  level: [number, number]
  ivFloor: number
  shinyOneIn: number
  shinyOdds: string
  bands: TierBand[]
}
export interface FairnessCommit { commitId: string; serverSeedHash: string; algorithm: string }
export interface BoxQuote {
  chainId: number
  contract: string | null
  sellable: boolean
  tiers: TierQuote[]
  fairness: { algorithm: string; seedHash: string; commit: FairnessCommit | null; note: string }
}
export interface BoxVoucher {
  uid: string; tier: BoxTier; attrCommit: string; fee: string; deadline: number
  signature: string; signer: string; chainId: number; contract: string
  serverSeedHash: string; clientSeed: string; commitId: string
}
export interface BoxContents {
  dexId: number; ticker: string | null; name: string; types: string[]; sprite: string | null
  level: number; ivs: number[]; natureId: number; nature: string; shiny: boolean
  caughtAt: number; band: string
}
export interface BoxRow {
  uid: string; tier: BoxTier; status: BoxStatus; tokenId: string | null
  feeWei: string; deadline: number; attrCommit: string; signature: string
  serverSeedHash: string | null; clientSeed: string; createdAt: string
  openedAt: string | null; chainId: number; contract: string | null
  contents: BoxContents | null
}
export interface BoxReveal extends BoxContents {
  uid: string; tokenId: string | null; tier: BoxTier; salt: string; attrCommit: string
  serverSeed: string | null; serverSeedHash: string | null; clientSeed: string
  rollAlgorithm: string; contract: string; chainId: number
  species: { ticker: string; name: string; types: string[]; sprite: string } | null
}

/** Everything the shop needs from the outside world, so tests can stub it. */
export interface BoxShopApi {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** Force a data refresh (after a wallet connect, say). */
  refresh(): void
  destroy(): void
  root: HTMLElement
}

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<any> }
interface EngineLike { processAction?: (action: string, data: unknown) => void }
interface SocketLike { on?: (type: string, cb: (data: any) => void) => void }
interface MountOpts {
  /** Prefix for the /box/* calls. '' means same-origin, which is the norm. */
  baseUrl?: string
  /** Override the wallet identity lookup (tests). */
  wallet?: () => { address?: string; connectionId?: string } | null
}

/* ============================================================== CALLDATA ===*/

/**
 * Pinned selectors. Regenerate with:
 *   node tools/lootbox-cli.mjs selectors
 * test/lootbox.test.mjs asserts these against contracts/out/**\/*.json, so a
 * signature change fails CI instead of a player's wallet.
 */
export const SELECTORS = {
  // mintCaught(bytes32,bytes32,uint256,uint64,bytes)
  mintCaught: '0xaa220172',
  // open(uint256,uint16,uint8,uint8[6],uint8,bool,uint64,bytes32)
  open: '0xf0aaf959',
} as const

const hex = (v: bigint | number | string): string => {
  const b = typeof v === 'bigint' ? v : BigInt(v)
  if (b < 0n) throw new Error('negative')
  return b.toString(16)
}
/** One ABI word: 32 bytes, right-aligned, no 0x. */
const word = (v: bigint | number | string | boolean): string => {
  if (typeof v === 'boolean') return word(v ? 1 : 0)
  if (typeof v === 'string' && v.startsWith('0x')) {
    const s = v.slice(2).toLowerCase()
    if (s.length > 64) throw new Error(`value too wide for one word: ${v}`)
    return s.padStart(64, '0')
  }
  return hex(v as bigint | number | string).padStart(64, '0')
}

/** `mintCaught(bytes32,bytes32,uint256,uint64,bytes) payable` */
export function encodeMintCaught(v: {
  attrCommit: string; uid: string; fee: string; deadline: number; signature: string
}): string {
  const sig = v.signature.replace(/^0x/, '')
  if (sig.length % 2) throw new Error('signature is not whole bytes')
  const bytesLen = sig.length / 2
  const padded = sig.padEnd(Math.ceil(bytesLen / 32) * 64, '0')
  return SELECTORS.mintCaught
    + word(v.attrCommit)
    + word(v.uid)
    + word(BigInt(v.fee))
    + word(v.deadline)
    + word(5 * 32) // offset to the `bytes` tail: five head words precede it
    + word(bytesLen)
    + padded
}

/** `open(uint256,uint16,uint8,uint8[6],uint8,bool,uint64,bytes32)` — all static. */
export function encodeOpen(v: {
  tokenId: string; dexId: number; level: number; ivs: number[]
  natureId: number; shiny: boolean; caughtAt: number; salt: string
}): string {
  if (v.ivs.length !== 6) throw new Error('ivs must be 6 values')
  return SELECTORS.open
    + word(BigInt(v.tokenId))
    + word(v.dexId)
    + word(v.level)
    // uint8[6] is a FIXED array: six inline words, no offset and no length.
    + v.ivs.map((iv) => word(iv)).join('')
    + word(v.natureId)
    + word(v.shiny)
    + word(v.caughtAt)
    + word(v.salt)
}

/* ================================================================ STYLES ===*/

const TIER_ACCENT: Record<BoxTier, string> = {
  standard: '#c9a06a', prime: '#a9bccd', apex: '#f6c177',
}
const BAND_COLORS: Record<string, string> = {
  common: '#8b8397', uncommon: '#7ecf6b', rare: '#6fa8f5', elite: '#f6c177',
}

const CSS = `
#sm-boxshop {
  z-index: ${Z.marketWindow};
  width: min(960px, 94vw); height: min(700px, 88vh);
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: none;
}
#sm-boxshop.open { display: flex; }
#sm-boxshop.dialog-hidden { visibility: hidden; pointer-events: none; }

/* --- title bar ----------------------------------------------------------- */
#sm-boxshop .bx-wallet {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--sm-surface); border: 2px solid var(--sm-border);
  padding: 4px 8px; font-size: 10px; letter-spacing: .06em; line-height: 1;
}
#sm-boxshop .bx-wallet .dot { width: 7px; height: 7px; background: var(--sm-ok); }
#sm-boxshop .bx-wallet.off { color: var(--sm-muted); }
#sm-boxshop .bx-wallet.off .dot { background: var(--sm-danger); }

/* --- tabs (identical vocabulary to the exchange) ------------------------- */
#sm-boxshop .bx-tabs {
  flex: 0 0 auto; display: flex; padding: 10px 12px 0;
  background: var(--sm-surface); border-bottom: 3px solid var(--sm-border);
}
#sm-boxshop .bx-tab {
  appearance: none;
  font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--sm-muted);
  background: var(--sm-dark);
  border: 3px solid var(--sm-border); border-bottom: none; border-radius: 0;
  padding: 9px 16px 8px; margin: 0 6px -3px 0; cursor: pointer;
}
#sm-boxshop .bx-tab:hover { color: var(--sm-text); }
#sm-boxshop .bx-tab.is-on { color: #09070f; background: var(--sm-border); }
#sm-boxshop .bx-tab .n { opacity: .72; margin-left: 6px; }

#sm-boxshop .bx-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
#sm-boxshop .bx-pane { flex: 1 1 auto; min-height: 0; padding: 16px; display: none; overflow-y: auto; }
#sm-boxshop .bx-pane.is-on { display: flex; flex-direction: column; }

/* --- notice bar ---------------------------------------------------------- */
#sm-boxshop .bx-notice {
  flex: 0 0 auto; display: none; align-items: center; gap: 10px;
  padding: 9px 14px; font-size: 11px; letter-spacing: .05em; line-height: 1.5;
  background: rgba(224,108,117,.14);
  border-bottom: 3px solid var(--sm-danger);
  color: var(--sm-text);
}
#sm-boxshop .bx-notice.show { display: flex; }
#sm-boxshop .bx-notice.is-info { background: rgba(246,193,119,.12); border-bottom-color: var(--sm-border); }
#sm-boxshop .bx-notice .spacer { flex: 1 1 auto; }
#sm-boxshop .bx-notice .smui-btn { font-size: 10px; padding: 6px 10px; }

/* --- tier cards ---------------------------------------------------------- */
#sm-boxshop .bx-tiers {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
  align-items: stretch;
  /* Fill the pane: three short cards floating in a tall empty window read as
   * a layout bug rather than a shop. The art panel absorbs the slack. */
  flex: 1 1 auto; min-height: 0;
}
#sm-boxshop .bx-tier {
  --accent: ${TIER_ACCENT.standard};
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px;
  background: var(--sm-surface-alt);
  border: 3px solid var(--accent);
  box-shadow: 3px 3px 0 var(--sm-shadow);
}
#sm-boxshop .bx-tier.tier-prime { --accent: ${TIER_ACCENT.prime}; }
#sm-boxshop .bx-tier.tier-apex  { --accent: ${TIER_ACCENT.apex}; }
#sm-boxshop .bx-tier .head { display: flex; align-items: baseline; gap: 8px; }
#sm-boxshop .bx-tier .head .nm {
  font-family: ${THEME.display}; font-size: 16px; font-weight: 600;
  letter-spacing: .14em; color: var(--accent);
  text-shadow: 2px 2px 0 var(--sm-shadow);
}
#sm-boxshop .bx-tier .head .spacer { flex: 1 1 auto; }
/* A fixed height, not an aspect ratio: three cards must fit the window at any
 * width, and a square art panel at 1/3 of 960px is taller than the pane. */
#sm-boxshop .bx-art {
  flex: 1 1 auto; min-height: 132px; position: relative;
  background:
    radial-gradient(circle at 50% 62%, rgba(246,193,119,.15), transparent 62%),
    linear-gradient(#1d1834, #14101f);
  border: 2px solid rgba(246,193,119,.42);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
#sm-boxshop .bx-art img { width: 84%; height: 84%; object-fit: contain; image-rendering: pixelated;
  filter: drop-shadow(0 3px 0 rgba(9,7,15,.5)); }
#sm-boxshop .bx-art .badge { position: absolute; top: 5px; left: 5px; }
#sm-boxshop .bx-art .badge.shiny { left: auto; right: 5px; }

/* The sealed box itself — same drawing as the exchange's sealed listings, so
 * a box a player buys here is recognisably the same object over there.
 * NO CREATURE ART EVER GOES INSIDE THIS ELEMENT. */
#sm-boxshop .bx-sealed {
  --c-lid: #7a5f38; --c-body: #6b5330; --c-dark: #3a2c18;
  --c-light: #8a6b3d; --c-tape: #f6c177; --c-tape2: #d9a458;
  width: 96px; height: 96px; position: relative;
  background: linear-gradient(var(--c-lid) 0 34%, var(--c-body) 34% 100%);
  border: 3px solid var(--c-dark);
  box-shadow: inset 0 0 0 3px var(--c-light);
  display: flex; align-items: flex-start; justify-content: center; padding-top: 12px;
}
#sm-boxshop .bx-sealed.tier-prime {
  --c-lid: #7c8798; --c-body: #68727f; --c-dark: #232a33;
  --c-light: #9aa6b6; --c-tape: #bcd3e8; --c-tape2: #8fb0cc;
}
#sm-boxshop .bx-sealed.tier-apex {
  --c-lid: #cfa243; --c-body: #b08630; --c-dark: #4a3712;
  --c-light: #e5c065; --c-tape: #fff1c7; --c-tape2: #f6c177;
}
#sm-boxshop .bx-sealed::after {
  content: ''; position: absolute; left: 0; right: 0; top: 34%; height: 3px; background: var(--c-dark);
}
#sm-boxshop .bx-sealed::before {
  content: ''; position: absolute; left: 0; right: 0; top: 62%; height: 20%;
  background: repeating-linear-gradient(45deg, var(--c-tape) 0 6px, var(--c-tape2) 6px 12px);
  border-top: 3px solid var(--c-dark); border-bottom: 3px solid var(--c-dark);
}
#sm-boxshop .bx-sealed span {
  position: relative; font-family: ${THEME.display};
  font-size: 26px; line-height: 1; font-weight: 600; color: #fff1c7;
  text-shadow: 2px 2px 0 var(--c-dark);
}

/* --- odds readout -------------------------------------------------------- */
#sm-boxshop .bx-odds { display: flex; flex-direction: column; gap: 6px; }
#sm-boxshop .bx-bar { display: flex; height: 12px; border: 2px solid var(--sm-shadow); overflow: hidden; }
#sm-boxshop .bx-bar i { display: block; height: 100%; }
#sm-boxshop .bx-legend {
  display: flex; flex-wrap: wrap; gap: 4px 8px;
  font-size: 9px; letter-spacing: .06em; color: var(--sm-muted);
}
#sm-boxshop .bx-legend b { color: var(--sm-text); font-weight: 700; }
#sm-boxshop .bx-legend .sw { width: 7px; height: 7px; display: inline-block; margin-right: 4px;
  border: 1px solid rgba(9,7,15,.6); vertical-align: middle; }
#sm-boxshop .bx-facts {
  border: 2px solid rgba(246,193,119,.32); margin-top: auto;
}
#sm-boxshop .bx-facts .r {
  display: flex; gap: 8px; padding: 4px 7px; font-size: 10px; letter-spacing: .04em;
}
#sm-boxshop .bx-facts .r:nth-child(odd) { background: rgba(27,23,48,.55); }
#sm-boxshop .bx-facts .r .k { flex: 0 0 74px; color: var(--sm-muted); font-weight: 700; }
#sm-boxshop .bx-facts .r .v { flex: 1 1 auto; }
#sm-boxshop .bx-price { display: flex; align-items: baseline; gap: 5px;
  border-top: 2px solid rgba(246,193,119,.24); padding-top: 8px; }
#sm-boxshop .bx-price .v { font-size: 17px; font-weight: 700; color: var(--accent); letter-spacing: .04em; }
#sm-boxshop .bx-price .u { font-size: 9px; color: var(--sm-muted); letter-spacing: .1em; }
#sm-boxshop .bx-tier .smui-btn { width: 100%; padding: 9px 6px; font-size: 11px; }

/* --- fairness strip ------------------------------------------------------ */
#sm-boxshop .bx-fair {
  flex: 0 0 auto; border-top: 3px solid var(--sm-border);
  background: var(--sm-dark); padding: 9px 14px 10px;
}
#sm-boxshop .bx-fair h5 { margin: 0 0 5px; font-size: 10px; font-weight: 700;
  letter-spacing: .16em; color: var(--sm-border); }
#sm-boxshop .bx-fair .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-size: 10px; letter-spacing: .04em; color: var(--sm-muted); }
#sm-boxshop .bx-fair code {
  font-family: ${THEME.mono}; color: var(--sm-text);
  background: var(--sm-darker); border: 1px solid rgba(246,193,119,.3); padding: 2px 5px;
}
#sm-boxshop .bx-fair input.smui-input { width: 150px; padding: 5px 7px; font-size: 10px; }

/* --- MY BOXES ------------------------------------------------------------ */
#sm-boxshop .bx-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
#sm-boxshop .bx-row {
  display: flex; align-items: center; gap: 12px; padding: 10px;
  background: var(--sm-surface-alt); border: 3px solid var(--sm-border);
  box-shadow: 3px 3px 0 var(--sm-shadow);
}
#sm-boxshop .bx-row .thumb {
  flex: 0 0 62px; height: 62px; position: relative;
  background: linear-gradient(#1d1834, #14101f);
  border: 2px solid rgba(246,193,119,.42);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
#sm-boxshop .bx-row .thumb .bx-sealed { width: 48px; height: 48px; padding-top: 6px; }
#sm-boxshop .bx-row .thumb .bx-sealed span { font-size: 14px; }
#sm-boxshop .bx-row .thumb img { width: 88%; height: 88%; object-fit: contain; image-rendering: pixelated; }
#sm-boxshop .bx-row .meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
#sm-boxshop .bx-row .meta .l1 { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 12px; font-weight: 700; }
#sm-boxshop .bx-row .meta .l2 { display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  font-size: 9px; letter-spacing: .06em; color: var(--sm-muted); }
#sm-boxshop .bx-row .cost {
  flex: 0 0 auto; display: flex; flex-direction: column; gap: 3px;
  align-items: flex-end; text-align: right;
  border-right: 2px solid rgba(246,193,119,.24); padding-right: 14px; margin-right: 2px;
}
#sm-boxshop .bx-row .cost .v { font-size: 14px; font-weight: 700; color: var(--sm-border); letter-spacing: .04em; }
#sm-boxshop .bx-row .cost .k { font-size: 9px; letter-spacing: .12em; color: var(--sm-muted); }
#sm-boxshop .bx-row .act { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; align-items: stretch; }
#sm-boxshop .bx-row .act .smui-btn { min-width: 104px; font-size: 10px; padding: 7px 10px; }
#sm-boxshop .bx-type {
  display: inline-block; padding: 2px 5px; line-height: 1;
  font-size: 8px; font-weight: 700; letter-spacing: .08em;
  color: #09070f; border: 1px solid rgba(9,7,15,.55);
}
#sm-boxshop .bx-empty { padding: 56px 12px; text-align: center; color: var(--sm-muted);
  font-size: 12px; letter-spacing: .1em; line-height: 2; }

/* --- modal (purchase / reveal) ------------------------------------------ */
#sm-boxshop .bx-modal {
  position: absolute; inset: 0; z-index: ${Z.marketModal - Z.marketWindow + 10};
  background: rgba(9,7,15,.86);
  display: none; align-items: center; justify-content: center; padding: 20px;
}
#sm-boxshop .bx-modal.open { display: flex; }
/* 560px matches the exchange's purchase sheet, and is the width at which a
 * 0x-prefixed 32-byte hash fits the proof panel on one line. */
#sm-boxshop .bx-modal .sheet {
  width: min(560px, 100%); max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--sm-surface); border: 3px solid var(--sm-border);
  box-shadow: 6px 6px 0 var(--sm-shadow); overflow: hidden;
}
#sm-boxshop .bx-modal .sheet > .head {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px;
  background: var(--sm-dark); border-bottom: 3px solid var(--sm-border);
}
#sm-boxshop .bx-modal .sheet > .head .title {
  font-family: ${THEME.display}; font-weight: 600; font-size: 14px; letter-spacing: .14em;
  text-shadow: 2px 2px 0 var(--sm-shadow);
}
#sm-boxshop .bx-modal .sheet > .head .spacer { flex: 1 1 auto; }
#sm-boxshop .bx-modal .sheet > .content { padding: 16px; overflow-y: auto; min-height: 0;
  display: flex; flex-direction: column; gap: 12px; align-items: center; }
#sm-boxshop .bx-modal .foot {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  background: var(--sm-dark); border-top: 3px solid var(--sm-border);
}
#sm-boxshop .bx-modal .foot .spacer { flex: 1 1 auto; }
#sm-boxshop .bx-modal .foot .total { display: flex; flex-direction: column; gap: 3px; }
#sm-boxshop .bx-modal .foot .total .k { font-size: 9px; letter-spacing: .16em; color: var(--sm-muted); }
#sm-boxshop .bx-modal .foot .total .v { font-size: 18px; font-weight: 700; color: var(--sm-border); }
#sm-boxshop .bx-stage {
  width: 190px; height: 190px; position: relative; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 55%, rgba(246,193,119,.16), transparent 64%),
              linear-gradient(#1d1834, #14101f);
  border: 3px solid var(--sm-border);
}
#sm-boxshop .bx-stage .bx-sealed { width: 132px; height: 132px; padding-top: 18px; }
#sm-boxshop .bx-stage .bx-sealed span { font-size: 36px; }
#sm-boxshop .bx-stage .smui-badge { position: absolute; top: 7px; right: 7px; }
#sm-boxshop .bx-steps { width: 100%; border: 2px solid rgba(246,193,119,.32); }
#sm-boxshop .bx-steps .s {
  display: flex; align-items: center; gap: 9px; padding: 6px 9px;
  font-size: 10px; letter-spacing: .05em; color: var(--sm-muted);
}
#sm-boxshop .bx-steps .s:nth-child(odd) { background: rgba(27,23,48,.55); }
#sm-boxshop .bx-steps .s .dot {
  width: 9px; height: 9px; flex: 0 0 9px; border: 2px solid var(--sm-muted); background: transparent;
}
#sm-boxshop .bx-steps .s.is-now { color: var(--sm-text); }
#sm-boxshop .bx-steps .s.is-now .dot { border-color: var(--sm-border); background: var(--sm-border);
  animation: bx-pulse .9s steps(2, end) infinite; }
#sm-boxshop .bx-steps .s.is-done { color: var(--sm-text); }
#sm-boxshop .bx-steps .s.is-done .dot { border-color: var(--sm-ok); background: var(--sm-ok); }
#sm-boxshop .bx-steps .s.is-fail { color: var(--sm-danger); }
#sm-boxshop .bx-steps .s.is-fail .dot { border-color: var(--sm-danger); background: var(--sm-danger); }
#sm-boxshop .bx-steps .s .spacer { flex: 1 1 auto; }
#sm-boxshop .bx-steps .s .note { font-size: 9px; color: var(--sm-muted); }
@keyframes bx-pulse { 0% { opacity: 1 } 50% { opacity: .25 } 100% { opacity: 1 } }

/* The shake is decoration; the payload underneath is whatever the server said. */
@keyframes bx-shake {
  0%,100% { transform: translate(0,0) rotate(0) }
  20% { transform: translate(-3px,1px) rotate(-2deg) }
  40% { transform: translate(3px,-1px) rotate(2deg) }
  60% { transform: translate(-2px,-2px) rotate(-1deg) }
  80% { transform: translate(2px,2px) rotate(1deg) }
}
#sm-boxshop .bx-sealed.is-rattling { animation: bx-shake .38s steps(3, end) infinite; }
@keyframes bx-burst { from { opacity: 1; transform: scale(.2) } to { opacity: 0; transform: scale(2.4) } }
#sm-boxshop .bx-stage .burst {
  position: absolute; inset: 0; border: 6px solid var(--sm-border);
  animation: bx-burst .45s steps(5, end) forwards; pointer-events: none;
}
@keyframes bx-pop { from { transform: scale(.55); opacity: 0 } to { transform: scale(1); opacity: 1 } }
#sm-boxshop .bx-stage .prize { width: 84%; height: 84%; object-fit: contain; image-rendering: pixelated;
  animation: bx-pop .3s steps(4, end) both; filter: drop-shadow(0 4px 0 rgba(9,7,15,.55)); }
#sm-boxshop .bx-reveal-info { width: 100%; display: flex; flex-direction: column; gap: 8px; }
#sm-boxshop .bx-reveal-info h3 {
  margin: 0; font-family: ${THEME.display}; font-size: 18px; font-weight: 600;
  letter-spacing: .06em; text-shadow: 2px 2px 0 var(--sm-shadow); text-align: center;
}
#sm-boxshop .bx-ivs { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
#sm-boxshop .bx-ivs .iv {
  display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px;
  background: var(--sm-darker); border: 2px solid rgba(246,193,119,.3);
}
#sm-boxshop .bx-ivs .iv .k { font-size: 8px; letter-spacing: .1em; color: var(--sm-muted); }
#sm-boxshop .bx-ivs .iv .v { font-size: 13px; font-weight: 700; }
#sm-boxshop .bx-ivs .iv.max .v { color: var(--sm-ok); }
#sm-boxshop .bx-proof {
  width: 100%; font-size: 9px; line-height: 1.7; letter-spacing: .03em; color: var(--sm-muted);
  border-left: 3px solid var(--sm-border); padding: 5px 0 5px 9px; word-break: break-all;
}
#sm-boxshop .bx-proof b { color: var(--sm-text); }
#sm-boxshop .bx-err {
  width: 100%; font-size: 11px; line-height: 1.6; color: var(--sm-danger);
  border-left: 3px solid var(--sm-danger); padding: 5px 0 5px 9px;
}

@media (max-width: 820px) {
  #sm-boxshop .bx-tiers { grid-template-columns: 1fr; }
}
`

/* ================================================================== VIEW ===*/

const STAT_KEYS = ['HP', 'ATK', 'DEF', 'SPD', 'SPA', 'SPD'] as const
const IV_LABELS = ['HP', 'ATK', 'DEF', 'SPE', 'SPA', 'SPD'] as const

const TYPE_COLORS: Record<string, string> = {
  Alloy: '#a9b2c3', Blaze: '#f0803c', Combat: '#d75f4a', Fae: '#f39bd6',
  Flora: '#7ecf6b', Frost: '#7fd3e8', Neutral: '#c9c3ac', Psionic: '#c48cf0',
  Shadow: '#8b7fd6', Spectre: '#a9a0ff', Stone: '#b79a6a', Swarm: '#b6cf5a',
  Terra: '#d8a558', Tide: '#6fa8f5', Toxic: '#b46fd6', Volt: '#f6d64a',
  Wind: '#9fe0c8', Wyrm: '#6f7ff5',
}

let instance: BoxShopApi | null = null

export function mountBoxShop(
  engine?: EngineLike,
  socket?: SocketLike,
  opts?: MountOpts,
): BoxShopApi {
  if (instance) return instance
  ensureUiKit()
  injectStyle('sm-boxshop-css', CSS)

  const base = opts?.baseUrl ?? ''
  const api = (p: string) => `${base}${p}`

  const readWallet = opts?.wallet ?? (() => {
    try { return JSON.parse(localStorage.getItem('sm-wallet') ?? 'null') } catch { return null }
  })

  let tab: 'buy' | 'mine' = 'buy'
  let quote: BoxQuote | null = null
  let boxes: BoxRow[] = []
  let clientSeed = randomSeed()
  let busy = false

  function randomSeed(): string {
    const a = new Uint8Array(8)
    ;(globalThis.crypto ?? ({} as Crypto)).getRandomValues?.(a)
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function ethereum(): Eip1193 | null {
    return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null
  }

  /* --- chrome ------------------------------------------------------------ */
  const root = el('div', {
    id: 'sm-boxshop', class: 'smui smui-win', role: 'dialog',
    'aria-label': 'Sealed box shop', 'aria-modal': 'false',
  })

  const titlebar = el('div', { class: 'smui-titlebar' })
  const walletDot = el('span', { class: 'dot' })
  const walletText = el('span', { text: 'NO WALLET' })
  const walletChip = el('span', { class: 'bx-wallet off' }, [walletDot, walletText])
  const closeBtn = el('button', {
    class: 'smui-btn smui-close is-danger', type: 'button',
    'aria-label': 'Close box shop', text: '✕',
  })
  titlebar.append(
    el('span', { class: 'title', text: 'SEALED BOX DEPOT' }),
    el('span', { class: 'spacer' }),
    walletChip,
    closeBtn,
  )

  /* --- tabs -------------------------------------------------------------- */
  const buyTab = el('button', { class: 'bx-tab is-on', type: 'button', role: 'tab', 'aria-selected': 'true', text: 'Buy a Box' })
  const mineCount = el('span', { class: 'n', text: '' })
  const mineTab = el('button', { class: 'bx-tab', type: 'button', role: 'tab', 'aria-selected': 'false' }, [
    el('span', { text: 'My Boxes' }), mineCount,
  ])
  const tabsRow = el('div', { class: 'bx-tabs', role: 'tablist' }, [buyTab, mineTab])
  buyTab.addEventListener('click', () => setTab('buy'))
  mineTab.addEventListener('click', () => setTab('mine'))

  /* --- notice ------------------------------------------------------------ */
  const noticeText = el('span', { text: '' })
  const noticeAction = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'Connect' })
  const notice = el('div', { class: 'bx-notice', role: 'status' }, [
    noticeText, el('span', { class: 'spacer' }), noticeAction,
  ])
  noticeAction.addEventListener('click', () => void connectWallet())

  function showNotice(msg: string, kind: 'error' | 'info' = 'error', action?: { label: string; run: () => void }) {
    noticeText.textContent = msg
    notice.classList.add('show')
    notice.classList.toggle('is-info', kind === 'info')
    if (action) {
      noticeAction.textContent = action.label
      noticeAction.onclick = action.run
      noticeAction.classList.remove('smui-hidden')
    } else {
      noticeAction.classList.add('smui-hidden')
    }
  }
  const hideNotice = () => notice.classList.remove('show')

  /* --- panes ------------------------------------------------------------- */
  const tiersBox = el('div', { class: 'bx-tiers' })
  const buyPane = el('div', { class: 'bx-pane is-on smui-scroll' }, [tiersBox])
  const listBox = el('div', { class: 'bx-list smui-scroll' })
  const minePane = el('div', { class: 'bx-pane' }, [listBox])
  const bodyBox = el('div', { class: 'bx-body' }, [notice, buyPane, minePane])

  /* --- fairness strip ---------------------------------------------------- */
  const seedInput = el('input', {
    class: 'smui-input', type: 'text', value: clientSeed, maxlength: '64',
    'aria-label': 'Your client seed', spellcheck: 'false', autocomplete: 'off',
  })
  guardKeys(seedInput)
  seedInput.addEventListener('input', () => { clientSeed = seedInput.value })
  const rerollSeed = el('button', { class: 'smui-btn is-ghost', type: 'button', text: '⟳', title: 'New client seed' })
  rerollSeed.addEventListener('click', () => { clientSeed = randomSeed(); seedInput.value = clientSeed })
  const commitCode = el('code', { text: '—' })
  const fairStrip = el('div', { class: 'bx-fair' }, [
    el('h5', { text: 'PROVABLY FAIR' }),
    el('div', { class: 'row' }, [
      el('span', { text: 'SERVER SEED HASH' }),
      commitCode,
      el('span', { text: 'YOUR SEED' }),
      seedInput,
      rerollSeed,
    ]),
    el('div', { class: 'row' }, [
      el('span', {
        text: 'The server publishes the hash before you choose a seed; the seed itself '
          + 'arrives with the contents so you can replay the roll.',
      }),
    ]),
  ])

  /* --- modal ------------------------------------------------------------- */
  const modal = el('div', { class: 'bx-modal' })

  root.append(titlebar, tabsRow, bodyBox, fairStrip, modal)
  document.body.appendChild(root)
  makeDraggable(root, titlebar)

  /* ------------------------------------------------------------- helpers */
  function sealedNode(tier: BoxTier, rattling = false): HTMLElement {
    return el('div', { class: `bx-sealed tier-${tier}${rattling ? ' is-rattling' : ''}` }, [
      el('span', { text: '?' }),
    ])
  }
  function typePill(t: string): HTMLElement {
    return el('span', { class: 'bx-type', style: `background:${TYPE_COLORS[t] ?? '#b9b2d6'}`, text: t.toUpperCase() })
  }
  function factRow(k: string, v: string): HTMLElement {
    return el('div', { class: 'r' }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })])
  }

  async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(api(path), init)
    let payload: any = null
    try { payload = await res.json() } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error(payload?.message ?? payload?.error ?? `${res.status} ${res.statusText}`)
    return payload as T
  }

  /* ------------------------------------------------------------- wallet */
  function wallet(): { address?: string; connectionId?: string } | null {
    const w = readWallet()
    return w && w.connectionId && w.address ? w : null
  }

  function syncWalletChip() {
    const w = wallet()
    walletChip.classList.toggle('off', !w)
    walletText.textContent = w?.address ? shortAddr(w.address) : 'NO WALLET'
  }

  /**
   * We do NOT re-implement sign-in here: index.html owns /auth/verify and
   * writes localStorage['sm-wallet']. All this can do is nudge the player and
   * pick the answer up afterwards.
   */
  async function connectWallet() {
    const eth = ethereum()
    if (!eth) {
      showNotice('No browser wallet found. Install one, then reload to buy boxes.', 'error')
      return
    }
    try { await eth.request({ method: 'eth_requestAccounts' }) } catch { /* user declined */ }
    syncWalletChip()
    if (!wallet()) {
      showNotice('Sign in with your wallet on the title screen first — the box needs a verified identity.', 'error')
    } else {
      hideNotice()
      refresh()
    }
  }

  /* -------------------------------------------------------------- render */
  function renderTiers() {
    tiersBox.textContent = ''
    if (!quote) {
      tiersBox.appendChild(el('div', { class: 'bx-empty', text: 'LOADING BOX PRICES…' }))
      return
    }
    for (const t of quote.tiers) {
      const bar = el('div', { class: 'bx-bar' })
      const legend = el('div', { class: 'bx-legend' })
      for (const b of t.bands) {
        if (b.pct > 0) {
          bar.appendChild(el('i', { style: `flex:${b.pct};background:${BAND_COLORS[b.id] ?? '#b9b2d6'}` }))
        }
        legend.append(el('span', {}, [
          el('span', { class: 'sw', style: `background:${BAND_COLORS[b.id] ?? '#b9b2d6'}` }),
          el('b', { text: `${b.pct}%` }),
          el('span', { text: ` ${b.label.toUpperCase()}` }),
        ]))
      }
      const art = el('div', { class: 'bx-art' }, [sealedNode(t.id)])
      art.appendChild(el('span', { class: 'smui-badge is-sealed badge', text: 'SEALED' }))

      const buyBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: `Buy ${t.label} box` })
      buyBtn.addEventListener('click', () => void startPurchase(t))

      tiersBox.appendChild(el('div', { class: `bx-tier tier-${t.id}` }, [
        el('div', { class: 'head' }, [
          el('span', { class: 'nm', text: t.label.toUpperCase() }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'smui-chip', text: t.shinyOdds + ' SHINY' }),
        ]),
        art,
        el('div', { class: 'bx-odds' }, [bar, legend]),
        el('div', { class: 'bx-facts' }, [
          factRow('LEVEL', `${t.level[0]} – ${t.level[1]}`),
          factRow('IV FLOOR', `${t.ivFloor} / 31`),
          factRow('SHINY', t.shinyOdds),
        ]),
        el('div', { class: 'bx-price' }, [
          el('span', { class: 'v', text: formatEth(t.priceWei) }),
          el('span', { class: 'u', text: 'ETH' }),
        ]),
        buyBtn,
      ]))
    }
  }

  function renderMine() {
    listBox.textContent = ''
    mineCount.textContent = boxes.length ? String(boxes.length) : ''
    if (!wallet()) {
      // Say so plainly rather than showing an empty list that looks like a
      // wallet with nothing in it.
      const connect = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'Connect wallet' })
      connect.addEventListener('click', () => void connectWallet())
      listBox.appendChild(el('div', { class: 'bx-empty' }, [
        el('div', { text: 'NO WALLET CONNECTED' }),
        el('div', { text: 'A box belongs to a wallet, so there is nothing to show until you sign in.' }),
        el('div', { style: 'margin-top:14px' }, [connect]),
      ]))
      return
    }
    if (!boxes.length) {
      listBox.appendChild(el('div', { class: 'bx-empty' }, [
        el('div', { text: 'NO BOXES YET' }),
        el('div', { text: 'Buy one on the other tab. It stays sealed until you open it.' }),
      ]))
      return
    }
    for (const b of boxes) listBox.appendChild(boxRow(b))
  }

  function boxRow(b: BoxRow): HTMLElement {
    const opened = b.status === 'opened' && b.contents
    const thumb = el('div', { class: 'thumb' }, [
      // RULE 1: art only for a box the server says is already open.
      opened && b.contents?.sprite
        ? el('img', { src: `/${b.contents.sprite}`, alt: b.contents.name, draggable: 'false' })
        : sealedNode(b.tier),
    ])

    const l1 = el('div', { class: 'l1' })
    if (opened && b.contents) {
      l1.append(
        el('span', { text: b.contents.name }),
        el('span', { class: 'smui-badge is-opened', text: 'OPENED' }),
      )
      if (b.contents.shiny) l1.appendChild(el('span', { class: 'smui-badge is-shiny', text: 'SHINY' }))
    } else {
      l1.append(
        el('span', { text: `${b.tier.toUpperCase()} BOX` }),
        el('span', { class: 'smui-badge is-sealed', text: b.status.toUpperCase() }),
      )
    }

    const l2 = el('div', { class: 'l2' })
    if (opened && b.contents) {
      for (const t of b.contents.types) l2.appendChild(typePill(t))
      l2.appendChild(el('span', { text: `LV${b.contents.level}` }))
      l2.appendChild(el('span', { text: b.contents.nature.toUpperCase() }))
      l2.appendChild(el('span', { text: `IV ${b.contents.ivs.reduce((a, c) => a + c, 0)}/186` }))
    } else {
      l2.appendChild(el('span', { text: '??? — CONTENTS HIDDEN' }))
    }
    l2.appendChild(el('span', { text: b.tokenId ? `TOKEN #${b.tokenId}` : 'NOT MINTED' }))

    const paid = el('div', { class: 'cost' }, [
      el('span', { class: 'v', text: `${formatEth(b.feeWei)} ETH` }),
      el('span', { class: 'k', text: costCaption(b) }),
    ])

    const act = el('div', { class: 'act' })
    if (b.status === 'issued' && !b.tokenId) {
      const mintBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'Mint' })
      const dead = b.deadline * 1000 < Date.now()
      if (dead) {
        mintBtn.disabled = true
        mintBtn.textContent = 'Expired'
      } else {
        mintBtn.addEventListener('click', () => void mintExisting(b))
      }
      act.appendChild(mintBtn)
    } else if (b.tokenId && b.status !== 'opened') {
      const openBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'Open' })
      openBtn.addEventListener('click', () => void openBox(b))
      act.appendChild(openBtn)
    } else if (b.status === 'opened') {
      const seeBtn = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'Details' })
      seeBtn.addEventListener('click', () => void showRevealed(b))
      act.appendChild(seeBtn)
    }

    return el('div', { class: 'bx-row' }, [thumb, el('div', { class: 'meta' }, [l1, l2]), paid, act])
  }

  /** What the price column is telling you, which differs by lifecycle stage. */
  function costCaption(b: BoxRow): string {
    if (b.status === 'issued' && !b.tokenId) {
      const left = b.deadline * 1000 - Date.now()
      if (left <= 0) return 'VOUCHER EXPIRED'
      const mins = Math.floor(left / 60_000)
      return mins >= 1 ? `PAY WITHIN ${mins}M` : `PAY WITHIN ${Math.floor(left / 1000)}S`
    }
    if (b.status === 'expired') return 'NEVER MINTED'
    return 'PAID'
  }

  function setTab(next: 'buy' | 'mine') {
    tab = next
    buyTab.classList.toggle('is-on', next === 'buy')
    mineTab.classList.toggle('is-on', next === 'mine')
    buyTab.setAttribute('aria-selected', String(next === 'buy'))
    mineTab.setAttribute('aria-selected', String(next === 'mine'))
    buyPane.classList.toggle('is-on', next === 'buy')
    minePane.classList.toggle('is-on', next === 'mine')
    fairStrip.classList.toggle('smui-hidden', next !== 'buy')
    if (next === 'mine') void loadBoxes()
  }

  /* --------------------------------------------------------------- modal */
  let releaseModal: (() => void) | null = null
  function closeModal() {
    modal.classList.remove('open')
    modal.textContent = ''
    releaseModal?.()
    releaseModal = null
  }
  function openModal(title: string, content: HTMLElement, foot?: HTMLElement) {
    closeModal()
    const x = el('button', { class: 'smui-btn smui-close is-danger', type: 'button', 'aria-label': 'Close', text: '✕' })
    x.addEventListener('click', () => closeModal())
    const sheet = el('div', { class: 'sheet' }, [
      el('div', { class: 'head' }, [
        el('span', { class: 'title', text: title }), el('span', { class: 'spacer' }), x,
      ]),
      el('div', { class: 'content' }, [content]),
      foot ?? null,
    ])
    modal.appendChild(sheet)
    modal.classList.add('open')
    releaseModal = pushLayer(() => closeModal())
    return { sheet, close: closeModal }
  }

  /** A step list that tells the truth about where the flow got to. */
  function steps(labels: string[]) {
    const nodes = labels.map((l) => el('div', { class: 's' }, [
      el('span', { class: 'dot' }), el('span', { text: l }),
      el('span', { class: 'spacer' }), el('span', { class: 'note', text: '' }),
    ]))
    const box = el('div', { class: 'bx-steps' }, nodes)
    // Notes are cleared on every transition: a step that has finished must not
    // still read "waiting for you…", because someone reading the screenshot
    // (or the player) would think it is still waiting.
    const clearNotes = () => nodes.forEach((n) => { (n.lastChild as HTMLElement).textContent = '' })
    return {
      box,
      at(i: number, note = '') {
        clearNotes()
        nodes.forEach((n, j) => {
          n.classList.toggle('is-done', j < i)
          n.classList.toggle('is-now', j === i)
          n.classList.remove('is-fail')
        })
        ;(nodes[i]?.lastChild as HTMLElement).textContent = note
      },
      done(note = '') {
        clearNotes()
        nodes.forEach((n) => { n.classList.add('is-done'); n.classList.remove('is-now', 'is-fail') })
        if (note) (nodes[nodes.length - 1].lastChild as HTMLElement).textContent = note
      },
      fail(i: number, note: string) {
        clearNotes()
        nodes[i]?.classList.remove('is-now', 'is-done')
        nodes[i]?.classList.add('is-fail')
        ;(nodes[i]?.lastChild as HTMLElement).textContent = note
      },
    }
  }

  /* ------------------------------------------------------------ purchase */
  async function startPurchase(t: TierQuote) {
    if (busy) return
    const w = wallet()
    if (!w) {
      showNotice('Connect and sign in with your wallet before buying a box.', 'error',
        { label: 'Connect', run: () => void connectWallet() })
      return
    }
    const eth = ethereum()
    if (!eth) {
      showNotice('No browser wallet found — a box is minted by your own wallet, not by us.', 'error')
      return
    }
    hideNotice()

    const stage = el('div', { class: 'bx-stage' }, [sealedNode(t.id, true)])
    const flow = steps([
      'Roll and sign the box',
      'Confirm the payment in your wallet',
      'Wait for the chain',
    ])
    const proof = el('div', { class: 'bx-proof' })
    const content = el('div', { class: 'bx-reveal-info' }, [
      el('h3', { text: `${t.label.toUpperCase()} BOX` }), stage, flow.box, proof,
    ])
    // Centre the stage without disturbing the column layout.
    stage.style.margin = '0 auto'
    const doneBtn = el('button', { class: 'smui-btn', type: 'button', text: 'Close' })
    doneBtn.addEventListener('click', () => closeModal())
    const foot = el('div', { class: 'foot' }, [
      el('div', { class: 'total' }, [
        el('span', { class: 'k', text: 'YOU PAY' }),
        el('span', { class: 'v', text: `${formatEth(t.priceWei)} ETH` }),
      ]),
      el('span', { class: 'spacer' }), doneBtn,
    ])
    openModal('BUYING A SEALED BOX', content, foot)

    busy = true
    try {
      flow.at(0, 'asking the server…')
      const voucher = await apiCall<BoxVoucher>('/box/voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: w.connectionId, address: w.address, tier: t.id,
          commitId: quote?.fairness.commit?.commitId ?? null,
          clientSeed,
        }),
      })
      proof.innerHTML = ''
      proof.append(
        el('div', {}, [el('b', { text: 'server seed hash ' }), el('span', { text: voucher.serverSeedHash })]),
        el('div', {}, [el('b', { text: 'your seed ' }), el('span', { text: voucher.clientSeed || '(none)' })]),
        el('div', {}, [el('b', { text: 'commitment ' }), el('span', { text: voucher.attrCommit })]),
      )
      // The commitment is spent; the next purchase needs a fresh one.
      void loadQuote()

      flow.at(1, 'waiting for you…')
      const hash = await sendMint(eth, w.address!, voucher)

      flow.at(2, hash ? shortAddr(hash) : '')
      await waitForBox(voucher.uid)
      flow.done('sealed and yours')
      doneBtn.textContent = 'See my boxes'
      doneBtn.classList.add('is-primary')
      doneBtn.onclick = () => { closeModal(); setTab('mine') }
      void loadBoxes()
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      flow.fail(/wallet|reject|denied|User/i.test(msg) ? 1 : 0, trimError(msg))
      content.appendChild(el('div', { class: 'bx-err', text: trimError(msg) }))
    } finally {
      busy = false
      stage.querySelector('.bx-sealed')?.classList.remove('is-rattling')
    }
  }

  /** Re-send a voucher that was signed but never minted. */
  async function mintExisting(b: BoxRow) {
    const w = wallet()
    const eth = ethereum()
    if (!w || !eth) { showNotice('Connect your wallet first.', 'error'); return }
    const flow = steps(['Confirm the payment in your wallet', 'Wait for the chain'])
    const content = el('div', { class: 'bx-reveal-info' }, [
      el('h3', { text: `${b.tier.toUpperCase()} BOX` }), flow.box,
    ])
    openModal('MINTING A SIGNED BOX', content)
    try {
      flow.at(0, 'waiting for you…')
      await sendMint(eth, w.address!, {
        uid: b.uid, attrCommit: b.attrCommit, fee: b.feeWei,
        deadline: b.deadline, signature: b.signature, contract: b.contract ?? '',
      } as BoxVoucher)
      flow.at(1)
      await waitForBox(b.uid)
      flow.done('minted')
      void loadBoxes()
    } catch (err) {
      flow.fail(0, trimError((err as Error).message))
      content.appendChild(el('div', { class: 'bx-err', text: trimError((err as Error).message) }))
    }
  }

  async function sendMint(eth: Eip1193, from: string, v: BoxVoucher): Promise<string> {
    const to = v.contract || quote?.contract
    if (!to) throw new Error('This server has no NFT contract configured, so boxes cannot be minted.')
    const data = encodeMintCaught({
      attrCommit: v.attrCommit, uid: v.uid, fee: v.fee, deadline: v.deadline, signature: v.signature,
    })
    return await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from, to, data, value: '0x' + BigInt(v.fee).toString(16) }],
    })
  }

  /** The server learns tokenIds from the chain, not from us. Poll until it has. */
  async function waitForBox(uid: string, tries = 20): Promise<BoxRow | null> {
    for (let i = 0; i < tries; i++) {
      await new Promise((r) => setTimeout(r, i < 3 ? 400 : 1200))
      await loadBoxes()
      const found = boxes.find((b) => b.uid.toLowerCase() === uid.toLowerCase())
      if (found?.tokenId) return found
    }
    return null
  }

  /* -------------------------------------------------------------- opening */
  async function openBox(b: BoxRow) {
    const w = wallet()
    const eth = ethereum()
    if (!w || !eth) { showNotice('Connect your wallet first.', 'error'); return }

    const stage = el('div', { class: 'bx-stage' }, [sealedNode(b.tier, true)])
    stage.style.margin = '0 auto'
    const flow = steps(['Fetch the reveal from the server', 'Confirm open() in your wallet', 'Wait for the chain'])
    const info = el('div', { class: 'bx-reveal-info' })
    const content = el('div', { class: 'bx-reveal-info' }, [stage, flow.box, info])
    openModal(`OPENING BOX #${b.tokenId}`, content)

    try {
      flow.at(0)
      const reveal = await apiCall<BoxReveal>('/box/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: w.connectionId, address: w.address, uid: b.uid }),
      })
      // RULE 2: the animation runs AFTER we know the answer, and shows that
      // answer. It is not a slot machine that decides anything.
      flow.at(1, 'waiting for you…')
      const data = encodeOpen({
        tokenId: b.tokenId!, dexId: reveal.dexId, level: reveal.level, ivs: reveal.ivs,
        natureId: reveal.natureId, shiny: reveal.shiny, caughtAt: reveal.caughtAt, salt: reveal.salt,
      })
      await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: w.address, to: reveal.contract ?? b.contract, data }],
      })
      flow.at(2)
      await burstInto(stage, reveal)
      flow.done('opened on chain')
      renderReveal(info, reveal)
      void loadBoxes()
    } catch (err) {
      flow.fail(0, trimError((err as Error).message))
      stage.querySelector('.bx-sealed')?.classList.remove('is-rattling')
      info.appendChild(el('div', { class: 'bx-err', text: trimError((err as Error).message) }))
    }
  }

  /** Details for a box that is already open — no chain call, same layout. */
  async function showRevealed(b: BoxRow) {
    const w = wallet()
    if (!w) return
    const info = el('div', { class: 'bx-reveal-info' })
    const stage = el('div', { class: 'bx-stage' })
    stage.style.margin = '0 auto'
    const content = el('div', { class: 'bx-reveal-info' }, [stage, info])
    openModal(`BOX #${b.tokenId ?? '—'}`, content)
    try {
      const reveal = await apiCall<BoxReveal>('/box/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: w.connectionId, address: w.address, uid: b.uid }),
      })
      const sprite = reveal.species?.sprite
      stage.appendChild(sprite
        ? el('img', { class: 'prize', src: `/${sprite}`, alt: reveal.species?.name ?? '' })
        : sealedNode(b.tier))
      renderReveal(info, reveal)
    } catch (err) {
      info.appendChild(el('div', { class: 'bx-err', text: trimError((err as Error).message) }))
    }
  }

  /** The theatre. Short, and always lands on the server's answer. */
  async function burstInto(stage: HTMLElement, reveal: BoxReveal) {
    await new Promise((r) => setTimeout(r, 520))
    stage.appendChild(el('div', { class: 'burst' }))
    await new Promise((r) => setTimeout(r, 300))
    stage.textContent = ''
    const sprite = reveal.species?.sprite
    stage.appendChild(sprite
      ? el('img', { class: 'prize', src: `/${sprite}`, alt: reveal.species?.name ?? '' })
      : el('span', { class: 'smui-display', text: `#${reveal.dexId}` }))
    if (reveal.shiny) stage.appendChild(el('span', { class: 'smui-badge is-shiny badge', text: 'SHINY' }))
  }

  function renderReveal(host: HTMLElement, r: BoxReveal) {
    host.textContent = ''
    const types = el('div', { class: 'l2', style: 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap' })
    for (const t of r.species?.types ?? r.types ?? []) types.appendChild(typePill(t))

    const ivs = el('div', { class: 'bx-ivs' })
    r.ivs.forEach((v, i) => {
      ivs.appendChild(el('div', { class: `iv${v === 31 ? ' max' : ''}` }, [
        el('span', { class: 'k', text: IV_LABELS[i] ?? STAT_KEYS[i] }),
        el('span', { class: 'v', text: String(v) }),
      ]))
    })

    const facts = el('div', { class: 'bx-facts' }, [
      factRow('LEVEL', String(r.level)),
      factRow('NATURE', r.nature.toUpperCase()),
      factRow('SHINY', r.shiny ? 'YES' : 'no'),
      factRow('BAND', (r.band ?? '').toUpperCase()),
      factRow('IV TOTAL', `${r.ivs.reduce((a, c) => a + c, 0)} / 186`),
    ])

    host.append(
      el('h3', { text: `${r.species?.name ?? `#${r.dexId}`}${r.species?.ticker ? `  $${r.species.ticker}` : ''}` }),
      types,
      ivs,
      facts,
      el('div', { class: 'bx-proof' }, [
        el('div', {}, [el('b', { text: 'algorithm ' }), el('span', { text: r.rollAlgorithm })]),
        el('div', {}, [el('b', { text: 'server seed ' }), el('span', { text: r.serverSeed ?? '(not recorded)' })]),
        el('div', {}, [el('b', { text: 'hash ' }), el('span', { text: r.serverSeedHash ?? '—' })]),
        el('div', {}, [el('b', { text: 'your seed ' }), el('span', { text: r.clientSeed || '(none)' })]),
        el('div', {}, [el('b', { text: 'salt ' }), el('span', { text: r.salt })]),
        el('div', { text: 'Verify: node tools/lootbox-cli.mjs verify --file reveal.json' }),
      ]),
    )
  }

  const trimError = (m: string) => (m ?? '').split('\n')[0].slice(0, 220)

  /* ----------------------------------------------------------------- data */
  async function loadQuote() {
    try {
      quote = await apiCall<BoxQuote>('/box/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      commitCode.textContent = quote.fairness.commit
        ? quote.fairness.commit.serverSeedHash.slice(0, 18) + '…'
        : 'unavailable'
      commitCode.setAttribute('title', quote.fairness.commit?.serverSeedHash ?? quote.fairness.note)
      renderTiers()
      if (!quote.sellable) {
        showNotice('Box sales are offline on this server right now — prices and odds are still real.', 'info')
      }
    } catch (err) {
      tiersBox.textContent = ''
      tiersBox.appendChild(el('div', { class: 'bx-empty' }, [
        el('div', { text: 'COULD NOT REACH THE DEPOT' }),
        el('div', { text: trimError((err as Error).message) }),
      ]))
    }
  }

  async function loadBoxes() {
    const w = wallet()
    if (!w) { boxes = []; renderMine(); return }
    try {
      const out = await apiCall<{ boxes: BoxRow[] }>(
        `/box/mine?connectionId=${encodeURIComponent(w.connectionId!)}&address=${encodeURIComponent(w.address!)}`,
      )
      boxes = out.boxes ?? []
    } catch {
      boxes = []
    }
    renderMine()
  }

  function refresh() {
    syncWalletChip()
    if (!wallet()) {
      showNotice('No wallet connected — you can browse the odds, but buying needs a signed-in wallet.', 'info',
        { label: 'Connect', run: () => void connectWallet() })
    } else {
      hideNotice()
    }
    void loadQuote()
    void loadBoxes()
  }

  /* -------------------------------------------------------- open / close */
  let releaseWindow: (() => void) | null = null
  function open() {
    if (root.classList.contains('open')) return
    root.classList.add('open')
    releaseWindow = pushLayer(() => close())
    refresh()
    setTimeout(() => (tab === 'buy' ? buyTab : mineTab).focus(), 0)
  }
  function close() {
    closeModal()
    root.classList.remove('open')
    releaseWindow?.()
    releaseWindow = null
  }
  closeBtn.addEventListener('click', () => close())

  const stopWatch = watchGameDialog((dialogOpen) => {
    root.classList.toggle('dialog-hidden', dialogOpen)
  })

  // Optional server pushes; harmless if they never fire.
  socket?.on?.('box:refresh', () => { if (root.classList.contains('open')) void loadBoxes() })

  renderTiers()
  renderMine()

  const shop: BoxShopApi = {
    root,
    open,
    close,
    toggle() { root.classList.contains('open') ? close() : open() },
    isOpen: () => root.classList.contains('open'),
    refresh,
    destroy() {
      stopWatch()
      close()
      root.remove()
      instance = null
    },
  }
  instance = shop
  return shop
}

/** Open the shop, mounting it on first use. */
export function openBoxShop(): BoxShopApi {
  const shop = instance ?? mountBoxShop()
  shop.open()
  return shop
}

export function closeBoxShop(): void { instance?.close() }
export function getBoxShop(): BoxShopApi | null { return instance }
