# In-game HUD and NFT marketplace UI

Three new client-side files, pure DOM + CSS, no framework, no network calls:

| File | Exports | What it is |
| --- | --- | --- |
| `src/ui-kit.ts` | `ensureUiKit`, `el`, `guardKeys`, `pushLayer`, `watchGameDialog`, `makeDraggable`, `formatEth`, `parseEth`, `THEME`, `Z` | The shared pixel-window vocabulary: palette, buttons, inputs, checkboxes, chips, badges, scrollbars, window chrome, plus the three behaviours everything depends on (key guarding, the ESC stack, the dialog watcher). |
| `src/hud.ts` | `mountHud(engine, socket)` | The always-on HUD. |
| `src/marketplace.ts` | `mountMarketplace(engine, socket, opts?)`, `openMarketplace()`, `closeMarketplace()`, `demoMarketSource()`, types | The draggable marketplace window. |

## Wiring

Both mounts are one-liners next to the existing `mountChatUi` call in
`src/client.ts` (they take the same `engine` / `socket` pair):

```ts
mountHud(engine, socket)
mountMarketplace(engine, socket)   // optional: creates the window up front
```

`mountMarketplace` is optional — `openMarketplace()` mounts on first use. The
HUD's MARKET button (hotkey `4`) calls it either way. Both mounts are
idempotent; a second call returns the same instance.

## Layout

```
┌ avatar tile · name · LV · XP bar          gear ⚙ + banner slot stack ┐
│ currency chips                                                       │
│                                                                      │
│                     map canvas (untouched)                           │
│                                                                      │
└ chat panel (chat-ui.ts)              ▣ ▣ ▣ ▣ ▣ ▣  action bar ────────┘
```

* **Top-left** — 76px framed avatar tile showing the player's chosen character
  (frame col 1 / row 0 of the 96×128 sheet at `spritesheets/characters/<slug>.png`),
  name, `LV n · TRAINER`, an XP bar, and a wrapping row of currency chips.
* **Top-right** — gear button (opens a small settings popover: sound, music,
  player names, banner slots — all persisted to `localStorage`) and a vertical
  stack of three banner slots, hidden below 1180px wide.
* **Bottom** — the action bar (BAG · DEX · TEAM · MARKET · QUESTS · MAP,
  hotkeys 1-6). It is anchored `left: calc(var(--sm-chat-w) + 28px)` so it can
  never overlap the chat panel, and centres itself in the space that is left.
  Every button also fires `window` CustomEvent `sm:hud-action` with
  `{ id }`, so whoever owns bag/dex/team/quests/map later just listens.

The `#sm-hud` container is `pointer-events: none`; only the three clusters turn
them back on. Verified in the harness: `elementFromPoint` at four map points
returns the map, not the HUD.

## Marketplace window

Title bar (draggable, wallet chip, close) → tabs `All / Sealed Boxes / Opened /
My Listings` → sidebar (search + collapsible **Item type**, **Type** (all 18
creature types, colour-swatched), **Rarity → Shiny only**, plus *Clear filters*)
→ responsive card grid (`auto-fill, minmax(172px, 1fr)`) → **SESSION
TRANSACTIONS** strip. Two sub-windows overlay it:

* **CONFIRM PURCHASE** — large art, attribute table, total, CANCEL / BUY. For a
  sealed box the table reads `CONTENTS ??? — hidden until opened`, `TYPE ???`,
  `STATS ???`, plus `BOX TIER`, `SHINY ODDS` and the on-chain `ATTR COMMIT`.
  Sealed cards never render creature art at all — a crate is drawn in CSS.
* **LIST FOR SALE** — reached from *My Listings* on an unlisted token: price
  input in ETH with live validation, a 2.5% fee/payout line, CANCEL / LIST.
  Already-listed tokens show CANCEL LISTING instead.

Box tiers (`standard` / `prime` / `apex`) tint the crate and set the shiny odds.
They describe the **odds**, never the contents, so they leak nothing.

## Data seam

Everything the UI renders comes from one interface:

