# Stockmonsters — handover

Written 2026-08-25. Everything below was verified by running it, not assumed.
Where something is unverified or uncertain, it says so.

---

## What this project is

`Stockmonsters/` is a **PSDK / Pokémon Studio** game — a reskinned Pokémon
fangame where 194 US stock tickers became collectible monsters, each tied to an
EVM contract address. It is a crypto/meme project, so the deliverable is a
shareable link that works on a phone.

Three workstreams are running:

| | What | State |
|---|---|---|
| **1. Live game** | The real PSDK game streamed to browsers over WebRTC | **Live and working** |
| **2. Landing page** | Next.js marketing site, all 194 stocks | Built; one build fix in progress |
| **3. MMO** | Rebuild on RPG-JS so players share a map | Early; one blocker |

---

## 1. Live game — WORKING

**https://test.lordfishnu.com/** — open it, it goes straight into the game.

### Why streaming at all

PSDK has **no HTML5/WASM export**. The game cannot be compiled to run in a
browser. But PSDK ships **native Linux binaries** (`ruby-dist/bin/ruby` +
`LiteRGSS.so`, SFML-based), so the real game runs natively in a container and
only its *video* reaches the browser, over WebRTC via
[neko](https://github.com/m1k1o/neko). No Wine, no emulator.

The consequence people find surprising: **the browser downloads no game assets
at all.** The 330 MB of graphics and audio stay on the server. The phone plays a
video stream and sends back keypresses. That also means one game instance = one
shared world — see "the MMO question" below.

### Server

| | |
|---|---|
| Host | BitLaunch, `66.179.31.212`, Amsterdam |
| Spec | Ubuntu 24.04.4, x86_64, **2 cores, 3.8 GB RAM**, 94 GB free |
| Plan | $52/mo ($0.078/hr — billed hourly, resize freely) |
| Access | SSH key auth as `root` (the Mac's `~/.ssh/id_ed25519`) |
| Deploy dir | `/opt/stockmonsters` |

**x86_64 is mandatory** — PSDK ships no ARM Linux binaries.

### Credentials

- Player password: `stonks` (not a secret — it *is* the share link)
- Admin password: `28e16a6612bf2b5c0392b742` — **keep out of shared links**;
  it can take control and kick players. Lives in `/opt/stockmonsters/web/.env`.

### Deploying a change

```bash
# from the repo root, after committing
git archive --format=tar HEAD web | ssh root@66.179.31.212 "tar -x -C /opt/stockmonsters"
ssh root@66.179.31.212 'cd /opt/stockmonsters && \
  docker compose -f web/docker-compose.yml --profile tls up -d --build'
```

`web/deploy/bootstrap.sh` brings up a *fresh* box (docker, ufw, clone, .env).
`web/deploy/sync.sh root@host` does the ship-and-rebuild above.

The repo is **public**, so a new server can `git clone` the 330 MB of game
assets from GitHub itself — far faster than uploading them. Only `web/` (0.1 MB)
needs to travel over SSH.

### Verified working

Game boots in **0.6 s** on real hardware, zero errors. Rendering via llvmpipe
(software GL, no GPU). Audio: OpenAL → PulseAudio → captured by neko. 960×720
(the game is natively 320×240, upscaled exactly 3× so pixels stay crisp).
HTTPS via Caddy with a real Let's Encrypt cert. Bare domain auto-logs-in and
neko strips the credentials from the address bar.

### Hard-won gotchas (all encoded in `web/game/Dockerfile`)

1. **PSDK's Ruby is not relocatable.** Built with RVM, it has
   `/home/palbolsky/.rvm/rubies/ruby-3.3.0` compiled in as its prefix. Without a
   symlink at that exact path it dies with `uninitialized constant
   Encoding::UTF_8`. The Dockerfile *detects* the prefix at build time and
   symlinks it, so it survives PSDK repackaging.
2. **Missing native libs:** `libyaml-0-2`, `libsodium23`. PSDK's bundled
   `psych.so` dlopens them; without them the game aborts during extension load.
3. **`libvpx.so.7`** is wanted by PSDK's bundled ffmpeg libs; Debian 13 has 9.
   Only SFEMovie video playback needs it and this game has none
   (`introMovieMapId` is a *map*, not a video). Add real cutscenes and this
   becomes a problem.
4. **No `USER neko` in the Dockerfile.** neko's supervisord must start as root
   and drops privileges itself.
5. **`GAME_SCALE` must match `NEKO_DESKTOP_SCREEN`.** Scale 3 → 960×720.
6. PSDK draws **its own mouse cursor sprite**. Disabled via
   `Data/configs/devices_config.json` → `isMouseDisabled: true`, applied at
   image build time. Configs are read from the **JSON**, not the `.rxdata` —
   see PSDK's `register(:devices, 'devices_config', :json, ...)`.

### Touch controls (`web/game/touch-controls.js`)

The game is keyboard-only and neko's mobile fallback just opens the OS soft
keyboard, which is useless for a game. This script injects a D-pad, face
buttons, and a keyboard button into **neko's own page** (not an iframe), and
talks to the client neko exposes globally:

```js
window.$client.sendData('keydown', { key: 0xff52 })   // Up
```

That is the same call neko's own keyboard handler makes, so it bypasses
Guacamole's browser-key translation entirely.

**Key mapping — read from PSDK's `Input::Keys` table, not guessed.** Every
virtual button has several bindings; we deliberately use the **non-letter** one:

| Button | Key | Keysym | Why not the obvious one |
|---|---|---|---|
| D-pad | arrows | `0xff51`–`0xff54` | |
| A | Enter | `0xff0d` | `C` would type "c" on the name-entry screen |
| B | Escape | `0xff1b` | `X` would type "x" |
| START | Insert | `0xff63` | `J` would type "j" |
| SELECT | Pause | `0xff13` | `H` would type "h" |

Other details that matter: the D-pad is 8-way and follows the finger as it
slides; every held key is released on `visibilitychange`/`blur`/`pagehide` (or a
backgrounded tab leaves the character walking into a wall on the server); a
one-tap "PLAY" gate buys fullscreen + audio + landscape lock in a single gesture
(browsers grant none of them without one); and embed mode is forced client-side
so a cached page can never show neko's own branding.

**Test:** `node web/scripts/test-touch-controls.mjs` — drives real Chrome with
touch emulation, wraps `window.$client` to capture what would go on the wire,
asserts exact keysyms. **24/24 passing.** Needs `npm i puppeteer-core` and
Chrome; set `CHROME_PATH` if not at the macOS default.

**Not yet done:** never tested on a real phone. Button sizes and D-pad deadzone
are guesses that passed in emulation.

### Capacity — estimated, NOT measured

`web/scripts/measure.sh 120` exists to settle this; run it on the box **while
someone is actually playing** (an idle title screen measures nothing). It
reports cores, RAM, egress bitrate and — importantly — **steal time**, since
this is a shared-vCPU instance and sustained video encoding is exactly the
workload a hypervisor throttles.

Verified from neko's source (`streamsink.go`): **one gstreamer pipeline per
stream, many listeners.** Encoding cost does *not* scale with viewer count; only
per-peer packetisation does. So:

- **Shared room, 50 viewers:** ~4–8 vCPU total. Bandwidth is the real limit
  (~50 × 1.5 Mbps ≈ 75 Mbps sustained).
- **50 isolated sessions:** ~1 core *each*. Cloud VPS pricing makes this
  brutal — Hetzner tripled CCX prices in June 2026 (CCX53 = 32 vCPU for €533/mo).
  Dedicated hardware is the only sane route if this is ever wanted.

The current 2-core box handles roughly 15–25 shared viewers, not 50.

Cheapest lever if capacity gets tight: `GAME_SCALE=2` + `640x480@30` roughly
halves encode cost, and pixel art still looks fine upscaled by the browser.

---

## 2. Landing page — `landing-stockmonster/`

Next.js 15 App Router / TS / Tailwind v4, fully static, 201 pages.

- `/` — hero with an RPG battle screen rebuilt in DOM, ticker tape, starter
  picker, type chart, the full 194-entry ledger, meme wing, FAQ
- `/ledger/[ticker]` — 194 deep-linkable pages (sprite, dex entry, base stats,
  defensive matchups, contract address)
- `/memes` — the 60 meme-coin monsters

Design direction: *"a Bloomberg terminal that thinks it's a Game Boy."*

### Two data findings worth keeping

1. **`dex-text.json` is keyed by 1-based position in the token map, NOT by
   `dexId`.** Keying by `dexId` silently mismatches 88 of 194 entries. Anything
   else that joins this data must use the same keying.
2. **Real base stats and a real 18×18 type chart exist in
   `Stockmonsters/Data/Studio/`** — baseHp/Atk/Dfe/Ats/Dfs/Spd, height, weight,
   catch rate, the full effectiveness matrix and each type's hex colour. Not
   invented. `vocab.js` documents the positional type rename.

Nice detail: the reskin happened to land on the engine's starter slots, so the
starters genuinely are **Apple / NVIDIA / Tesla**.

### In progress

A background agent is fixing a **TypeScript build failure on Vercel**
(`src/lib/data.ts:49` — `typesRaw as ElementType[]`; the generated JSON infers a
union of 18 object shapes with `?: undefined` keys, which is not assignable to
`Record<string, number>`). It was told not to disable type checking, and to find
out **why a local `npm run build` passed while Vercel failed** — that divergence
matters more than the single fix, or the next type error reaches Vercel the same
way. A stale `.next` directory is the leading suspect.

`metadataBase` is still a placeholder (`https://stockmonsters.example`) — swap
it for the real domain before launch.

---

## ⚠️ 3. Unresolved: unreskinned Nintendo art in the game

**This is the most important open item before the link goes wide.**

The reskin is incomplete. Confirmed by looking at the actual files:

- **The game's intro animation** (Map002) still plays the original Pokémon
  Red/Blue opening — **Gengar and Nidorino**, unmodified. Anyone who opens the
  live link and waits on the title screen sees it.
- **`Stockmonsters/graphics/icons/`** (926 files) is *item* icons — Poké Balls,
  Master Balls, potions. Unmodified Nintendo art.
- **`Stockmonsters/graphics/battlers/`** is Pokémon **trainer** sprites.
- **`graphics/pokedex/pokeicon/`** is vanilla creature icons.

The **safe** source is **`graphics/pokedex/pokefront/`** — all 254 creature
fronts (194 stocks + 60 memes) were inspected individually and are original
generated art. The landing page uses only these. A `.vanilla-bak` sibling file
is a reliable signal that an asset *was* reskinned.

For a project with money attached and a public link, the intro should be
replaced (or skipped) before wide distribution. `stockmonsters-reskin/` already
has the sprite pipeline to do it.

---

## 4. MMO (`stockmonsters-mmo/`) — the real product direction

### Why

Streaming gives **one shared character** — everyone who opens the link controls
the same player. The desired product is *"everyone plays their own character,
up to 50 on the same map"*, which is an MMO. **PSDK cannot do this**: it is a
single-player engine with no networking. It is not a setting; it is a different
engine.

Counter-intuitive but important: **the MMO is far cheaper to run.** 50 streamed
players ≈ 50 cores. 50 MMO players ≈ one small server, because the game runs on
each player's device. The expensive path is the one that avoids the rewrite.

### Framework decision: RPG-JS v5 (beta)

| | Latest | Date |
|---|---|---|
| v4 | 4.3.0 | **2024-01-29** — 2.5 years stale |
| v5 | 5.0.0-beta.33 | **2026-08-20** |

The choice is not "stable vs beta", it is **maintained beta vs abandoned
stable**. v5. Versions are already pinned exactly (no caret) in `package.json`,
so upgrades stay deliberate.

**The real risk is not the version number** — it is depending on a
single-maintainer, pre-1.0 framework for months. Mitigation, and this should
drive the architecture: keep the framework-independent surface large. The
assets, the map importer, the game data (194 tokens, dex text, type chart) are
already ours. **The battle engine — the biggest piece — should be written as
plain logic and attached to RPG-JS through a thin layer, not built inside it.**

### What exists

`tools/import-maps.mjs` — a reusable importer for all 26 PSDK Tiled maps. It
solves three real migration problems:

1. **Path flattening** — PSDK links `Maps/`, `Tilesets/`, `Assets/` with `../`;
   RPG-JS wants them side by side.
2. **Colour key → alpha** — PSDK tilesets mark transparency the RPG Maker way
   (`trans="f05ba1"` on the `<image>` tag, colour left opaque in the PNG). PIXI
   ignores it, so everything rendered solid magenta. The importer bakes the key
   into a real alpha channel (3.8 M pixels on TECH-Buildings alone).
3. **Metadata layers stripped** — PSDK smuggles collision (`passages`) and
   terrain tags (`systemtags`) in as tile layers. They are data, not art, and
   RPG-JS tries to draw them.

**Plus the bug that took longest to find:** two tilesets claimed more tiles than
their images contain (TECH-Nature declared 3451, the PNG holds 3120; TECH_Lab
declared 230, holds 180). The reskin resized the PNGs without updating the
`.tsx` metadata. Any map tile landing on a phantom index made the renderer ask
for an `undefined` texture and **the entire map failed to draw**. The importer
now re-derives `tilecount`/`columns`/image size from the actual PNG.

Result: the Hub map imports cleanly, **all 8,427 tiles resolve to real image
tiles**, no overlapping firstgid ranges, no render errors.

### The one blocker

**No player character appears.** `onConnected` never fires — proven with a
filesystem side-effect, so it is not a lost console message: the module loads,
the hook never runs. Without a player there is no camera target either, which is
why the view sits at the map's top-left corner.

**Decisive finding: a pristine `npx degit rpgjs/starter#v5` works.** Two
character sprites render, zero errors. So the framework is fine and **this is a
regression introduced in our copy.**

**Next step — bisect.** Start from pristine and re-apply our changes one at a
time until the player disappears. The candidates, roughly in order of suspicion:

1. `src/server.ts` — I added `provideServerModules([mainServerModule])` on top of
   the starter's `provideMain()`. Registering the same module twice may break
   hook collection. **Try removing this first.**
2. `src/modules/main/player.ts` — `onConnected` was made `async` and
   `player.changeMap(...)` awaited. If the hook runner does not handle an async
   hook the way I assumed, this could break the chain.
3. `src/modules/main/server.ts` — the starter's `events: [{ Npc() }]` was removed
   along with the `Npc` import. Unlikely, but it is a change.
4. The map itself — least likely: the failure reproduced with the starter's own
   `simplemap` restored.

Useful mechanics learned while digging: `onConnected` fires inside
`LobbyRoom.onJoin` (`@Room({ path: "lobby-{id}" })`), the client joins
`lobby-1` by default, and `onStart` only fires after a GUI interaction carrying
`data.id === "start"`. So the intended flow is **lobby → start selection → map**,
which the starter presumably wires up and we may have bypassed.

### Realistic schedule

| Stage | Work | Estimate |
|---|---|---|
| 1 | One map, multiple players visible to each other | ~1 week (mostly done bar the blocker) |
| 2 | Collision conversion + all 26 maps + transitions | 1–2 weeks |
| 3 | Character/creature sprites, dex | 1–2 weeks |
| 4 | **Turn-based battles + catching** | 4–8 weeks |
| 5 | Saves, inventory, events, menus | 4+ weeks |

Playable MMO demo (1–3): **~1 month.** Parity with the PSDK game: **3–6 months.**

Note stage 4 has no shortcut: RPG-JS ships `@rpgjs/action-battle`, which is
*action* combat. Stockmonsters is turn-based. That system is written from
scratch and it is the largest single piece of the port.

### Assets are in good shape for the port

26 Tiled `.tmx` maps (standard 1.10, 64×64 tiles at 32 px), 21 tilesets, 2282
RPG Maker character sprites. RPG-JS has `Presets.RMSpritesheet` and reads Tiled
natively, so the art travels almost unchanged. The Ruby side does not travel.

---

## Repo layout

```
Stockmonsters/          the PSDK game (do not edit for streaming concerns —
                        put those in the Docker image instead)
stockmonsters-reskin/   sprite/data pipeline, token map, dex text
web/                    the live streaming stack  ← deployed
landing-stockmonster/   Next.js marketing site
stockmonsters-mmo/      RPG-JS port (early)
```

## Loose ends

- `stockmonsters-mmo/src/modules/main/player.ts` still contains the
  `/tmp/sm-hook.log` trace instrumentation — remove once the blocker is solved.
- Uncommitted at handover: `landing-stockmonster/src/lib/data.ts` (agent is
  working on it), `stockmonsters-mmo/` package files and `player.ts`.
- Deploying while someone is playing kills their session mid-frame and shows
  PSDK's crash screen. Worth a maintenance notice or a graceful drain.
- A queue for the shared room was designed but **not built** — it became moot
  when the direction moved to the MMO. If the streamed version is kept as a
  bridge, the design was: everyone watches, control passes on idle, admin can
  force-skip. `NEKO_SESSION_IMPLICIT_HOSTING=true` is currently set, so right
  now *everyone* can control the character simultaneously.
