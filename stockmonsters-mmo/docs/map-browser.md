# World map / fast travel browser

The MAP button used to open a five-entry `showChoices` dialog. The game now has
**171 maps** — the 19 original PSDK maps plus the 152 converted Kanto/Johto maps
(see `docs/rmxp-map-import.md`) — so the player browses them visually instead.

Three pieces:

| file | what it is |
| --- | --- |
| `tools/render-map-thumbs.mjs` | generator: preview PNGs **and** the catalogue |
| `public/previews/<id>.png` | one preview per map, ~320px on the long edge |
| `src/data/map-catalog.ts` | generated data the window reads |
| `src/map-browser.ts` | the window itself |

## Wiring it up

```ts
import { mountMapBrowser, openMapBrowser } from './map-browser'

mountMapBrowser(engine, socket)   // at boot, next to mountMarketplace
// …and from the HUD's MAP button:
openMapBrowser()
```

`mountMapBrowser` is idempotent — a second call returns the first instance, and
`openMapBrowser()` mounts on first use if nobody mounted it at boot.

The window emits exactly one thing, and only when the player commits to a trip:

```ts
engine.processAction('travel:to', { map: id })
```

The server owns the landing tile and the validation. This window never sends
coordinates, never guesses at them, and emits nothing else. It also listens for
an optional `map:browser` socket push (`{ map? }`) so an NPC can open the window
straight onto one place; that is harmless if the event never fires.

## Regenerating

```sh
node tools/render-map-thumbs.mjs            # incremental
node tools/render-map-thumbs.mjs --force    # re-render everything
node tools/render-map-thumbs.mjs --only route-29
```

Run it after importing or editing any `.tmx`. A thumbnail is re-rendered only
when its `.tmx` (or the generator itself) is newer than the PNG; the catalogue
is always rewritten. Today: **171 rendered, 0 failed, 0.89 MB total.**

### How the previews are rendered

The obvious approach — composite every layer at the full 32px/tile and let sharp
shrink the result — is what the throwaway autotile-verification renderer did, and
it is wrong here twice over. A 110x100 map is 3520x3200px for a 330x300 answer,
and a generic resize applied to a *tileset atlas* samples across tile boundaries,
dragging unrelated neighbours into every tile.

So instead: shrink each **tileset** once, with an exact per-tile box average that
never reads outside the tile it is averaging, then blit R x R blocks. R is whole
pixels per tile, chosen from a ladder so that the long edge lands near 320px
(2px/tile for a 182-tile-wide route, 16 for a 20-tile placeholder). Alpha is
averaged and RGB is alpha-weighted, so transparent padding does not darken edges.
Shrunk atlases are cached by `(tileset, R)`, which is why 171 maps render in ~5s.

Layers with `visible="0"`, and layers named `Borders` / `systemtags*` /
`terrain_tag`, are collision and metadata — they are skipped, not drawn.

### Regions

`region` is `exchange` for the 19 PSDK maps. For the RMXP maps three signals are
tried, most confident first:

1. the base place name (a floor/compass suffix like `B2F` or `East` is stripped
   first) against explicit Kanto and Johto place lists;
2. the route number — 1..25 is Kanto, 26..48 is Johto;
3. the PBS map-id cluster — `rmxpId` 1..78 is Kanto, 79..152 is Johto.

Anything none of those three place is `other`, never a guess. Today that is
exactly the 25 RMXP folder markers and blank scratch pages (`MAP035`, `Towns`,
`Routes`, `Extra`, `Johto Enhanced`, `Kanto Remastered` …) — they are real maps
in the manifest, so they stay browsable, but they are not places.

Current split: **exchange 19 · kanto 53 · johto 74 · other 25**.

`connections` comes from `src/data/rmxp-connections.json`, symmetrised and
filtered to maps that exist here, and drives the BORDERS chips in the detail
sheet. 77 of the 171 maps have at least one.

## The window

Same chrome, same z-band and the same habits as `src/marketplace.ts`, all of it
out of `src/ui-kit.ts`:

- draggable title bar, close button, `Z.marketWindow` (960) — above the map
  canvas and the HUD, below the RPG-JS dialog layer;
- hides itself (`watchGameDialog`) while a game dialog is up rather than
  fighting it;
- `pushLayer` escape stack: ESC closes the detail sheet first, then the window;
- `guardKeys` on the search box and the sort select, so typing never walks the
  player around.

Left sidebar is the region filter (All / Exchange City / Kanto / Johto / Other,
with counts) plus a search box that matches name, id and region label. There is
deliberately **no "visited only" toggle** — nothing tracks visits yet.

Thumbnails lazy-load through an `IntersectionObserver` rooted on the grid, with
a screenful of `rootMargin` runway. Opening the window fetches roughly the 16
cards on screen, not 171 images. If `IntersectionObserver` is missing the images
simply all load, which is the old behaviour and still correct.

## Not done here

- No server handler: `travel:to` is assumed to exist and to validate. Until it
  lands, TRAVEL closes the window and nothing happens.
- The player's current map is not highlighted — the client is not told which map
  it is on in a way this module can read without new plumbing.
- The 25 `other` maps are mostly blank 20x15 scratch pages, so their previews are
  a flat background colour. That is what they contain.
