# Stockmonsters MMO — handover

Written 2026-08-25. Everything below was verified by running it. Where something
is unverified, it says so.

---

## The goal

Rebuild Stockmonsters as a browser MMO: **every player controls their own
character, up to ~50 on the same map.**

`Stockmonsters/` is a **PSDK / Pokémon Studio** game — a reskinned Pokémon
fangame where 194 US stock tickers became collectible monsters, each tied to an
EVM contract address. It is a crypto/meme project, so the deliverable is a link
that works on a phone.

## Why a rewrite is unavoidable

**PSDK is a single-player engine with no networking.** One player character, one
save, one world state. "50 people on the same map with their own characters" is
not a setting — it is a different engine.

There is a working fallback in the meantime (see the last section): the real
PSDK game streamed to browsers over WebRTC. But streaming gives **one shared
character** — everyone who opens that link drives the same player.

Counter-intuitive but decisive: **the MMO is far cheaper to run.** 50 streamed
players ≈ 50 CPU cores, because each needs its own game process and video
encoder. 50 MMO players ≈ one small server, because the game runs on each
player's own device. The expensive path is the one that avoids the rewrite.

---

## Framework: RPG-JS v5 (beta) — decided

| | Latest release | Date |
|---|---|---|
| v4 | 4.3.0 | **2024-01-29** — 2.5 years stale |
| v5 | 5.0.0-beta.33 | **2026-08-20** |

The choice is not "stable vs beta", it is **maintained beta vs abandoned
stable**. v5. Versions are already pinned exactly (no caret) in `package.json`,
so upgrades stay deliberate.

**The real risk is not the version number** — it is depending on a
single-maintainer, pre-1.0 framework for months. This should shape the
architecture: keep the framework-independent surface large. The assets, the map
importer and the game data (194 tokens, dex text, type chart) are already ours.
**The battle engine — the biggest single piece — should be written as plain
logic and attached to RPG-JS through a thin adapter, not built inside it.**

## Assets travel well; the Ruby does not

- 26 Tiled `.tmx` maps, standard Tiled 1.10, 64×64 tiles at 32 px
- 21 tilesets
- 2282 RPG Maker character sprites
- Real base stats and a real 18×18 type chart in `Stockmonsters/Data/Studio/`
  (baseHp/Atk/Dfe/Ats/Dfs/Spd, height, weight, catch rate, effectiveness
  matrix, per-type hex colours). Not invented — shipped game data.
  `stockmonsters-reskin/vocab.js` documents the positional type rename.

RPG-JS has `Presets.RMSpritesheet` and reads Tiled natively, so the art moves
almost unchanged. What does not move: PSDK's Ruby layer — battle system, events,
menus, the lot.

**Data gotcha:** `stockmonsters-reskin/dex-text.json` is keyed by **1-based
position in the token map, NOT by `dexId`.** Keying by `dexId` silently
mismatches 88 of the 194 entries. Anything joining this data must use the same
keying.

---

## What is built: `stockmonsters-mmo/`

Scaffolded from `npx degit rpgjs/starter#v5`. MMO mode is the starter's default
(`provideMmorpg`).

### `tools/import-maps.mjs` — the map importer

Reusable for all 26 maps (`--all`). Solves four real migration problems:

1. **Path flattening.** PSDK links `Maps/`, `Tilesets/`, `Assets/` with `../`;
   RPG-JS wants them side by side in `src/tiled/`.

2. **Colour key → alpha.** PSDK marks transparency the RPG Maker way:
   `trans="f05ba1"` on the `<image>` tag, with that colour left *opaque* in the
   PNG. Tiled and PSDK honour it; PIXI does not, so everything "transparent"
   rendered as solid magenta. The importer bakes the key into a real alpha
   channel (3.8 M pixels on TECH-Buildings alone).

3. **Metadata layers stripped.** PSDK smuggles collision (`passages`) and
   terrain tags (`systemtags`) in as tile layers. They are data, not art, and
   RPG-JS tries to draw them.

4. **The bug that took longest to find.** Two tilesets claimed more tiles than
   their images contain — TECH-Nature declared `tilecount="3451"` but the PNG
   holds 3120; TECH_Lab declared 230, holds 180. The reskin resized the PNGs
   without updating the `.tsx` metadata. Any map tile landing on a phantom index
   made the renderer ask for an `undefined` texture and **the entire map failed
   to draw** — a total blank screen from two stale numbers. The importer now
   re-derives `tilecount`, `columns` and the declared image size from the actual
   PNG.

**Result:** the Hub map imports cleanly. All **8,427 tiles resolve to real image
tiles**, no overlapping `firstgid` ranges, no render errors. Verified by a
standalone GID validator (worth keeping as a check when importing the other 25).

---

## The blocker — SOLVED (2026-08-25)

**Symptom:** no player character, camera stuck at the map's top-left, screen
mostly black. Root causes were three stacked problems, found by bisecting
against a pristine starter:

1. **The diagnostic was a bug.** `player.ts` imported `node:fs` for trace
   logging. RPG-JS bundles module files into the *client* too, and vite's
   externalization of `node:fs` threw at module load — killing the whole
   client. Every earlier client-side observation was tainted by this.
2. **Duplicate module registration.** `provideServerModules([mainServerModule])`
   had been added alongside `provideMain()`. The pristine starter ships
   `provideServerModules([])` — the empty call registers `ModulesToken`, so it
   must stay, but adding `mainServerModule` to it registers the module twice
   and breaks hook collection. Restored to `provideServerModules([])`.
3. **The real map bug: no `<objectgroup>` in the TMX.** RPG-JS mounts its
   `EventLayerComponent` — the layer that renders ALL characters and arms
   camera-follow — only where the Tiled map has an objectgroup layer
   (`@canvasengine/presets` TiledMap: `case ObjectGroup: objectLayer()`).
   PSDK maps never contain one, so the importer now injects an empty
   `<objectgroup name="events"/>` into every imported map.

**Verified working:** hub renders fully, hero sprite at spawn (912,1200 —
tile 28,37), camera follows, arrow-key movement moves the player
(912,1200 → 1154,1367 in test). Headless-browser test scripts are in the
session scratchpad (`shot.mjs`, `move-test.mjs`, `probe*.mjs`).

**Also added:** `src/zoom.ts` — auto-zooms the pixi-viewport 2–3x by window
width after each map load (no zoom option exists in the client config).
Wired into both `standalone.ts` (dev entry — note: vite serves *standalone*
mode, server+client in one page) and `client.ts` (real MMO entry).

### Facts worth keeping

- The dev entry injected by the vite plugin is `src/standalone.ts`, NOT
  `src/client.ts`. Testing multiplayer needs a real server + `client.ts`.
- `startGame()` resolves to the DI context; `inject(ctx, RpgClientEngine)`
  reaches the engine (`findViewportInstance()`, `sceneMap.getCurrentPlayer()`,
  `mapLoadCompleted$`…). `cameraFollowTargetId` of `null` means "follow the
  current player", it is not an error state.
- PSDK "Black_1"/"Black_5" layers are real art (semi-opaque black masks over
  the void), not metadata — keep them.
- The old `@rpgjs/testing` note still stands (needs a real canvas).

## Realistic schedule

| Stage | Work | Estimate |
|---|---|---|
| 1 | One map, multiple players seeing each other | ~1 week (mostly done bar the blocker) |
| 2 | Collision conversion + all 26 maps + transitions | 1–2 weeks |
| 3 | Character/creature sprites, dex | 1–2 weeks |
| 4 | **Turn-based battles + catching** | 4–8 weeks |
| 5 | Saves, inventory, events, menus | 4+ weeks |

Playable MMO demo (stages 1–3): **~1 month.** Parity with the PSDK game:
**3–6 months.**

**Stage 4 has no shortcut.** RPG-JS ships `@rpgjs/action-battle`, which is
*action* combat. Stockmonsters is turn-based. That system gets written from
scratch and it is the largest piece of the port. Stage 2's collision conversion
is also real work: PSDK's `passages` layer encodes passability in its own
format, and it must be translated into RPG-JS collision. Until then players walk
through walls.

---

## ⚠️ Unreskinned Nintendo art — applies to the MMO too

The reskin is incomplete, and the MMO will draw from the same asset pool. Confirmed
by inspecting the files:

- **`graphics/icons/`** (926 files) — *item* icons: Poké Balls, Master Balls,
  potions. Unmodified Nintendo art.
- **`graphics/battlers/`** — Pokémon **trainer** sprites. Unmodified.
- **`graphics/pokedex/pokeicon/`** — vanilla creature icons.
- The PSDK game's **intro animation** (Map002) still plays the original
  Red/Blue opening — Gengar and Nidorino.

**The safe source is `graphics/pokedex/pokefront/`** — all 254 creature fronts
(194 stocks + 60 memes) were inspected individually and are original generated
art. A `.vanilla-bak` sibling file is a reliable signal that an asset *was*
reskinned.

Those fronts sit on a **noisy magenta chroma key whose exact colour differs per
file** (253,82,214 / 253,58,180 / 254,0,127 / 251,104,247…), so any pipeline
using them must sample the key per sprite rather than assume one value.

For a project with money attached, replacing the remaining vanilla assets should
happen before wide distribution. `stockmonsters-reskin/` has the sprite pipeline.

---

## Loose ends in `stockmonsters-mmo/`

- `src/tiled/` currently holds only the Hub map and its 8 tilesets. The starter's
  own tiled assets were moved out; they are in the session scratchpad if needed,
  or just re-degit a pristine starter.
