# Create Your Character — layered character designer

The overlay in `src/character-designer.ts`. Two tabs, one output.

| Tab | What it is | Emits |
|---|---|---|
| **PICK A TRADER** | the 49 ready-made Pipoya sheets, grid, one click | `['ch-female-07']` |
| **BUILD YOUR OWN** | six stacked layers + live preview + RANDOMIZE | `['chl-body-color4', 'chl-eyes-eyes33', …]` |

Both produce **an ordered array of spritesheet ids**. That array *is* the whole
mechanism: `player.setGraphic(ids)` renders one sprite per entry, in array
order, all driven by the same direction/animation signal, synced to every
client by the `@sync()`'d `graphics` field. A ready-made is a one-element
array; a built character is up to six. Nothing is composited anywhere.

Draw order — **the array order is the z-order**:

```
body → eyes → hair → clothes → hat → accessory
```

## Wiring

```ts
import { mountCharacterDesigner, openCharacterDesigner } from './character-designer'

mountCharacterDesigner(engine)   // builds the overlay, hidden; idempotent
openCharacterDesigner()          // or the window.openCharacterDesigner global,
                                 // for the plain <script> in index.html
```

CONFIRM does three things and nothing else:

1. `localStorage['sm-character'] = JSON.stringify(ids)`
2. `window.dispatchEvent(new CustomEvent('sm:character', { detail: ids }))`
3. an optimistic `engine.processAction('character:set', { layers: ids })`,
   only if an engine was passed to `mountCharacterDesigner`.

(2) is the real seam: `src/client.ts` already listens on it and owns delivery,
including the retry-until-`character:accepted` loop. (3) is a shortcut for
changes made from inside a running game; it is never the guarantee.

The server validates every id against `CHARACTER_IDS` and drops the whole
request if any one is unknown — and an unknown id that slipped through would
render the player **invisible with no error at all**. The designer therefore
re-checks its own output against `CHARACTER_IDS` before emitting.

## The assets

`node tools/import-characters.mjs` (run from `stockmonsters-mmo/`) copies from
the WorkAdventure snapshot and regenerates `src/data/character-catalog.ts`.
Idempotent and deterministic.

| Set | Source | Files | Shipped | Id prefix |
|---|---|---:|---:|---|
| ready-mades | `characters/pipoya/` | 300 | **49** | `ch-` |
| body | `customisation/character_color/` | 34 | **33** | `chl-body-` |
| eyes | `customisation/character_eyes/` | 34 | **34** | `chl-eyes-` |
| hair | `customisation/character_hairs/` | 74 | **73** | `chl-hair-` |
| clothes | `customisation/character_clothes/` | 74 | **74** | `chl-clothes-` |
| hat | `customisation/character_hats/` | 27 | **26** | `chl-hat-` |
| accessory | `customisation/character_accessories/` | 34 | **33** | `chl-accessory-` |

322 ids total. Every shipped sheet is verified **96×128** from its PNG header —
3 cols × 4 rows of 32×32, rows down/left/right/up, i.e. `RMSpritesheet(3, 4)`,
identical to `hero.png`. Anything else is skipped with a warning.

Five files were skipped, all deliberately:

- `character_color/_Èµ.png` — a mojibake orphan the upstream catalog never
  references. Matched by "filename is not printable ASCII", because its bytes
  on disk are double-encoded and a literal-name match is unreliable.
- `character_hairs0.png`, `character_hats1.png`, `character_accessories1.png` —
  **fully transparent** placeholders. The designer offers an explicit NONE, so
  a no-op item is only a way to waste a grid cell.

Two hats (`hats6`, `hats7`) are invisible in the facing-down frame — they are
side-of-the-head clips. The importer measures per-frame alpha coverage and
records `row: 1` on them; the grid then shows those thumbnails from the left,
with the body turned to match, instead of rendering an empty cell.

## Thumbnails

Pure CSS sprite offsets — `background-position: -32px 0` on a 32×32 `<i>`
scaled 2×. No canvas and no `requestAnimationFrame` per cell (WorkAdventure
mounts one rAF loop per grid item; the hair tab alone would be 73 of them).

