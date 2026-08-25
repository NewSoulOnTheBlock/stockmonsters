# Importing the RPG Maker XP map pack

The "Remastered Kanto Johto Map Pack" is an RPG Maker XP (RMXP) project, not a
PSDK/Tiled one. `tools/import-rmxp-maps.mjs` converts all 152 of its maps into
the same `.tmx` + `.tsx` + `*.hitboxes.json` shape that `tools/import-maps.mjs`
produces for the PSDK maps, so one renderer and one collision code path serve
both families.

## Re-running

```sh
node tools/import-rmxp-maps.mjs                    # all 152 maps
node tools/import-rmxp-maps.mjs --maps 79,128,16   # a subset, ids unchanged
node tools/import-rmxp-maps.mjs --keep-dump        # keep the intermediate JSON
```

Needs Ruby (3.2.6 verified) on `PATH` and the source project at
`../new-assets/Remastered Kanto Johto Map Pack` relative to the repo.

It is idempotent and deterministic — a second run rewrites byte-identical
files. It only ever writes `src/tiled/RMXP-*`, `src/tiled/<map>.tmx`,
`src/tiled/<map>.hitboxes.json`, `src/tiled/rmxp-manifest.ts` and
`src/data/rmxp-connections.json`; the PSDK maps and `src/tiled/manifest.ts`
are never touched.

Two stages, because `.rxdata` is a Ruby `Marshal` stream:

| stage | file | job |
| --- | --- | --- |
| 1 | `tools/rmxp-dump.rb` | `Marshal.load` the `.rxdata` into JSON in a temp dir |
| 2 | `tools/import-rmxp-maps.mjs` | JSON + PNGs → tilesets, TMX, collision, manifests |

`tools/rmxp-defs.rb` holds the stub classes `Marshal` needs (`Table`,
`RPG::Map`, `RPG::Tileset`, …) so the data loads without RMXP installed.

## RMXP format facts confirmed against this pack

