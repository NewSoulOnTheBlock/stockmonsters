/*
 * marketplace.ts — the in-game NFT marketplace window.
 *
 *   mountMarketplace(engine, socket)   // create it (hidden) at boot
 *   openMarketplace()                  // open it from anywhere (HUD, an NPC…)
 *
 * Structure
 *   ┌ titlebar (draggable) · wallet chip · close ────────────────────────────┐
 *   │ tabs: ALL | SEALED BOXES | OPENED | MY LISTINGS                        │
 *   ├ sidebar: search + collapsible filter groups │ toolbar + card grid      │
 *   ├ SESSION TRANSACTIONS (pending / confirmed / cancelled)                 │
 *   └───────────────────────────────────────────────────────────────────────┘
 *   Two sub-windows overlay the whole window: PURCHASE confirm and LIST (sell).
 *
 * It sits at z-index 960-990 — above the map and the battle scene, but under
 * the RPG-JS dialog layer (1000+). When a game dialog opens the window hides
 * itself (see `watchGameDialog` in ui-kit.ts) instead of being buried by it.
 *
 * ── DATA SEAM ────────────────────────────────────────────────────────────────
 * The UI only ever talks to a `MarketSource`. `demoMarketSource` fabricates
 * listings from src/data/dex.json so the whole flow is explorable with no
 * backend at all. See the comment above `demoMarketSource` for exactly what to
 * replace when the EIP-712 marketplace contract lands.
 */

import dex from './data/dex.json'
import {
  ensureUiKit, injectStyle, el, escapeHtml, guardKeys, pushLayer,
  makeDraggable, watchGameDialog, formatEth, parseEth, shortAddr, Z,
} from './ui-kit'

/* ================================================================= TYPES ===*/

export type ItemKind = 'sealed' | 'opened'
export type TxStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed'
export type MarketTab = 'all' | 'sealed' | 'opened' | 'mine'
export type SortKey = 'recent' | 'price-asc' | 'price-desc' | 'name'

export interface CreatureStats {
  hp: number; atk: number; def: number; spd: number; ats: number; dfs: number
}

export interface MarketItem {
  /** Listing id (off-chain order hash once the contract lands). */
  id: string
  /** ERC-721 token id, as a decimal string. */
  tokenId: string
  kind: ItemKind
  /** Display name. A sealed box never reveals the creature behind it. */
  name: string
  /** Only present once opened. */
  ticker?: string
  types?: string[]
  stats?: CreatureStats
  level?: number
  shiny: boolean
  /** Image URL relative to the site root, or undefined for a sealed box. */
  art?: string
  priceWei?: string
  seller: string
  /** Sealed listings carry the commitment to the hidden attributes. */
  attrCommit?: string
  listedAt: number
  /** True when this token belongs to the local player. */
  mine?: boolean
  /** True when the player's own token currently has a live listing. */
  listed?: boolean
}

export interface MarketFilters {
  tab?: MarketTab
  q?: string
  kinds?: ItemKind[]
  types?: string[]
  shinyOnly?: boolean
  sort?: SortKey
}

export interface TxHandle {
  id: string
  kind: 'buy' | 'list' | 'cancel'
  label: string
  status: TxStatus
  hash?: string
  /** Resolves when the chain settles the action (or the order is rejected). */
  settled: Promise<TxStatus>
}

/**
 * The one interface the UI knows about. Implement this against the real
 * contract and hand it to `mountMarketplace(..., { source })` — nothing in the
 * rendering code has to change.
 */
export interface MarketSource {
  listItems(filters: MarketFilters): Promise<MarketItem[]>
  getItem(id: string): Promise<MarketItem | null>
  /** Sign + submit a fill for an existing order. */
  buy(id: string): Promise<TxHandle>
  /** Sign a new sell order for one of the player's tokens. */
  list(tokenId: string, priceWei: string): Promise<TxHandle>
  /** Cancel one of the player's own listings. */
  cancel(id: string): Promise<TxHandle>
  /** Tokens the player owns, listed or not. */
  myItems(): Promise<MarketItem[]>
  /** Connected account, for the wallet chip. Optional. */
  account?(): string | undefined
}

/* ================================================== demo (no backend yet) ==*/

interface DexEntry {
  ticker: string; name: string; kind: string; dexId: number
  types: string[]; species: string
  stats: CreatureStats
  sprite: string
}
const DEX = dex as unknown as DexEntry[]

export const ALL_TYPES: string[] =
  Array.from(new Set(DEX.flatMap((d) => d.types))).sort()