```ts
interface MarketSource {
  listItems(filters: MarketFilters): Promise<MarketItem[]>
  getItem(id: string): Promise<MarketItem | null>
  buy(id: string): Promise<TxHandle>
  list(tokenId: string, priceWei: string): Promise<TxHandle>
  cancel(id: string): Promise<TxHandle>
  myItems(): Promise<MarketItem[]>
  account?(): string | undefined
}
```

`demoMarketSource()` fabricates 72 listings + 8 owned tokens from
`src/data/dex.json` with a seeded PRNG, so the UI is fully explorable today.

**When the EIP-712 marketplace contract lands**, write
`src/market-source-chain.ts` exporting a `MarketSource` built on viem and hand
it over — no rendering code changes:

```ts
mountMarketplace(engine, socket, { source: chainMarketSource() })
// or, at runtime:
getMarketplace()?.setSource(chainMarketSource())
```

* `listItems` / `getItem` / `myItems` → read the order book (API/indexer). Each
  order carries maker, tokenId, price, nonce, expiry, signature, and for a
  sealed token its `attrCommit`. A sealed `MarketItem` must keep `art`, `types`
  and `stats` **undefined** — the hidden contents are the product.
* `list(tokenId, priceWei)` → `setApprovalForAll` once, then
  `signTypedData({ domain, types: { Order }, primaryType: 'Order', message })`
  and POST `{ order, signature }`. No gas.
* `buy(id)` → `writeContract({ functionName: 'fillOrder', args: [order, sig],
  value: order.price })`. Return the `TxHandle` immediately with
  `status: 'pending'` and `hash`, and resolve `settled` from
  `waitForTransactionReceipt`.
* `cancel(id)` → order-book delete or on-chain `cancelNonce(nonce)`.

Prices are **wei strings** everywhere; `formatEth` / `parseEth` in `ui-kit.ts`
are the only conversion points. `TxHandle.settled` is what moves a row in
SESSION TRANSACTIONS from pending to confirmed/cancelled/failed.

The HUD has the same shape: `HudModel` holds name, level, XP, avatar sheet,
chips and banners. The live parts (name, character sprite) are read from the
engine and from `name:accepted` on the socket; everything else is marked
`PLACEHOLDER` in `demoHudModel()`. Push updates either as a socket
`hud:update` event with a `Partial<HudModel>`, or via `mountHud(...).update()`.

## Layering and input rules

* z-index: map 0 · battle scene 800 · chat 850 · **HUD 700-780** ·
  **marketplace 960-990** · RPG-JS dialog layer 1000+.
* The marketplace hides itself (`visibility: hidden`) and the HUD dims to 30%
  while any `.rpg-ui-dialog` is in the DOM — `watchGameDialog()` in `ui-kit.ts`
  runs a `MutationObserver` for it. HUD hotkeys are ignored during a dialog.
* Every input calls `guardKeys()`, which stops `keydown/keyup/keypress`
  propagation — the engine listens on `window`, so without this typing walks the
  player. Same pattern chat-ui.ts uses.
* ESC closes the top-most layer only: purchase/sell sheet first, then the
  window, then the settings popover (`pushLayer()` keeps the stack, in the
  capture phase so the game never sees the keystroke).
* Focus rings are the accent green; tabs are real `role="tab"` buttons, filters
  are real checkboxes, and the modals move focus to their primary button.

## Verified

`RPG_TYPE=mmorpg npx vite build` green, `npx vitest run` 101/101. A headless
harness (scratchpad, not in the repo) mounted both modules against a stub
engine/socket and asserted: hotkey `4` opens the window, zero keystrokes leak to
the game while typing in the search box, ESC closes the sheet then the window,
Enter still focuses the chat input, the HUD is pointer-transparent over the map,
the chat panel and action bar rectangles do not intersect, and the marketplace
goes `visibility: hidden` when an `.rpg-ui-dialog` appears.

## Not done yet

* BAG / DEX / TEAM / QUESTS / MAP only fire `sm:hud-action`; no panels behind
  them.
* Banner slots are empty frames — pass `HudModel.banners[].image` to fill them.
* No real balances, level or XP (placeholders), and no pagination/virtualisation
  in the grid (fine for hundreds of listings, not for tens of thousands).