Layer cells stack **two** `<i>`: the currently chosen body underneath, the
candidate item on top. WorkAdventure renders the candidate layer alone, which
makes hair and hats read as objects floating in the void; this doesn't.

## Preview

A 128 px `<canvas>`, `imageSmoothingEnabled = false`:

```
for part of [body, eyes, hair, clothes, hat, accessory]:
    drawImage(img, 1 * 32, dir * 32, 32, 32, 0, 0, 128, 128)
```

Column 1 is the standing frame of every row. ROTATE cycles `dir` through
`[0, 1, 3, 2]` so it reads down → left → up → right. The preview is faithful,
so an item that genuinely can't be seen from the current angle isn't drawn —
turn the character to check it.

RANDOMIZE picks uniformly per part; hats and accessories are absent half the
time. Opening BUILD YOUR OWN with nothing saved seeds one random character,
because the raw defaults are a naked black silhouette.

---

## ⚠ Licensing: the layer set's provenance is UNRESOLVED

**This is a known open item, not an oversight.** It applies only to the `chl-`
layer assets. The `ch-` ready-mades are unaffected and clear (see below).

The 276 layer PNGs come from `play/public/resources/customisation/` in the
WorkAdventure snapshot. In that tree they have **no `about.txt`, no credits
file, no attribution file, and no license text anywhere** — the only
character-asset license in the whole snapshot is the Pipoya `about.txt` next to
the ready-mades. The snapshot isn't a git checkout, so upstream history isn't
available locally to trace the commit that added them.

Complicating facts:

- The art style matches Pipoya closely, but the Pipoya 32×32 pack ships **whole
  characters**, not separable layers — so these are at minimum a derivative
  re-cut, possibly original work by someone else.
- Several items are unmistakably WorkAdventure-specific additions by another
  hand: `black_hoodie`, `white_hoodie`, `pride_shirt`, `engelbert`,
  `tinfoil_hat1`, `mask`, `mate_bottle1`.
- WorkAdventure's **code** is AGPL-3.0 **+ Commons Clause** (no selling). If
  these assets were ever treated as part of "the Software", that would bite a
  commercial game. No code was copied here — the designer is written fresh
  against RPG-JS — but the assets are a separate question.

### Options, cheapest first

1. **Clear it upstream.** Check `github.com/workadventure/workadventure` history
   for the commit that added `play/public/resources/customisation/`, and its PR
   description / CREDITS; or email TheCodingMachine. Cheapest outcome if it
   comes back "Pipoya-derived, same terms".
2. **Substitute a CC0 layered set.** LPC is CC-BY-SA 3.0 / GPL — usable but the
   share-alike terms are awkward for a commercial closed product. A CC0 layered
   charset (OpenGameArt, itch) is the clean answer.
3. **Commission our own.** The format is trivial: a 96×128 transparent PNG,
   3 cols × 4 rows of 32×32, rows down/left/right/up, drawn to register with
   the base body. ~40 items across 6 slots is a day of art, not engineering,
   and gives us assets we unambiguously own.

### Why removal is cheap

Every layer id is prefixed **`chl-`** and every layer file lives under
`public/spritesheets/characters/layers/`. To pull the whole set:

```
grep -rn "chl-" src/            # every reference, in one place
rm -rf public/spritesheets/characters/layers public/spritesheets/characters/layers.json
```

then delete the layer block from `tools/import-characters.mjs` and re-run it.
The ready-made picker, the catalog, the server whitelist, the event seam and the
persistence all keep working — the BUILD YOUR OWN tab simply has nothing to
offer. Substituting a different layered set means pointing the importer at a new
source directory; nothing downstream changes, because everything downstream
only ever sees ids and 96×128 URLs.

### The ready-mades are fine

`characters/pipoya/about.txt` credits
<https://pipoya.itch.io/pipoya-free-rpg-character-sprites-32x32>, whose terms
allow commercial use and modification and forbid only redistributing/reselling
the assets *as an asset pack*. Shipping them inside the game is permitted use,
and `hero.png` / `female.png` are already byte-identical Pipoya files — the
picker adds no new exposure. `CREDITS.md` carries the attribution line.
