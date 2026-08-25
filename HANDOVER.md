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

### Requested, not yet built (user, 2026-08-25 evening)

- **In-game minigames** once the maps are done — small playable activities
  inside the world.
- **NFT staking area**: a physical location on a map the player walks to and
  stakes their minted Stockmonsters.
- **Play-to-earn features** built around the above.
  (Sequencing per user: maps first, then these.)

### Next steps (in order, user-confirmed)

1. Deploy to the BitLaunch box with the lord-fishu pattern (bootstrap/sync/Caddy).
2. Wallet login (SIWE) — identity + persistent saves keyed by wallet.
3. `contracts/` folder: the NFT mint contract (after server work).
4. Map expansion via the tile-design skill + tiled MCP (maps 22-26 first).

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
