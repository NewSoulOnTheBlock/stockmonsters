# Stockmonsters in the browser

Stockmonsters is a PSDK / Pokémon Studio game. PSDK has **no HTML5 export** and
no WebAssembly port, so the game cannot be compiled to run inside a browser.

What it *does* have is native Linux binaries (`ruby-dist/bin/ruby` +
`LiteRGSS.so`, which is SFML-based). So this setup runs the real game natively
in a container and streams it to the browser over WebRTC using
[neko](https://github.com/m1k1o/neko). Players click a link and play — no
download, no Wine, no emulator.

## Status

Verified working end to end in a clean container:

| | |
|---|---|
| Game boots | yes — ~2.9s, zero errors in the log |
| Rendering | yes — OpenGL via llvmpipe (software, no GPU needed) |
| Audio | yes — OpenAL → PulseAudio → captured by neko |
| Resolution | 960×720 (game is natively 320×240, upscaled exactly 3×) |
| Web endpoint | yes — HTTP 200 on :8080 |
| Touch controls | yes — D-pad + buttons, 18/18 assertions pass in a real browser |

## Deploy

### 1. Get a server

Must be **x86_64** — PSDK ships no ARM Linux binaries. No GPU needed.

The game is 320×240 upscaled to 960×720 and encoded in software, which is
cheap. Budget roughly **1 core per concurrent player** and start with something
like a 4–8 vCPU box (Hetzner CCX/CPX, Vultr, DigitalOcean — all fine).

### 2. Open the firewall

| Port | Protocol | Why |
|---|---|---|
| 8080 | TCP | web UI + signalling |
| 52000–52100 | UDP | WebRTC media |

The UDP range is **not optional**. If it is closed, players get a spinner that
never connects.

### 3. Build and run

```bash
git clone <this repo> && cd stockmonsters/web
cp .env.example .env
$EDITOR .env          # PUBLIC_IP is required — curl -s ifconfig.me
docker compose up -d --build
```

First build downloads the ~150 MB Pokémon Studio .deb to extract the Linux PSDK
runtime, and copies the ~320 MB game. Expect a few minutes and a ~1.8 GB image.

Then open `http://<server-ip>:8080/` and log in with `PLAYER_PASSWORD`.

### 4. Put it behind HTTPS

Browsers restrict WebRTC on plain HTTP, and you want a real link to share.
Point a domain at the box and terminate TLS with Caddy:

```
play.stockmonsters.xyz {
    reverse_proxy localhost:8080
}
```

Media still flows over the UDP range directly — only signalling is proxied.

### 5. The link to share

```
https://play.stockmonsters.xyz/?usr=player&pwd=<PLAYER_PASSWORD>&embed=1
```

`embed=1` hides neko's chrome and shows only the game. `usr`/`pwd` prefill the
login so players do not face a password box. (`cast=1` hides *all* controls —
use it for a view-only stream on a landing page.)

## How it fits together

```
browser ──WebRTC(h264/opus)── neko ──X11 capture── Xvfb :99
                                │                     │
                                └──PulseAudio─────  game (ruby + LiteRGSS)
```

- `game/Dockerfile` — extracts the Linux PSDK runtime from the Pokémon Studio
  .deb, layers it and the game onto neko's base image.
- `game/launch-game.sh` — waits for X, writes `.gameopts`, starts the game.
- `game/supervisord.conf` — runs openbox + the game under neko's supervisord.
- `game/openbox.xml` — a window manager stripped of every keybinding and menu,
  so players cannot escape the game into a desktop.

### Things that will bite you

- **PSDK's Ruby is not relocatable.** It was built with RVM and has
  `/home/palbolsky/.rvm/rubies/ruby-3.3.0` compiled in as its prefix. Without a
  symlink at that exact path it dies with `uninitialized constant
  Encoding::UTF_8`. The Dockerfile detects the prefix and symlinks it, so this
  keeps working if PSDK repackages with a different path.
- **PSDK bundles libs that want `libvpx.so.7`**, which Debian 13 no longer has.
  That code path belongs to SFEMovie video playback, which this game does not
  use (`introMovieMapId` is a map, not a video). If you later add real video
  cutscenes, you will need to supply libvpx 7.
- **`GAME_SCALE` must stay in sync with `NEKO_DESKTOP_SCREEN`.** Scale 3 →
  960×720. Mismatch it and you get a letterboxed or clipped window.
- **Do not add a `USER neko` to the Dockerfile.** neko's supervisord has to
  start as root and drops privileges itself.

## Scaling up

`docker-compose.yml` runs **one shared room**: everyone who opens the link sees
the same session, and control passes between players. That is the cheapest
setup and, for a meme project, arguably the better one — a shared "everyone
plays at once" session is more fun to post about than a private instance.

For isolated per-player sessions, run [neko-rooms](https://github.com/m1k1o/neko-rooms)
in front of this image: it exposes an API to create and destroy rooms on
demand. Add a session time limit and a queue when the box is full, or an
idle player will hold a container forever.

## Mobile controls

The game is keyboard-only, and neko's own mobile affordance is a button that
opens the OS soft keyboard — useless for a game. `game/touch-controls.js` adds
a real D-pad and face buttons on touch devices.

It is injected into neko's own `index.html` at build time, so it runs in neko's
document rather than an iframe, and talks to the client neko exposes globally:

```js
window.$client.sendData('keydown', { key: 0xff52 })   // Up
```

That is the same call neko's own keyboard handler makes, so it bypasses
Guacamole's browser-key translation entirely and cannot disagree with it.

Key mapping, taken from PSDK's `Input::Keys` table rather than guessed:

| On-screen | Key | X11 keysym | PSDK |
|---|---|---|---|
| D-pad | arrows | `0xff51`–`0xff54` | UP/DOWN/LEFT/RIGHT |
| A | `C` | `0x63` | A — confirm |
| B | `X` | `0x78` | B — cancel / run |
| START | `J` | `0x6a` | START — menu |
| SELECT | `H` | `0x68` | SELECT |

Details that matter in practice:

- The D-pad is 8-way and analogue-ish — direction follows the finger and
  updates as it slides, so diagonals work without hitting a target.
- Every held key is released on `visibilitychange`, `blur` and `pagehide`.
  Without this, a player who backgrounds the tab mid-step leaves the key down
  on the server and the character walks into a wall until they reconnect.
- In landscape the controls sit on the letterbox bars beside the 4:3 game, so
  they cover none of it.
- `NEKO_SESSION_IMPLICIT_HOSTING=true` is set in the compose file so players
  get control by interacting. Without it they would have to find and press
  neko's "request control" button, which nobody does on a phone.

### Testing it

`scripts/test-touch-controls.mjs` drives a real Chrome with touch emulation,
wraps `window.$client` to capture what would go on the wire, and asserts the
exact keysyms. It needs no WebRTC session.

```bash
npm i puppeteer-core
docker compose up -d
node scripts/test-touch-controls.mjs
```

Set `CHROME_PATH` if Chrome is not at the macOS default location.

## Operating notes

- Saves are wiped on each container start (`GAME_WIPE_SAVES=1` in
  `launch-game.sh`) so one player's session does not leak into the next.
  Set it to `0` and mount a volume at `/opt/game/Saves` for persistence.
- Logs: `docker exec stockmonsters tail -f /var/log/neko/stockmonsters.log`
- The game auto-restarts if it crashes (supervisord `autorestart=true`).
- `ADMIN_PASSWORD` lets you take control and kick players from the neko UI.
  Keep it out of the shared link.