- `sharp` was added as a dependency for the colour-key conversion.
- No dev server is left running.

---

## Session-2 progress (2026-08-25, later)

Everything below is committed and was verified by running it.

- **All 19 playable maps** imported with collision (passages -> hitbox rects),
  phantom-gid sanitizing, and an auto-injected `<objectgroup>`; GID-validated.
- **70 PSDK warps** extracted (`tools/extract-warps.py`) into touch/action
  events; elevators are hand-written `showChoices` floor menus. Arrivals snap
  to the nearest passable cell (4/70 PSDK targets land on blocked cells).
- **Spawn matches the original game**: the exterior dock at the ship gangway.
- **Title screen** (original art, click -> fullscreen), 1.5x auto-zoom.
- **Dex**: 254 fronts chroma-keyed + `src/data/dex.json` (types, stats,
  contract addresses, dex text — stocks keyed by token-map position, memes by
  dexId). **68 of 254 overworld charsets** exist; wild creatures wander the
  outdoor maps biome-matched. The other 186 charsets were never generated.
- **`docs/psdk-mechanics.md`** — 2000-line engine-source-verified spec.
- **Battle core** (`src/battle/`, framework-independent, injectable RNG):
  stats, exp curves, type chart, Gen-4 damage, catching, accuracy, turn
  order, minimal 1v1 loop, wild-creature factory. 29 golden tests green
  (`npx vitest run`).

- **In-game battles**: touching a wild creature opens a dialog-driven wild
  battle (starter trio on first touch; Fight/Ball/Run; catches land in the
  BOX variable — the NFT mint queue). Escape opens MENU -> Team / Box.
  Wild wanderer pool is BST-capped at 460.

- **Battle core** complete through the status tranche (44 tests,
  `npx vitest run`): Gen-4 damage, statuses, stat stages, catching, flee.
- **Production MMO server WORKS**: `npm run build:mmo && npm start` →
  `server.mjs` hosts client + /parties rooms + ws + SQLite persistence
  (data/rooms.sqlite) on one Node process. Verified: two browsers see each
  other on the exterior dock. Chunk streaming is REQUIRED in mmorpg mode
  and is re-enabled (the old transfer breakage was the ping-pong loops,
  not streaming).
- Generated `src/data/ow-spritesheets.ts` must stay free of @rpgjs/client
  imports (server reads it; client Presets applied in config.client.ts).
- Tooling: `.claude/skills/tile-design` (autotiling reference, fetched from
  GitHub source) and a `tiled` MCP server registered in the project config
  (`npx tiled-mcp-server --project-root .../src/tiled`) — loads next session.

### Known issues

- **Map-transfer camera flash**: on transfer the engine resets camera follow
  and scene data, so the camera shows the map's (0,0) corner for the first
  frames before the player syncs in. A black fade cover in `src/zoom.ts`
  hides it; the root cause is framework-side (beta.33).
- First-ever load of a map during a transfer takes several seconds (parse +
  textures); repeat visits are fast. Candidate fix: preload adjacent maps.
- Map chunk streaming is disabled (`streaming: false` in `src/server.ts`) —
  transfers break with it in beta.33 ("f.tilesets is not iterable").
- ~~186 missing overworld charsets~~ SOLVED session 3: `tools/gen-ow.mjs`
  fallback generation from dex fronts (real art can replace them anytime —
  the generator skips existing files).
- PSDK maps 22-26 (Bull Canyon -> Exchange City) have encounter data but no
  geometry — that route must be authored from scratch.

- **Wallet login DONE (session 3)**: `auth.mjs` implements a minimal
  sign-in-with-Ethereum on the production server. `GET /auth/nonce` issues a
  single-use, 5-minute nonce; `POST /auth/verify {address,message,signature}`
  checks it with viem's `verifyMessage` and returns
  `connectionId = "w:" + HMAC-SHA256(SERVER_SECRET, address)`.
  THE POINT: connectionId is chosen client-side and is what saves key by, so
  the address must NEVER be the id directly — anyone could then load anyone
  else's save. The HMAC is stable per wallet (saves follow you across
  devices) but unforgeable without the secret. **Set SERVER_SECRET in
  production**; without it a random one is generated per boot and wallet
  saves reset on restart. `tools/auth-test.mjs` is the regression test (run
  the server on PORT=4131, then `node tools/auth-test.mjs`): honest login,
  stable id, impersonation, nonce replay, forged signature, distinct
  wallets, unknown nonce — all 7 behave correctly.
- **contracts/StockmonstersNFT.sol**: catch-to-mint ERC-721 with
  server-signed EIP-712 vouchers, 4 forge tests green (`cd contracts &&
  forge test`). Deploy steps in contracts/README.md.

- **NFT = sealed boxes, tested on a local chain.** User decisions applied:
  claiming is OPTIONAL, costs **0.01 ETH** (`claimFee`, adjustable +
  `withdraw`), and attributes are a SURPRISE — the mint stores only a
  commitment hash (nothing readable on-chain), `open()` reveals with the
  server-held salt (commit-reveal). 5 forge tests green. Full e2e verified
  on anvil: deploy -> `tools/sign-voucher.mjs` (viem, the production signer
  path) -> player claims for 0.01 ETH -> sealed reads empty -> open reveals
  shiny Nvidrake. viem is now a dependency of stockmonsters-mmo.
- **`new-assets/Ultimate Gen 4 Overworlds Pack/`**: 495 PNGs of Gen-4 style
  HUMAN overworld sprites (334 official NPCs + 75 Zaffre originals + effect
  animations: exclamation, grass, dust, splashes) — CREDIT REQUIRED
  (PurpleZaffre per included txt; credited in stockmonsters-mmo/CREDITS.md).
  No creature overworlds in it. Candidate source for NPC charset variety.
- **`new-assets/Remastered Kanto Johto Map Pack/`**: RMXP map data (152
  Map*.rxdata), tilesets, autotiles, PBS connection data, BGM — candidate
  raw material for the map-expansion stage (importer already speaks rxdata).

### Session-3 progress (2026-08-25, evening — committed)

- **"Create Your Character" selector SHIPPED** (user renamed it from Woka —
  the word "woka" must not appear anywhere): research in
  `docs/woka-character-selector.md` (engine-verified; key facts:
  `setGraphic()` accepts an ARRAY = native layer stacking synced to all
  peers; Pipoya sprites are license-clear, WorkAdventure's customisation/
  layers are NOT — provenance unresolved, gate for the layered builder;
  unknown graphic id = invisible player, silently). Implementation:
  `tools/import-characters.mjs` copies 49 curated Pipoya sheets (18 male,
  25 female, 3 cats, 3 dogs) -> `public/spritesheets/characters/` +
  generated `src/data/character-catalog.ts` + `catalog.json` for the DOM.
  Picker overlay in `index.html` (pixel theme, CREATE YOUR CHARACTER button
  on title + auto-open for first-timers), event seam `sm:character` ->
  `client.ts` -> `processAction('character:set')` -> `player.ts` validates
  against `CHARACTER_IDS` whitelist (anti-invisibility) and persists in the
  `CHARACTER` variable (per-wallet via connectionId), restored on every
  reconnect BEFORE the SPAWNED guard. localStorage mirror: `sm-character`.
- **All 254 creature overworld charsets exist now**: `tools/gen-ow.mjs`
  (sharp) generates fallback 128x128 4x4 charsets from dex fronts for the
  186 missing (alpha-trim, fit 28x28, bottom-center, right row mirrored,
  1px bob walk), never overwrites the 68 real PSDK sheets, plus border-only
  magenta-halo erosion that spares genuinely pink creatures (LADYS/GME/…).
  `tools/ow-spritesheets-emit.mjs` is the single shared emitter of
  `src/data/ow-spritesheets.ts` (dir scan; import-overworld.mjs calls it
  too, so run order no longer matters). Every creature can wander.
- **Battle visual scene SHIPPED**: server `player.emit('battle:state'|
  'battle:end')` snapshots from `battle.ts` (start/turn/potion/end);
  client `src/battle-scene.ts` DOM overlay (z 800, under dialogs at 1000):
  enemy front sprite top-right + mirrored ally bottom-left, pixel HP panels
  (green/amber/red, stepped animation), damage flash, status tag. Channel:
  `inject(ctx, WebSocketToken)` + `socket.on(...)` — the documented custom
  event path in beta.33.
- **NPCs curated 198 -> 56 and visually varied** (user: too many, all the
  same sprite). `tools/extract-npcs.py` now filters PSDK's demo-project
  tutorial NPCs (they explain engine commands: library/photostudio/
  gamecorner), lines still naming unreskinned Nintendo species, internal
  identifier names (NPC_foo, BattleOrdering), and scenery events (radio,
  bin, TV) that would render as people; then caps per map (hub 8, most 6).
  `npcs.ts` assigns each NPC one of the 43 human Pipoya sheets via FNV-1a
  over map:x,y:name — stable per NPC for every client and across restarts
  (32 distinct sprites in use).
- Verified: `RPG_TYPE=mmorpg npx vite build` green, 63 vitest green,
  production `server.mjs` smoke test serves picker catalog (49), generated
  ow sheets, and a "woka"-free page.