/** Deterministic PRNG so the demo catalogue is stable between reloads. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ETH = 1_000_000_000_000_000_000n

function fakeHash(rnd: () => number, len = 64): string {
  let s = '0x'
  for (let i = 0; i < len; i++) s += '0123456789abcdef'[Math.floor(rnd() * 16)]
  return s
}

function makeItem(rnd: () => number, i: number, forceKind?: ItemKind): MarketItem {
  const entry = DEX[Math.floor(rnd() * DEX.length)]
  const kind: ItemKind = forceKind ?? (rnd() < 0.42 ? 'sealed' : 'opened')
  const shiny = kind === 'opened' && rnd() < 0.12
  // Price scales with the creature's raw power, plus a sealed-box premium.
  const bst = Object.values(entry.stats).reduce((a, b) => a + b, 0)
  const base = 4n + BigInt(Math.floor((bst / 600) * 90)) + BigInt(Math.floor(rnd() * 40))
  const mult = (kind === 'sealed' ? 130n : 100n) * (shiny ? 7n : 1n)
  const priceWei = ((base * mult * ETH) / 100000n).toString()
  const tokenId = String(10000 + Math.floor(rnd() * 89999))
  return kind === 'sealed'
    ? {
      id: `ord-${i}-${tokenId}`,
      tokenId,
      kind,
      name: `SEALED BOX #${tokenId}`,
      shiny: false,
      priceWei,
      seller: fakeHash(rnd, 40),
      attrCommit: fakeHash(rnd),
      listedAt: Date.now() - Math.floor(rnd() * 86_400_000),
    }
    : {
      id: `ord-${i}-${tokenId}`,
      tokenId,
      kind,
      name: entry.name,
      ticker: entry.ticker,
      types: entry.types,
      stats: entry.stats,
      level: 3 + Math.floor(rnd() * 60),
      shiny,
      art: entry.sprite,
      priceWei,
      seller: fakeHash(rnd, 40),
      listedAt: Date.now() - Math.floor(rnd() * 86_400_000),
    }
}

/**
 * ── REPLACE ME WHEN THE CONTRACT LANDS ──────────────────────────────────────
 * This whole object is scaffolding. The real implementation is a second file
 * (e.g. `src/market-source-chain.ts`) exporting a `MarketSource` built on viem
 * (already a dependency) and the EIP-712 off-chain-order marketplace another
 * agent is writing. Concretely:
 *
 *   listItems / getItem / myItems
 *       → read from the order-book API (or an indexer/subgraph). Each order
 *         carries: maker, tokenId, priceWei, nonce, expiry, signature, and for
 *         a sealed token its `attrCommit`. Keep returning `MarketItem`s and no
 *         rendering code changes. A sealed item must keep `art`, `types` and
 *         `stats` undefined — the hidden contents ARE the product.
 *
 *   list(tokenId, priceWei)
 *       → ensure setApprovalForAll(marketplace) once, then
 *         walletClient.signTypedData({ domain: { name, version, chainId,
 *         verifyingContract }, types: { Order: [...] }, primaryType: 'Order',
 *         message: { maker, tokenId, price, nonce, expiry, attrCommit } })
 *         and POST { order, signature } to the order book. No gas.
 *
 *   buy(id)
 *       → fetch the signed order, then
 *         walletClient.writeContract({ ...marketplaceAbi, functionName:
 *         'fillOrder', args: [order, signature], value: order.price }).
 *         Return the TxHandle immediately with status 'pending' and hash set,
 *         and resolve `settled` from waitForTransactionReceipt (→ 'confirmed'
 *         on status === 'success', otherwise 'failed').
 *
 *   cancel(id)
 *       → either DELETE on the order book (soft cancel) or on-chain
 *         `cancelNonce(nonce)`; same TxHandle shape.
 *
 *   account()
 *       → the connected wallet address (localStorage 'sm-wallet' already holds
 *         one for the game's own auth).
 *
 * The UI awaits `TxHandle.settled` to move a row in SESSION TRANSACTIONS from
 * pending to confirmed, so a signature-only action (list/cancel) can simply
 * resolve it right away.
 */
export function demoMarketSource(): MarketSource {
  const rnd = mulberry32(0xc0ffee)
  const catalogue: MarketItem[] = Array.from({ length: 72 }, (_, i) => makeItem(rnd, i))

  const ownRnd = mulberry32(0xbadf00d)
  const owned: MarketItem[] = Array.from({ length: 8 }, (_, i) => {
    const it = makeItem(ownRnd, 1000 + i, i < 3 ? 'sealed' : 'opened')
    it.mine = true
    it.seller = DEMO_ACCOUNT
    // Two of them are already on sale, so CANCEL has something to act on.
    it.listed = i === 1 || i === 5
    if (!it.listed) it.priceWei = undefined
    return it
  })

  const settleIn = (ms: number, status: TxStatus): Promise<TxStatus> =>
    new Promise((res) => setTimeout(() => res(status), ms))

  const match = (it: MarketItem, f: MarketFilters): boolean => {
    if (f.kinds?.length && !f.kinds.includes(it.kind)) return false
    if (f.shinyOnly && !it.shiny) return false
    if (f.types?.length) {
      // A sealed box has no visible type, so a type filter necessarily hides it.
      if (!it.types?.some((t) => f.types!.includes(t))) return false
    }
    if (f.q) {
      const q = f.q.toLowerCase()
      const hay = `${it.name} ${it.ticker ?? ''} ${it.tokenId} ${(it.types ?? []).join(' ')}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }

  const sortBy = (items: MarketItem[], sort: SortKey = 'recent'): MarketItem[] => {
    const w = (i: MarketItem) => (i.priceWei ? BigInt(i.priceWei) : 0n)
    const copy = items.slice()
    if (sort === 'price-asc') copy.sort((a, b) => (w(a) < w(b) ? -1 : w(a) > w(b) ? 1 : 0))
    else if (sort === 'price-desc') copy.sort((a, b) => (w(a) > w(b) ? -1 : w(a) < w(b) ? 1 : 0))
    else if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name))
    else copy.sort((a, b) => b.listedAt - a.listedAt)
    return copy
  }

  return {
    async listItems(f) {
      if (f.tab === 'mine') return sortBy(owned.filter((i) => match(i, f)), f.sort)
      const tabKind: ItemKind | undefined =
        f.tab === 'sealed' ? 'sealed' : f.tab === 'opened' ? 'opened' : undefined
      return sortBy(
        catalogue.filter((i) => (!tabKind || i.kind === tabKind) && match(i, f)),
        f.sort,
      )
    },
    async getItem(id) {
      return catalogue.find((i) => i.id === id) ?? owned.find((i) => i.id === id) ?? null
    },
    async myItems() { return owned.slice() },
    account: () => DEMO_ACCOUNT,
    async buy(id) {
      const item = catalogue.find((i) => i.id === id)
      const label = item ? `BUY ${item.name}` : `BUY ${id}`
      return {
        id: `tx-${Date.now().toString(36)}`,
        kind: 'buy',
        label,
        status: 'pending',
        hash: fakeHash(rnd),
        settled: settleIn(2400, 'confirmed'),
      }
    },
    async list(tokenId, priceWei) {
      const it = owned.find((i) => i.tokenId === tokenId)
      if (it) { it.listed = true; it.priceWei = priceWei }
      return {
        id: `tx-${Date.now().toString(36)}`,
        kind: 'list',
        label: `LIST #${tokenId} @ ${formatEth(priceWei)} ETH`,
        status: 'pending',
        settled: settleIn(1400, 'confirmed'),
      }
    },
    async cancel(id) {
      const it = owned.find((i) => i.id === id)
      if (it) { it.listed = false; it.priceWei = undefined }
      return {
        id: `tx-${Date.now().toString(36)}`,
        kind: 'cancel',
        label: `CANCEL ${it?.name ?? id}`,
        status: 'pending',
        settled: settleIn(1200, 'cancelled'),
      }
    },
  }
}

