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