**`Table`** is RMXP's binary array: a 20-byte header (`size, xsize, ysize,
zsize, item_count`, all `uint32` LE) then `item_count` little-endian `uint16`s.
Map data is `x * y * z` with `z = 3` layers, indexed
`x + y*xsize + z*xsize*ysize`. Layer 0 is drawn first (bottom), 2 last.

**`MapInfos.rxdata` is a Hash** keyed by map id, not an Array. `Tilesets.rxdata`
*is* an Array indexed by tileset id, with slot 0 `nil`.

**Globbing gotcha:** `Data/Map*.rxdata` also matches `Data/MapInfos.rxdata`.
Use `Data/Map[0-9]*.rxdata`.

**Tile ids** in `map.data`:

| id | meaning |
| --- | --- |
| `0` | empty |
| `1 … 383` | autotile — `autotile_index = id/48 - 1`, `pattern = id % 48` |
| `>= 384` | static tileset tile, index `id - 384` |

Ids `1..47` (which would be autotile index −1) never occur in this pack.

**Only 4 of the 26 tileset slots carry art** — 21 Kanto Exterior
(`KANTO50S_OUT`), 22 Caves, 23 Johto (`JohtoCompactExterior`), 24 Alternate
Ship and Trees (`Johtoshiptile`). The other 22 are empty editor slots. Map
usage: 62 / 43 / 45 / 2.

**Tileset PNG geometry is 8 tiles (256 px) wide**, and the `passages` table
length confirms it exactly: `384 + 8 * rows`. E.g. `JohtoCompactExterior` is
256×9600 → 2400 tiles → `passages.xsize == 2784`. Every tile index referenced
by every map is inside its tileset's real range — no phantoms in the source.

**Transparency is a real alpha channel** on all four static tilesets, unlike
PSDK's colour-keyed art, so no `trans=` handling is needed there. Three
*autotiles* were saved without an alpha channel and use a magenta colour key
instead (`A_FLOW.jpg` and `A_FLOWRED.jpg` are 100% key, `TFJ_Waterfall.png`
keys its unused top row). PIXI ignores Tiled's `trans=` attribute, so the
importer bakes those keys into a real alpha channel exactly as
`tools/import-maps.mjs` does. The key is only trusted when the corner pixel is
unmistakably magenta (`r > 120 && b > 120 && g < min(r,b)*0.6`) — `A_beach`'s
corner is water blue and `STILL`'s is sand, and keying those out would erase
the art.

**Tilesets are reflowed from 8 columns to 32.** RMXP's 8-wide sheets are up to
9600 px tall, past the 8192 px `MAX_TEXTURE_SIZE` many GPUs still report. The
importer rewrites them to 1024 px wide (tallest becomes 2400) preserving tile
*index* order, so a Tiled tileset with `columns="32"` indexes identically to
the RMXP one.

## The autotile algorithm

An autotile frame is 96×128 px — 3×4 blocks of 32 px, or equivalently a **6×8
grid of 16 px quarters** numbered 1…48 left-to-right, top-to-bottom. Each of
the 48 patterns is assembled from four quarters in the order
`[top-left, top-right, bottom-left, bottom-right]`:

```
quarter n  ->  sx = ((n-1) % 6) * 16 ,  sy = floor((n-1) / 6) * 16
```

The 48×4 table lives in `QUARTERS` in `tools/import-rmxp-maps.mjs`. Output is
one 48-tile sheet per autotile *file* (8 across × 6 down, 256×192 px), reused
by every tileset that references it.

### How the table was verified

Not by trusting a table found somewhere — by three independent checks:

1. **Structural.** Patterns 34/20/36 · 16/0/24 · 40/28/38 resolve to exactly
   the nine 32 px blocks of the image's bottom-left 3×3 region, in the
   corner/edge/centre arrangement RMXP draws a "water body" with (pattern 0 =
   fully surrounded = centre block; pattern 47 = isolated = block (0,0)).
2. **Data.** A histogram of every autotile id in all 152 maps shows the map
   data uses precisely that nine-block set plus the four single-outer-corner
   variants (1/2/4/8) and their combinations — a distribution that is only
   coherent if the quarter assignment is right.
3. **Visual.** Rendered maps were inspected as PNGs. Concave shorelines
   (Lake of Rage's inner islands), cave-water inlets (Mt. Mortar) and town
   sand borders (New Bark Town) all close correctly. A wrong-quarter bug shows
   up instantly as half-tile seams at exactly these places.

### Animated and short autotiles

Animated autotiles are frames laid out side by side, `width = 96 * frames`
(this pack has 1, 4, 5, 6, 11, 18 and 32-frame files). **Frame 0** is used;
Tiled tile animations are not emitted.

Two files (`A_FLOW.jpg`, `A_FLOWRED.jpg`, `Waterfall crest.png`) are 32 px
tall — a single animated 32×32 tile rather than a 96×128 template. All 48
patterns collapse to that one tile.

### The missing autotile

`R49Water` is declared by the Johto tileset (slot 6) but has no file in
`Graphics/Autotiles`. `Lake` is substituted (logged on every run). Checking
every tile id in all 152 maps shows **`R49Water` is never actually placed**, so
the substitute exists only to keep the gid table the same shape for every map
on that tileset. `Flowers2.png` is the mirror case: a file no tileset slot
references, so no sheet is generated for it.

## Collision

RMXP keeps collision in the **tileset**, not in a layer. `Game_Map#passable?`
walks the three tile layers top-down against the tileset's `passages` and
`priorities` tables:

```
for z in [2, 1, 0]:
    t = data[x, y, z]
    if passages[t] & 0x0f == 0x0f:  -> blocked
    if priorities[t] == 0:          -> passable, stop looking
-> passable
```

`passages` bits are `0x01/0x02/0x04/0x08` = blocked from down/left/right/up and
`0x40` = "star" (drawn above the player).