- **Player names + global chat SHIPPED (session 3)**. Names: mandatory once
  a wallet is connected — pixel modal (`src/chat-ui.ts`, no browser prompt),
  validated server-side by `src/modules/main/names.ts` (3-14 chars, ASCII
  only so Cyrillic lookalikes can't impersonate, reserved words blocked, no
  links/addresses), stored in the `NAME` variable, and rendered above every
  character via `player.setComponentsTop(Components.text('{name}'))` — the
  engine syncs that to all clients, no custom rendering needed.
  Chat: left-side pixel panel, Enter focuses the input (and stops key
  propagation so typing doesn't walk the player), Escape leaves it. Server
  filters EVERY message (`chat-filter.ts`) and rate-limits 6 per 10s.
  **The filter's design is the interesting part**: it never tests raw text.
  It builds two normalized views — `squashed` (all separators removed, catches
  "e x a m p l e . c o m") and `dotted` (only PUNCTUATION collapsed to ".",
  spaces preserved) — plus homoglyph/leetspeak folding. The space-vs-
  punctuation split is load-bearing: "to" and "me" are real TLDs AND ordinary
  words, so "want to trade" must pass while "example . com" must not. Length
  checks run per raw word, because a whole sentence squashes into one long run
  that looks exactly like a base58 address. 38 tests in
  `src/modules/main/chat-filter.spec.ts` (vitest.config.ts now includes it);
  suite went 63 -> 101 green.

### Kanto/Johto map pack IMPORTED and wired (session 3)

- `tools/import-rmxp-maps.mjs` (+ `tools/rmxp-defs.rb`, `tools/rmxp-dump.rb`)
  converts the RPG Maker XP pack in `new-assets/Remastered Kanto Johto Map
  Pack/` into Tiled maps: **152 maps**, autotiles expanded to real tilesets,
  colour-key transparency baked to alpha, collision derived from the RMXP
  tileset `passages` table, `<objectgroup>` injected. Format notes and the
  autotile algorithm are in `docs/rmxp-map-import.md`.
  Gotcha that cost time: `Data/Map*.rxdata` also globs `MapInfos.rxdata` —
  use `Map[0-9]*`. `MapInfos` unmarshals to a HASH keyed by id, `Tilesets`
  to an ARRAY. Ruby 3.2 + Marshal with stub classes reads all of it.
- `src/tiled/rmxp-manifest.ts` is SEPARATE from `manifest.ts` so the two
  importers never clobber each other; `server.ts` concatenates them. Zero id
  collisions with the 19 PSDK maps (verified).
- **Edge transitions** (`src/modules/main/rmxp-warps.ts`): these maps join at
  their borders, not through doors. `src/data/rmxp-connections.json` (111
  links from the PBS data, 222 directional) gives the touching sides plus an
  offset, and `arrival = departure + fromOffset - toOffset` on the shared
  axis. Every border tile that maps into the neighbour gets a touch event —
  **5934 trigger tiles**; the other 6565 border tiles have no neighbour
  opposite them (maps differ in length along a shared edge), which is normal.
  Arrivals land one tile INSIDE the destination and are `snapFree`d, or the
  player spawns on the border and bounces straight back.
- `src/modules/main/geometry.ts` — shared `isBlocked`/`snapFree` over BOTH
  manifests. `warps.ts` still has its own PSDK-only copy; merge them when it
  is next touched.
- **Travel menu** (escape -> Travel) is the temporary way in and out of the
  region — nothing links it to the PSDK island yet. A ship/route replaces it.
- Verified: server boots in 0.5s with 171 maps, serves `new-bark-town.tmx`
  and `goldenrod-city.tmx`, build green, 101 tests green. Rendered previews
  (New Bark Town, Mt. Mortar, Lake of Rage, Cherrygrove, Olivine + collision
  overlays) looked correct — autotile seams clean, walls blocked.
- ⚠️ This is literal Pokémon geography and Nintendo-derived tile art, and it
  is NOT reskinned. The unreskinned-art warning above applies to it.

### Reload-kills-input blocker — FOUND AND FIXED (session 3)

**Symptom**: "picking a character doesn't start you with it." **Real cause**,
proven with puppeteer: after a page RELOAD the whole client -> server channel
was dead. Arrow keys did nothing, chat did nothing, a manual
`engine.processAction` did nothing, and even a raw `socket.conn` emit
bypassing every client guard did nothing — server-side logging confirmed the
action never arrived. The player still RENDERED and received sync, which is
why it looked like a character bug.

**Root cause**: RPG-JS's `provideMmorpg` defaults to
`connectionIdScope: 'local'`, which stores a connection id in
`localStorage['rpgjs-user-id']` and REUSES IT on every load. Reconnecting with
an id the server has already seen produces a half-alive session: receive
works, send does not. Closing the socket cleanly on `pagehide` did NOT help.

**Fix**: `connectionIdScope: 'ephemeral'` — a fresh transport id per page
load, always. Verified: reload now keeps the character AND movement works
(784 -> 585), for both the anonymous and the wallet path.

**Consequence, important**: the connection id is no longer the identity. The
wallet id (the unforgeable HMAC from auth.mjs) now travels as a CLAIM — the
client sends `auth:wallet` after connecting and the server stores it in
`WALLET_ID`/`WALLET_ADDRESS`. Note that per-connectionId persistence was never
actually working anyway: with a stable id, a reload still came back as a fresh
"Trader" with nothing restored. **Cross-device wallet-keyed saves are
therefore still TO BUILD** — currently character and name are restored from
localStorage on the client and re-applied over the wire.

### Title screen rebuilt (session 3)

- `public/titles/background.svg` had PRESS START baked into the artwork as 16
  traced paths. They are DELETED from the SVG (backup was taken and removed
  after verification); a pixel panel in index.html sits exactly in the hole.
  The stage element carries `aspect-ratio: 1448/1086`, so the panel is
  positioned in PERCENTAGES of the artwork and stays glued to it at any size.
  **If you ever regenerate the SVG, the hole disappears and the panel will
  float over the old button — re-run the removal.** The hole is ~10.4% of the
  artwork tall, hence `#title-actions { min-height: 10.5% }`; without that the
  page background shows through beneath the buttons.
- Disconnected: CONNECT WALLET only. Connected: PLAY GAME, CHANGE YOUR
  CHARACTER, MY STOCKMONSTERS / NFTS, GAME SETTINGS, plus the address on a
  footer strip. The last two dispatch `sm:open` CustomEvents ('marketplace' /
  'settings') after entering the world — the in-game windows own those panels.
- Two bugs found and fixed: `.title-btn { display: block }` outranks the UA
  rule for `[hidden]`, so "hidden" buttons still rendered (now
  `.title-btn[hidden] { display: none }`); and the name modal opened OVER the
  title art (now waits for the curtain to be removed).

### In-game HUD + NFT marketplace UI, and hardened contracts (session 3)

**UI** — `src/hud.ts`, `src/marketplace.ts`, `src/ui-kit.ts` (shared pixel-window
vocabulary: palette, z-layers, ESC stack, drag, key guards, wei<->ETH).
HUD: top-left avatar tile (reads the player's chosen character sheet frame) +
name + XP + currency chips; top-right gear + banner slots; bottom action bar
(BAG/DEX/TEAM/MARKET/QUESTS/MAP, hotkeys 1-6) anchored clear of the chat corner.
Marketplace: draggable window, tabs All/Sealed/Opened/My Listings, filter
sidebar (18 types, rarity), search, card grid, purchase confirm, SELL flow,
session-transactions strip. **Sealed listings render a crate, never creature
art** — the seal is the product, so the UI must not leak it either.
Both hide/dim while a game dialog is open (they sit below `.rpg-ui-dialog`).
Verified inside the real game: HUD mounts, hotkey 4 opens the market,
movement still works, no console errors.

**Data seam**: `MarketSource { listItems, getItem, buy, list, cancel, myItems }`
with a `demoMarketSource()` built from dex.json. Swap in a chain-backed source
when the order book exists. ⚠️ `marketplace.ts` was written against an assumed
order shape (`maker/nonce/expiry`, `cancelNonce`); the CONTRACT that landed uses
`seller/salt/deadline/epoch`, `cancelOrder(order)` and `incrementEpoch()`.
`fillOrder(order, signature)` with `value: order.price` matches. Fix the field
names when wiring the real source.

**Contracts** — `StockmonstersNFT.sol` rewritten, `StockmonstersMarket.sol` new,
**81 forge tests passing**. Highlights:
- Real ERC-721 at last: both `safeTransferFrom` overloads + receiver check. The
  old contract advertised 0x80ac58cd without them, so every marketplace and
  bridge would have reverted against us.
- Two-step ownership, ERC-2981 royalties (capped), voucher now binds `fee` and
  `deadline` so `setClaimFee` can neither brick nor front-run a pending mint.
- Dual-state on-chain `tokenURI` (base64, no metadata server): a generic box
  document while sealed, full attributes once opened, stats computed on-chain
  from stored IVs using OUR psdk formulas. Needs `registerSpecies` batches —
  `tools/register-species.mjs` derives them from dex.json and refuses to run on
  a mismatch.
- **`optimizer = true` in foundry.toml is now REQUIRED** — unoptimised, the
  renderer puts the contract ~11 KB over the EIP-170 limit. A test guards it.
- Market: off-chain EIP-712 asks, on-chain settlement, no escrow (escrow would
  stop a seller opening their own sealed box). The crux is
  `require(opened(tokenId) == !order.requireSealed)` plus a pinned `attrCommit`,
  so a seller cannot open the box and still fill a sealed-price order.
- **The salt IS the seal**: the non-salt committed fields carry only ~2^40 joint
  entropy, grindable on a laptop. If anyone ever "simplifies" the salt to a
  counter or keccak(uid), every box becomes readable offline with no on-chain
  signal. Documented in NatSpec/README/DESIGN; `tools/voucher-lib.mjs` is the
  single signing path and uses 32 random bytes.
- JS<->Solidity cross-check tests: the production signer emits vectors that a
  forge test actually mints and opens with. A divergence there would have made
  every NFT minted in between permanently unopenable.
- Not built: bids/offers (need WETH or escrow), EIP-1271 contract wallets,
  auctions, bundles, the order-book service.

### Session-3 late additions (all committed, all verified running)

- **THE ENTRY-POINT TRAP, remember this**: `npm run dev` boots
  `src/standalone.ts`, NOT `src/client.ts`. UI wired into only one of them is
  invisible in the other. Shared mounting now lives in `src/game-ui.ts` and
  both entries call it. This cost a full round-trip with the user.
- **Escape was unreliable**: the engine samples input per frame and drops a
  short tap, so the in-game menu opened only if the key was HELD (~350ms).
  `game-ui.ts` now forwards Escape itself; the server's menu guard makes the
  double-fire harmless. Do not "simplify" that away.
- **Save & quit to title**: escape menu + HUD gear. The server flushes the
  profile and only then emits `game:quit`; a failed write keeps the player in
  the world and says so. Returning shows PROGRESS SAVED and skips the picker.
- **HUD action bar is wired**: BAG/DEX/TEAM open server dialogs, MAP opens the
  world map, MARKET the marketplace, QUESTS says it is unbuilt. Silence reads
  as broken, so nothing is silent.
- **World map browser** (`src/map-browser.ts`, `tools/render-map-thumbs.mjs`):
  171 rendered previews (0.89 MB), region filter (exchange 19 / kanto 53 /
  johto 74 / other 25 — `other` is the RMXP folder markers, not a guess),
  search, detail sheet with bordering maps, lazy-loaded thumbs.
  Thumbnails shrink each TILESET once with a per-tile box average and blit
  whole-pixel blocks; resizing a composited map instead bleeds neighbouring
  tiles into each other.
  `travel:to` takes ONLY a map id — the arrival tile is server-chosen and
  `snapFree`d, because a client coordinate would be a teleport into any room.
- Known noise: `TypeError: s.tilesets is not iterable` still logs during a
  transfer (the old beta.33 streaming complaint). The transfer completes and
  the destination renders and plays — verified. Worth chasing, not blocking.

### NFT supply and rarity — the decision and its consequence

- The 254-species data we ship (`src/data/dex.json`) was compared field by
  field against the collaborator's `last-commits/stockmonsters-nft/data/
  species.json`: ticker, name, types, base stats and catch rate MATCH on all
  254. Ours is a superset (contract address, dex text, sprite, height/weight)
  and is the single source for the game, the on-chain species registry
  (`tools/register-species.mjs`) and metadata.
- **Minting is deliberately uncapped** (user's call): `totalSupply` is a
  counter, not a limit; there is no per-species cap and no global cap.
- **A cap could not be enforced on-chain anyway.** The sealed box means the
  contract cannot see a token's dexId until `open()`, so "max N of this
  species" and "shiny is 1/4096" are unverifiable by the chain. Rarity is
  produced by the SERVER when it signs the voucher.
  **Operational consequence: the signing key IS the scarcity.** If it leaks,
  anyone can mint unlimited shinies and nothing on-chain will look wrong. Give
  it its own wallet, and put it behind a KMS/HSM before real value exists.

### Map connectivity — measured, and worse than it looked

Only the PBS EDGE links were wired. Measured on the 152 RMXP maps:
**7 reachable from New Bark Town, 75 with no connection of any kind.** Every
cave, gym, house and dungeon floor joins through an in-map RMXP transfer event
(command code 201) and those were never extracted — which is exactly why
stairs did nothing. Extraction + wiring is in progress; re-run the reachability
count after it lands rather than trusting the code to be complete.

### The world is one place now: 146/146 maps walkable (session 4)

`node stockmonsters-mmo/tools/check-connectivity.mjs` reports **1 component,
146 of 146 real maps reachable from `exterior` on foot, 0 unreachable**
(from 79 components / 7 reachable). 194 hand-authored links in
`src/data/rmxp-warps.json` (`manual`), generated by
`tools/join-regions.mjs` from a table of Gold/Silver adjacencies; every gate
tile is checked against the map's hitboxes before it is written, and a pair is
skipped rather than written one-way.

**The map pack ships ZERO events** — it is an art pack for mappers, so there is
no stair/door data to extract anywhere and there never will be. It also has no
interiors at all: no gym, house or centre maps exist, so every door sprite in
every town leads nowhere by construction.

Three traps that cost real time here, all worth remembering:
1. **The warp runner silently dropped any link whose destination was a PSDK
   map** (it checked the RMXP size table for existence), which is how the
   return ferry and the `route` link went missing while looking present in the
   data. Fixed with an explicit KNOWN_DESTINATIONS set over both manifests.
2. **An action event fires for the tile the player FACES**, not the one they
   stand on, so a warp on the spawn tile can never be triggered.
3. **The engine settles a spawn away from the coordinate you give it**: spawn
   y=2000 ends up at y=2020, i.e. tile row 63 rather than the row 62 the
   coordinate implies. A touch gate placed on the row the coordinate suggested
   was never crossed. When a touch warp "does not fire", print the player's RAW
   pixel position before suspecting anything else.

Verified in the running game: one step west of the spawn boards the ship and
lands in Olivine City.

### Battle animations (session 4)

`src/battle-fx.ts` + `src/battle-scene.ts` play a turn out instead of snapping
to the result: the attacker lunges, the target shakes and flashes, a damage
number rises, SUPER EFFECTIVE / CRITICAL banners appear, HP drains in steps and
turns amber then red, misses puff, statuses pulse in their own colour, stat
stages show arrows, faints drop and fade, and the scene wipes in and out.
`src/modules/main/battle.ts` emits three channels — `battle:state` (the
snapshot, and the SOURCE OF TRUTH for HP), `battle:turn` (the rules engine's
own event list, played beat by beat) and `battle:end`. A snapshot arriving
mid-burst is held and applied when the queue drains, so the scene can never
disagree with the server.

**How it is verified, and why that shape.** 87 browser frames prove the overlay
renders the payloads (scratchpad `battlefx-*.png`). Proving the SERVER produces
them needed a different tool: walking a headless player into a wandering
creature is unreliable — the six creatures on `exterior` sit at (49,6) (49,50)
(41,45) (50,28) (25,33) (49,14) and a naive walker gets stuck against the
buildings long before reaching one. So `src/modules/main/battle.spec.ts` drives
a REAL battle through a fake player and asserts the wire traffic: the scene
opens before the first line, the turn list is the engine's own events (not a
re-description), the last snapshot's HP is always in range, and a second battle
cannot start while one runs. `battle.ts` now imports `RpgPlayer` as a TYPE —
a value import drags canvasengine (and its need for `window`) into any test.

### Dev server needs every API route mounted twice — remember this

`npm run dev` is vite, which knows nothing about `server.mjs`. Any endpoint
added there MUST also be mounted in the `apiDevServer` plugin in
`vite.config.ts`, or the dev server answers it with index.html and the UI
blames the player: `/auth/*` produced "connection cancelled" and `/box/*`
produced "COULD NOT REACH THE DEPOT — 404". Both are mounted now (`handleAuth`,
`handleBoxRoutes`).

### Box shop demo mode

With no contract deployed the depot cannot sell, and a shop that only says
"offline" shows nothing. When `/box/quote` reports `sellable: false` the shop
switches to DEMO MODE: it rolls a box in the browser using the odds the server
just published, keeps it in `localStorage['sm-demo-boxes']`, and lets it be
opened with the real reveal animation. Nothing is signed, spent, or sent, and
the state is labelled everywhere it appears. The moment `BOX_SIGNER_PK` and
`BOX_NFT_ADDRESS` are set, `sellable` flips true and none of the demo path
runs. Band cutoffs in the demo roll mirror `BANDS` in `lootbox.mjs` — the
server stays authoritative; if those move, move both.

### Name rules (session 4)

3-16 characters, ASCII only, reserved words and link-like strings refused
(`src/modules/main/names.ts`), **globally unique**, **one per wallet**, and
**changeable once a day**.

- The 24h cooldown is decided by a CONDITIONAL UPDATE in `profiles.mjs`, not a
  read-then-write: two sockets for one wallet would otherwise both read "last
  changed yesterday" and both write. `db/migrations/0003_name_rules.sql` adds
  `name_changed_at` and widens the CHECK to 16.
- **Re-sending the same name is not a change.** Every reconnect re-sends the
  stored name; if that restarted the clock, a player who logs in daily could
  never change their name at all. The UPDATE only stamps `name_changed_at` when
  the name actually differs.
- Choosing one is genuinely mandatory: the modal opens by itself, cannot be
  dismissed, and keys are swallowed while it is up so the player cannot walk
  away and stay "Trader". A stored name is only a claim — if the server refuses
  it (taken since, or rule change) the modal reopens.
- A refused CHANGE is shown in chat, since the modal is closed by then and a
  silent refusal reads as a broken button. Changing later: the HUD gear.
- `test/names.test.mjs` (8 tests, real Postgres) covers uniqueness incl. casing,
  one-per-wallet, the cooldown, the same-name re-claim, the 16/17 boundary, and
  **two racing claims** — the case a happy-path test would miss.

⚠️ TESTING GOTCHA: a wallet id is `w:` + 32 **hex** characters. Seeding a test
with `'w:' + 'n'.repeat(32)` is silently refused by the server, the player runs
with NO wallet identity, and everything looks like it works while nothing
reaches Postgres. Several of my own test runs were wrong this way.

### Chat cooldown and delivery (session 4)

**One message every 5 seconds**, plus a 30s block on repeating the same line —
repetition is the cheapest spam there is and a plain rate limit does not catch
it. Both refusals say when the player may try again.

- **The limit is charged to the WALLET, not the connection.** The connection id
  is regenerated on every page load, so a connection-keyed limit hands a fresh
  budget to anyone who presses F5 — exactly what a spammer does.
- Chat is **global**, not per-map: with 171 maps a per-map channel is an empty
  room almost every time anyone types. `chat.ts` keeps its own roster of
  connected players.
- **Roster entries must be refreshed in `onJoinMap`, not only `onConnected`.**
  The engine hands each room a fresh RpgPlayer, and `emit` on a stale one
  silently returns (it needs a current map) — so broadcasts reached nobody
  while the system replies, which use the live object, worked fine. That
  asymmetry is what made it look like the rate limiter was eating everything.
- A player with no name cannot chat: otherwise everyone unnamed appears as
  "Trader" and impersonation is free.
- `src/modules/main/chat.spec.ts` — 9 tests incl. the reload-for-a-fresh-budget
  case and the repeat block.

Also fixed: `name:rejected` used to open the name modal even while the TITLE
SCREEN was up. The modal covers the viewport at a higher z-index, so it hid
PLAY GAME and the player could not get into the world to answer. It now waits
for the world like every other path.

### Returning players are not re-interrogated (session 4)

Three bugs made every login feel like a first one:
1. **The saved-character check only matched `ch-`**, but a character you BUILD
   is a list of `chl-…` layer ids. So a designed character was never recognised
   as saved and the picker reopened on every PLAY GAME. Both prefixes now count.
2. **The name modal opened whenever confirmation was slow.** A stored name is
   now simply re-sent; only an explicit `name:rejected` reopens the modal.
   Asking a returning player to name themselves every login is worse than
   briefly showing a stale name — and the modal swallows every key while up.
3. **GAME SETTINGS on the title screen only entered the world** — nothing
   listened for the `sm:open` detail 'settings'. `hud.ts` now exposes
   `openSettings()` and `game-ui.ts` routes to it.

Verified: second login goes straight into the world with the built character
intact and no prompts; GAME SETTINGS lands on the gear panel.

### Player-to-player DMs and gifting (session 4)

Walk next to someone, press the action key, talk. `src/modules/main/dm.ts`
(server) + `src/dm-ui.ts` (window), wired in `game-ui.ts`.

- **Nothing is stored.** No database, no log, no localStorage — the window says
  so in as many words. Messages exist while both players are standing there.
- **Proximity is server-side and re-checked on every send** (≤64px, same map):
  players are not events, so RPG-JS's own interaction cannot do this. Walk away
  mid-conversation and the next message is refused — otherwise "stand next to
  someone to talk" quietly becomes a second broadcast channel.
- **1 message / 2s charged to the wallet**, plus a 15s repeat guard. Chat's 5s
  is right for a broadcast; a DM reaches one person who has a one-click off
  switch, and 5s makes a real exchange unusable.
- **Blocking is symmetric**: it stops their messages AND the blocker's, removes
  both from each other's proximity offer, and refuses gifting. A block ends a
  conversation rather than making it one-way. In memory, per process, keyed by
  wallet so it survives the blocked player reloading.
- **Gifting: the server never moves value.** It returns the recipient's address
  and nothing else; the player's own wallet signs. ⚠️ That necessarily
  discloses an address to whoever is standing next to you — inherent to
  gifting, so it only happens once a gift is actually started, and both sides
  need a wallet, proximity and no block. NFT transfer uses
  `safeTransferFrom(address,address,uint256)` = `0x42842e0e`, verified against
  the compiled artifact (the 4-arg overload `0xb88d4fde` is NOT it).
- 34 tests in `src/modules/main/dm.spec.ts`; proven in two real browsers.

Known gaps: nothing watches the chain, so a recipient is not notified that a
gift arrived (the sender's window says to tell them); no HUD entry point for
opening a DM without walking up to someone.

### ⚠️ A STALE data/rooms.sqlite FREEZES PLAYERS (found the hard way)

Symptom: the player spawns and CANNOT MOVE — arrow keys, `processAction`, all
of it. `stopProcessingInput` is false, `canMove` is true, the socket is up, no
console errors. Everything looks healthy and nothing works.

Cause: `data/rooms.sqlite` is the ROOM's persistent storage. It survives
restarts and accumulates across every test run (mine had grown to 18 MB), and a
wedged entry leaves the player unable to move. **`rm -rf data/` fixes it
instantly.**

I lost a long stretch bisecting my own code for this — disabling every panel,
reverting the camera work, restoring event hitboxes, deleting warp entries —
before proving with a git worktree that the SAME commit moved fine from a clean
directory. If movement is dead and the code looks fine, delete `data/` FIRST.

### Two glitches the user reported, both fixed

1. **"Walking back from spawn teleports you somewhere random and stuck."** The
   ferry was a floor trigger one tile from the spawn, so stepping back boarded
   the ship by accident — and it landed in a pocket of Olivine with only TWO
   reachable tiles, hence "stuck". It is now an ACTION on the ship's hull at
   the WEST END of the pier (x=17, rows 63 AND 64 — the engine settles the
   player on either, and an action fires only for the tile actually faced), and
   it lands at (24,42) in Olivine's main 584-tile area.
2. **"After a map transition it shows the wrong place until you move."** The
   cover in `zoom.ts` lifted as soon as the map existed, but the engine re-arms
   camera follow a few frames later. It now holds the cover until the local
   player has a stable position, puts the camera on them explicitly, and only
   then reveals — and it stops touching the viewport afterwards so it never
   fights the engine's own follow.

### Friends, remote DMs and presence (session 5, 2026-08-26)

Built end to end and verified in two real browsers (`npm run test:e2e:friends`,
29 checks). Full write-up: `stockmonsters-mmo/docs/friends.md`.

- A friend request does NOTHING until the other side presses ACCEPT. That
  acceptance is the only thing that lets a DM travel: `dm.ts` still refuses any
  message between players more than 64px apart unless `areFriends()` says yes,
  and it asks per MESSAGE, so un-friending cuts the line immediately.
- Friendships are relational rows (`db/migrations/0004_friends.sql`), not part
  of the save blob — a friendship belongs to two players at once. ONE row per
  pair, enforced by storing the wallet ids in canonical order as the primary
  key; `(a,b)` and `(b,a)` as separate keys would let a double-accept leave a
  pair friends twice and un-friends once.
- Panel on the left edge, always-visible tab carrying the count of waiting
  requests. Not a modal: you can walk with it open.
- Without a database it degrades to a session-only store AND SAYS SO on screen.

### ⚠️ RPG-JS beta.33 NEVER CALLS `onDisconnected`

The player hook is documented and dead. The engine dispatches
`server-player-onConnected`, `-onJoinMap` and `-onLeaveMap` — nothing else.
Verified by instrumenting the hook and closing a real browser: it did not fire.

Everything hanging off it was dead code: the chat roster, the DM roster, and the
final profile save on exit (so `untrackPlayer` never ran and the background
sweeper held departed players forever). `player.ts` now detects leaving from
`onLeaveMap`, which ALSO fires on every map transfer — so it schedules the
goodbye and `onJoinMap` cancels it. A player who really left never arrives
anywhere; a player walking through a door does, within a fraction of a second.

Two more things this uncovered:

- **A navigated-away tab is not a closed session.** Chrome keeps the page and
  its websocket in the back/forward cache, so the server sees nothing until the
  tab or browser actually closes. Any test that "leaves" by going to
  `about:blank` is not testing a disconnect.
- **The room store resurrects ghosts.** It keeps every player it has ever seen,
  keyed by the ephemeral transport id, and nothing removes them — so a restart
  put the characters of old test sessions back on the dock. `server.mjs` now
  deletes `data/rooms.sqlite` on boot (`SM_KEEP_ROOMS=1` to keep it). This also
  makes the freeze in the section above impossible to hit again.

### The name was being dropped on a cold load

The user reported still being "Trader" with a name they had already chosen.
Cause: the client's stored name was claimed with a single `name:set` at mount,
and `processAction` is dropped SILENTLY while the player cannot act — which at
boot means "until the room is joined". The character had a retry loop for
exactly this reason; the name did not. It does now (`chat-ui.ts`), it stops on
the first acceptance or on a rejection, and if nothing is ever confirmed the
name modal opens rather than leaving the player nameless.

Also: the title screen greets a returning player — `WELCOME, <name> · 0xf39f…`
— and the HUD avatar now draws the player's ACTUAL character, all layers
stacked in draw order. It was blank before: the id-to-file mapping was string
surgery that only worked for ready-made presets, so a built character
(`chl-body-01`) and the two engine defaults both resolved to a 404.

### Title art is the game's own PNG again

`public/titles/title.png` (the 320x240 PSDK title, scaled with pixelated
rendering) replaces the traced SVG. Same 4:3, so every button percentage still
lands where it was measured, and the opaque button panel covers the PRESS START
plate baked into the art.

### The token economy is LIVE ON SEPOLIA (session 5, 2026-08-26)

Full write-up: `stockmonsters-mmo/docs/token-economy.md`. Addresses are in
`stockmonsters-mmo/deployments/sepolia.json` and `.env`. NOT verified on
Etherscan — the user asked for the deploy without it.

Five contracts: the token (SMON, 1B fixed, no mint function), the rewards pool
players are paid from, the treasury that splits revenue, plus the existing NFT
and marketplace extended to accept an ERC-20.

- **Tax 2% buy / 2% sell, and 0% wallet-to-wallet.** 75% of it goes to players,
  25% to the treasury, and the players' share cannot be set below half. Tax
  only fires when one side is a registered AMM pair — anything the game itself
  does moves exact amounts, and a token that delivers less than it was told to
  would break escrow arithmetic everywhere.
- **Revenue splits 50/50**: half back into the game (ETH is reserved for a
  buyback whose output goes straight to the rewards pool; tokens go there
  directly), half to ops. `route()` is permissionless.
- **The game never mints.** Every reward is a claim on a pool that already
  exists. `docs/token-economy.md` says why, and what to do instead if a faucet
  is ever wanted.

Proven on the real chain by `npm run test:e2e:token`, which injects a real
EIP-1193 wallet into a headless browser: a reward claim paid the player on
chain, and a loot box was bought with SMON (approve + mint), with the fee
landing in the treasury.

### Duels and gyms are on Sepolia too (session 5, later)

```
arena  0x4B4b255E47B7dFaE8B99fd5E7C60089A5E81a6e2
gyms   0x8d697Bf3c383fC90204E9279413Fd3849794B7f1
```

Walk up to someone, bet tokens, fight for them. **Blind picks**: each side's
creature is hashed with a random salt and both hashes go into the wager both
players sign, so neither can see the other's and neither can substitute a
counter afterwards — the reveal is checked against the commitment on chain.

The fight is AUTO-RESOLVED from a seed committed before either player picked
(`src/battle/duel.ts`). That is deliberate: a turn-by-turn wagered fight means
somebody disconnects the moment they are losing, and the seed reveal lets
anyone replay the duel and check the server.

Only OPENED Stockmonsters may fight — a sealed box's contents are the product,
and a replay would give them away.

Proven on Sepolia: `npm run test:e2e:duel` runs a real 1,000,000 SMON duel
between two fresh wallets. Escrow held 2M, winner took 1.94M, 60k of rake
landed in the treasury.

Gyms: stake to hold one, 5% entry fee to challenge, 70/30 fee split when the
challenger loses, and on a win the gym changes hands with a 20% takeover bounty
out of the old holder's stake. No emissions anywhere — every payout is an entry
fee somebody chose to pay.

### NFT metadata is ON CHAIN; the images are not (and are broken)

Checked against the deployed contract rather than assumed:

- `tokenURI` returns `data:application/json;base64,…` built by the contract.
  **There is nothing to pin and nothing that can rot.** Strictly better than
  IPFS for the JSON, and already live.
- That JSON points at `imageBaseURI + <TICKER> + "/regular.png"`, and
  imageBaseURI is `https://stockmonsters.game/dex/` — **a domain that does not
  exist**. Every minted token currently shows a broken image in a wallet.

`node tools/ipfs.mjs pack` builds exactly the layout the contract expects from
`public/dex/` — 254 species × (regular + shiny) + a sealed-box image, 509 files
and 4.8 MB. Shinies are generated (a hue rotation), because the art set has one
image per species.

Uploading is NOT wired up: pinning is account-bound and paid, so the tool says
which key is missing and stops rather than half-doing it. Once pinned:
`node tools/ipfs.mjs set --cid <cid>` points the contract at `ipfs://<cid>/`
and every token already minted picks it up immediately — there is no cached
JSON to invalidate.

### Mobile: it plays on a phone (session 5, later)

`src/touch-controls.ts` — a d-pad and A/B buttons, plus every phone layout
override in one stylesheet. Verified on an emulated iPhone 14 (390x844): the
character walks, nothing overlaps, the action bar fits.

**⚠️ SYNTHETIC KEYBOARD EVENTS DO NOT MOVE THE CHARACTER.** I tried; it moved
zero pixels. The engine binds its controls to the canvas directive, not to
window. The working path is the engine's own API — and `inject(ctx,
KeyboardControls)` returns NULL, because RPG-JS stores the instance on its own
context when the player's sprite mounts:

```js
engine.context.values['inject:KeyboardControls'].values.get('__default__')
```

Control names, read off the live instance: `down up left right space shift
escape`. There is no `action` — it is `space`. `window.__controls` is a debug
handle for exactly this kind of digging.

Our own UI (chat's Enter, the DM window's Space, the escape stack) DOES answer
synthetic events, so the touch buttons fire both.

**⚠️ Inject the mobile stylesheet LAST.** Every panel injects its own CSS when
it mounts, and equal-specificity rules go to whichever came later in the
document. Injected first, the phone layout matched and did nothing — the HUD
silently overruled all of it.

What a phone still cannot do: connect a wallet from a normal mobile browser.
`window.ethereum` only exists inside a wallet's in-app browser, so the title
screen now says to open the page there rather than leaving a dead button.
WalletConnect is the real fix and is not built.

### Sound, and the IP problem that comes with it

`public/audio/` holds twelve effects lifted from the same fan pack as the maps
(`new-assets/The Pokémon World Project - Kanto/Audio`). Wired in `src/sfx.ts`:
hits by effectiveness, faints, ball shakes, UI clicks, and win/lose fanfares on
a duel. It obeys the HUD's SOUND EFFECTS toggle live, stays silent until the
first click (browsers refuse audio before a gesture), and swallows every
failure — a missing file must never throw.

**Same problem as the tilesets: this is Nintendo-derived audio.** Fine for a
testnet, has to be replaced before anything is public.

### ⚠️ Reward farming was open, now capped

Nothing rate-limits wild battles, so a scripted client could win one every few
seconds and grind `battleWin` for an income. The on-chain per-epoch budget
bounds the POOL but not one bot's share of it.

`earnings.ts` now caps ONE WALLET at 1,000 tokens per epoch, credits the part
that fits rather than refusing a whole reward, and tells the player when they
have hit it. That is a mitigation, not a fix — the real answer is rewarding
things a bot cannot fake, which is what gyms and duels do (and why neither pays
out of the reward pool).

### ⚠️ The contracts are fork-tested against real Uniswap

`forge test --fork-url https://ethereum-rpc.publicnode.com --match-path
StockmonstersFork.t.sol` — 8 tests against the actual V2 router on a mainnet
fork. It corrected an assumption I had backwards:

- a PLAIN buy through `swapExactETHForTokens` **works**; the buyer simply
  receives 2% less than quoted, because the tax is taken after the pool is
  already square;
- a PLAIN sell **reverts** — the router tells the pair to expect the full
  amount, less arrives, and K refuses it. Any UI, bot or aggregator selling
  this token MUST use the `SupportingFeeOnTransferTokens` entry points.

The suite skips itself (`vm.skip`) when run without `--fork-url`, so
`forge test` stays green offline.

### ⚠️ Foundry's expectRevert eats the wrong call

`vm.expectRevert` arms against the NEXT external call — and `hashResult(...)`,
`vm.sign(...)` or a view getter in the same expression IS that call. Seven PvP
tests "did not revert as expected" until every argument was computed into a
local first. If a revert test fails for no reason, look for a call in the args.

### ⚠️ Three traps this uncovered

1. **The NFT went 334 bytes OVER the EIP-170 limit** once the ERC-20 mint path
   was added — undeployable, and the legacy compiler pipeline could not fix it.
   `via_ir = true` compiles the same source to 21,787 bytes with ~2.7 KB of
   headroom. It costs ~45s of build time. Check `forge build --sizes` after
   touching the NFT.
2. **Rewards were earned before the wallet was known.** A player joins a map
   several hundred ms before `auth:wallet` arrives, so crediting straight to
   the ledger dropped the reward AND marked the map visited — unearnable
   forever after. They are parked and flushed AFTER hydrate resolves; flushing
   alongside it lets the profile load overwrite the credit.
3. **The spawn map can never pay.** `visitedMaps()` always includes HOME_MAP,
   by design. Any test that expects a fresh player to earn a
   first-visit reward on spawn is testing a thing that cannot happen.

### Before mainnet

Register the AMM pair (`setPair`) once liquidity exists — until then nothing is
taxed. Set the buyback router. Move the three keys (deployer, box signer, claim
signer) off the game server's disk; they are three keys precisely so they can
live in three places. Pick a real ops wallet — it is the deployer today.

### WHERE THIS STANDS — session 8 (2026-08-31)

**IT IS LIVE** at https://test.lordfishnu.com, and the economy underneath it is
a NEW set of seven addresses: every contract is a UUPS implementation behind an
ERC-1967 proxy now (`deployments/sepolia.json`; the old immutable set is kept
there under `previousDeployment`). Nothing carried over — old SMON balances,
minted creatures and open orders belong to contracts the game no longer talks
to.

#### The one bug that explained four complaints

**RpgPlayer VARIABLES DO NOT SURVIVE A MAP CHANGE.** The engine builds a fresh
player for every room and everything `setVariable` put on the old one is gone —
proven by logging WALLET_ID, NAME and even SPAWNED across a single door, all
three absent on the far side, on a player whose transport id had not changed.

Everything this game knew about a player was a variable, so walking through one
door reset the session: the wallet (a duel answered "they have no wallet
connected" for somebody plainly logged in), the name (the client asks again
when nothing is ever confirmed), the party, box, bag, visited list, ledger and
XP — and every save, because the sweeper writes whichever object was registered
at login and that object stops changing the moment its room is left. Production
had taken 242 profile loads and written ONE row.

So identity lives in a module map keyed by the transport player id (which IS
stable across a transfer), the state each room object is rebuilt from lives
beside it, and `onConnected` — which fires once per session and NOT on a
transfer — clears both, so a recycled id cannot inherit a session.

#### Traps this session added to the list

- **Restoring state into a fresh object CRASHED THE SERVER.** `getVariable`
  returns the engine's reactive wrapper, the wrapper holds a sync callback, and
  handing one back to `setVariable` makes the engine `structuredClone` a
  function on its next broadcast. Everything crossing that boundary is a plain
  copy now — which is also why a saved bag in production read `{"$path": …}`.
- **The engine's position sync does not reach a client that has just changed
  room.** Measured: server had the player at (912,1520) inside the hub, client
  still read (992,1030) outside it, and nothing corrected it until the first
  keypress — the "it throws me somewhere else when I move" report. A
  server-side teleport to the same tile changes no synced value and a
  one-pixel nudge changed nothing either; the fix is a plain `map:arrival`
  event the client writes into its own signals.
- **AN EVENT IS SOLID BY DEFAULT.** Trigger events placed on the pavement in
  front of every door turned into a wall. `through = true` makes an event a
  trigger.
- **THE CONTROL NAME IS NOT THE KEY NAME.** `boundKeys` is keyed by the key
  (space, shift, escape), `_controlsOptions` by the control (action, dash,
  back). `applyControl` wants the second. The phone's A button sent 'space',
  which does nothing — so talking to anybody on a phone had never worked. An
  earlier note in this file said there was no `action` control; it was wrong.
- **ui-kit's `el()` sets every attribute with `setAttribute`**, so an `onclick`
  FUNCTION is stringified and the button silently does nothing.
- **A deploy can succeed completely and still record nothing.** Two of the
  deploy script's params are BigInts and `JSON.stringify` throws on those:
  seven contracts live, wired and funded, and not one address written down.
  They were recovered by walking the deployer's nonces.

#### What changed, in one list

- All seven contracts behind proxies, live on Sepolia, 254 species registered,
  and `test:e2e:sepolia` driving voucher → mint → reveal → open against them.
  The upgrade path is armed and owner-gated on all seven (verified on chain).
- Where you were standing is part of the profile: close the tab, come back,
  and you are where you left off. `test:e2e:return` is the regression test.
- Quests are priced in DOLLARS ($1–2 each, $7 board) and boxes are anchored to
  their ether price, both derived from `SM_TOKEN_USD` — written as a market cap
  over the fixed billion supply ($200k → $0.0002). A box had two prices that
  disagreed by 24x; it has one now.
- Doorways accept an approach from the tile in front while you face them.
- Draw order: the player is drawn behind roofs, canopies and doorway arches.
- Kelby's opening is a conversation again — it asks how you play, hands you to
  the character designer, and reads your name back before it sticks.
- One NPC conversation at a time. The same key advances a dialog AND talks to
  the NPC, so every press restarted the conversation and it could never end.
- The landing page describes THIS game (gameplay + play-to-earn + @stonksters).

#### Still open, and the honest state of each

- **The stutter.** Frames freeze for up to 1.6s (3.2s worst) in a single block
  while a map loads, and ~200ms periodically while walking. That is what is
  left of the "black screen": the curtain's own bugs are fixed and it now
  bounds at 2s, but no timer can run during a 3s freeze. Going further means
  making the load cheaper — the atlases are already compacted, so what is left
  is parse and texture upload.
- **The token is upgradeable**, so "fixed supply, no mint function" is now a
  promise by the owner key rather than a property of the code. Timelock it (or
  renounce) before mainnet. `freezeSpecies()` is still deliberately uncalled.
- **The NFT has 1,199 bytes of EIP-170 headroom left**, down from ~2.7 KB.
- The art is still Nintendo's; three signing keys are still on the box.

#### A mistake of mine worth not repeating

I read a failing live test as state leaking between wallets — a fresh sign-in
landing on another player's tile, their row written at my timestamp — and said
so before checking. `e2e-live` signs with the DEPLOYER key out of
contracts/.env, not a fresh one: it logs in as the same wallet the game is
played with and correctly resumed that wallet's saved position. Before calling
something a data leak, check what identity the test is actually using.

### WHERE THIS STOOD — session 7 (2026-08-28)

**IT IS DEPLOYED.** https://test.lordfishnu.com — Ubuntu 24.04 at
66.179.31.212, one Node process behind Caddy, Postgres and Redis in Docker.
The old WebRTC streaming stack that lived on that box was removed (its
uncommitted local changes and its .env are backed up in
/root/backup-streaming/, and Caddy's certificate volume was deliberately kept).

#### What session 7 changed, and what it cost to find

**The duel never once opened its escrow through the UI.** Three bugs stacked:
the opponent was never asked to approve (open() pulls BOTH stakes, so it
reverted on their allowance every time); `duel:open` never carried
playerA/playerB, so the client's encoder threw on `word(undefined)`; and the
wager's expiry was computed twice, from `Date.now()` at signing and
`createdAt` at opening, so the digests diverged and the contract answered
BAD_SIGNATURE_A. All three only surfaced by driving the whole thing through
two real browsers — `npm run test:e2e:duel-ui`, which now proves the pot moves
on chain. The server re-drives the opening every 8s while it waits, because an
emit to a stale player object is silently lost.

**The white screen on iOS was memory.** The spawn map pulled in seven shared
tileset atlases totalling 228 MB of decoded texture (TECH-Buildings.png alone
is 4096x6144 = 96 MB from a 1.3 MB file), and two of them exceeded the 4096
limit many iOS devices enforce. `tools/compact-atlases.mjs` packs, per map, an
atlas of only the tiles that map draws: 228 MB -> 4.3 MB for the spawn, 265 ->
5.3 for the worst map. **`src/tiled/compact/` MUST stay committed** — sync.sh
ships `git archive HEAD`, so untracked output means production silently serves
the 228 MB version.

**Touch walking died after ~1.4s** because the engine wipes its held-key state
while the player moves and re-registers the controls every ~7s. A keyboard
never notices (the OS auto-repeats); a thumb has none. The stick now
re-applies the press four times a second.

**Still open, upstream:** the character element rebuild behind that ~7s
re-registration costs a 170-250ms frame while walking — the visible stutter.
Not reachable from application code. Also `s.tilesets is not iterable`, thrown
once per map transition from inside @rpgjs/tiledmap.

**Measured, not a bug:** the game loop is time-stepped, so a 144Hz monitor
does NOT run it faster (60Hz vs 144Hz walk speed: x1.01). A machine that runs
it slowly is what makes someone else's look fast.

#### Two mistakes of mine worth not repeating

Both were *fixes* that broke something else, and both were found by checking
what the server actually returns rather than trusting a green browser test:

1. Marking `/map/*` `immutable` in the Caddyfile. Those names are not
   fingerprinted, so a repack would serve stale art forever and a reload would
   not clear it. Only `/assets/*` may be immutable.
2. Gating the SPA fallback on `Accept: text/html`. True of browsers, false of
   everything else — `curl /` returned 404 on the front page. Whether a
   request is for an asset is a property of the URL (does it end in an
   extension), not of who is asking.

And the build does not clean `dist/client/map`, so switching map sources
leaves both sets behind and the served maps reference atlases that are no
longer written — a black world with a 200 for every missing file. `sync.sh`
now clears it first.

#### New since session 6

- **Kelby's introduction** (`src/intro.ts`), the original PSDK opening script
  adapted, with the name asked as its last beat. Replaced a modal that
  appeared out of nowhere and said nothing about the game.
- **Daily quests** (`src/modules/main/quests.ts`), gated on owning an OPENED
  Stockmonster, verified on chain — and one NFT unlocks the board for one
  wallet per epoch, so a token passed between wallets cannot farm with fresh
  accounts. Payouts go through `credit()`, so they live under the same daily
  cap and per-epoch on-chain budget.
- **Trainer XP** (`src/modules/main/trainer.ts`) — the HUD's LV 12 was invented.
- **SMON gifting** — SEND TOKEN only ever sent ether.
- **A second computer no longer asks for a name the wallet already owns.** The
  name lives in Postgres; localStorage is a cache. The client now waits for
  the server before deciding somebody is new.

#### The next piece of work, named precisely

Map behaviour. PSDK encodes stairs, escalators and doorway draw-order in
`systemtags`/`terrain_tag` layers and `Z=0..4`; our importer drops them. That
is why stairs have no slowdown, the escalator misbehaves, and the player
appears to walk over the first doorway instead of behind it. The warp
TRIGGERS are already on the correct tiles (edge events on row 0 / h-1,
doorways on their own tile, 1-tile hitboxes) — if transitions still fire
early, measure the player's collision box before changing anything, because it
affects all 171 maps.

Deploy tooling is `stockmonsters-mmo/deploy/` — bootstrap.sh, sync.sh, a
Caddyfile and a systemd unit. To ship a new commit:

    cd stockmonsters-mmo && ./deploy/sync.sh root@66.179.31.212

Verify it with `npm run test:e2e:live`, which drives the real site in a real
browser. THE WEBSOCKET IS WHAT MATTERS: a misconfigured proxy serves the title
screen, the API and every asset perfectly and then silently fails the upgrade,
so the site looks completely fine and the world never loads. A 200 proves
nothing; a player object standing on a map does.

The game is playable end to end, on desktop and on a phone, against a live
economy on Sepolia.

**Works, and was driven in a real browser to prove it:** one walkable world of
171 maps · wallet login with server-verified signatures · Postgres profiles ·
character designer · names (unique, 16 chars, one change a day) · global chat ·
proximity DMs, blocking and gifting · friends with remote DMs and presence ·
fast travel gated on having walked there · wild battles with animation and
sound · sealed loot boxes (provably fair, buyable in ETH **or** SMON, minted
and opened with real transactions) · reward claims paid on chain · blind-pick
duels for real tokens.

**The wallet is now forced onto the right chain.** `public/chain-guard.js`
switches it at connect — before the FIRST signature — and again before every
send: mint, open, wager, settle, claim, and both DM gifts. Every signature this
game makes is bound to a chain id, so a wallet parked on mainnet used to sign a
valid-looking message and broadcast to an address that belongs to someone else.
It is a classic script in `public/` because the title screen is inline ES5 and
the game UI is bundled TypeScript; `src/chain-guard.ts` is a typed shim over the
same global. Two callers, one implementation — do not fork it.

**Live on Sepolia** (addresses in `stockmonsters-mmo/deployments/sepolia.json`,
full write-up in `stockmonsters-mmo/docs/token-economy.md`): token, rewards
pool, treasury, NFT, marketplace, gyms, arena. NOT verified on Etherscan — the
user asked for the deploy without it.

The NFT's 254-species registry is loaded (7 batches). It was EMPTY until
session 6, which meant every reveal would have reverted. `freezeSpecies()` is
still uncalled, deliberately — call it when the roster is final, and after that
nobody can rewrite the species behind a token that is already sold.

**Tests:** `npx vitest run` 229 · `cd contracts && forge test` 156 (+8 more with
`--fork-url` against real Uniswap) · six end-to-end runs that drive real
browsers and real transactions: `test:e2e:persistence`, `test:e2e:friends`,
`test:e2e:token`, `test:e2e:duel`, `test:e2e:sepolia` (voucher → mint → the
server learns the token id off chain → reveal → `open()` → the token reads as a
named creature with its IPFS art loading), `test:e2e:chain` (three wallets: one
on mainnet that switches, one that answers 4902 and must be offered the chain,
one whose owner refuses — and it asserts the ORDER, because a signature made on
the wrong chain is bound to the wrong chain id and nothing downstream can tell).

Every one of these must stay runnable. `test:e2e:token` now generates and funds
a FRESH wallet per run: the rewards contract allows one claim per player per
epoch, so reusing the deploy key made the test go red on its second run of the
day for doing exactly the right thing.

#### The three things blocking a public launch

1. **The art is still Nintendo's.** Creature sprites are reskinned to tickers
   (254 dex + 254 overworld), but the MAPS are Kanto/Johto, the tilesets are
   PSDK's, the SOUND is a fan rip, and species internals still carry names like
   `bulbasaur`. Testable privately; not publishable.
2. **Three keys sit on the game server's disk** (box signer, reward signer,
   battle signer) and the ops wallet is the deployer. Fine for a testnet.

(The old third blocker, NFT images 404ing, is FIXED. The art is pinned on
Pinata and `imageBaseURI` points at `ipfs://bafybeickaanjlxwbmcxaccjylsedi7ome
xniy56euyuio2agmffw5w3zrm/`. `PINATA_JWT` and the optional `PINATA_GATEWAY`
live in `stockmonsters-mmo/.env`. A gateway is NOT required for anything to
work — what goes on chain is `ipfs://`, which wallets resolve themselves — it
is only used to prove the art is retrievable before pointing a contract at it,
which `ipfs.mjs set` now refuses to do otherwise.)

#### What the user asked for that is NOT built

- **WalletConnect.** A normal mobile browser cannot connect a wallet;
  `window.ethereum` only exists inside a wallet's in-app browser. The title
  screen says so rather than showing a dead button.
- ~~A real marketplace back end~~ — BUILT. `market.mjs` indexes signed orders
  and holds no custody. Two known gaps, documented in the code: a token bought
  on the market does not appear in its new owner's MY LISTINGS (`/box/mine` is
  keyed to the wallet that bought the box, and the NFT has no
  `tokenOfOwnerByIndex`), and the sell form only prices in ETH though the SMON
  path is proven end to end.
- ~~Trainer XP~~ — BUILT. `src/modules/main/trainer.ts`. Deliberately not part
  of the reward ledger: XP is not money, buys nothing and has no on-chain form,
  which is why it can be generous where earnings.ts must be stingy. Keeping
  them together would eventually cap the wrong one.
- **Gyms. Not built at all** — an earlier version of this file wrongly listed
  them as working. `StockmonstersGyms` is deployed, configured and funded, and
  NOT ONE LINE OF CODE CALLS IT: no ABI, no server module, no UI, no gym
  anywhere in the world. `SM_GYMS_ADDRESS` is read in `token.mjs` and exposed
  at `/token` and that is the entire integration. The contract is the good half
  (players stake to hold a gym, challengers pay an entry fee to fight for it,
  every payout comes out of that fee so the loop is solvent by construction).
- **In-game minigames, NFT staking, play-to-earn beyond duels.**
- **A domain of its own.** It is on `test.lordfishnu.com` because that already
  pointed at the box and had a certificate. One line in `.env` (`SM_DOMAIN`)
  plus a `bootstrap.sh` re-run moves it.
- **npm ci does not work on the box.** This repo is developed with pnpm and its
  `package-lock.json` is a stale side-artifact, so ci refuses on peers it never
  recorded (`@pixi/react` needs `react`, which npm auto-installs and the lock
  does not list). bootstrap falls back to `npm install` and says so. Committing
  a lock npm itself generated would fix it properly.

#### If you change one thing, know this first

- `npm run dev` boots `src/standalone.ts`, NOT `src/client.ts`. Shared UI lives
  in `src/game-ui.ts` so both get it. Vite knows nothing about `server.mjs`:
  every API route must be mounted in `vite.config.ts` too.
- **Bare `vite` does not put `.env` into `process.env`** — it loads it for
  `import.meta.env` in the client only. Production runs with
  `--env-file-if-exists=.env`, so for a long time dev quietly ran an
  unconfigured world: no token, no chain, boxes stuck in DEMO MODE on chain
  31337, and `/token/chain` answering `chainId: 0` so no wallet could connect.
  Nothing errored, because every store is built to degrade politely when
  unconfigured. `vite.config.ts` now loads it explicitly before building any
  store. If dev ever looks like the economy vanished, check this first.
- The mobile stylesheet must be injected LAST (`mountMobileLayout()` at the end
  of `mountGameUi`), or every panel's own CSS silently overrules it.
- `forge build` needs `via_ir`; without it the NFT is 334 bytes over EIP-170.
- **`npm run build` is NOT the production build.** It builds the standalone
  game into `dist/`, wiping `dist/client` — which is what `server.mjs` serves.
  Production is `npm run build:mmo` (`RPG_TYPE=mmorpg vite build`). Every
  puppeteer test serves `dist/client`, so a stale build silently tests old
  code: two "bugs" in session 6 were nothing but that.
- `BOX_RPC_URL` and `BOX_FROM_BLOCK` are load-bearing. Without the first,
  `lootbox.mjs` builds no chain client, the mint indexer never runs, and no box
  ever learns its token id — which breaks opening a box AND empties the duel
  fighter list, neither of which looks like a missing env var. Without the
  second, every sync asks a public RPC for the whole chain and is refused.
- Delete `data/` if a player cannot move. It is disposable; `server.mjs` now
  clears it on boot.

### Direction notes

- Roadmap (user): mechanics -> backend (wallet SIWE login; progress stored
  server-side keyed by wallet) -> **in-game NFT mint: catching a
  stockmonster mints it to the player's wallet**. NFTs should also be usable
  in-game. Server stays authoritative over mint decisions. Agreed NFT shape:
  catch goes to an in-game box first, the player mints on demand; metadata
  carries IVs/nature/shiny so each NFT is a unique individual; owning the
  NFT is what makes the creature usable in a team.
- Later ideas (user, 2026-08-25): author new maps to fit more players
  (Tiled -> importer already supports this; the unbuilt maps 22-26 are the
  natural start) and a global chat (websocket broadcast + small GUI; tie
  names to wallets once SIWE lands).

## The streaming fallback (context only — not the focus)

`web/` holds a working WebRTC streaming stack that runs the **real PSDK game**
natively in a container and streams it to browsers. It is live at
**https://test.lordfishnu.com/** on a $52/mo BitLaunch box (`66.179.31.212`,
Ubuntu 24.04, x86_64, 2 cores; SSH key auth as root; deploy dir
`/opt/stockmonsters`). Player password `stonks`; the admin password is in
`/opt/stockmonsters/web/.env` and must stay out of shared links.

Deploy: `git archive --format=tar HEAD web | ssh root@66.179.31.212 "tar -x -C /opt/stockmonsters"`
then `docker compose -f web/docker-compose.yml --profile tls up -d --build` on
the box. `web/README.md` documents the whole thing, including the PSDK-on-Linux
gotchas (non-relocatable Ruby prefix, missing `libyaml`/`libsodium`, the mouse
cursor, the key bindings) and `web/scripts/` has the touch-control test and a
capacity measurement script.

Keep it as the bridge while the MMO is built; retire it when the MMO ships.