const DEMO_ACCOUNT = '0x8f3aC1b6E27b1F3a5b3C0aD4B7e2E10c9a4D5e6F'

/* ================================================================ STYLES ===*/

const TYPE_COLORS: Record<string, string> = {
  Alloy: '#a9b2c3', Blaze: '#f0803c', Combat: '#d75f4a', Fae: '#f39bd6',
  Flora: '#7ecf6b', Frost: '#7fd3e8', Neutral: '#c9c3ac', Psionic: '#c48cf0',
  Shadow: '#8b7fd6', Spectre: '#a9a0ff', Stone: '#b79a6a', Swarm: '#b6cf5a',
  Terra: '#d8a558', Tide: '#6fa8f5', Toxic: '#b46fd6', Volt: '#f6d64a',
  Wind: '#9fe0c8', Wyrm: '#6f7ff5',
}

const CSS = `
#sm-market {
  z-index: ${Z.marketWindow};
  width: min(1180px, 94vw); height: min(760px, 88vh);
  left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: none;
}
#sm-market.open { display: flex; }
#sm-market.dialog-hidden { visibility: hidden; pointer-events: none; }
#sm-market .sm-ico { display: block; }

/* --- title bar ----------------------------------------------------------- */
#sm-market .mk-wallet {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--sm-surface); border: 2px solid var(--sm-border);
  padding: 4px 8px; font-size: 10px; letter-spacing: .06em; line-height: 1;
}
#sm-market .mk-wallet .dot { width: 7px; height: 7px; background: var(--sm-ok); }

/* --- tabs ---------------------------------------------------------------- */
#sm-market .mk-tabs {
  flex: 0 0 auto; display: flex; gap: 0;
  padding: 10px 12px 0;
  background: var(--sm-surface);
  border-bottom: 3px solid var(--sm-border);
}
#sm-market .mk-tab {
  appearance: none;
  font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--sm-muted);
  background: var(--sm-dark);
  border: 3px solid var(--sm-border);
  border-bottom: none;
  border-radius: 0;
  padding: 9px 16px 8px;
  margin: 0 6px -3px 0;
  cursor: pointer;
  position: relative;
}
#sm-market .mk-tab:hover { color: var(--sm-text); }
#sm-market .mk-tab.is-on {
  color: #09070f; background: var(--sm-border);
}
#sm-market .mk-tab .n { opacity: .72; margin-left: 6px; font-weight: 700; }

/* --- body ---------------------------------------------------------------- */
#sm-market .mk-body { flex: 1 1 auto; display: flex; min-height: 0; }
#sm-market .mk-side {
  flex: 0 0 224px; min-height: 0;
  display: flex; flex-direction: column;
  background: var(--sm-dark);
  border-right: 3px solid var(--sm-border);
}
#sm-market .mk-search { padding: 12px; border-bottom: 3px solid rgba(246,193,119,.24); }
#sm-market .mk-filters { flex: 1 1 auto; min-height: 0; padding: 4px 12px 12px; }
#sm-market .mk-group { border-bottom: 2px solid rgba(246,193,119,.18); padding: 8px 0; }
#sm-market .mk-group:last-child { border-bottom: none; }
#sm-market .mk-group > .head {
  width: 100%; display: flex; align-items: center; gap: 8px;
  background: none; border: none; padding: 4px 0; margin: 0;
  font-family: inherit; font-size: 10px; font-weight: 700; letter-spacing: .14em;
  color: var(--sm-border); text-transform: uppercase; cursor: pointer;
}
#sm-market .mk-group > .head .caret { font-size: 9px; width: 10px; }
#sm-market .mk-group > .body { padding: 4px 0 2px 2px; }
#sm-market .mk-group.collapsed > .body { display: none; }
#sm-market .mk-group .scrolly { max-height: 214px; overflow-y: auto; padding-right: 4px; }
#sm-market .mk-swatch { width: 8px; height: 8px; flex: 0 0 8px; border: 1px solid rgba(9,7,15,.6); }
#sm-market .mk-clear { margin-top: 12px; width: 100%; font-size: 10px; padding: 7px 8px; }

/* --- main ---------------------------------------------------------------- */
#sm-market .mk-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
#sm-market .mk-toolbar {
  flex: 0 0 auto;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  border-bottom: 3px solid rgba(246,193,119,.24);
  background: rgba(27,23,48,.55);
  font-size: 11px; letter-spacing: .08em; color: var(--sm-muted);
}
#sm-market .mk-toolbar .spacer { flex: 1 1 auto; }
#sm-market .mk-toolbar strong { color: var(--sm-text); }
#sm-market select.smui-input { width: auto; padding: 6px 8px; cursor: pointer; }
#sm-market .mk-grid {
  flex: 1 1 auto; min-height: 0;
  padding: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 14px;
  align-content: start;
}
#sm-market .mk-empty {
  grid-column: 1 / -1;
  padding: 48px 12px; text-align: center;
  color: var(--sm-muted); font-size: 12px; letter-spacing: .1em;
}

/* --- card ---------------------------------------------------------------- */
#sm-market .mk-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px;
  background: var(--sm-surface-alt);
  border: 3px solid var(--sm-border);
  box-shadow: 3px 3px 0 var(--sm-shadow);
}
#sm-market .mk-card:hover { background: #362f56; }
#sm-market .mk-art {
  position: relative;
  aspect-ratio: 1 / 1;
  background:
    radial-gradient(circle at 50% 62%, rgba(246,193,119,.15), transparent 62%),
    linear-gradient(#1d1834, #14101f);
  border: 2px solid rgba(246,193,119,.42);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
#sm-market .mk-art img {
  width: 84%; height: 84%; object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 3px 0 rgba(9,7,15,.5));
}
#sm-market .mk-art .badge { position: absolute; top: 5px; left: 5px; }
#sm-market .mk-art .badge.shiny { top: 5px; left: auto; right: 5px; }
/* Sealed box: deliberately no creature art — the contents are the product. */
#sm-market .mk-sealed {
  width: 76%; height: 76%;
  position: relative;
  background: linear-gradient(#6b5330 0 100%);
  border: 3px solid #3a2c18;
  box-shadow: inset 0 0 0 3px #8a6b3d;
  display: flex; align-items: center; justify-content: center;
}
#sm-market .mk-sealed::before {
  content: ''; position: absolute; left: 0; right: 0; top: 38%; height: 20%;
  background: repeating-linear-gradient(45deg, #f6c177 0 6px, #d9a458 6px 12px);
  border-top: 3px solid #3a2c18; border-bottom: 3px solid #3a2c18;
}
#sm-market .mk-sealed span {
  position: relative;
  font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-size: 30px; font-weight: 600; color: #fff1c7;
  text-shadow: 2px 2px 0 #3a2c18;
}
#sm-market .mk-card .name {
  font-size: 12px; font-weight: 700; letter-spacing: .04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#sm-market .mk-card .sub {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  font-size: 9px; letter-spacing: .06em; color: var(--sm-muted);
  min-height: 14px;
}
#sm-market .mk-type {
  display: inline-block; padding: 2px 5px; line-height: 1;
  font-size: 8px; font-weight: 700; letter-spacing: .08em;
  color: #09070f; border: 1px solid rgba(9,7,15,.55);
}
#sm-market .mk-price {
  display: flex; align-items: baseline; gap: 5px;
  border-top: 2px solid rgba(246,193,119,.24);
  padding-top: 7px;
}
#sm-market .mk-price .v { font-size: 14px; font-weight: 700; color: var(--sm-border); letter-spacing: .04em; }
#sm-market .mk-price .u { font-size: 9px; color: var(--sm-muted); letter-spacing: .1em; }
#sm-market .mk-price .free { font-size: 10px; color: var(--sm-muted); letter-spacing: .08em; }
#sm-market .mk-card .smui-btn { width: 100%; padding: 8px 6px; font-size: 11px; }

/* --- transactions strip -------------------------------------------------- */
#sm-market .mk-tx {
  flex: 0 0 auto;
  border-top: 3px solid var(--sm-border);
  background: var(--sm-dark);
  padding: 9px 14px 10px;
}
#sm-market .mk-tx h5 {
  margin: 0 0 6px;
  font-size: 10px; font-weight: 700; letter-spacing: .16em;
  color: var(--sm-border);
}
#sm-market .mk-tx .rows { max-height: 78px; overflow-y: auto; }
#sm-market .mk-tx .row {
  display: flex; align-items: center; gap: 10px;
  padding: 3px 0; font-size: 10px; letter-spacing: .04em;
  border-bottom: 1px solid rgba(246,193,119,.12);
}
#sm-market .mk-tx .row .t { color: var(--sm-muted); flex: 0 0 58px; }
#sm-market .mk-tx .row .l { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#sm-market .mk-tx .row .h { color: var(--sm-muted); flex: 0 0 auto; }
#sm-market .mk-tx .none { font-size: 10px; color: var(--sm-muted); letter-spacing: .08em; padding: 4px 0; }
#sm-market .mk-status {
  flex: 0 0 auto; padding: 2px 6px; line-height: 1;
  font-size: 9px; font-weight: 700; letter-spacing: .1em;
  border: 2px solid var(--sm-shadow); color: #09070f;
}
#sm-market .mk-status.pending { background: var(--sm-border); }
#sm-market .mk-status.confirmed { background: var(--sm-ok); }
#sm-market .mk-status.cancelled { background: var(--sm-muted); }
#sm-market .mk-status.failed { background: var(--sm-danger); }

/* --- sub-window (purchase / sell) ---------------------------------------- */
#sm-market .mk-modal {
  position: absolute; inset: 0; z-index: ${Z.marketModal - Z.marketWindow + 10};
  background: rgba(9,7,15,.82);
  display: none; align-items: center; justify-content: center;
  padding: 20px;
}
#sm-market .mk-modal.open { display: flex; }
#sm-market .mk-modal .sheet {
  width: min(560px, 100%); max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--sm-surface);
  border: 3px solid var(--sm-border);
  box-shadow: 6px 6px 0 var(--sm-shadow);
  overflow: hidden;
}
#sm-market .mk-modal .sheet > .head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: var(--sm-dark);
  border-bottom: 3px solid var(--sm-border);
}
#sm-market .mk-modal .sheet > .head .title {
  font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-weight: 600; font-size: 14px; letter-spacing: .14em;
  text-shadow: 2px 2px 0 var(--sm-shadow);
}
#sm-market .mk-modal .sheet > .head .spacer { flex: 1 1 auto; }
#sm-market .mk-modal .sheet > .content {
  padding: 16px; display: flex; gap: 16px; overflow-y: auto; min-height: 0;
}
#sm-market .mk-modal .bigart {
  flex: 0 0 168px; height: 168px;
  background:
    radial-gradient(circle at 50% 62%, rgba(246,193,119,.16), transparent 62%),
    linear-gradient(#1d1834, #14101f);
  border: 3px solid var(--sm-border);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
#sm-market .mk-modal .bigart img { width: 86%; height: 86%; object-fit: contain; image-rendering: pixelated; }
#sm-market .mk-modal .info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
#sm-market .mk-modal .info h3 {
  margin: 0; font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-size: 17px; font-weight: 600; letter-spacing: .06em;
  text-shadow: 2px 2px 0 var(--sm-shadow);
}
#sm-market .mk-attrs { border: 2px solid rgba(246,193,119,.32); }
#sm-market .mk-attrs .r { display: flex; gap: 10px; padding: 5px 8px; font-size: 10px; letter-spacing: .05em; }
#sm-market .mk-attrs .r:nth-child(odd) { background: rgba(27,23,48,.55); }
#sm-market .mk-attrs .r .k { flex: 0 0 92px; color: var(--sm-muted); font-weight: 700; }
#sm-market .mk-attrs .r .v { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
#sm-market .mk-attrs .r .v.hidden-v { color: var(--sm-border); }
#sm-market .mk-note {
  font-size: 10px; line-height: 1.6; letter-spacing: .04em; color: var(--sm-muted);
  border-left: 3px solid var(--sm-border); padding: 4px 0 4px 8px;
}
#sm-market .mk-modal .foot {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; background: var(--sm-dark);
  border-top: 3px solid var(--sm-border);
}
#sm-market .mk-modal .foot .spacer { flex: 1 1 auto; }
#sm-market .mk-modal .foot .total { display: flex; flex-direction: column; gap: 3px; }
#sm-market .mk-modal .foot .total .k { font-size: 9px; letter-spacing: .16em; color: var(--sm-muted); }
#sm-market .mk-modal .foot .total .v { font-size: 18px; font-weight: 700; color: var(--sm-border); letter-spacing: .04em; }
#sm-market .mk-modal .foot .smui-btn { min-width: 104px; text-align: center; }
#sm-market .mk-priceform { display: flex; flex-direction: column; gap: 6px; }
#sm-market .mk-priceform label { font-size: 10px; letter-spacing: .14em; color: var(--sm-muted); font-weight: 700; }
#sm-market .mk-priceform .err { font-size: 10px; color: var(--sm-danger); min-height: 13px; letter-spacing: .04em; }

@media (max-width: 900px) {
  #sm-market .mk-side { flex-basis: 180px; }
  #sm-market .mk-modal .sheet > .content { flex-direction: column; }
  #sm-market .mk-modal .bigart { flex: 0 0 140px; width: 140px; align-self: center; }
}
`