The subtle part is why an empty upper layer does not short-circuit the loop:
**tile id 0 has `passages == 0` but `priorities == 5`** in all four tilesets —
deliberately non-zero, so an empty cell falls through to the layer below
instead of declaring the tile walkable. Star tiles carry priority 5 too, which
is why you can walk behind a roof.

The importer runs that loop per cell, then greedy-merges blocked cells into
rectangles (horizontal runs per row, then vertical joins of equal runs) — the
same merge `tools/import-maps.mjs` uses — and writes them to
`src/tiled/<map>.hitboxes.json` in **map pixels**. That is the exact shape
`src/modules/main/server.ts` injects through `map.onBeforeUpdate` under the
`__psdk_passages__:` hitbox id, so no server change is needed to use them.

**Known limitation.** 1357 cells across the pack carry per-edge-only passage
flags (`0x01`…`0x0e`). A rectangle hitbox cannot express "blocked from the
north only", so those cells are left walkable and the count is reported on
every run — the same trade-off, and the same loud reporting, as the PSDK
importer's per-edge passage tiles.

**Also not converted.** `priorities > 0` (draw above the player) and
`terrain_tags` (tall grass, water, ledges — tags 1…15 are populated here) are
read for collision but not emitted. The three tile layers are written in order
with `<objectgroup name="events"/>` last, matching the PSDK maps, so the player
renders above all tiles.

## Output

- `src/tiled/RMXP-<Tileset>.png` / `.tsx` — 4 reflowed static tilesets
- `src/tiled/RMXP-auto-<name>.png` / `.tsx` — 15 expanded 48-tile autotile sheets
- `src/tiled/<map>.tmx` — 152 maps, three layers named `lower`/`middle`/`upper`
- `src/tiled/<map>.hitboxes.json` — merged collision rects
- `src/tiled/rmxp-manifest.ts` — `RMXP_MAPS`, explicit imports only
- `src/data/rmxp-connections.json` — 111 edge links from PBS `map_connections.txt`

Every map gets an `<objectgroup name="events"/>`, whose id is derived from the
layers actually emitted rather than from `nextlayerid`. RPG-JS mounts its
character/camera layer only where one exists; without it there is no player
sprite and no camera follow.

**Map ids** are slugified `MapInfos` names (`New Bark Town` → `new-bark-town`).
A name shared by several maps gets the RMXP id appended to *all* of them
(`route-2-11`, `route-2-70`), so no id depends on iteration order. Ids that
would collide with a PSDK map are suffixed the same way. The reserved set is
read from `src/tiled/manifest.ts`, not from the `.tmx` files on disk, so a
second run does not see its own output as "taken" and renumber everything.

### GID validation

A single gid that points past the end of its tileset makes PIXI fail the
texture lookup and the **whole map** renders blank — that is how an earlier bug
in the PSDK importer showed up. So the importer validates, after writing, that
every gid in every map resolves to a real tile in a declared tileset and that
no two `firstgid` ranges overlap. Current result: clean across all 152 maps.

## Wiring the maps into the game

They are deliberately *not* in the game yet. `src/tiled/rmxp-manifest.ts` is
separate from `src/tiled/manifest.ts` so the two importers can never clobber
each other. To add them, spread `RMXP_MAPS` into the map list in
`src/modules/main/server.ts` — the hitbox shape is identical, so the existing
`onBeforeUpdate` hook already handles them.

`src/data/rmxp-connections.json` is data only. Each entry links two map edges;
the offsets align the maps along the shared edge, in tiles:

```
79,West,13,104,East,0
{ from: 'new-bark-town', fromEdge: 'west', fromOffset: 13,
  to:   'route-29',      toEdge:   'east', toOffset:   0  }
```

For a north/south link, `world_x(to) = world_x(from) + fromOffset - toOffset`;
for east/west the same holds on `y`. Stepping off `from` at tile `(x, y)` lands
on `to` at `x + fromOffset - toOffset` along the shared axis.