/* ================================================================== VIEW ===*/

interface EngineLike { processAction?: (action: string, data: unknown) => void }
interface SocketLike { on?: (type: string, cb: (data: any) => void) => void }

export interface MarketplaceApi {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** Swap the demo data for the real contract-backed source. */
  setSource(source: MarketSource): void
  destroy(): void
  root: HTMLElement
}

interface TxRow { id: string; label: string; status: TxStatus; hash?: string; at: number }

let instance: MarketplaceApi | null = null

export function mountMarketplace(
  engine?: EngineLike,
  socket?: SocketLike,
  opts?: { source?: MarketSource },
): MarketplaceApi {
  if (instance) return instance
  ensureUiKit()
  injectStyle('sm-market-css', CSS)

  let source: MarketSource = opts?.source ?? demoMarketSource()

  const filters: MarketFilters = {
    tab: 'all', q: '', kinds: [], types: [], shinyOnly: false, sort: 'recent',
  }
  const txs: TxRow[] = []
  let items: MarketItem[] = []
  let reqId = 0

  /* --- chrome ------------------------------------------------------------ */
  const root = el('div', { id: 'sm-market', class: 'smui smui-win', role: 'dialog', 'aria-label': 'Marketplace', 'aria-modal': 'false' })

  const titlebar = el('div', { class: 'smui-titlebar' })
  const walletChip = el('span', { class: 'mk-wallet' }, [
    el('span', { class: 'dot' }),
    el('span', { text: shortAddr(source.account?.() ?? '0x000000') }),
  ])
  const closeBtn = el('button', { class: 'smui-btn smui-close is-danger', type: 'button', 'aria-label': 'Close marketplace', text: '✕' })
  titlebar.append(
    el('span', { class: 'title', text: 'STOCKMONSTER EXCHANGE' }),
    el('span', { class: 'spacer' }),
    walletChip,
    closeBtn,
  )

  /* --- tabs -------------------------------------------------------------- */
  const TABS: Array<{ id: MarketTab; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'sealed', label: 'Sealed Boxes' },
    { id: 'opened', label: 'Opened' },
    { id: 'mine', label: 'My Listings' },
  ]
  const tabsRow = el('div', { class: 'mk-tabs', role: 'tablist' })
  const tabBtns = new Map<MarketTab, HTMLButtonElement>()
  for (const t of TABS) {
    const b = el('button', {
      class: `mk-tab${t.id === 'all' ? ' is-on' : ''}`, type: 'button',
      role: 'tab', 'aria-selected': t.id === 'all' ? 'true' : 'false',
      'data-tab': t.id, text: t.label,
    })
    b.addEventListener('click', () => setTab(t.id))
    tabBtns.set(t.id, b)
    tabsRow.appendChild(b)
  }

  /* --- sidebar ----------------------------------------------------------- */
  const search = el('input', {
    class: 'smui-input', type: 'search', placeholder: 'Search name / ticker…',
    'aria-label': 'Search listings', autocomplete: 'off', spellcheck: 'false',
  })
  guardKeys(search)
  let searchTimer: any = null
  search.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { filters.q = search.value.trim(); refresh() }, 140)
  })

  const filtersBox = el('div', { class: 'mk-filters smui-scroll' })

  function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, swatch?: string) {
    const input = el('input', { type: 'checkbox', checked })
    const row = el('label', { class: `smui-check${checked ? ' is-on' : ''}` }, [
      input,
      el('span', { class: 'box' }),
      swatch ? el('span', { class: 'mk-swatch', style: `background:${swatch}` }) : null,
      el('span', { text: label }),
    ])
    input.addEventListener('change', () => {
      row.classList.toggle('is-on', input.checked)
      onChange(input.checked)
    })
    return row
  }

  function group(title: string, body: HTMLElement, collapsed = false) {
    const g = el('div', { class: `mk-group${collapsed ? ' collapsed' : ''}` })
    const caret = el('span', { class: 'caret', text: collapsed ? '▶' : '▼' })
    const head = el('button', { class: 'head', type: 'button', 'aria-expanded': String(!collapsed) }, [
      caret, el('span', { text: title }),
    ])
    head.addEventListener('click', () => {
      const now = g.classList.toggle('collapsed')
      caret.textContent = now ? '▶' : '▼'
      head.setAttribute('aria-expanded', String(!now))
    })
    g.append(head, el('div', { class: 'body' }, [body]))
    return g
  }

  const kindBody = el('div')
  for (const k of ['sealed', 'opened'] as ItemKind[]) {
    kindBody.appendChild(checkbox(k === 'sealed' ? 'Sealed' : 'Opened', false, (on) => {
      const set = new Set(filters.kinds ?? [])
      if (on) set.add(k); else set.delete(k)
      filters.kinds = [...set]
      refresh()
    }))
  }
  const typeBody = el('div', { class: 'scrolly smui-scroll' })
  for (const t of ALL_TYPES) {
    typeBody.appendChild(checkbox(t, false, (on) => {
      const set = new Set(filters.types ?? [])
      if (on) set.add(t); else set.delete(t)
      filters.types = [...set]
      refresh()
    }, TYPE_COLORS[t] ?? '#b9b2d6'))
  }
  const rarityBody = el('div')
  rarityBody.appendChild(checkbox('Shiny only', false, (on) => { filters.shinyOnly = on; refresh() }, '#8fd0ff'))

  const clearBtn = el('button', { class: 'smui-btn is-ghost mk-clear', type: 'button', text: 'Clear filters' })
  filtersBox.append(
    group('Item type', kindBody),
    group('Type', typeBody),
    group('Rarity', rarityBody),
    clearBtn,
  )
  clearBtn.addEventListener('click', () => {
    filters.kinds = []; filters.types = []; filters.shinyOnly = false; filters.q = ''
    search.value = ''
    filtersBox.querySelectorAll('input[type=checkbox]').forEach((i) => {
      (i as HTMLInputElement).checked = false
      i.parentElement?.classList.remove('is-on')
    })
    refresh()
  })

  const side = el('div', { class: 'mk-side' }, [
    el('div', { class: 'mk-search' }, [search]),
    filtersBox,
  ])

  /* --- main -------------------------------------------------------------- */
  const countEl = el('strong', { text: '—' })
  const sortSel = el('select', { class: 'smui-input', 'aria-label': 'Sort listings' })
  for (const [v, label] of [
    ['recent', 'Recently listed'], ['price-asc', 'Price: low to high'],
    ['price-desc', 'Price: high to low'], ['name', 'Name A-Z'],
  ] as const) sortSel.appendChild(el('option', { value: v, text: label }))
  sortSel.addEventListener('change', () => { filters.sort = sortSel.value as SortKey; refresh() })
  guardKeys(sortSel)

  const toolbar = el('div', { class: 'mk-toolbar' }, [
    countEl, el('span', { text: 'LISTINGS' }),
    el('span', { class: 'spacer' }),
    el('span', { text: 'SORT' }), sortSel,
  ])
  const grid = el('div', { class: 'mk-grid smui-scroll' })
  const main = el('div', { class: 'mk-main' }, [toolbar, grid])

  const body = el('div', { class: 'mk-body' }, [side, main])

  /* --- transactions ------------------------------------------------------ */
  const txRows = el('div', { class: 'rows smui-scroll' })
  const txPanel = el('div', { class: 'mk-tx' }, [
    el('h5', { text: 'SESSION TRANSACTIONS' }), txRows,
  ])

  /* --- modals ------------------------------------------------------------ */
  const buyModal = el('div', { class: 'mk-modal' })
  const sellModal = el('div', { class: 'mk-modal' })

  root.append(titlebar, tabsRow, body, txPanel, buyModal, sellModal)
  document.body.appendChild(root)
  makeDraggable(root, titlebar)

  /* --------------------------------------------------------------- render */
  function artNode(item: MarketItem, big = false): HTMLElement {
    if (item.kind === 'sealed' || !item.art) {
      return el('div', { class: 'mk-sealed', style: big ? 'width:70%;height:70%' : '' }, [el('span', { text: '?' })])
    }
    return el('img', { src: item.art, alt: item.name, loading: 'lazy', draggable: 'false' })
  }

  function typePill(t: string): HTMLElement {
    return el('span', { class: 'mk-type', style: `background:${TYPE_COLORS[t] ?? '#b9b2d6'}`, text: t.toUpperCase() })
  }

  function card(item: MarketItem): HTMLElement {
    const art = el('div', { class: 'mk-art' }, [artNode(item)])
    art.appendChild(el('span', {
      class: `smui-badge ${item.kind === 'sealed' ? 'is-sealed' : 'is-opened'} badge`,
      text: item.kind === 'sealed' ? 'SEALED' : 'OPENED',
    }))
    if (item.shiny) art.appendChild(el('span', { class: 'smui-badge is-shiny badge shiny', text: 'SHINY' }))

    const sub = el('div', { class: 'sub' })
    if (item.kind === 'sealed') {
      sub.appendChild(el('span', { text: 'CONTENTS ???' }))
    } else {
      for (const t of item.types ?? []) sub.appendChild(typePill(t))
      if (item.level) sub.appendChild(el('span', { text: `LV${item.level}` }))
    }

    const price = el('div', { class: 'mk-price' })
    if (item.priceWei) {
      price.append(
        el('span', { class: 'v', text: formatEth(item.priceWei) }),
        el('span', { class: 'u', text: 'ETH' }),
      )
    } else {
      price.appendChild(el('span', { class: 'free', text: 'NOT LISTED' }))
    }

    let action: HTMLElement
    if (filters.tab === 'mine') {
      if (item.listed) {
        action = el('button', { class: 'smui-btn is-danger', type: 'button', text: 'Cancel listing' })
        action.addEventListener('click', () => doCancel(item))
      } else {
        action = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'Sell' })
        action.addEventListener('click', () => openSell(item))
      }
    } else {
      action = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'Buy' })
      action.addEventListener('click', () => openBuy(item))
    }

    return el('div', { class: 'mk-card' }, [
      art,
      el('div', { class: 'name', title: item.name, text: item.name }),
      sub,
      price,
      action,
    ])
  }

  function renderGrid() {
    grid.textContent = ''
    countEl.textContent = String(items.length)
    if (!items.length) {
      grid.appendChild(el('div', { class: 'mk-empty', text: 'NO LISTINGS MATCH THESE FILTERS' }))
      return
    }
    const frag = document.createDocumentFragment()
    for (const it of items) frag.appendChild(card(it))
    grid.appendChild(frag)
  }

  async function refresh() {
    const my = ++reqId
    const got = await source.listItems({ ...filters })
    if (my !== reqId) return // a newer request won
    items = got
    renderGrid()
  }

  function setTab(tab: MarketTab) {
    filters.tab = tab
    for (const [id, b] of tabBtns) {
      const on = id === tab
      b.classList.toggle('is-on', on)
      b.setAttribute('aria-selected', String(on))
    }
    grid.scrollTop = 0
    refresh()
  }

  /* ------------------------------------------------------------ tx ledger */
  function renderTx() {
    txRows.textContent = ''
    if (!txs.length) {
      txRows.appendChild(el('div', { class: 'none', text: 'No transactions this session.' }))
      return
    }
    for (const t of txs.slice(0, 24)) {
      const time = new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      txRows.appendChild(el('div', { class: 'row' }, [
        el('span', { class: 't', text: time }),
        el('span', { class: 'l', text: t.label }),
        t.hash ? el('span', { class: 'h', text: shortAddr(t.hash) }) : null,
        el('span', { class: `mk-status ${t.status}`, text: t.status.toUpperCase() }),
      ]))
    }
  }

  async function track(handle: TxHandle) {
    const row: TxRow = { id: handle.id, label: handle.label, status: handle.status, hash: handle.hash, at: Date.now() }
    txs.unshift(row)
    renderTx()
    try {
      row.status = await handle.settled
    } catch {
      row.status = 'failed'
    }
    renderTx()
    refresh()
  }

  /* ---------------------------------------------------------- buy / sell */
  let releaseModal: (() => void) | null = null
  function closeModals() {
    buyModal.classList.remove('open')
    sellModal.classList.remove('open')
    buyModal.textContent = ''
    sellModal.textContent = ''
    releaseModal?.()
    releaseModal = null
  }

  function attrRow(k: string, v: string, hidden = false) {
    return el('div', { class: 'r' }, [
      el('span', { class: 'k', text: k }),
      el('span', { class: `v${hidden ? ' hidden-v' : ''}`, text: v, title: v }),
    ])
  }

  function openBuy(item: MarketItem) {
    closeModals()
    const attrs = el('div', { class: 'mk-attrs' })
    if (item.kind === 'sealed') {
      attrs.append(
        attrRow('CONTENTS', '??? — hidden until opened', true),
        attrRow('TYPE', '???', true),
        attrRow('STATS', '???', true),
        attrRow('SHINY ODDS', '1 in 128', false),
        attrRow('ATTR COMMIT', item.attrCommit ? shortAddr(item.attrCommit) : '—'),
        attrRow('TOKEN ID', `#${item.tokenId}`),
        attrRow('SELLER', shortAddr(item.seller)),
      )
    } else {
      const s = item.stats
      attrs.append(
        attrRow('TICKER', item.ticker ? `$${item.ticker}` : '—'),
        attrRow('TYPE', (item.types ?? []).join(' / ') || '—'),
        attrRow('LEVEL', String(item.level ?? '—')),
        attrRow('SHINY', item.shiny ? 'YES' : 'NO'),
        attrRow('STATS', s ? `HP ${s.hp} · ATK ${s.atk} · DEF ${s.def}` : '—'),
        attrRow('', s ? `SPD ${s.spd} · SpA ${s.ats} · SpD ${s.dfs}` : '—'),
        attrRow('TOKEN ID', `#${item.tokenId}`),
        attrRow('SELLER', shortAddr(item.seller)),
      )
    }

    const info = el('div', { class: 'info' }, [
      el('h3', { text: item.name }),
      el('div', { class: 'sub', style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
        el('span', { class: `smui-badge ${item.kind === 'sealed' ? 'is-sealed' : 'is-opened'}`, text: item.kind.toUpperCase() }),
        item.shiny ? el('span', { class: 'smui-badge is-shiny', text: 'SHINY' }) : null,
        ...((item.types ?? []).map(typePill)),
      ]),
      attrs,
      el('div', {
        class: 'mk-note',
        text: item.kind === 'sealed'
          ? 'Sealed boxes stay sealed. What is inside is committed on-chain and only revealed when you open it — nobody, seller included, can see it first.'
          : 'This creature is already revealed. Attributes above are what you receive.',
      }),
    ])

    const bigArt = el('div', { class: 'bigart' }, [artNode(item, true)])
    const buyBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'Buy' })
    const cancelBtn = el('button', { class: 'smui-btn', type: 'button', text: 'Cancel' })

    const sheet = el('div', { class: 'sheet' }, [
      el('div', { class: 'head' }, [
        el('span', { class: 'title', text: 'CONFIRM PURCHASE' }),
        el('span', { class: 'spacer' }),
      ]),
      el('div', { class: 'content smui-scroll' }, [bigArt, info]),
      el('div', { class: 'foot' }, [
        el('div', { class: 'total' }, [
          el('span', { class: 'k', text: 'TOTAL' }),
          el('span', { class: 'v', text: `${item.priceWei ? formatEth(item.priceWei, 5) : '—'} ETH` }),
        ]),
        el('span', { class: 'spacer' }),
        cancelBtn, buyBtn,
      ]),
    ])
    buyModal.appendChild(sheet)
    buyModal.classList.add('open')
    releaseModal = pushLayer(closeModals)
    cancelBtn.addEventListener('click', closeModals)
    buyBtn.addEventListener('click', async () => {
      buyBtn.disabled = true
      buyBtn.textContent = 'Signing…'
      try {
        const handle = await source.buy(item.id)
        closeModals()
        track(handle)
      } catch {
        buyBtn.disabled = false
        buyBtn.textContent = 'Buy'
      }
    })
    setTimeout(() => buyBtn.focus(), 0)
  }

  function openSell(item: MarketItem) {
    closeModals()
    const input = el('input', {
      class: 'smui-input', type: 'text', inputmode: 'decimal',
      placeholder: '0.05', 'aria-label': 'Price in ETH', autocomplete: 'off',
    })
    const err = el('div', { class: 'err' })
    const payout = el('div', { class: 'mk-note', text: 'Marketplace fee 2.5% · you receive —' })
    const listBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'List', disabled: true })
    const cancelBtn = el('button', { class: 'smui-btn', type: 'button', text: 'Cancel' })

    const validate = () => {
      const wei = parseEth(input.value)
      if (!wei) {
        listBtn.disabled = true
        err.textContent = input.value.trim() ? 'Enter a positive ETH amount.' : ''
        payout.textContent = 'Marketplace fee 2.5% · you receive —'
        return null
      }
      listBtn.disabled = false
      err.textContent = ''
      const net = (BigInt(wei) * 975n) / 1000n
      payout.textContent = `Marketplace fee 2.5% · you receive ${formatEth(net.toString(), 5)} ETH`
      return wei
    }
    input.addEventListener('input', validate)
    guardKeys(input, closeModals)
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !listBtn.disabled) submit()
    })

    const attrs = el('div', { class: 'mk-attrs' }, [
      attrRow('TOKEN ID', `#${item.tokenId}`),
      attrRow('ITEM', item.kind === 'sealed' ? 'Sealed box (contents hidden)' : `${item.name}${item.ticker ? ` · $${item.ticker}` : ''}`),
      attrRow('TYPE', item.kind === 'sealed' ? '???' : (item.types ?? []).join(' / ') || '—', item.kind === 'sealed'),
    ])

    const sheet = el('div', { class: 'sheet' }, [
      el('div', { class: 'head' }, [
        el('span', { class: 'title', text: 'LIST FOR SALE' }),
        el('span', { class: 'spacer' }),
      ]),
      el('div', { class: 'content smui-scroll' }, [
        el('div', { class: 'bigart' }, [artNode(item, true)]),
        el('div', { class: 'info' }, [
          el('h3', { text: item.name }),
          attrs,
          el('div', { class: 'mk-priceform' }, [
            el('label', { for: '', text: 'PRICE (ETH)' }),
            input, err,
          ]),
          payout,
          el('div', {
            class: 'mk-note',
            text: 'Listing is a signature, not a transaction — no gas until somebody buys.',
          }),
        ]),
      ]),
      el('div', { class: 'foot' }, [el('span', { class: 'spacer' }), cancelBtn, listBtn]),
    ])
    sellModal.appendChild(sheet)
    sellModal.classList.add('open')
    releaseModal = pushLayer(closeModals)
    cancelBtn.addEventListener('click', closeModals)

    async function submit() {
      const wei = validate()
      if (!wei) return
      listBtn.disabled = true
      listBtn.textContent = 'Signing…'
      try {
        const handle = await source.list(item.tokenId, wei)
        closeModals()
        track(handle)
      } catch {
        listBtn.disabled = false
        listBtn.textContent = 'List'
      }
    }
    listBtn.addEventListener('click', submit)
    setTimeout(() => input.focus(), 0)
  }

  async function doCancel(item: MarketItem) {
    const handle = await source.cancel(item.id)
    track(handle)
  }

  /* -------------------------------------------------------- open / close */
  let releaseWindow: (() => void) | null = null
  function open() {
    if (root.classList.contains('open')) return
    root.classList.add('open')
    releaseWindow = pushLayer(() => close())
    refresh()
    setTimeout(() => (tabBtns.get(filters.tab ?? 'all') as HTMLElement)?.focus(), 0)
  }
  function close() {
    closeModals()
    root.classList.remove('open')
    releaseWindow?.()
    releaseWindow = null
  }
  closeBtn.addEventListener('click', () => close())

  // Never fight the RPG-JS dialog layer: step aside while a dialog is up.
  const stopWatch = watchGameDialog((dialogOpen) => {
    root.classList.toggle('dialog-hidden', dialogOpen)
  })

  // Optional server pushes, harmless if the events never fire.
  socket?.on?.('market:tx', (d: { label?: string; status?: TxStatus; hash?: string }) => {
    if (!d?.label) return
    txs.unshift({ id: `srv-${Date.now()}`, label: d.label, status: d.status ?? 'pending', hash: d.hash, at: Date.now() })
    renderTx()
  })
  socket?.on?.('market:refresh', () => { if (root.classList.contains('open')) refresh() })

  renderTx()

  const api: MarketplaceApi = {
    root,
    open,
    close,
    toggle() { root.classList.contains('open') ? close() : open() },
    isOpen: () => root.classList.contains('open'),
    setSource(s) {
      source = s
      const acct = s.account?.()
      if (acct) (walletChip.lastChild as HTMLElement).textContent = shortAddr(acct)
      refresh()
    },
    destroy() {
      stopWatch()
      close()
      root.remove()
      instance = null
    },
  }
  instance = api
  return api
}

/** Open the marketplace, mounting it on first use. */
export function openMarketplace(): MarketplaceApi {
  const api = instance ?? mountMarketplace()
  api.open()
  return api
}

export function closeMarketplace(): void { instance?.close() }
export function getMarketplace(): MarketplaceApi | null { return instance }
