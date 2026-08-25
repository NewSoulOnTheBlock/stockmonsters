# Stockmonsters — Sprite Production Brief

Art briefs and generation prompts for all **194 Stockmonsters**, one per Robinhood Chain token.

Every technical value here was read from the live project — dex ids and filenames from
`stockmonsters-token-map.json`, types from `Data/Studio/pokemon/*.json`, and dimensions measured
off the existing PNGs. Drop generated art at the exact paths listed and PSDK picks it up with no
config change, because `resources` in each creature JSON keys sprites by **dex id**, not name.

## 1. What each creature needs

| Sprite | Path (under `graphics/`) | Size | Notes |
|---|---|---|---|
| Front | `pokedex/pokefront/NNNN.png` | **96×96** | Battle sprite, faces the player |
| Front shiny | `pokedex/pokefrontshiny/NNNNs.png` | **96×96** | Recoloured variant |
| Back | `pokedex/pokeback/NNNN.png` | **96×96** | Rear view, seen over the player's shoulder |
| Back shiny | `pokedex/pokebackshiny/NNNNs.png` | **96×96** | Recoloured variant |
| Icon | `pokedex/pokeicon/NNNN.png` | **64×32** | Two 32×32 frames side by side (bob animation) |
| Footprint | `pokedex/footprints/NNNN.png` | **16×16** | Silhouette only, solid dark on transparent |
| Overworld | `characters/NNNN.png` | **128×128** | 4×4 grid of 32×32 frames: 4 walk frames × 4 facings |

`NNNN` is the zero-padded dex id from each entry below. All files are **PNG with a real alpha
channel** (RGBA) — index-transparency will render with fringing.

All 194 slots currently hold the original placeholder art, so nothing breaks while you replace
them incrementally. Ship fronts first: that is what shows in battle, the dex, and Studio.

## 2. Shared style contract

Prepend this to every subject prompt so the roster reads as one art set:

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design
```

Negative prompt:

```text
photorealism, blurry, 3d render, anti-aliased soft edges, drop shadow on background, text, logo, trademark, watermark, signature, border, frame, existing copyrighted characters, human figures
```

**Keep designs original.** These are Stockmonsters, not reskinned existing creatures — the whole
point is a roster nobody else has. Prompts below describe original bodies built from what each
company actually does.

## 3. Per-sprite prompt suffixes

Generate the **front** first, then derive the rest from it so a creature stays on-model:

| Sprite | Append to the subject prompt |
|---|---|
| Front | `full body, facing viewer, 96x96 pixel canvas` |
| Back | `rear view of the same creature, same palette and proportions, 96x96 pixel canvas` |
| Shiny | `same creature, alternate colourway: shift hue 120-180 degrees, keep value structure identical` |
| Icon | `simplified chibi bust, readable at 32x32, chunky shapes, minimal detail` |
| Footprint | `solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail` |
| Overworld | `tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified` |

## 4. The roster

### 1. Applion

**AAPL** · Apple · type **Flora / Toxic** · dex id `0001`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a legendary cyber-lion whose mane is made of glowing blossom-petals of light, brushed-aluminium body plates, calm and regal, silver-white and soft gold
```

<sub>Files: `pokefront/0001.png` · `pokefrontshiny/0001s.png` · `pokeback/0001.png` · `pokebackshiny/0001s.png` · `pokeicon/0001.png` · `footprints/0001.png` · `characters/0001.png`</sub>

### 2. Optolisk

**AAOI** · Applied Optoelectronics · type **Flora / Toxic** · dex id `0002`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled fibre-optic serpent, body of braided glass strands, pulses of laser light running head to tail, cyan and black
```

<sub>Files: `pokefront/0002.png` · `pokefrontshiny/0002s.png` · `pokeback/0002.png` · `pokebackshiny/0002s.png` · `pokeicon/0002.png` · `footprints/0002.png` · `characters/0002.png`</sub>

### 3. Abcellyx

**ABCL** · Abcellera Biologics · type **Flora / Toxic** · dex id `0003`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an antibody-lynx, branching Y-shaped tail-forks that lock onto targets, clinical white and cyan
```

<sub>Files: `pokefront/0003.png` · `pokefrontshiny/0003s.png` · `pokeback/0003.png` · `pokebackshiny/0003s.png` · `pokeicon/0003.png` · `footprints/0003.png` · `characters/0003.png`</sub>

### 4. Nvidrake

**NVDA** · NVIDIA · type **Blaze** · dex id `0004`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a colossal technological dragon that feeds on computation, GPU-fin ridges glowing under load, green fire in its throat, black and acid green
```

<sub>Files: `pokefront/0004.png` · `pokefrontshiny/0004s.png` · `pokeback/0004.png` · `pokebackshiny/0004s.png` · `pokeicon/0004.png` · `footprints/0004.png` · `characters/0004.png`</sub>

### 5. Adobemoth

**ADBE** · Adobe · type **Blaze** · dex id `0005`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-winged creative moth, wing patterns shifting like layered artwork, gradient magenta and red
```

<sub>Files: `pokefront/0005.png` · `pokefrontshiny/0005s.png` · `pokeback/0005.png` · `pokebackshiny/0005s.png` · `pokeicon/0005.png` · `footprints/0005.png` · `characters/0005.png`</sub>

### 6. Aehrion

**AEHR** · Aehr · type **Blaze / Wind** · dex id `0006`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat burn-in furnace beetle, glowing test-socket eyes, heat-shimmer carapace, ember orange
```

<sub>Files: `pokefront/0006.png` · `pokefrontshiny/0006s.png` · `pokeback/0006.png` · `pokebackshiny/0006s.png` · `pokeicon/0006.png` · `footprints/0006.png` · `characters/0006.png`</sub>

### 7. Teslazar

**TSLA** · Tesla · type **Tide** · dex id `0007`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an electric kaiju that generates lightning when enraged, battery-cell spine, storm building around it, chrome red and white
```

<sub>Files: `pokefront/0007.png` · `pokefrontshiny/0007s.png` · `pokeback/0007.png` · `pokebackshiny/0007s.png` · `pokeicon/0007.png` · `footprints/0007.png` · `characters/0007.png`</sub>

### 8. Aegisurge

**AEIS** · Advanced Energy · type **Tide** · dex id `0008`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an armoured power-cell ram, spiral horns arcing with plasma, thick industrial plating, steel blue
```

<sub>Files: `pokefront/0008.png` · `pokefrontshiny/0008s.png` · `pokeback/0008.png` · `pokebackshiny/0008s.png` · `pokeicon/0008.png` · `footprints/0008.png` · `characters/0008.png`</sub>

### 9. Alabyrinth

**ALAB** · Astera Labs, Inc. · type **Tide** · dex id `0009`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a maze-shelled tortoise, interconnect traces winding across its back like a labyrinth, silver and violet
```

<sub>Files: `pokefront/0009.png` · `pokefrontshiny/0009s.png` · `pokeback/0009.png` · `pokebackshiny/0009s.png` · `pokeicon/0009.png` · `footprints/0009.png` · `characters/0009.png`</sub>

### 10. Amdeon

**AMD** · AMD · type **Swarm** · dex id `0010`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean four-winged raptor, red-hot core vents along its spine, forked tail like a heatsink, crimson and graphite
```

<sub>Files: `pokefront/0010.png` · `pokefrontshiny/0010s.png` · `pokeback/0010.png` · `pokebackshiny/0010s.png` · `pokeicon/0010.png` · `footprints/0010.png` · `characters/0010.png`</sub>

### 11. Amatherium

**AMAT** · Applied Materials · type **Swarm** · dex id `0011`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a many-armed deposition golem, each limb a coating nozzle, wafer-disc shoulders, matte grey and gold
```

<sub>Files: `pokefront/0011.png` · `pokefrontshiny/0011s.png` · `pokeback/0011.png` · `pokebackshiny/0011s.png` · `pokeicon/0011.png` · `footprints/0011.png` · `characters/0011.png`</sub>

### 12. Ambaraven

**AMBA** · Ambarella · type **Swarm / Wind** · dex id `0012`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lens-eyed owl, aperture irises that dilate, feathers of thin sensor film, dusk purple
```

<sub>Files: `pokefront/0012.png` · `pokefrontshiny/0012s.png` · `pokeback/0012.png` · `pokebackshiny/0012s.png` · `pokeicon/0012.png` · `footprints/0012.png` · `characters/0012.png`</sub>

### 13. Coinraith

**COIN** · Coinbase · type **Swarm / Toxic** · dex id `0013`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a spectral creature made of constantly shifting coins that grows stronger with speculation, no fixed body, ghostly blue and gold
```

<sub>Files: `pokefront/0013.png` · `pokefrontshiny/0013s.png` · `pokeback/0013.png` · `pokebackshiny/0013s.png` · `pokeicon/0013.png` · `footprints/0013.png` · `characters/0013.png`</sub>

### 14. Amcthulhu

**AMC** · AMC Entertainment · type **Swarm / Toxic** · dex id `0014`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a cinema-hall eldritch thing, curtain tentacles, projector eye, popcorn-stalactite maw, deep red
```

<sub>Files: `pokefront/0014.png` · `pokefrontshiny/0014s.png` · `pokeback/0014.png` · `pokebackshiny/0014s.png` · `pokeicon/0014.png` · `footprints/0014.png` · `characters/0014.png`</sub>

### 15. Amkorax

**AMKR** · Amkor Technology · type **Swarm / Toxic** · dex id `0015`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scarab with a packaged-chip shell, gold bond-wire legs, iridescent black
```

<sub>Files: `pokefront/0015.png` · `pokefrontshiny/0015s.png` · `pokeback/0015.png` · `pokebackshiny/0015s.png` · `pokeicon/0015.png` · `footprints/0015.png` · `characters/0015.png`</sub>

### 16. Metamorph

**META** · Meta Platforms · type **Neutral / Wind** · dex id `0016`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shapeshifter with no fixed face, mirror-mask cycling through borrowed identities, infinity-loop horns, deep blue
```

<sub>Files: `pokefront/0016.png` · `pokefrontshiny/0016s.png` · `pokeback/0016.png` · `pokebackshiny/0016s.png` · `pokeicon/0016.png` · `footprints/0016.png` · `characters/0016.png`</sub>

### 17. Anetheron

**ANET** · Arista · type **Neutral / Wind** · dex id `0017`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a switching heron, cables braided into plumage, routes anything through its beak, cobalt
```

<sub>Files: `pokefront/0017.png` · `pokefrontshiny/0017s.png` · `pokeback/0017.png` · `pokebackshiny/0017s.png` · `pokeicon/0017.png` · `footprints/0017.png` · `characters/0017.png`</sub>

### 18. Aplidra

**APLD** · Applied Digital · type **Neutral / Wind** · dex id `0018`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a data-centre hydra rising out of prairie ground, transformer-heads, dust and steel
```

<sub>Files: `pokefront/0018.png` · `pokefrontshiny/0018s.png` · `pokeback/0018.png` · `pokebackshiny/0018s.png` · `pokeicon/0018.png` · `footprints/0018.png` · `characters/0018.png`</sub>

### 19. Palantheon

**PLTR** · Palantir Technologies · type **Neutral** · dex id `0019`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a seeing-stone pantheon-idol, many eyes across a black monolith body, watches everything at once, obsidian and grey
```

<sub>Files: `pokefront/0019.png` · `pokefrontshiny/0019s.png` · `pokeback/0019.png` · `pokebackshiny/0019s.png` · `pokeicon/0019.png` · `footprints/0019.png` · `characters/0019.png`</sub>

### 20. Appallon

**APP** · AppLovin · type **Neutral** · dex id `0020`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a grinning ad-sprite with kaleidoscope eyes, tail made of impression counters, hot pink
```

<sub>Files: `pokefront/0020.png` · `pokefrontshiny/0020s.png` · `pokeback/0020.png` · `pokebackshiny/0020s.png` · `pokeicon/0020.png` · `footprints/0020.png` · `characters/0020.png`</sub>

### 21. Netflixis

**NFLX** · Netflix · type **Neutral / Wind** · dex id `0021`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a long serialised ibis, feathers like episode tiles, its tail never ends, red and black
```

<sub>Files: `pokefront/0021.png` · `pokefrontshiny/0021s.png` · `pokeback/0021.png` · `pokebackshiny/0021s.png` · `pokeicon/0021.png` · `footprints/0021.png` · `characters/0021.png`</sub>

### 22. Asmolith

**ASML** · ASML Holding NV · type **Neutral / Wind** · dex id `0022`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a monolithic standing sentinel, single slit-eye emitting extreme ultraviolet, mirror-polished obsidian body
```

<sub>Files: `pokefront/0022.png` · `pokefrontshiny/0022s.png` · `pokeback/0022.png` · `pokebackshiny/0022s.png` · `pokeicon/0022.png` · `footprints/0022.png` · `characters/0022.png`</sub>

### 23. Amazorgon

**AMZN** · Amazon · type **Toxic** · dex id `0023`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gigantic jungle serpent whose body contains warehouses and endless delivery roads, conveyor scales, smile-curve jaw, deep green and orange
```

<sub>Files: `pokefront/0023.png` · `pokefrontshiny/0023s.png` · `pokeback/0023.png` · `pokebackshiny/0023s.png` · `pokeicon/0023.png` · `footprints/0023.png` · `characters/0023.png`</sub>

### 24. Astraseraph

**ASTS** · AST SpaceMobile · type **Toxic** · dex id `0024`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a seraph of orbital arrays, unfolding panel-wings that block out the sun, white and gold
```

<sub>Files: `pokefront/0024.png` · `pokefrontshiny/0024s.png` · `pokeback/0024.png` · `pokebackshiny/0024s.png` · `pokeicon/0024.png` · `footprints/0024.png` · `characters/0024.png`</sub>

### 25. Auroryx

**AUR** · Aurora Innovation · type **Volt** · dex id `0025`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an autonomous-driving aurora wolf, lidar halo, drives itself, teal and violet
```

<sub>Files: `pokefront/0025.png` · `pokefrontshiny/0025s.png` · `pokeback/0025.png` · `pokebackshiny/0025s.png` · `pokeicon/0025.png` · `footprints/0025.png` · `characters/0025.png`</sub>

### 26. Avavulture

**AVAV** · AeroVironment · type **Volt** · dex id `0026`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drone-vulture, loitering wings, patient and unblinking, desert tan
```

<sub>Files: `pokefront/0026.png` · `pokefrontshiny/0026s.png` · `pokeback/0026.png` · `pokebackshiny/0026s.png` · `pokeicon/0026.png` · `footprints/0026.png` · `characters/0026.png`</sub>

### 27. Avgoliath

**AVGO** · Broadcom · type **Terra** · dex id `0027`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-shouldered goliath, chest a switching matrix, cables braided into a beard, deep red and slate
```

<sub>Files: `pokefront/0027.png` · `pokefrontshiny/0027s.png` · `pokeback/0027.png` · `pokebackshiny/0027s.png` · `pokeicon/0027.png` · `footprints/0027.png` · `characters/0027.png`</sub>

### 28. Axonyx

**AXON** · Axon · type **Terra** · dex id `0028`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a taser-lynx, arc between its horns, non-lethal but decisive, yellow and black
```

<sub>Files: `pokefront/0028.png` · `pokefrontshiny/0028s.png` · `pokeback/0028.png` · `pokebackshiny/0028s.png` · `pokeicon/0028.png` · `footprints/0028.png` · `characters/0028.png`</sub>

### 29. Axtiger

**AXTI** · AXT · type **Toxic** · dex id `0029`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a crystalline tiger, compound-semiconductor stripes that refract light, amber and indigo
```

<sub>Files: `pokefront/0029.png` · `pokefrontshiny/0029s.png` · `pokeback/0029.png` · `pokebackshiny/0029s.png` · `pokeicon/0029.png` · `footprints/0029.png` · `characters/0029.png`</sub>

### 30. Boewyrm

**BA** · Boeing · type **Toxic** · dex id `0030`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vast twin-aisle wyrm, fuselage body, swept wings, weathered white and blue
```

<sub>Files: `pokefront/0030.png` · `pokefrontshiny/0030s.png` · `pokeback/0030.png` · `pokebackshiny/0030s.png` · `pokeicon/0030.png` · `footprints/0030.png` · `characters/0030.png`</sub>

### 31. Babaroc

**BABA** · Alibaba · type **Toxic / Terra** · dex id `0031`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vast merchant roc, cargo-laden wings, carries an entire market on its back, orange
```

<sub>Files: `pokefront/0031.png` · `pokefrontshiny/0031s.png` · `pokeback/0031.png` · `pokebackshiny/0031s.png` · `pokeicon/0031.png` · `footprints/0031.png` · `characters/0031.png`</sub>

### 32. Blackbriar

**BB** · Blackberry · type **Toxic** · dex id `0032`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a black-thorn briar beast, keyboard-scale hide, security thorns, dark grey
```

<sub>Files: `pokefront/0032.png` · `pokefrontshiny/0032s.png` · `pokeback/0032.png` · `pokebackshiny/0032s.png` · `pokeicon/0032.png` · `footprints/0032.png` · `characters/0032.png`</sub>

### 33. Bloomkindle

**BE** · Bloom Energy · type **Toxic** · dex id `0033`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fuel-cell kindling-beast, stacked-cell ribs glowing warm, quiet flame, ember orange
```

<sub>Files: `pokefront/0033.png` · `pokefrontshiny/0033s.png` · `pokeback/0033.png` · `pokebackshiny/0033s.png` · `pokeicon/0033.png` · `footprints/0033.png` · `characters/0033.png`</sub>

### 34. Bondwarden

**BND** · Vanguard Total Bond Market ETF · type **Toxic / Terra** · dex id `0034`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a bond-warden tortoise, laddered-maturity shell, slow, dull and unkillable, muted brown
```

<sub>Files: `pokefront/0034.png` · `pokefrontshiny/0034s.png` · `pokeback/0034.png` · `pokebackshiny/0034s.png` · `pokeicon/0034.png` · `footprints/0034.png` · `characters/0034.png`</sub>

### 35. Bullwark

**BULL** · Webull · type **Fae** · dex id `0035`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a bulwark-bull, shield-shaped brow, plants itself and refuses to move, deep green
```

<sub>Files: `pokefront/0035.png` · `pokefrontshiny/0035s.png` · `pokeback/0035.png` · `pokebackshiny/0035s.png` · `pokeicon/0035.png` · `footprints/0035.png` · `characters/0035.png`</sub>

### 36. Cerebraxis

**CBRS** · Cerebras Systems · type **Fae** · dex id `0036`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vast brain-coral leviathan, wafer-scale folds across its hull, quiet blue bioluminescence
```

<sub>Files: `pokefront/0036.png` · `pokefrontshiny/0036s.png` · `pokeback/0036.png` · `pokebackshiny/0036s.png` · `pokeicon/0036.png` · `footprints/0036.png` · `characters/0036.png`</sub>

### 37. Googolem

**GOOGL** · Alphabet Class A · type **Blaze** · dex id `0037`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vast search-golem of stacked index-stone, glowing query-eye, moss of crawled data on its shoulders, primary-colour seams
```

<sub>Files: `pokefront/0037.png` · `pokefrontshiny/0037s.png` · `pokeback/0037.png` · `pokebackshiny/0037s.png` · `pokeicon/0037.png` · `footprints/0037.png` · `characters/0037.png`</sub>

### 38. Carnivyre

**CCL** · Carnival Corporation · type **Blaze** · dex id `0038`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a barnacled leviathan cruise-whale, deck-lights along its flank, ocean navy
```

<sub>Files: `pokefront/0038.png` · `pokefrontshiny/0038s.png` · `pokeback/0038.png` · `pokebackshiny/0038s.png` · `pokeicon/0038.png` · `footprints/0038.png` · `characters/0038.png`</sub>

### 39. Costaurus

**COST** · Costco · type **Neutral / Fae** · dex id `0039`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous bulk-hauling taurus, pallet-slab shoulders, membership-tag ring through its nose, red and navy
```

<sub>Files: `pokefront/0039.png` · `pokefrontshiny/0039s.png` · `pokeback/0039.png` · `pokebackshiny/0039s.png` · `pokeicon/0039.png` · `footprints/0039.png` · `characters/0039.png`</sub>

### 40. Constellyon

**CEG** · Constellation Energy · type **Neutral / Fae** · dex id `0040`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a constellation-lyon, reactor-core heart, star map across its pelt, deep blue and white
```

<sub>Files: `pokefront/0040.png` · `pokefrontshiny/0040s.png` · `pokeback/0040.png` · `pokebackshiny/0040s.png` · `pokeicon/0040.png` · `footprints/0040.png` · `characters/0040.png`</sub>

### 41. Microstryx

**MSTR** · Strategy Inc. · type **Toxic / Wind** · dex id `0041`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a hoarding stryx-owl perched on an enormous orange coin, leveraged wings, never sells, black and orange
```

<sub>Files: `pokefront/0041.png` · `pokefrontshiny/0041s.png` · `pokeback/0041.png` · `pokebackshiny/0041s.png` · `pokeicon/0041.png` · `footprints/0041.png` · `characters/0041.png`</sub>

### 42. Celsyrax

**CELH** · Celsius · type **Toxic / Wind** · dex id `0042`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a caffeinated sabre-hare, heartbeat visible through its chest, neon citrus
```

<sub>Files: `pokefront/0042.png` · `pokefrontshiny/0042s.png` · `pokeback/0042.png` · `pokebackshiny/0042s.png` · `pokeicon/0042.png` · `footprints/0042.png` · `characters/0042.png`</sub>

### 43. Cienath

**CIEN** · Ciena · type **Flora / Toxic** · dex id `0043`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a deep-sea cable serpent, transoceanic body, glowing at every repeater, abyss blue
```

<sub>Files: `pokefront/0043.png` · `pokefrontshiny/0043s.png` · `pokeback/0043.png` · `pokebackshiny/0043s.png` · `pokeicon/0043.png` · `footprints/0043.png` · `characters/0043.png`</sub>

### 44. Clovyre

**CLOV** · Clover Health Investments · type **Flora / Toxic** · dex id `0044`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a four-leaf clover-wyrm, insurance-luck motif, green
```

<sub>Files: `pokefront/0044.png` · `pokefrontshiny/0044s.png` · `pokeback/0044.png` · `pokebackshiny/0044s.png` · `pokeicon/0044.png` · `footprints/0044.png` · `characters/0044.png`</sub>

### 45. Celestrix

**CLS** · Celestica · type **Flora / Toxic** · dex id `0045`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stork-legged assembly heron, precision manipulator beak, clean-room white
```

<sub>Files: `pokefront/0045.png` · `pokefrontshiny/0045s.png` · `pokeback/0045.png` · `pokebackshiny/0045s.png` · `pokeicon/0045.png` · `footprints/0045.png` · `characters/0045.png`</sub>

### 46. Sparkraken

**CLSK** · CleanSpark · type **Swarm / Flora** · dex id `0046`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a spark-kraken, immersion-cooled tentacles, hash-rate lightning between its arms, teal and black
```

<sub>Files: `pokefront/0046.png` · `pokefrontshiny/0046s.png` · `pokeback/0046.png` · `pokebackshiny/0046s.png` · `pokeicon/0046.png` · `footprints/0046.png` · `characters/0046.png`</sub>

### 47. Cohryst

**COHR** · Coherent · type **Swarm / Flora** · dex id `0047`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a prism stag, antlers splitting light into spectra, coherent white beam between the tines
```

<sub>Files: `pokefront/0047.png` · `pokefrontshiny/0047s.png` · `pokeback/0047.png` · `pokebackshiny/0047s.png` · `pokeicon/0047.png` · `footprints/0047.png` · `characters/0047.png`</sub>

### 48. Microsoftus

**MSFT** · Microsoft · type **Swarm / Toxic** · dex id `0048`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a four-paned colossus, window-light shining from its chest, oldest and steadiest of the tech titans, azure and grey
```

<sub>Files: `pokefront/0048.png` · `pokefrontshiny/0048s.png` · `pokeback/0048.png` · `pokebackshiny/0048s.png` · `pokeicon/0048.png` · `footprints/0048.png` · `characters/0048.png`</sub>

### 49. Circulith

**CRCL** · Circle Internet Group · type **Swarm / Toxic** · dex id `0049`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a perfect ring-construct, stablecoin core that never wobbles, mint green and white
```

<sub>Files: `pokefront/0049.png` · `pokefrontshiny/0049s.png` · `pokeback/0049.png` · `pokebackshiny/0049s.png` · `pokeicon/0049.png` · `footprints/0049.png` · `characters/0049.png`</sub>

### 50. Credoryx

**CRDO** · Credo Technology Group · type **Terra** · dex id `0050`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a signal-serpent with a mirrored gorget, retimer scales that repeat its own pattern, teal
```

<sub>Files: `pokefront/0050.png` · `pokefrontshiny/0050s.png` · `pokeback/0050.png` · `pokebackshiny/0050s.png` · `pokeicon/0050.png` · `footprints/0050.png` · `characters/0050.png`</sub>

### 51. Salesphinx

**CRM** · Salesforce · type **Terra** · dex id `0051`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sphinx wreathed in customer-record scrolls, cloud mane, asks a question before it lets you pass, sky blue
```

<sub>Files: `pokefront/0051.png` · `pokefrontshiny/0051s.png` · `pokeback/0051.png` · `pokebackshiny/0051s.png` · `pokeicon/0051.png` · `footprints/0051.png` · `characters/0051.png`</sub>

### 52. Crowdstryker

**CRWD** · CrowdStrike Holdings · type **Neutral** · dex id `0052`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a spectral falcon that hunts intrusions, talons of white fire, crimson and smoke
```

<sub>Files: `pokefront/0052.png` · `pokefrontshiny/0052s.png` · `pokeback/0052.png` · `pokebackshiny/0052s.png` · `pokeicon/0052.png` · `footprints/0052.png` · `characters/0052.png`</sub>

### 53. Coreweaver

**CRWV** · CoreWeave · type **Neutral** · dex id `0053`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a spider weaving racks of GPUs into a web, cooling-mist body, violet
```

<sub>Files: `pokefront/0053.png` · `pokefrontshiny/0053s.png` · `pokeback/0053.png` · `pokebackshiny/0053s.png` · `pokeicon/0053.png` · `footprints/0053.png` · `characters/0053.png`</sub>

### 54. Ciscolossus

**CSCO** · Cisco Systems · type **Tide** · dex id `0054`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an ancient routing colossus, port-lined shoulders, moss growing on old infrastructure, teal and stone
```

<sub>Files: `pokefront/0054.png` · `pokefrontshiny/0054s.png` · `pokeback/0054.png` · `pokebackshiny/0054s.png` · `pokeicon/0054.png` · `footprints/0054.png` · `characters/0054.png`</sub>

### 55. Cognizarch

**CTSH** · Cognizant · type **Tide** · dex id `0055`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a many-handed advisory ogre, each hand holding a different process, plain grey
```

<sub>Files: `pokefront/0055.png` · `pokefrontshiny/0055s.png` · `pokeback/0055.png` · `pokebackshiny/0055s.png` · `pokeicon/0055.png` · `footprints/0055.png` · `characters/0055.png`</sub>

### 56. Carvanaught

**CVNA** · Carvana · type **Combat** · dex id `0056`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vending-machine juggernaut, cars stacked in its glass torso, tower-tall, sky blue
```

<sub>Files: `pokefront/0056.png` · `pokefrontshiny/0056s.png` · `pokeback/0056.png` · `pokebackshiny/0056s.png` · `pokeicon/0056.png` · `footprints/0056.png` · `characters/0056.png`</sub>

### 57. Datahound

**DDOG** · Datadog · type **Combat** · dex id `0057`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a loyal telemetry hound, dashboard-glow collar, three eyes for logs, metrics and traces, purple
```

<sub>Files: `pokefront/0057.png` · `pokefrontshiny/0057s.png` · `pokeback/0057.png` · `pokebackshiny/0057s.png` · `pokeicon/0057.png` · `footprints/0057.png` · `characters/0057.png`</sub>

### 58. Dellemental

**DELL** · Dell · type **Blaze** · dex id `0058`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a modular elemental made of stacked chassis, reassembles itself mid-fight, midnight blue
```

<sub>Files: `pokefront/0058.png` · `pokefrontshiny/0058s.png` · `pokeback/0058.png` · `pokebackshiny/0058s.png` · `pokeicon/0058.png` · `footprints/0058.png` · `characters/0058.png`</sub>

### 59. Djtitan

**DJT** · Trump Media & Technology Group · type **Blaze** · dex id `0059`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gilded broadcast titan, tower-crown, speaks only in all-caps, gold
```

<sub>Files: `pokefront/0059.png` · `pokefrontshiny/0059s.png` · `pokeback/0059.png` · `pokebackshiny/0059s.png` · `pokeicon/0059.png` · `footprints/0059.png` · `characters/0059.png`</sub>

### 60. Docnereid

**DOCN** · DigitalOcean · type **Tide** · dex id `0060`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a nereid of the developer sea, droplet-shaped, small and quick, ocean blue
```

<sub>Files: `pokefront/0060.png` · `pokefrontshiny/0060s.png` · `pokeback/0060.png` · `pokebackshiny/0060s.png` · `pokeicon/0060.png` · `footprints/0060.png` · `characters/0060.png`</sub>

### 61. Elfyre

**ELF** · e.l.f. Beauty · type **Tide** · dex id `0061`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a cosmetics sprite, pigment-swirl wings, changes colour on a whim, pastel
```

<sub>Files: `pokefront/0061.png` · `pokefrontshiny/0061s.png` · `pokeback/0061.png` · `pokebackshiny/0061s.png` · `pokeicon/0061.png` · `footprints/0061.png` · `characters/0061.png`</sub>

### 62. Formosaur

**EWT** · iShares MSCI Taiwan Capped ETF · type **Tide / Combat** · dex id `0062`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a formosa-saur, island-shaped shell, fabs terraced down its back, jade green
```

<sub>Files: `pokefront/0062.png` · `pokefrontshiny/0062s.png` · `pokeback/0062.png` · `pokebackshiny/0062s.png` · `pokeicon/0062.png` · `footprints/0062.png` · `characters/0062.png`</sub>

### 63. Hanguldra

**EWY** · iShares MSCI South Korea fund · type **Psionic** · dex id `0063`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a han-dragon of heavy industry, shipyard and memory-fab scales, deep red and steel
```

<sub>Files: `pokefront/0063.png` · `pokefrontshiny/0063s.png` · `pokeback/0063.png` · `pokebackshiny/0063s.png` · `pokeicon/0063.png` · `footprints/0063.png` · `characters/0063.png`</sub>

### 64. Fordrake

**F** · Ford Motor · type **Psionic** · dex id `0064`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an old blue work-drake, pickup-bed shoulders, dented and still running, oval blue
```

<sub>Files: `pokefront/0064.png` · `pokefrontshiny/0064s.png` · `pokeback/0064.png` · `pokebackshiny/0064s.png` · `pokeicon/0064.png` · `footprints/0064.png` · `characters/0064.png`</sub>

### 65. Ficolith

**FICO** · Fair Isaac · type **Psionic** · dex id `0065`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scoring monolith-sphinx, three-digit glyph burning on its forehead, judges everyone, grey
```

<sub>Files: `pokefront/0065.png` · `pokefrontshiny/0065s.png` · `pokeback/0065.png` · `pokebackshiny/0065s.png` · `pokeicon/0065.png` · `footprints/0065.png` · `characters/0065.png`</sub>

### 66. Figmaw

**FIG** · Figma · type **Combat** · dex id `0066`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a many-fingered design imp, vector-node joints, redraws its own outline constantly, multicolour
```

<sub>Files: `pokefront/0066.png` · `pokefrontshiny/0066s.png` · `pokeback/0066.png` · `pokebackshiny/0066s.png` · `pokeicon/0066.png` · `footprints/0066.png` · `characters/0066.png`</sub>

### 67. Fiservok

**FISV** · Fiserv · type **Combat** · dex id `0067`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a payment-rail crane, transaction-ledger wings, unglamorous and everywhere, orange
```

<sub>Files: `pokefront/0067.png` · `pokefrontshiny/0067s.png` · `pokeback/0067.png` · `pokebackshiny/0067s.png` · `pokeicon/0067.png` · `footprints/0067.png` · `characters/0067.png`</sub>

### 68. Fixarach

**FIX** · Comfort Systems · type **Combat** · dex id `0068`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an HVAC arachnid, duct-limbs threading through buildings, galvanised silver
```

<sub>Files: `pokefront/0068.png` · `pokefrontshiny/0068s.png` · `pokeback/0068.png` · `pokebackshiny/0068s.png` · `pokeicon/0068.png` · `footprints/0068.png` · `characters/0068.png`</sub>

### 69. Fluencer

**FLNC** · Fluence Energy · type **Flora / Toxic** · dex id `0069`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a storage-elemental made of battery racks, absorbs and releases surges, electric teal
```

<sub>Files: `pokefront/0069.png` · `pokefrontshiny/0069s.png` · `pokeback/0069.png` · `pokebackshiny/0069s.png` · `pokeicon/0069.png` · `footprints/0069.png` · `characters/0069.png`</sub>

### 70. Fireflyre

**FLY** · Firefly Aerospace Inc. · type **Flora / Toxic** · dex id `0070`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a firefly-drake, first-stage flame at its tail, small and fast off the pad, amber
```

<sub>Files: `pokefront/0070.png` · `pokefrontshiny/0070s.png` · `pokeback/0070.png` · `pokebackshiny/0070s.png` · `pokeicon/0070.png` · `footprints/0070.png` · `characters/0070.png`</sub>

### 71. Fortinaut

**FTNT** · Fortinet · type **Flora / Toxic** · dex id `0071`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fortress-shelled crab, firewall plating, claws that clamp shut on threats, red and steel
```

<sub>Files: `pokefront/0071.png` · `pokefrontshiny/0071s.png` · `pokeback/0071.png` · `pokebackshiny/0071s.png` · `pokeicon/0071.png` · `footprints/0071.png` · `characters/0071.png`</sub>

### 72. Futuros

**FUTU** · Futu Holdings · type **Tide / Toxic** · dex id `0072`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a brokerage kirin, order-book mane, moves faster than settlement, orange
```

<sub>Files: `pokefront/0072.png` · `pokefrontshiny/0072s.png` · `pokeback/0072.png` · `pokebackshiny/0072s.png` · `pokeicon/0072.png` · `footprints/0072.png` · `characters/0072.png`</sub>

### 73. Geleviathan

**GE** · General Electric · type **Tide / Toxic** · dex id `0073`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an old industrial leviathan, turbine-heart, jet-engine shoulders, weathered blue
```

<sub>Files: `pokefront/0073.png` · `pokefrontshiny/0073s.png` · `pokeback/0073.png` · `pokebackshiny/0073s.png` · `pokeicon/0073.png` · `footprints/0073.png` · `characters/0073.png`</sub>

### 74. Gevortex

**GEV** · GE Vernova · type **Stone / Terra** · dex id `0074`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vortex-winged turbine bird, three-blade wings, spins the sky, white and blue
```

<sub>Files: `pokefront/0074.png` · `pokefrontshiny/0074s.png` · `pokeback/0074.png` · `pokebackshiny/0074s.png` · `pokeicon/0074.png` · `footprints/0074.png` · `characters/0074.png`</sub>

### 75. Gildrake

**GLD** · SPDR Gold Trust · type **Stone / Terra** · dex id `0075`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gilded drake sleeping on a vault floor, solid gold scales, moves only in crises
```

<sub>Files: `pokefront/0075.png` · `pokefrontshiny/0075s.png` · `pokeback/0075.png` · `pokebackshiny/0075s.png` · `pokeicon/0075.png` · `footprints/0075.png` · `characters/0075.png`</sub>

### 76. Glasswyrm

**GLW** · Corning · type **Stone / Terra** · dex id `0076`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a glass-wyrm, gorilla-tough transparent scales, refracts every attack, clear and green
```

<sub>Files: `pokefront/0076.png` · `pokefrontshiny/0076s.png` · `pokeback/0076.png` · `pokebackshiny/0076s.png` · `pokeicon/0076.png` · `footprints/0076.png` · `characters/0076.png`</sub>

### 77. Galaxeon

**GLXY** · Galaxy Digital Inc. · type **Blaze** · dex id `0077`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a galaxy-serpent of crypto dust, star-field body, cosmic violet
```

<sub>Files: `pokefront/0077.png` · `pokefrontshiny/0077s.png` · `pokeback/0077.png` · `pokebackshiny/0077s.png` · `pokeicon/0077.png` · `footprints/0077.png` · `characters/0077.png`</sub>

### 78. Gmemeleon

**GME** · GameStop · type **Blaze** · dex id `0078`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a meme-chameleon whose power is set entirely by attention, cycles through every colour when watched, arcade-cabinet ridges
```

<sub>Files: `pokefront/0078.png` · `pokefrontshiny/0078s.png` · `pokeback/0078.png` · `pokebackshiny/0078s.png` · `pokeicon/0078.png` · `footprints/0078.png` · `characters/0078.png`</sub>

### 79. Hulliath

**HII** · Huntington Ingalls · type **Tide / Psionic** · dex id `0079`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shipyard-goliath, hull-plate shoulders, drags carriers behind it, sea grey
```

<sub>Files: `pokefront/0079.png` · `pokefrontshiny/0079s.png` · `pokeback/0079.png` · `pokebackshiny/0079s.png` · `pokeicon/0079.png` · `footprints/0079.png` · `characters/0079.png`</sub>

### 80. Himsalve

**HIMS** · Hims & Hers Health · type **Tide / Psionic** · dex id `0080`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a salve-serpent, telehealth caduceus markings, discreet and direct, sage green
```

<sub>Files: `pokefront/0080.png` · `pokefrontshiny/0080s.png` · `pokeback/0080.png` · `pokebackshiny/0080s.png` · `pokeicon/0080.png` · `footprints/0080.png` · `characters/0080.png`</sub>

### 81. Hpegasus

**HPE** · HP Enterprise · type **Volt / Alloy** · dex id `0081`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a winged enterprise pegasus, server-blade feathers, dependable and grey-green
```

<sub>Files: `pokefront/0081.png` · `pokefrontshiny/0081s.png` · `pokeback/0081.png` · `pokebackshiny/0081s.png` · `pokeicon/0081.png` · `footprints/0081.png` · `characters/0081.png`</sub>

### 82. Howmetheus

**HWM** · Howmet Aerospace · type **Volt / Alloy** · dex id `0082`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a forged-titanium giant, engineered joints, lightweight and unbreakable, bright metal
```

<sub>Files: `pokefront/0082.png` · `pokefrontshiny/0082s.png` · `pokeback/0082.png` · `pokebackshiny/0082s.png` · `pokeicon/0082.png` · `footprints/0082.png` · `characters/0082.png`</sub>

### 83. Ibmoloch

**IBM** · IBM · type **Neutral / Wind** · dex id `0083`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an ancient blue idol-titan, mainframe monolith torso, carved punchcard runes, deep blue
```

<sub>Files: `pokefront/0083.png` · `pokefrontshiny/0083s.png` · `pokeback/0083.png` · `pokebackshiny/0083s.png` · `pokeicon/0083.png` · `footprints/0083.png` · `characters/0083.png`</sub>

### 84. Ibrexis

**IBRX** · ImmunityBio, · type **Neutral / Wind** · dex id `0084`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an immune-system chimera, cell-cluster mane, turns the body against invaders, pale gold
```

<sub>Files: `pokefront/0084.png` · `pokefrontshiny/0084s.png` · `pokeback/0084.png` · `pokebackshiny/0084s.png` · `pokeicon/0084.png` · `footprints/0084.png` · `characters/0084.png`</sub>

### 85. Indavatar

**INDA** · iShares MSCI India ETF · type **Neutral / Wind** · dex id `0085`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an avatar-elephant of the subcontinent, many-armed, saffron and green
```

<sub>Files: `pokefront/0085.png` · `pokefrontshiny/0085s.png` · `pokeback/0085.png` · `pokebackshiny/0085s.png` · `pokeicon/0085.png` · `footprints/0085.png` · `characters/0085.png`</sub>

### 86. Inflequin

**INFQ** · Infleqtion · type **Tide** · dex id `0086`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a neutral-atom equine, lattice-trap mane, cold and precise, pale blue
```

<sub>Files: `pokefront/0086.png` · `pokefrontshiny/0086s.png` · `pokeback/0086.png` · `pokebackshiny/0086s.png` · `pokeicon/0086.png` · `footprints/0086.png` · `characters/0086.png`</sub>

### 87. Inodrone

**INOD** · Innodata · type **Tide / Frost** · dex id `0087`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a data-annotating drone-swarm that forms one bird shape, tagging everything it sees, white
```

<sub>Files: `pokefront/0087.png` · `pokefrontshiny/0087s.png` · `pokeback/0087.png` · `pokebackshiny/0087s.png` · `pokeicon/0087.png` · `footprints/0087.png` · `characters/0087.png`</sub>

### 88. Intelisk

**INTC** · Intel · type **Toxic** · dex id `0088`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an old blue basilisk, cracked fab-plate scales, dim but enormous, cobalt and rust
```

<sub>Files: `pokefront/0088.png` · `pokefrontshiny/0088s.png` · `pokeback/0088.png` · `pokebackshiny/0088s.png` · `pokeicon/0088.png` · `footprints/0088.png` · `characters/0088.png`</sub>

### 89. Intuivore

**INTU** · Intuit · type **Toxic** · dex id `0089`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a ledger-devouring toad, tongue that snatches receipts, swollen with tax season, green
```

<sub>Files: `pokefront/0089.png` · `pokefrontshiny/0089s.png` · `pokeback/0089.png` · `pokebackshiny/0089s.png` · `pokeicon/0089.png` · `footprints/0089.png` · `characters/0089.png`</sub>

### 90. Ionquark

**IONQ** · IonQ · type **Tide** · dex id `0090`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a trapped-ion quark-moth, particles suspended in its wing-lattice, laser-cooled, violet and white
```

<sub>Files: `pokefront/0090.png` · `pokefrontshiny/0090s.png` · `pokeback/0090.png` · `pokebackshiny/0090s.png` · `pokeicon/0090.png` · `footprints/0090.png` · `characters/0090.png`</sub>

### 91. Irendra

**IREN** · IREN Limited · type **Tide / Frost** · dex id `0091`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a hydro-cooled mining hydra, immersion-tank body, three cold heads, glacier blue
```

<sub>Files: `pokefront/0091.png` · `pokefrontshiny/0091s.png` · `pokeback/0091.png` · `pokebackshiny/0091s.png` · `pokeicon/0091.png` · `footprints/0091.png` · `characters/0091.png`</sub>

### 92. Jabilisk

**JBL** · Jabil Inc. · type **Spectre / Toxic** · dex id `0092`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a workhorse pack-mule automaton, modular crates bolted to its frame, utilitarian olive
```

<sub>Files: `pokefront/0092.png` · `pokefrontshiny/0092s.png` · `pokeback/0092.png` · `pokebackshiny/0092s.png` · `pokeicon/0092.png` · `footprints/0092.png` · `characters/0092.png`</sub>

### 93. Johnsonyx

**JNJ** · Johnson & Johnson · type **Spectre / Toxic** · dex id `0093`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a many-armed apothecary golem, bandage wrappings, panacea vial heart, red and white
```

<sub>Files: `pokefront/0093.png` · `pokefrontshiny/0093s.png` · `pokeback/0093.png` · `pokebackshiny/0093s.png` · `pokeicon/0093.png` · `footprints/0093.png` · `characters/0093.png`</sub>

### 94. Jobyrd

**JOBY** · Joby Aviation · type **Spectre / Toxic** · dex id `0094`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an eVTOL bird, six rotor-plumes, near-silent flight, white and blue
```

<sub>Files: `pokefront/0094.png` · `pokefrontshiny/0094s.png` · `pokeback/0094.png` · `pokebackshiny/0094s.png` · `pokeicon/0094.png` · `footprints/0094.png` · `characters/0094.png`</sub>

### 95. Klacolyth

**KLAC** · KLA · type **Stone / Terra** · dex id `0095`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scanning lynx, grid-pupil eyes that sweep for defects, hairline-thin whiskers, pale gold
```

<sub>Files: `pokefront/0095.png` · `pokefrontshiny/0095s.png` · `pokeback/0095.png` · `pokebackshiny/0095s.png` · `pokeicon/0095.png` · `footprints/0095.png` · `characters/0095.png`</sub>

### 96. Kohlossus

**KSS** · Kohls Corporation · type **Psionic** · dex id `0096`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a colossus of department-store floors, perpetual discount banners for a mane, faded gold
```

<sub>Files: `pokefront/0096.png` · `pokefrontshiny/0096s.png` · `pokeback/0096.png` · `pokebackshiny/0096s.png` · `pokeicon/0096.png` · `footprints/0096.png` · `characters/0096.png`</sub>

### 97. Kratossus

**KTOS** · Kratos Defense & Security Solutions · type **Psionic** · dex id `0097`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a target-drone colossus, expendable but relentless, matte grey
```

<sub>Files: `pokefront/0097.png` · `pokefrontshiny/0097s.png` · `pokeback/0097.png` · `pokebackshiny/0097s.png` · `pokeicon/0097.png` · `footprints/0097.png` · `characters/0097.png`</sub>

### 98. Harrixen

**LHX** · L3Harris · type **Tide** · dex id `0098`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a comms-raptor, encrypted-signal crest, hears everything, dark blue
```

<sub>Files: `pokefront/0098.png` · `pokefrontshiny/0098s.png` · `pokeback/0098.png` · `pokebackshiny/0098s.png` · `pokeicon/0098.png` · `footprints/0098.png` · `characters/0098.png`</sub>

### 99. Lumenthra

**LITE** · Lumentum · type **Tide** · dex id `0099`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lantern-jelly, transceiver bells pulsing in sequence, drifting fibre tendrils, luminous green
```

<sub>Files: `pokefront/0099.png` · `pokefrontshiny/0099s.png` · `pokeback/0099.png` · `pokebackshiny/0099s.png` · `pokeicon/0099.png` · `footprints/0099.png` · `characters/0099.png`</sub>

### 100. Llyxir

**LLY** · Eli Lilly · type **Volt** · dex id `0100`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elixir-drake, metabolic vial coiled in its chest, slims and heals, warm red
```

<sub>Files: `pokefront/0100.png` · `pokefrontshiny/0100s.png` · `pokeback/0100.png` · `pokebackshiny/0100s.png` · `pokeicon/0100.png` · `footprints/0100.png` · `characters/0100.png`</sub>

### 101. Lockheedra

**LMT** · Lockheed · type **Volt** · dex id `0101`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stealth-hydra, faceted radar-absorbing plates, low observable, charcoal
```

<sub>Files: `pokefront/0101.png` · `pokefrontshiny/0101s.png` · `pokeback/0101.png` · `pokebackshiny/0101s.png` · `pokeicon/0101.png` · `footprints/0101.png` · `characters/0101.png`</sub>

### 102. Lrcyclops

**LRCX** · Lam Research Corp · type **Flora / Psionic** · dex id `0102`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a one-eyed etching cyclops, plasma-jet fist, plating scarred by its own work, dull violet
```

<sub>Files: `pokefront/0102.png` · `pokefrontshiny/0102s.png` · `pokeback/0102.png` · `pokebackshiny/0102s.png` · `pokeicon/0102.png` · `footprints/0102.png` · `characters/0102.png`</sub>

### 103. Lululyth

**LULU** · Lululemon · type **Flora / Psionic** · dex id `0103`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lithe stretching lynx, athletic-weave fur, impossible flexibility, seafoam
```

<sub>Files: `pokefront/0103.png` · `pokefrontshiny/0103s.png` · `pokeback/0103.png` · `pokebackshiny/0103s.png` · `pokeicon/0103.png` · `footprints/0103.png` · `characters/0103.png`</sub>

### 104. Lunarch

**LUNR** · Intuitive Machines · type **Terra** · dex id `0104`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lunar monarch, regolith-dust mane, lands where nothing else can, ash grey and gold
```

<sub>Files: `pokefront/0104.png` · `pokefrontshiny/0104s.png` · `pokeback/0104.png` · `pokebackshiny/0104s.png` · `pokeicon/0104.png` · `footprints/0104.png` · `characters/0104.png`</sub>

### 105. Mongodrake

**MDB** · MongoDB · type **Terra** · dex id `0105`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a document-drake coiled around a green leaf-shaped hoard, flexible spineless body
```

<sub>Files: `pokefront/0105.png` · `pokefrontshiny/0105s.png` · `pokeback/0105.png` · `pokebackshiny/0105s.png` · `pokeicon/0105.png` · `footprints/0105.png` · `characters/0105.png`</sub>

### 106. Modrake

**MOD** · Modine · type **Combat** · dex id `0106`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a heat-exchange drake, radiator-fin frill, breathes cool instead of fire, copper and green
```

<sub>Files: `pokefront/0106.png` · `pokefrontshiny/0106s.png` · `pokeback/0106.png` · `pokebackshiny/0106s.png` · `pokeicon/0106.png` · `footprints/0106.png` · `characters/0106.png`</sub>

### 114. Monolithan

**MPWR** · Monolithic Power Systems · type **Flora** · dex id `0114`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact monolith badger, single-block body, dense and unsplittable, dark bronze
```

<sub>Files: `pokefront/0114.png` · `pokefrontshiny/0114s.png` · `pokeback/0114.png` · `pokebackshiny/0114s.png` · `pokeicon/0114.png` · `footprints/0114.png` · `characters/0114.png`</sub>

### 123. Modernyx

**MRNA** · Moderna · type **Swarm / Wind** · dex id `0123`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a messenger-serpent of coiled mRNA, instruction-strand body, rewrites what it touches, red and white
```

<sub>Files: `pokefront/0123.png` · `pokefrontshiny/0123s.png` · `pokeback/0123.png` · `pokebackshiny/0123s.png` · `pokeicon/0123.png` · `footprints/0123.png` · `characters/0123.png`</sub>

### 129. Marvellon

**MRVL** · Marvell Technology · type **Tide** · dex id `0129`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a storage-drake with a spiralling data-tail, controller runes on its flanks, sea green
```

<sub>Files: `pokefront/0129.png` · `pokefrontshiny/0129s.png` · `pokeback/0129.png` · `pokebackshiny/0129s.png` · `pokeicon/0129.png` · `footprints/0129.png` · `characters/0129.png`</sub>

### 130. Mtsiren

**MTSI** · MACOM · type **Tide / Wind** · dex id `0130`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a radio-wave siren, dish-shaped collar, microwave ripples where it sings, muted copper
```

<sub>Files: `pokefront/0130.png` · `pokefrontshiny/0130s.png` · `pokeback/0130.png` · `pokebackshiny/0130s.png` · `pokeicon/0130.png` · `footprints/0130.png` · `characters/0130.png`</sub>

### 131. Micronoth

**MU** · Micron Technology · type **Tide / Frost** · dex id `0131`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a memory-cell mammoth, hexagonal DRAM tusks, dense layered hide, industrial green
```

<sub>Files: `pokefront/0131.png` · `pokefrontshiny/0131s.png` · `pokeback/0131.png` · `pokebackshiny/0131s.png` · `pokeicon/0131.png` · `footprints/0131.png` · `characters/0131.png`</sub>

### 147. Maxlinyx

**MXL** · MaxLinear · type **Wyrm** · dex id `0147`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a whip-thin broadband eel, signal fins, amplifies anything it touches, electric yellow
```

<sub>Files: `pokefront/0147.png` · `pokefrontshiny/0147s.png` · `pokeback/0147.png` · `pokebackshiny/0147s.png` · `pokeicon/0147.png` · `footprints/0147.png` · `characters/0147.png`</sub>

### 149. Navnomad

**NAVN** · Navan · type **Wyrm / Wind** · dex id `0149`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a nomadic travel-sprite, itinerary wings, always in transit, sky blue
```

<sub>Files: `pokefront/0149.png` · `pokefrontshiny/0149s.png` · `pokeback/0149.png` · `pokebackshiny/0149s.png` · `pokeicon/0149.png` · `footprints/0149.png` · `characters/0149.png`</sub>

### 154. Nebulisk

**NBIS** · Nebius Group · type **Flora** · dex id `0154`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a nebula-basilisk, GPU-cluster coils, born from an older empire, deep violet
```

<sub>Files: `pokefront/0154.png` · `pokefrontshiny/0154s.png` · `pokeback/0154.png` · `pokebackshiny/0154s.png` · `pokeicon/0154.png` · `footprints/0154.png` · `characters/0154.png`</sub>

### 166. Netcumulus

**NET** · Cloudflare · type **Swarm / Wind** · dex id `0166`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a cumulus wolf, body of edge-cloud vapour, sits between traffic and harm, orange and white
```

<sub>Files: `pokefront/0166.png` · `pokefrontshiny/0166s.png` · `pokeback/0166.png` · `pokebackshiny/0166s.png` · `pokeicon/0166.png` · `footprints/0166.png` · `characters/0166.png`</sub>

### 168. Nanonuke

**NNE** · Nano Nuclear Energy · type **Swarm / Toxic** · dex id `0168`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small nuclear cub, containment-shell body, dangerous potential in a compact frame, yellow-green
```

<sub>Files: `pokefront/0168.png` · `pokefrontshiny/0168s.png` · `pokeback/0168.png` · `pokebackshiny/0168s.png` · `pokeicon/0168.png` · `footprints/0168.png` · `characters/0168.png`</sub>

### 170. Nowarden

**NOW** · ServiceNow · type **Tide / Volt** · dex id `0170`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a workflow golem of interlocking ticket-plates, moves only when a process advances, green
```

<sub>Files: `pokefront/0170.png` · `pokefrontshiny/0170s.png` · `pokeback/0170.png` · `pokebackshiny/0170s.png` · `pokeicon/0170.png` · `footprints/0170.png` · `characters/0170.png`</sub>

### 171. Nuvora

**NU** · Nu · type **Tide / Volt** · dex id `0171`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a violet jungle cat of the digital bank, sleek and regional, purple
```

<sub>Files: `pokefront/0171.png` · `pokefrontshiny/0171s.png` · `pokeback/0171.png` · `pokebackshiny/0171s.png` · `pokeicon/0171.png` · `footprints/0171.png` · `characters/0171.png`</sub>

### 181. Navitusk

**NVTS** · Navitas Semiconductor · type **Volt** · dex id `0181`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gallium-nitride boar, tusks arcing with fast-switching current, compact and violent, pale jade
```

<sub>Files: `pokefront/0181.png` · `pokefrontshiny/0181s.png` · `pokeback/0181.png` · `pokebackshiny/0181s.png` · `pokeicon/0181.png` · `footprints/0181.png` · `characters/0181.png`</sub>

### 183. Oklonyx

**OKLO** · Oklo · type **Tide / Fae** · dex id `0183`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fast-reactor fox, tail of spent-fuel fire, sleek and controversial, orange-black
```

<sub>Files: `pokefront/0183.png` · `pokefrontshiny/0183s.png` · `pokeback/0183.png` · `pokebackshiny/0183s.png` · `pokeicon/0183.png` · `footprints/0183.png` · `characters/0183.png`</sub>

### 193. Onyxide

**ON** · ON Semiconductor · type **Swarm / Wind** · dex id `0193`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a night-black panther, power-transistor spots that flicker on and off, matte obsidian
```

<sub>Files: `pokefront/0193.png` · `pokefrontshiny/0193s.png` · `pokeback/0193.png` · `pokebackshiny/0193s.png` · `pokeicon/0193.png` · `footprints/0193.png` · `characters/0193.png`</sub>

### 215. Ontolith

**ONTO** · Onto Innovation · type **Shadow / Frost** · dex id `0215`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a metrology moth, wings patterned like inspection interferograms, iridescent silver
```

<sub>Files: `pokefront/0215.png` · `pokefrontshiny/0215s.png` · `pokeback/0215.png` · `pokebackshiny/0215s.png` · `pokeicon/0215.png` · `footprints/0215.png` · `characters/0215.png`</sub>

### 223. Oraclysm

**ORCL** · Oracle · type **Tide** · dex id `0223`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a cataclysm-oracle, database-tablet halo, speaks in queries, blood red and black
```

<sub>Files: `pokefront/0223.png` · `pokefrontshiny/0223s.png` · `pokeback/0223.png` · `pokebackshiny/0223s.png` · `pokeicon/0223.png` · `footprints/0223.png` · `characters/0223.png`</sub>

### 246. Oustrider

**OUST** · Ouster · type **Stone / Terra** · dex id `0246`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lidar-owl, spinning sensor crown, sees in point clouds, deep blue
```

<sub>Files: `pokefront/0246.png` · `pokefrontshiny/0246s.png` · `pokeback/0246.png` · `pokebackshiny/0246s.png` · `pokeicon/0246.png` · `footprints/0246.png` · `characters/0246.png`</sub>

### 253. Purion

**P** · Everpure · type **Flora** · dex id `0253`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a purified water-spirit, absolutely clear body, filters whatever passes through, pale cyan
```

<sub>Files: `pokefront/0253.png` · `pokefrontshiny/0253s.png` · `pokeback/0253.png` · `pokebackshiny/0253s.png` · `pokeicon/0253.png` · `footprints/0253.png` · `characters/0253.png`</sub>

### 270. Panwarden

**PANW** · Palo Alto Networks · type **Tide / Flora** · dex id `0270`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a firewall warden, gate-shaped shield, unblinking inspection eye, dark orange
```

<sub>Files: `pokefront/0270.png` · `pokefrontshiny/0270s.png` · `pokeback/0270.png` · `pokebackshiny/0270s.png` · `pokeicon/0270.png` · `footprints/0270.png` · `characters/0270.png`</sub>

### 271. Pathyrion

**PATH** · UiPath · type **Tide / Flora** · dex id `0271`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a many-limbed automation golem, repeats one motion perfectly forever, orange
```

<sub>Files: `pokefront/0271.png` · `pokefrontshiny/0271s.png` · `pokeback/0271.png` · `pokebackshiny/0271s.png` · `pokeicon/0271.png` · `footprints/0271.png` · `characters/0271.png`</sub>

### 272. Pengulith

**PENG** · Penguin Solutions · type **Tide / Flora** · dex id `0272`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an armoured penguin engineer, memory-module chestplate, waddling but immovable, ice blue
```

<sub>Files: `pokefront/0272.png` · `pokefrontshiny/0272s.png` · `pokeback/0272.png` · `pokebackshiny/0272s.png` · `pokeicon/0272.png` · `footprints/0272.png` · `characters/0272.png`</sub>

### 280. Pfyre

**PFE** · Pfizer · type **Psionic / Fae** · dex id `0280`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a blue pill-golem, capsule-segment body, ubiquitous and unglamorous, cobalt
```

<sub>Files: `pokefront/0280.png` · `pokefrontshiny/0280s.png` · `pokeback/0280.png` · `pokebackshiny/0280s.png` · `pokeicon/0280.png` · `footprints/0280.png` · `characters/0280.png`</sub>

### 298. Planetheon

**PL** · Planet Labs · type **Neutral / Fae** · dex id `0298`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a pantheon of imaging satellites in one bird-shape, photographs the whole world daily, white
```

<sub>Files: `pokefront/0298.png` · `pokefrontshiny/0298s.png` · `pokeback/0298.png` · `pokebackshiny/0298s.png` · `pokeicon/0298.png` · `footprints/0298.png` · `characters/0298.png`</sub>

### 328. Poetheon

**POET** · POET Technologies · type **Terra** · dex id `0328`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a photonic hummingbird, wings of etched waveguide, hovers in a halo of light, opal
```

<sub>Files: `pokefront/0328.png` · `pokefrontshiny/0328s.png` · `pokeback/0328.png` · `pokebackshiny/0328s.png` · `pokeicon/0328.png` · `footprints/0328.png` · `characters/0328.png`</sub>

### 330. Powlvolt

**POWL** · Powell Industries · type **Terra / Wyrm** · dex id `0330`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a switchgear rhino, breaker-plate hide, charges and cannot be stopped mid-arc, industrial yellow
```

<sub>Files: `pokefront/0330.png` · `pokefrontshiny/0330s.png` · `pokeback/0330.png` · `pokebackshiny/0330s.png` · `pokeicon/0330.png` · `footprints/0330.png` · `characters/0330.png`</sub>

### 335. Permyre

**PR** · Permian Resources · type **Neutral** · dex id `0335`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shale-burrowing wyrm of the Permian, rock-dust hide, crude-black sheen
```

<sub>Files: `pokefront/0335.png` · `pokefrontshiny/0335s.png` · `pokeback/0335.png` · `pokebackshiny/0335s.png` · `pokeicon/0335.png` · `footprints/0335.png` · `characters/0335.png`</sub>

### 336. Quantasurge

**PWR** · Quanta · type **Toxic** · dex id `0336`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lineworker colossus, transmission-tower limbs, strings power across the horizon, safety orange
```

<sub>Files: `pokefront/0336.png` · `pokefrontshiny/0336s.png` · `pokeback/0336.png` · `pokebackshiny/0336s.png` · `pokeicon/0336.png` · `footprints/0336.png` · `characters/0336.png`</sub>

### 339. Qubitwyrm

**QBTS** · D-Wave Quantum Inc. Common Stock · type **Tide / Terra** · dex id `0339`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an annealing wyrm, superconducting coil body, settles into the lowest-energy shape, chrome and blue
```

<sub>Files: `pokefront/0339.png` · `pokefrontshiny/0339s.png` · `pokeback/0339.png` · `pokebackshiny/0339s.png` · `pokeicon/0339.png` · `footprints/0339.png` · `characters/0339.png`</sub>

### 340. Qcomet

**QCOM** · Qualcomm · type **Tide / Terra** · dex id `0340`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a comet-tailed lynx, modem whiskers trailing signal, streaks of blue fire
```

<sub>Files: `pokefront/0340.png` · `pokefrontshiny/0340s.png` · `pokeback/0340.png` · `pokebackshiny/0340s.png` · `pokeicon/0340.png` · `footprints/0340.png` · `characters/0340.png`</sub>

### 350. Nasdrake

**QQQ** · Invesco QQQ · type **Tide** · dex id `0350`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a nasdaq-drake with a hundred wings, each wing a different tech company, iridescent
```

<sub>Files: `pokefront/0350.png` · `pokefrontshiny/0350s.png` · `pokeback/0350.png` · `pokebackshiny/0350s.png` · `pokeicon/0350.png` · `footprints/0350.png` · `characters/0350.png`</sub>

### 361. Qubitron

**QUBT** · Quantum Computing · type **Frost** · dex id `0361`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a photonic qubit sprite, exists in two poses at once, shimmering teal
```

<sub>Files: `pokefront/0361.png` · `pokefrontshiny/0361s.png` · `pokeback/0361.png` · `pokebackshiny/0361s.png` · `pokeicon/0361.png` · `footprints/0361.png` · `characters/0361.png`</sub>

### 380. Robloxis

**RBLX** · Roblox · type **Wyrm / Psionic** · dex id `0380`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a blocky construct that rebuilds itself from primitive shapes, child-simple and endless, red and grey
```

<sub>Files: `pokefront/0380.png` · `pokefrontshiny/0380s.png` · `pokeback/0380.png` · `pokebackshiny/0380s.png` · `pokeicon/0380.png` · `footprints/0380.png` · `characters/0380.png`</sub>

### 381. Rcatamount

**RCAT** · Red Cat · type **Wyrm / Psionic** · dex id `0381`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a red drone-catamount, quadrotor whiskers, small predator of the sky, crimson
```

<sub>Files: `pokefront/0381.png` · `pokefrontshiny/0381s.png` · `pokeback/0381.png` · `pokebackshiny/0381s.png` · `pokeicon/0381.png` · `footprints/0381.png` · `characters/0381.png`</sub>

### 418. Rddtroll

**RDDT** · Reddit · type **Tide** · dex id `0418`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a many-mouthed cave troll, upvote-arrow horns, gets stronger the more it is argued with, orange-red
```

<sub>Files: `pokefront/0418.png` · `pokefrontshiny/0418s.png` · `pokeback/0418.png` · `pokebackshiny/0418s.png` · `pokeicon/0418.png` · `footprints/0418.png` · `characters/0418.png`</sub>

### 419. Redwyrm

**RDW** · Redwire · type **Tide** · dex id `0419`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a red-wire construct, in-space assembly arms, builds itself in orbit, rust red
```

<sub>Files: `pokefront/0419.png` · `pokefrontshiny/0419s.png` · `pokeback/0419.png` · `pokebackshiny/0419s.png` · `pokeicon/0419.png` · `footprints/0419.png` · `characters/0419.png`</sub>

### 422. Rigetyphon

**RGTI** · Rigetti Computing · type **Tide** · dex id `0422`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a superconducting typhon, chandelier-cryostat body hanging in cold, gold and frost
```

<sub>Files: `pokefront/0422.png` · `pokefrontshiny/0422s.png` · `pokeback/0422.png` · `pokebackshiny/0422s.png` · `pokeicon/0422.png` · `footprints/0422.png` · `characters/0422.png`</sub>

### 423. Rivyathan

**RIVN** · Rivian Automotive · type **Tide / Terra** · dex id `0423`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a leviathan of the wilderness, adventure-rack ridges, quad-motor limbs, forest green and yellow
```

<sub>Files: `pokefront/0423.png` · `pokefrontshiny/0423s.png` · `pokeback/0423.png` · `pokebackshiny/0423s.png` · `pokeicon/0423.png` · `footprints/0423.png` · `characters/0423.png`</sub>

### 436. Rocketyr

**RKLB** · Rocket Lab Corporation · type **Alloy / Psionic** · dex id `0436`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender launch-tyr, electron-engine heart, black carbon body with a bright plume
```

<sub>Files: `pokefront/0436.png` · `pokefrontshiny/0436s.png` · `pokeback/0436.png` · `pokebackshiny/0436s.png` · `pokeicon/0436.png` · `footprints/0436.png` · `characters/0436.png`</sub>

### 451. Sunrunner

**RUN** · Sunrun · type **Toxic / Swarm** · dex id `0451`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a solar stag, panel-antlers tracking the sun, warms the ground it stands on, gold
```

<sub>Files: `pokefront/0451.png` · `pokefrontshiny/0451s.png` · `pokeback/0451.png` · `pokebackshiny/0451s.png` · `pokeicon/0451.png` · `footprints/0451.png` · `characters/0451.png`</sub>

### 453. Echosatyr

**SATS** · EchoStar · type **Toxic / Combat** · dex id `0453`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an echo-satyr, orbital-slot antlers, repeats whatever it hears back at you, pale blue
```

<sub>Files: `pokefront/0453.png` · `pokefrontshiny/0453s.png` · `pokeback/0453.png` · `pokebackshiny/0453s.png` · `pokeicon/0453.png` · `footprints/0453.png` · `characters/0453.png`</sub>

### 454. Dividrake

**SCHD** · Schwab US Dividend Equity ETF · type **Toxic / Combat** · dex id `0454`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a dividend-drake that sheds a golden scale every quarter, patient and unflashy, bronze
```

<sub>Files: `pokefront/0454.png` · `pokefrontshiny/0454s.png` · `pokeback/0454.png` · `pokebackshiny/0454s.png` · `pokeicon/0454.png` · `footprints/0454.png` · `characters/0454.png`</sub>

### 455. Sgovault

**SGOV** · iShares 0-3 Month Treasury Bond · type **Flora** · dex id `0455`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a vault-golem holding short-dated paper, absolutely inert, concrete grey
```

<sub>Files: `pokefront/0455.png` · `pokefrontshiny/0455s.png` · `pokeback/0455.png` · `pokebackshiny/0455s.png` · `pokeicon/0455.png` · `footprints/0455.png` · `characters/0455.png`</sub>

### 456. Shopifyre

**SHOP** · Shopify · type **Tide** · dex id `0456`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a merchant phoenix, storefront-plumage, rebuilds a shop wherever it lands, green and violet
```

<sub>Files: `pokefront/0456.png` · `pokefrontshiny/0456s.png` · `pokeback/0456.png` · `pokebackshiny/0456s.png` · `pokeicon/0456.png` · `footprints/0456.png` · `characters/0456.png`</sub>

### 459. Shyren

**SHY** · iShares 1-3 Year Treasury Bond ETF · type **Flora / Frost** · dex id `0459`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shy treasury-siren, hides at the shallow end of the curve, pale blue
```

<sub>Files: `pokefront/0459.png` · `pokefrontshiny/0459s.png` · `pokeback/0459.png` · `pokebackshiny/0459s.png` · `pokeicon/0459.png` · `footprints/0459.png` · `characters/0459.png`</sub>

### 460. Simotion

**SIMO** · Silicon Motion · type **Flora / Frost** · dex id `0460`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a controller-fox, nine tails each a flash channel, quick and neat, amber
```

<sub>Files: `pokefront/0460.png` · `pokefrontshiny/0460s.png` · `pokeback/0460.png` · `pokebackshiny/0460s.png` · `pokeicon/0460.png` · `footprints/0460.png` · `characters/0460.png`</sub>

### 465. Skhydra

**SKHY** · SK hynix Inc. American Depositary Shares · type **Flora** · dex id `0465`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a nine-headed memory hydra, each head a stacked HBM tower, ceramic white and blue
```

<sub>Files: `pokefront/0465.png` · `pokefrontshiny/0465s.png` · `pokeback/0465.png` · `pokebackshiny/0465s.png` · `pokeicon/0465.png` · `footprints/0465.png` · `characters/0465.png`</sub>

### 469. Slserum

**SLS** · SELLAS Life Sciences · type **Swarm / Wind** · dex id `0469`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small clinical-trial sprite, hope-flicker core, fragile odds, pale green
```

<sub>Files: `pokefront/0469.png` · `pokefrontshiny/0469s.png` · `pokeback/0469.png` · `pokebackshiny/0469s.png` · `pokeicon/0469.png` · `footprints/0469.png` · `characters/0469.png`</sub>

### 475. Silvyrm

**SLV** · iShares Silver Trust · type **Psionic / Combat** · dex id `0475`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a silver wyrm, mirror-bright scales, industrial and monetary at once
```

<sub>Files: `pokefront/0475.png` · `pokefrontshiny/0475s.png` · `pokeback/0475.png` · `pokebackshiny/0475s.png` · `pokeicon/0475.png` · `footprints/0475.png` · `characters/0475.png`</sub>

### 497. Smcimera

**SMCI** · Super Micro Computer · type **Flora** · dex id `0497`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chimera of server racks, mismatched limbs from different machines, cooling fans for eyes, steel and green
```

<sub>Files: `pokefront/0497.png` · `pokefrontshiny/0497s.png` · `pokeback/0497.png` · `pokebackshiny/0497s.png` · `pokeicon/0497.png` · `footprints/0497.png` · `characters/0497.png`</sub>

### 524. Smhelix

**SMH** · VanEck Semiconductor ETF · type **Stone** · dex id `0524`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a helix-serpent of the whole semiconductor cycle, boom and bust coiled together, chrome
```

<sub>Files: `pokefront/0524.png` · `pokefrontshiny/0524s.png` · `pokeback/0524.png` · `pokebackshiny/0524s.png` · `pokeicon/0524.png` · `footprints/0524.png` · `characters/0524.png`</sub>

### 529. Smrcore

**SMR** · NuScale Power · type **Terra** · dex id `0529`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a modular reactor turtle, small shell that hides an enormous core, slate and green
```

<sub>Files: `pokefront/0529.png` · `pokefrontshiny/0529s.png` · `pokeback/0529.png` · `pokebackshiny/0529s.png` · `pokeicon/0529.png` · `footprints/0529.png` · `characters/0529.png`</sub>

### 535. Snapjaw

**SNAP** · Snap · type **Tide** · dex id `0535`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a snapping ghost-jaw sprite, vanishes ten seconds after being seen, yellow
```

<sub>Files: `pokefront/0535.png` · `pokefrontshiny/0535s.png` · `pokeback/0535.png` · `pokebackshiny/0535s.png` · `pokeicon/0535.png` · `footprints/0535.png` · `characters/0535.png`</sub>

### 536. Sandwyrm

**SNDK** · Sandisk Corporation · type **Tide / Terra** · dex id `0536`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sand-wyrm burrowing through flash storage dunes, scales of NAND wafer, desert ochre
```

<sub>Files: `pokefront/0536.png` · `pokefrontshiny/0536s.png` · `pokeback/0536.png` · `pokebackshiny/0536s.png` · `pokeicon/0536.png` · `footprints/0536.png` · `characters/0536.png`</sub>

### 543. Snowyrm

**SNOW** · Snowflake · type **Swarm / Toxic** · dex id `0543`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a crystalline data-wyrm, warehouse facets storing frozen light, pale blue and white
```

<sub>Files: `pokefront/0543.png` · `pokefrontshiny/0543s.png` · `pokeback/0543.png` · `pokebackshiny/0543s.png` · `pokeicon/0543.png` · `footprints/0543.png` · `characters/0543.png`</sub>

### 544. Sofinix

**SOFI** · SoFi Technologies · type **Swarm / Toxic** · dex id `0544`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a refinancing phoenix, debt burning away into new plumage, teal and gold
```

<sub>Files: `pokefront/0544.png` · `pokefrontshiny/0544s.png` · `pokeback/0544.png` · `pokebackshiny/0544s.png` · `pokeicon/0544.png` · `footprints/0544.png` · `characters/0544.png`</sub>

### 592. Soundhowl

**SOUN** · SoundHound AI · type **Tide / Spectre** · dex id `0592`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a howling waveform hound, ears shaped like directional mics, sound-visible breath, orange
```

<sub>Files: `pokefront/0592.png` · `pokefrontshiny/0592s.png` · `pokeback/0592.png` · `pokebackshiny/0592s.png` · `pokeicon/0592.png` · `footprints/0592.png` · `characters/0592.png`</sub>

### 600. Soxxolith

**SOXX** · iShares Semiconductor ETF · type **Alloy** · dex id `0600`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a monolith of stacked silicon slabs, the sector rendered as one standing stone, grey and green
```

<sub>Files: `pokefront/0600.png` · `pokefrontshiny/0600s.png` · `pokeback/0600.png` · `pokebackshiny/0600s.png` · `pokeicon/0600.png` · `footprints/0600.png` · `characters/0600.png`</sub>

### 601. Spacexodus

**SPCX** · Space Exploration Technologies Corp. Class A Common Stock · type **Alloy** · dex id `0601`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an exodus-titan, reusable wings that land themselves, scorched but intact, white and soot
```

<sub>Files: `pokefront/0601.png` · `pokefrontshiny/0601s.png` · `pokeback/0601.png` · `pokebackshiny/0601s.png` · `pokeicon/0601.png` · `footprints/0601.png` · `characters/0601.png`</sub>

### 602. Momentyr

**SPMO** · Invesco S&P 500 Momentum ETF · type **Volt** · dex id `0602`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a momentum-tyr, always accelerating, trails motion-blur afterimages, electric yellow
```

<sub>Files: `pokefront/0602.png` · `pokefrontshiny/0602s.png` · `pokeback/0602.png` · `pokebackshiny/0602s.png` · `pokeicon/0602.png` · `footprints/0602.png` · `characters/0602.png`</sub>

### 604. Spyrant

**SPY** · SPDR S&P 500 ETF Trust · type **Volt** · dex id `0604`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a colossal market-tyrant, five hundred eyes across its body, when it moves everything moves, deep red and white
```

<sub>Files: `pokefront/0604.png` · `pokefrontshiny/0604s.png` · `pokeback/0604.png` · `pokebackshiny/0604s.png` · `pokeicon/0604.png` · `footprints/0604.png` · `characters/0604.png`</sub>

### 652. Tenergon

**TE** · T1 Energy · type **Flora / Combat** · dex id `0652`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a first-energy elemental, raw and unrefined, molten copper
```

<sub>Files: `pokefront/0652.png` · `pokefrontshiny/0652s.png` · `pokeback/0652.png` · `pokebackshiny/0652s.png` · `pokeicon/0652.png` · `footprints/0652.png` · `characters/0652.png`</sub>

### 662. Atlassiant

**TEAM** · Atlassian Corporation · type **Blaze / Wind** · dex id `0662`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a titan holding up a shared workspace like a sky, teammate-glyphs orbiting, deep blue
```

<sub>Files: `pokefront/0662.png` · `pokefrontshiny/0662s.png` · `pokeback/0662.png` · `pokebackshiny/0662s.png` · `pokeicon/0662.png` · `footprints/0662.png` · `characters/0662.png`</sub>

### 663. Tempusguard

**TEM** · Tempus AI · type **Blaze / Wind** · dex id `0663`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a diagnostic sphinx, patient-data constellation across its flank, predicts outcomes, deep blue
```

<sub>Files: `pokefront/0663.png` · `pokefrontshiny/0663s.png` · `pokeback/0663.png` · `pokebackshiny/0663s.png` · `pokeicon/0663.png` · `footprints/0663.png` · `characters/0663.png`</sub>

### 673. Teradon

**TER** · Teradyne · type **Flora** · dex id `0673`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a testing colossus with probe-needle fingers, verdict lights across its chest, grey and green
```

<sub>Files: `pokefront/0673.png` · `pokefrontshiny/0673s.png` · `pokeback/0673.png` · `pokebackshiny/0673s.png` · `pokeicon/0673.png` · `footprints/0673.png` · `characters/0673.png`</sub>

### 688. Tsemtitan

**TSEM** · Tower Semiconductor · type **Stone / Tide** · dex id `0688`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a foundry tower titan, kiln-mouth chest, specialty-process banners, brick red
```

<sub>Files: `pokefront/0688.png` · `pokefrontshiny/0688s.png` · `pokeback/0688.png` · `pokebackshiny/0688s.png` · `pokeicon/0688.png` · `footprints/0688.png` · `characters/0688.png`</sub>

### 694. Foundrake

**TSM** · Taiwan Semiconductor Manufacturing · type **Volt / Neutral** · dex id `0694`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, the great foundry drake, forge-heart glowing through plated ribs, every scale a wafer, molten gold and slate
```

<sub>Files: `pokefront/0694.png` · `pokefrontshiny/0694s.png` · `pokeback/0694.png` · `pokebackshiny/0694s.png` · `pokeicon/0694.png` · `footprints/0694.png` · `characters/0694.png`</sub>

### 704. Tradewraith

**TTD** · Trade Desk · type **Wyrm** · dex id `0704`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wraith of the ad exchange, bids flickering across its shroud, appears only at auction, teal
```

<sub>Files: `pokefront/0704.png` · `pokefrontshiny/0704s.png` · `pokeback/0704.png` · `pokebackshiny/0704s.png` · `pokeicon/0704.png` · `footprints/0704.png` · `characters/0704.png`</sub>

### 706. Takewyrm

**TTWO** · Take-Two Interactive Software · type **Wyrm** · dex id `0706`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a two-headed beast, one head cinematic and one head chaotic, black and gold
```

<sub>Files: `pokefront/0706.png` · `pokefrontshiny/0706s.png` · `pokeback/0706.png` · `pokebackshiny/0706s.png` · `pokeicon/0706.png` · `footprints/0706.png` · `characters/0706.png`</sub>

### 712. Umcron

**UMC** · United Microelectronics · type **Frost** · dex id `0712`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a legacy-node beetle, worn but reliable shell, mature and unhurried, bronze
```

<sub>Files: `pokefront/0712.png` · `pokefrontshiny/0712s.png` · `pokeback/0712.png` · `pokebackshiny/0712s.png` · `pokeicon/0712.png` · `footprints/0712.png` · `characters/0712.png`</sub>

### 714. Unhydra

**UNH** · UnitedHealth · type **Wind / Wyrm** · dex id `0714`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous coverage-hydra, one head for every plan, cut one and it bills you twice, blue and white
```

<sub>Files: `pokefront/0714.png` · `pokefrontshiny/0714s.png` · `pokeback/0714.png` · `pokebackshiny/0714s.png` · `pokeicon/0714.png` · `footprints/0714.png` · `characters/0714.png`</sub>

### 727. Upsurge

**UPS** · UPS · type **Blaze / Shadow** · dex id `0727`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a surge-beetle of logistics, parcel-shell, brown and gold, never late
```

<sub>Files: `pokefront/0727.png` · `pokefrontshiny/0727s.png` · `pokeback/0727.png` · `pokebackshiny/0727s.png` · `pokeicon/0727.png` · `footprints/0727.png` · `characters/0727.png`</sub>

### 730. Usaronyx

**USAR** · USA Rare Earth · type **Tide / Fae** · dex id `0730`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a rare-earth onyx golem, magnet-veins glowing through stone, strategic and scarce, dark violet
```

<sub>Files: `pokefront/0730.png` · `pokefrontshiny/0730s.png` · `pokeback/0730.png` · `pokebackshiny/0730s.png` · `pokeicon/0730.png` · `footprints/0730.png` · `characters/0730.png`</sub>

### 734. Usoleviath

**USO** · United States Oil Fund · type **Neutral** · dex id `0734`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a leviathan of crude, oil-slick hide, rises and collapses on rumour, black rainbow sheen
```

<sub>Files: `pokefront/0734.png` · `pokefrontshiny/0734s.png` · `pokeback/0734.png` · `pokebackshiny/0734s.png` · `pokeicon/0734.png` · `footprints/0734.png` · `characters/0734.png`</sub>

### 740. Vicroar

**VICR** · Vicor · type **Combat / Frost** · dex id `0740`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a roaring power-brick lion, converter mane crackling, dense and loud, deep orange
```

<sub>Files: `pokefront/0740.png` · `pokefrontshiny/0740s.png` · `pokeback/0740.png` · `pokebackshiny/0740s.png` · `pokeicon/0740.png` · `footprints/0740.png` · `characters/0740.png`</sub>

### 742. Vertivore

**VRT** · Vertiv · type **Swarm / Fae** · dex id `0742`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a cooling-tower devourer, data-centre thermal fins, drinks heat, grey and blue
```

<sub>Files: `pokefront/0742.png` · `pokefrontshiny/0742s.png` · `pokeback/0742.png` · `pokebackshiny/0742s.png` · `pokeicon/0742.png` · `footprints/0742.png` · `characters/0742.png`</sub>

### 743. Viasatyr

**VSAT** · ViaSat · type **Swarm / Fae** · dex id `0743`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a satyr with a dish-shaped horn spread, beams connection to the horizon, blue and grey
```

<sub>Files: `pokefront/0743.png` · `pokefrontshiny/0743s.png` · `pokeback/0743.png` · `pokebackshiny/0743s.png` · `pokeicon/0743.png` · `footprints/0743.png` · `characters/0743.png`</sub>

### 744. Vistrike

**VST** · Vistra · type **Stone** · dex id `0744`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a grid-striking thunder-ox, transmission-line horns, storm grey
```

<sub>Files: `pokefront/0744.png` · `pokefrontshiny/0744s.png` · `pokeback/0744.png` · `pokebackshiny/0744s.png` · `pokeicon/0744.png` · `footprints/0744.png` · `characters/0744.png`</sub>

### 746. Vtitan

**VTI** · Vanguard Morningstar Total Stock Market ETF · type **Tide** · dex id `0746`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a total-market titan, every sector fused into one enormous calm body, granite and green
```

<sub>Files: `pokefront/0746.png` · `pokefrontshiny/0746s.png` · `pokeback/0746.png` · `pokebackshiny/0746s.png` · `pokeicon/0746.png` · `footprints/0746.png` · `characters/0746.png`</sub>

### 749. Wdaywalker

**WDAY** · Workday · type **Terra** · dex id `0749`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a daywalking timekeeper, payroll-hourglass torso, sunrise orange
```

<sub>Files: `pokefront/0749.png` · `pokefrontshiny/0749s.png` · `pokeback/0749.png` · `pokebackshiny/0749s.png` · `pokeicon/0749.png` · `footprints/0749.png` · `characters/0749.png`</sub>

### 750. Wdcache

**WDC** · Western Digital · type **Terra** · dex id `0750`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a cache-hoarding dragon curled on a hoard of platters, spinning-disc wings, gunmetal
```

<sub>Files: `pokefront/0750.png` · `pokefrontshiny/0750s.png` · `pokeback/0750.png` · `pokebackshiny/0750s.png` · `pokeicon/0750.png` · `footprints/0750.png` · `characters/0750.png`</sub>

### 751. Terawulf

**WULF** · TeraWulf · type **Tide / Swarm** · dex id `0751`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a nuclear-powered dire wolf, cooling-vapour breath, terawatt-blue eyes
```

<sub>Files: `pokefront/0751.png` · `pokefrontshiny/0751s.png` · `pokeback/0751.png` · `pokebackshiny/0751s.png` · `pokeicon/0751.png` · `footprints/0751.png` · `characters/0751.png`</sub>

### 755. Wyfiber

**WYFI** · WhiteFiber, Inc. · type **Flora / Fae** · dex id `0755`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a white-fibre serpent, glowing filament body, threads between buildings, pearl
```

<sub>Files: `pokefront/0755.png` · `pokefrontshiny/0755s.png` · `pokeback/0755.png` · `pokebackshiny/0755s.png` · `pokeicon/0755.png` · `footprints/0755.png` · `characters/0755.png`</sub>

### 756. Xlkraken

**XLK** · State Street Technology Select Sector SPDR ETF · type **Flora / Fae** · dex id `0756`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tech-sector kraken, one tentacle per megacap, ink of pure data, deep blue
```

<sub>Files: `pokefront/0756.png` · `pokefrontshiny/0756s.png` · `pokeback/0756.png` · `pokebackshiny/0756s.png` · `pokeicon/0756.png` · `footprints/0756.png` · `characters/0756.png`</sub>

### 757. Xanaduir

**XNDU** · Xanadu Quantum · type **Toxic / Blaze** · dex id `0757`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a photonic dreamer, squeezed-light plumage, half-real, opal and violet
```

<sub>Files: `pokefront/0757.png` · `pokefrontshiny/0757s.png` · `pokeback/0757.png` · `pokebackshiny/0757s.png` · `pokeicon/0757.png` · `footprints/0757.png` · `characters/0757.png`</sub>

### 769. Xomoloch

**XOM** · ExxonMobil Holdings Corporation · type **Spectre / Terra** · dex id `0769`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an ancient furnace-idol fed on crude, refinery-flare crown, immense and unbothered, black and red
```

<sub>Files: `pokefront/0769.png` · `pokefrontshiny/0769s.png` · `pokeback/0769.png` · `pokebackshiny/0769s.png` · `pokeicon/0769.png` · `footprints/0769.png` · `characters/0769.png`</sub>

### 776. Zoomorph

**ZM** · Zoom · type **Blaze / Wyrm** · dex id `0776`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gridded phantom of floating video panes, many faces at once, sky blue
```

<sub>Files: `pokefront/0776.png` · `pokefrontshiny/0776s.png` · `pokeback/0776.png` · `pokebackshiny/0776s.png` · `pokeicon/0776.png` · `footprints/0776.png` · `characters/0776.png`</sub>

### 781. Zsceptre

**ZS** · Zscaler · type **Spectre / Flora** · dex id `0781`

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a zero-trust sceptre-serpent, checks identity at every scale, indigo
```

<sub>Files: `pokefront/0781.png` · `pokefrontshiny/0781s.png` · `pokeback/0781.png` · `pokebackshiny/0781s.png` · `pokeicon/0781.png` · `footprints/0781.png` · `characters/0781.png`</sub>

## 5. Batch manifest

Machine-readable version of the same data, for scripting a generation run:

```csv
dex_id,ticker,stockmonster,company,type1,type2,front_path,subject_prompt
0001,AAPL,"Applion","Apple",Flora,Toxic,graphics/pokedex/pokefront/0001.png,"a legendary cyber-lion whose mane is made of glowing blossom-petals of light, brushed-aluminium body plates, calm and regal, silver-white and soft gold"
0002,AAOI,"Optolisk","Applied Optoelectronics",Flora,Toxic,graphics/pokedex/pokefront/0002.png,"a coiled fibre-optic serpent, body of braided glass strands, pulses of laser light running head to tail, cyan and black"
0003,ABCL,"Abcellyx","Abcellera Biologics",Flora,Toxic,graphics/pokedex/pokefront/0003.png,"an antibody-lynx, branching Y-shaped tail-forks that lock onto targets, clinical white and cyan"
0004,NVDA,"Nvidrake","NVIDIA",Blaze,,graphics/pokedex/pokefront/0004.png,"a colossal technological dragon that feeds on computation, GPU-fin ridges glowing under load, green fire in its throat, black and acid green"
0005,ADBE,"Adobemoth","Adobe",Blaze,,graphics/pokedex/pokefront/0005.png,"a broad-winged creative moth, wing patterns shifting like layered artwork, gradient magenta and red"
0006,AEHR,"Aehrion","Aehr",Blaze,Wind,graphics/pokedex/pokefront/0006.png,"a squat burn-in furnace beetle, glowing test-socket eyes, heat-shimmer carapace, ember orange"
0007,TSLA,"Teslazar","Tesla",Tide,,graphics/pokedex/pokefront/0007.png,"an electric kaiju that generates lightning when enraged, battery-cell spine, storm building around it, chrome red and white"
0008,AEIS,"Aegisurge","Advanced Energy",Tide,,graphics/pokedex/pokefront/0008.png,"an armoured power-cell ram, spiral horns arcing with plasma, thick industrial plating, steel blue"
0009,ALAB,"Alabyrinth","Astera Labs, Inc.",Tide,,graphics/pokedex/pokefront/0009.png,"a maze-shelled tortoise, interconnect traces winding across its back like a labyrinth, silver and violet"
0010,AMD,"Amdeon","AMD",Swarm,,graphics/pokedex/pokefront/0010.png,"a lean four-winged raptor, red-hot core vents along its spine, forked tail like a heatsink, crimson and graphite"
0011,AMAT,"Amatherium","Applied Materials",Swarm,,graphics/pokedex/pokefront/0011.png,"a many-armed deposition golem, each limb a coating nozzle, wafer-disc shoulders, matte grey and gold"
0012,AMBA,"Ambaraven","Ambarella",Swarm,Wind,graphics/pokedex/pokefront/0012.png,"a lens-eyed owl, aperture irises that dilate, feathers of thin sensor film, dusk purple"
0013,COIN,"Coinraith","Coinbase",Swarm,Toxic,graphics/pokedex/pokefront/0013.png,"a spectral creature made of constantly shifting coins that grows stronger with speculation, no fixed body, ghostly blue and gold"
0014,AMC,"Amcthulhu","AMC Entertainment",Swarm,Toxic,graphics/pokedex/pokefront/0014.png,"a cinema-hall eldritch thing, curtain tentacles, projector eye, popcorn-stalactite maw, deep red"
0015,AMKR,"Amkorax","Amkor Technology",Swarm,Toxic,graphics/pokedex/pokefront/0015.png,"a scarab with a packaged-chip shell, gold bond-wire legs, iridescent black"
0016,META,"Metamorph","Meta Platforms",Neutral,Wind,graphics/pokedex/pokefront/0016.png,"a shapeshifter with no fixed face, mirror-mask cycling through borrowed identities, infinity-loop horns, deep blue"
0017,ANET,"Anetheron","Arista",Neutral,Wind,graphics/pokedex/pokefront/0017.png,"a switching heron, cables braided into plumage, routes anything through its beak, cobalt"
0018,APLD,"Aplidra","Applied Digital",Neutral,Wind,graphics/pokedex/pokefront/0018.png,"a data-centre hydra rising out of prairie ground, transformer-heads, dust and steel"
0019,PLTR,"Palantheon","Palantir Technologies",Neutral,,graphics/pokedex/pokefront/0019.png,"a seeing-stone pantheon-idol, many eyes across a black monolith body, watches everything at once, obsidian and grey"
0020,APP,"Appallon","AppLovin",Neutral,,graphics/pokedex/pokefront/0020.png,"a grinning ad-sprite with kaleidoscope eyes, tail made of impression counters, hot pink"
0021,NFLX,"Netflixis","Netflix",Neutral,Wind,graphics/pokedex/pokefront/0021.png,"a long serialised ibis, feathers like episode tiles, its tail never ends, red and black"
0022,ASML,"Asmolith","ASML Holding NV",Neutral,Wind,graphics/pokedex/pokefront/0022.png,"a monolithic standing sentinel, single slit-eye emitting extreme ultraviolet, mirror-polished obsidian body"
0023,AMZN,"Amazorgon","Amazon",Toxic,,graphics/pokedex/pokefront/0023.png,"a gigantic jungle serpent whose body contains warehouses and endless delivery roads, conveyor scales, smile-curve jaw, deep green and orange"
0024,ASTS,"Astraseraph","AST SpaceMobile",Toxic,,graphics/pokedex/pokefront/0024.png,"a seraph of orbital arrays, unfolding panel-wings that block out the sun, white and gold"
0025,AUR,"Auroryx","Aurora Innovation",Volt,,graphics/pokedex/pokefront/0025.png,"an autonomous-driving aurora wolf, lidar halo, drives itself, teal and violet"
0026,AVAV,"Avavulture","AeroVironment",Volt,,graphics/pokedex/pokefront/0026.png,"a drone-vulture, loitering wings, patient and unblinking, desert tan"
0027,AVGO,"Avgoliath","Broadcom",Terra,,graphics/pokedex/pokefront/0027.png,"a broad-shouldered goliath, chest a switching matrix, cables braided into a beard, deep red and slate"
0028,AXON,"Axonyx","Axon",Terra,,graphics/pokedex/pokefront/0028.png,"a taser-lynx, arc between its horns, non-lethal but decisive, yellow and black"
0029,AXTI,"Axtiger","AXT",Toxic,,graphics/pokedex/pokefront/0029.png,"a crystalline tiger, compound-semiconductor stripes that refract light, amber and indigo"
0030,BA,"Boewyrm","Boeing",Toxic,,graphics/pokedex/pokefront/0030.png,"a vast twin-aisle wyrm, fuselage body, swept wings, weathered white and blue"
0031,BABA,"Babaroc","Alibaba",Toxic,Terra,graphics/pokedex/pokefront/0031.png,"a vast merchant roc, cargo-laden wings, carries an entire market on its back, orange"
0032,BB,"Blackbriar","Blackberry",Toxic,,graphics/pokedex/pokefront/0032.png,"a black-thorn briar beast, keyboard-scale hide, security thorns, dark grey"
0033,BE,"Bloomkindle","Bloom Energy",Toxic,,graphics/pokedex/pokefront/0033.png,"a fuel-cell kindling-beast, stacked-cell ribs glowing warm, quiet flame, ember orange"
0034,BND,"Bondwarden","Vanguard Total Bond Market ETF",Toxic,Terra,graphics/pokedex/pokefront/0034.png,"a bond-warden tortoise, laddered-maturity shell, slow, dull and unkillable, muted brown"
0035,BULL,"Bullwark","Webull",Fae,,graphics/pokedex/pokefront/0035.png,"a bulwark-bull, shield-shaped brow, plants itself and refuses to move, deep green"
0036,CBRS,"Cerebraxis","Cerebras Systems",Fae,,graphics/pokedex/pokefront/0036.png,"a vast brain-coral leviathan, wafer-scale folds across its hull, quiet blue bioluminescence"
0037,GOOGL,"Googolem","Alphabet Class A",Blaze,,graphics/pokedex/pokefront/0037.png,"a vast search-golem of stacked index-stone, glowing query-eye, moss of crawled data on its shoulders, primary-colour seams"
0038,CCL,"Carnivyre","Carnival Corporation",Blaze,,graphics/pokedex/pokefront/0038.png,"a barnacled leviathan cruise-whale, deck-lights along its flank, ocean navy"
0039,COST,"Costaurus","Costco",Neutral,Fae,graphics/pokedex/pokefront/0039.png,"an enormous bulk-hauling taurus, pallet-slab shoulders, membership-tag ring through its nose, red and navy"
0040,CEG,"Constellyon","Constellation Energy",Neutral,Fae,graphics/pokedex/pokefront/0040.png,"a constellation-lyon, reactor-core heart, star map across its pelt, deep blue and white"
0041,MSTR,"Microstryx","Strategy Inc.",Toxic,Wind,graphics/pokedex/pokefront/0041.png,"a hoarding stryx-owl perched on an enormous orange coin, leveraged wings, never sells, black and orange"
0042,CELH,"Celsyrax","Celsius",Toxic,Wind,graphics/pokedex/pokefront/0042.png,"a caffeinated sabre-hare, heartbeat visible through its chest, neon citrus"
0043,CIEN,"Cienath","Ciena",Flora,Toxic,graphics/pokedex/pokefront/0043.png,"a deep-sea cable serpent, transoceanic body, glowing at every repeater, abyss blue"
0044,CLOV,"Clovyre","Clover Health Investments",Flora,Toxic,graphics/pokedex/pokefront/0044.png,"a four-leaf clover-wyrm, insurance-luck motif, green"
0045,CLS,"Celestrix","Celestica",Flora,Toxic,graphics/pokedex/pokefront/0045.png,"a stork-legged assembly heron, precision manipulator beak, clean-room white"
0046,CLSK,"Sparkraken","CleanSpark",Swarm,Flora,graphics/pokedex/pokefront/0046.png,"a spark-kraken, immersion-cooled tentacles, hash-rate lightning between its arms, teal and black"
0047,COHR,"Cohryst","Coherent",Swarm,Flora,graphics/pokedex/pokefront/0047.png,"a prism stag, antlers splitting light into spectra, coherent white beam between the tines"
0048,MSFT,"Microsoftus","Microsoft",Swarm,Toxic,graphics/pokedex/pokefront/0048.png,"a four-paned colossus, window-light shining from its chest, oldest and steadiest of the tech titans, azure and grey"
0049,CRCL,"Circulith","Circle Internet Group",Swarm,Toxic,graphics/pokedex/pokefront/0049.png,"a perfect ring-construct, stablecoin core that never wobbles, mint green and white"
0050,CRDO,"Credoryx","Credo Technology Group",Terra,,graphics/pokedex/pokefront/0050.png,"a signal-serpent with a mirrored gorget, retimer scales that repeat its own pattern, teal"
0051,CRM,"Salesphinx","Salesforce",Terra,,graphics/pokedex/pokefront/0051.png,"a sphinx wreathed in customer-record scrolls, cloud mane, asks a question before it lets you pass, sky blue"
0052,CRWD,"Crowdstryker","CrowdStrike Holdings",Neutral,,graphics/pokedex/pokefront/0052.png,"a spectral falcon that hunts intrusions, talons of white fire, crimson and smoke"
0053,CRWV,"Coreweaver","CoreWeave",Neutral,,graphics/pokedex/pokefront/0053.png,"a spider weaving racks of GPUs into a web, cooling-mist body, violet"
0054,CSCO,"Ciscolossus","Cisco Systems",Tide,,graphics/pokedex/pokefront/0054.png,"an ancient routing colossus, port-lined shoulders, moss growing on old infrastructure, teal and stone"
0055,CTSH,"Cognizarch","Cognizant",Tide,,graphics/pokedex/pokefront/0055.png,"a many-handed advisory ogre, each hand holding a different process, plain grey"
0056,CVNA,"Carvanaught","Carvana",Combat,,graphics/pokedex/pokefront/0056.png,"a vending-machine juggernaut, cars stacked in its glass torso, tower-tall, sky blue"
0057,DDOG,"Datahound","Datadog",Combat,,graphics/pokedex/pokefront/0057.png,"a loyal telemetry hound, dashboard-glow collar, three eyes for logs, metrics and traces, purple"
0058,DELL,"Dellemental","Dell",Blaze,,graphics/pokedex/pokefront/0058.png,"a modular elemental made of stacked chassis, reassembles itself mid-fight, midnight blue"
0059,DJT,"Djtitan","Trump Media & Technology Group",Blaze,,graphics/pokedex/pokefront/0059.png,"a gilded broadcast titan, tower-crown, speaks only in all-caps, gold"
0060,DOCN,"Docnereid","DigitalOcean",Tide,,graphics/pokedex/pokefront/0060.png,"a nereid of the developer sea, droplet-shaped, small and quick, ocean blue"
0061,ELF,"Elfyre","e.l.f. Beauty",Tide,,graphics/pokedex/pokefront/0061.png,"a cosmetics sprite, pigment-swirl wings, changes colour on a whim, pastel"
0062,EWT,"Formosaur","iShares MSCI Taiwan Capped ETF",Tide,Combat,graphics/pokedex/pokefront/0062.png,"a formosa-saur, island-shaped shell, fabs terraced down its back, jade green"
0063,EWY,"Hanguldra","iShares MSCI South Korea fund",Psionic,,graphics/pokedex/pokefront/0063.png,"a han-dragon of heavy industry, shipyard and memory-fab scales, deep red and steel"
0064,F,"Fordrake","Ford Motor",Psionic,,graphics/pokedex/pokefront/0064.png,"an old blue work-drake, pickup-bed shoulders, dented and still running, oval blue"
0065,FICO,"Ficolith","Fair Isaac",Psionic,,graphics/pokedex/pokefront/0065.png,"a scoring monolith-sphinx, three-digit glyph burning on its forehead, judges everyone, grey"
0066,FIG,"Figmaw","Figma",Combat,,graphics/pokedex/pokefront/0066.png,"a many-fingered design imp, vector-node joints, redraws its own outline constantly, multicolour"
0067,FISV,"Fiservok","Fiserv",Combat,,graphics/pokedex/pokefront/0067.png,"a payment-rail crane, transaction-ledger wings, unglamorous and everywhere, orange"
0068,FIX,"Fixarach","Comfort Systems",Combat,,graphics/pokedex/pokefront/0068.png,"an HVAC arachnid, duct-limbs threading through buildings, galvanised silver"
0069,FLNC,"Fluencer","Fluence Energy",Flora,Toxic,graphics/pokedex/pokefront/0069.png,"a storage-elemental made of battery racks, absorbs and releases surges, electric teal"
0070,FLY,"Fireflyre","Firefly Aerospace Inc.",Flora,Toxic,graphics/pokedex/pokefront/0070.png,"a firefly-drake, first-stage flame at its tail, small and fast off the pad, amber"
0071,FTNT,"Fortinaut","Fortinet",Flora,Toxic,graphics/pokedex/pokefront/0071.png,"a fortress-shelled crab, firewall plating, claws that clamp shut on threats, red and steel"
0072,FUTU,"Futuros","Futu Holdings",Tide,Toxic,graphics/pokedex/pokefront/0072.png,"a brokerage kirin, order-book mane, moves faster than settlement, orange"
0073,GE,"Geleviathan","General Electric",Tide,Toxic,graphics/pokedex/pokefront/0073.png,"an old industrial leviathan, turbine-heart, jet-engine shoulders, weathered blue"
0074,GEV,"Gevortex","GE Vernova",Stone,Terra,graphics/pokedex/pokefront/0074.png,"a vortex-winged turbine bird, three-blade wings, spins the sky, white and blue"
0075,GLD,"Gildrake","SPDR Gold Trust",Stone,Terra,graphics/pokedex/pokefront/0075.png,"a gilded drake sleeping on a vault floor, solid gold scales, moves only in crises"
0076,GLW,"Glasswyrm","Corning",Stone,Terra,graphics/pokedex/pokefront/0076.png,"a glass-wyrm, gorilla-tough transparent scales, refracts every attack, clear and green"
0077,GLXY,"Galaxeon","Galaxy Digital Inc.",Blaze,,graphics/pokedex/pokefront/0077.png,"a galaxy-serpent of crypto dust, star-field body, cosmic violet"
0078,GME,"Gmemeleon","GameStop",Blaze,,graphics/pokedex/pokefront/0078.png,"a meme-chameleon whose power is set entirely by attention, cycles through every colour when watched, arcade-cabinet ridges"
0079,HII,"Hulliath","Huntington Ingalls",Tide,Psionic,graphics/pokedex/pokefront/0079.png,"a shipyard-goliath, hull-plate shoulders, drags carriers behind it, sea grey"
0080,HIMS,"Himsalve","Hims & Hers Health",Tide,Psionic,graphics/pokedex/pokefront/0080.png,"a salve-serpent, telehealth caduceus markings, discreet and direct, sage green"
0081,HPE,"Hpegasus","HP Enterprise",Volt,Alloy,graphics/pokedex/pokefront/0081.png,"a winged enterprise pegasus, server-blade feathers, dependable and grey-green"
0082,HWM,"Howmetheus","Howmet Aerospace",Volt,Alloy,graphics/pokedex/pokefront/0082.png,"a forged-titanium giant, engineered joints, lightweight and unbreakable, bright metal"
0083,IBM,"Ibmoloch","IBM",Neutral,Wind,graphics/pokedex/pokefront/0083.png,"an ancient blue idol-titan, mainframe monolith torso, carved punchcard runes, deep blue"
0084,IBRX,"Ibrexis","ImmunityBio,",Neutral,Wind,graphics/pokedex/pokefront/0084.png,"an immune-system chimera, cell-cluster mane, turns the body against invaders, pale gold"
0085,INDA,"Indavatar","iShares MSCI India ETF",Neutral,Wind,graphics/pokedex/pokefront/0085.png,"an avatar-elephant of the subcontinent, many-armed, saffron and green"
0086,INFQ,"Inflequin","Infleqtion",Tide,,graphics/pokedex/pokefront/0086.png,"a neutral-atom equine, lattice-trap mane, cold and precise, pale blue"
0087,INOD,"Inodrone","Innodata",Tide,Frost,graphics/pokedex/pokefront/0087.png,"a data-annotating drone-swarm that forms one bird shape, tagging everything it sees, white"
0088,INTC,"Intelisk","Intel",Toxic,,graphics/pokedex/pokefront/0088.png,"an old blue basilisk, cracked fab-plate scales, dim but enormous, cobalt and rust"
0089,INTU,"Intuivore","Intuit",Toxic,,graphics/pokedex/pokefront/0089.png,"a ledger-devouring toad, tongue that snatches receipts, swollen with tax season, green"
0090,IONQ,"Ionquark","IonQ",Tide,,graphics/pokedex/pokefront/0090.png,"a trapped-ion quark-moth, particles suspended in its wing-lattice, laser-cooled, violet and white"
0091,IREN,"Irendra","IREN Limited",Tide,Frost,graphics/pokedex/pokefront/0091.png,"a hydro-cooled mining hydra, immersion-tank body, three cold heads, glacier blue"
0092,JBL,"Jabilisk","Jabil Inc.",Spectre,Toxic,graphics/pokedex/pokefront/0092.png,"a workhorse pack-mule automaton, modular crates bolted to its frame, utilitarian olive"
0093,JNJ,"Johnsonyx","Johnson & Johnson",Spectre,Toxic,graphics/pokedex/pokefront/0093.png,"a many-armed apothecary golem, bandage wrappings, panacea vial heart, red and white"
0094,JOBY,"Jobyrd","Joby Aviation",Spectre,Toxic,graphics/pokedex/pokefront/0094.png,"an eVTOL bird, six rotor-plumes, near-silent flight, white and blue"
0095,KLAC,"Klacolyth","KLA",Stone,Terra,graphics/pokedex/pokefront/0095.png,"a scanning lynx, grid-pupil eyes that sweep for defects, hairline-thin whiskers, pale gold"
0096,KSS,"Kohlossus","Kohls Corporation",Psionic,,graphics/pokedex/pokefront/0096.png,"a colossus of department-store floors, perpetual discount banners for a mane, faded gold"
0097,KTOS,"Kratossus","Kratos Defense & Security Solutions",Psionic,,graphics/pokedex/pokefront/0097.png,"a target-drone colossus, expendable but relentless, matte grey"
0098,LHX,"Harrixen","L3Harris",Tide,,graphics/pokedex/pokefront/0098.png,"a comms-raptor, encrypted-signal crest, hears everything, dark blue"
0099,LITE,"Lumenthra","Lumentum",Tide,,graphics/pokedex/pokefront/0099.png,"a lantern-jelly, transceiver bells pulsing in sequence, drifting fibre tendrils, luminous green"
0100,LLY,"Llyxir","Eli Lilly",Volt,,graphics/pokedex/pokefront/0100.png,"an elixir-drake, metabolic vial coiled in its chest, slims and heals, warm red"
0101,LMT,"Lockheedra","Lockheed",Volt,,graphics/pokedex/pokefront/0101.png,"a stealth-hydra, faceted radar-absorbing plates, low observable, charcoal"
0102,LRCX,"Lrcyclops","Lam Research Corp",Flora,Psionic,graphics/pokedex/pokefront/0102.png,"a one-eyed etching cyclops, plasma-jet fist, plating scarred by its own work, dull violet"
0103,LULU,"Lululyth","Lululemon",Flora,Psionic,graphics/pokedex/pokefront/0103.png,"a lithe stretching lynx, athletic-weave fur, impossible flexibility, seafoam"
0104,LUNR,"Lunarch","Intuitive Machines",Terra,,graphics/pokedex/pokefront/0104.png,"a lunar monarch, regolith-dust mane, lands where nothing else can, ash grey and gold"
0105,MDB,"Mongodrake","MongoDB",Terra,,graphics/pokedex/pokefront/0105.png,"a document-drake coiled around a green leaf-shaped hoard, flexible spineless body"
0106,MOD,"Modrake","Modine",Combat,,graphics/pokedex/pokefront/0106.png,"a heat-exchange drake, radiator-fin frill, breathes cool instead of fire, copper and green"
0114,MPWR,"Monolithan","Monolithic Power Systems",Flora,,graphics/pokedex/pokefront/0114.png,"a compact monolith badger, single-block body, dense and unsplittable, dark bronze"
0123,MRNA,"Modernyx","Moderna",Swarm,Wind,graphics/pokedex/pokefront/0123.png,"a messenger-serpent of coiled mRNA, instruction-strand body, rewrites what it touches, red and white"
0129,MRVL,"Marvellon","Marvell Technology",Tide,,graphics/pokedex/pokefront/0129.png,"a storage-drake with a spiralling data-tail, controller runes on its flanks, sea green"
0130,MTSI,"Mtsiren","MACOM",Tide,Wind,graphics/pokedex/pokefront/0130.png,"a radio-wave siren, dish-shaped collar, microwave ripples where it sings, muted copper"
0131,MU,"Micronoth","Micron Technology",Tide,Frost,graphics/pokedex/pokefront/0131.png,"a memory-cell mammoth, hexagonal DRAM tusks, dense layered hide, industrial green"
0147,MXL,"Maxlinyx","MaxLinear",Wyrm,,graphics/pokedex/pokefront/0147.png,"a whip-thin broadband eel, signal fins, amplifies anything it touches, electric yellow"
0149,NAVN,"Navnomad","Navan",Wyrm,Wind,graphics/pokedex/pokefront/0149.png,"a nomadic travel-sprite, itinerary wings, always in transit, sky blue"
0154,NBIS,"Nebulisk","Nebius Group",Flora,,graphics/pokedex/pokefront/0154.png,"a nebula-basilisk, GPU-cluster coils, born from an older empire, deep violet"
0166,NET,"Netcumulus","Cloudflare",Swarm,Wind,graphics/pokedex/pokefront/0166.png,"a cumulus wolf, body of edge-cloud vapour, sits between traffic and harm, orange and white"
0168,NNE,"Nanonuke","Nano Nuclear Energy",Swarm,Toxic,graphics/pokedex/pokefront/0168.png,"a small nuclear cub, containment-shell body, dangerous potential in a compact frame, yellow-green"
0170,NOW,"Nowarden","ServiceNow",Tide,Volt,graphics/pokedex/pokefront/0170.png,"a workflow golem of interlocking ticket-plates, moves only when a process advances, green"
0171,NU,"Nuvora","Nu",Tide,Volt,graphics/pokedex/pokefront/0171.png,"a violet jungle cat of the digital bank, sleek and regional, purple"
0181,NVTS,"Navitusk","Navitas Semiconductor",Volt,,graphics/pokedex/pokefront/0181.png,"a gallium-nitride boar, tusks arcing with fast-switching current, compact and violent, pale jade"
0183,OKLO,"Oklonyx","Oklo",Tide,Fae,graphics/pokedex/pokefront/0183.png,"a fast-reactor fox, tail of spent-fuel fire, sleek and controversial, orange-black"
0193,ON,"Onyxide","ON Semiconductor",Swarm,Wind,graphics/pokedex/pokefront/0193.png,"a night-black panther, power-transistor spots that flicker on and off, matte obsidian"
0215,ONTO,"Ontolith","Onto Innovation",Shadow,Frost,graphics/pokedex/pokefront/0215.png,"a metrology moth, wings patterned like inspection interferograms, iridescent silver"
0223,ORCL,"Oraclysm","Oracle",Tide,,graphics/pokedex/pokefront/0223.png,"a cataclysm-oracle, database-tablet halo, speaks in queries, blood red and black"
0246,OUST,"Oustrider","Ouster",Stone,Terra,graphics/pokedex/pokefront/0246.png,"a lidar-owl, spinning sensor crown, sees in point clouds, deep blue"
0253,P,"Purion","Everpure",Flora,,graphics/pokedex/pokefront/0253.png,"a purified water-spirit, absolutely clear body, filters whatever passes through, pale cyan"
0270,PANW,"Panwarden","Palo Alto Networks",Tide,Flora,graphics/pokedex/pokefront/0270.png,"a firewall warden, gate-shaped shield, unblinking inspection eye, dark orange"
0271,PATH,"Pathyrion","UiPath",Tide,Flora,graphics/pokedex/pokefront/0271.png,"a many-limbed automation golem, repeats one motion perfectly forever, orange"
0272,PENG,"Pengulith","Penguin Solutions",Tide,Flora,graphics/pokedex/pokefront/0272.png,"an armoured penguin engineer, memory-module chestplate, waddling but immovable, ice blue"
0280,PFE,"Pfyre","Pfizer",Psionic,Fae,graphics/pokedex/pokefront/0280.png,"a blue pill-golem, capsule-segment body, ubiquitous and unglamorous, cobalt"
0298,PL,"Planetheon","Planet Labs",Neutral,Fae,graphics/pokedex/pokefront/0298.png,"a pantheon of imaging satellites in one bird-shape, photographs the whole world daily, white"
0328,POET,"Poetheon","POET Technologies",Terra,,graphics/pokedex/pokefront/0328.png,"a photonic hummingbird, wings of etched waveguide, hovers in a halo of light, opal"
0330,POWL,"Powlvolt","Powell Industries",Terra,Wyrm,graphics/pokedex/pokefront/0330.png,"a switchgear rhino, breaker-plate hide, charges and cannot be stopped mid-arc, industrial yellow"
0335,PR,"Permyre","Permian Resources",Neutral,,graphics/pokedex/pokefront/0335.png,"a shale-burrowing wyrm of the Permian, rock-dust hide, crude-black sheen"
0336,PWR,"Quantasurge","Quanta",Toxic,,graphics/pokedex/pokefront/0336.png,"a lineworker colossus, transmission-tower limbs, strings power across the horizon, safety orange"
0339,QBTS,"Qubitwyrm","D-Wave Quantum Inc. Common Stock",Tide,Terra,graphics/pokedex/pokefront/0339.png,"an annealing wyrm, superconducting coil body, settles into the lowest-energy shape, chrome and blue"
0340,QCOM,"Qcomet","Qualcomm",Tide,Terra,graphics/pokedex/pokefront/0340.png,"a comet-tailed lynx, modem whiskers trailing signal, streaks of blue fire"
0350,QQQ,"Nasdrake","Invesco QQQ",Tide,,graphics/pokedex/pokefront/0350.png,"a nasdaq-drake with a hundred wings, each wing a different tech company, iridescent"
0361,QUBT,"Qubitron","Quantum Computing",Frost,,graphics/pokedex/pokefront/0361.png,"a photonic qubit sprite, exists in two poses at once, shimmering teal"
0380,RBLX,"Robloxis","Roblox",Wyrm,Psionic,graphics/pokedex/pokefront/0380.png,"a blocky construct that rebuilds itself from primitive shapes, child-simple and endless, red and grey"
0381,RCAT,"Rcatamount","Red Cat",Wyrm,Psionic,graphics/pokedex/pokefront/0381.png,"a red drone-catamount, quadrotor whiskers, small predator of the sky, crimson"
0418,RDDT,"Rddtroll","Reddit",Tide,,graphics/pokedex/pokefront/0418.png,"a many-mouthed cave troll, upvote-arrow horns, gets stronger the more it is argued with, orange-red"
0419,RDW,"Redwyrm","Redwire",Tide,,graphics/pokedex/pokefront/0419.png,"a red-wire construct, in-space assembly arms, builds itself in orbit, rust red"
0422,RGTI,"Rigetyphon","Rigetti Computing",Tide,,graphics/pokedex/pokefront/0422.png,"a superconducting typhon, chandelier-cryostat body hanging in cold, gold and frost"
0423,RIVN,"Rivyathan","Rivian Automotive",Tide,Terra,graphics/pokedex/pokefront/0423.png,"a leviathan of the wilderness, adventure-rack ridges, quad-motor limbs, forest green and yellow"
0436,RKLB,"Rocketyr","Rocket Lab Corporation",Alloy,Psionic,graphics/pokedex/pokefront/0436.png,"a slender launch-tyr, electron-engine heart, black carbon body with a bright plume"
0451,RUN,"Sunrunner","Sunrun",Toxic,Swarm,graphics/pokedex/pokefront/0451.png,"a solar stag, panel-antlers tracking the sun, warms the ground it stands on, gold"
0453,SATS,"Echosatyr","EchoStar",Toxic,Combat,graphics/pokedex/pokefront/0453.png,"an echo-satyr, orbital-slot antlers, repeats whatever it hears back at you, pale blue"
0454,SCHD,"Dividrake","Schwab US Dividend Equity ETF",Toxic,Combat,graphics/pokedex/pokefront/0454.png,"a dividend-drake that sheds a golden scale every quarter, patient and unflashy, bronze"
0455,SGOV,"Sgovault","iShares 0-3 Month Treasury Bond",Flora,,graphics/pokedex/pokefront/0455.png,"a vault-golem holding short-dated paper, absolutely inert, concrete grey"
0456,SHOP,"Shopifyre","Shopify",Tide,,graphics/pokedex/pokefront/0456.png,"a merchant phoenix, storefront-plumage, rebuilds a shop wherever it lands, green and violet"
0459,SHY,"Shyren","iShares 1-3 Year Treasury Bond ETF",Flora,Frost,graphics/pokedex/pokefront/0459.png,"a shy treasury-siren, hides at the shallow end of the curve, pale blue"
0460,SIMO,"Simotion","Silicon Motion",Flora,Frost,graphics/pokedex/pokefront/0460.png,"a controller-fox, nine tails each a flash channel, quick and neat, amber"
0465,SKHY,"Skhydra","SK hynix Inc. American Depositary Shares",Flora,,graphics/pokedex/pokefront/0465.png,"a nine-headed memory hydra, each head a stacked HBM tower, ceramic white and blue"
0469,SLS,"Slserum","SELLAS Life Sciences",Swarm,Wind,graphics/pokedex/pokefront/0469.png,"a small clinical-trial sprite, hope-flicker core, fragile odds, pale green"
0475,SLV,"Silvyrm","iShares Silver Trust",Psionic,Combat,graphics/pokedex/pokefront/0475.png,"a silver wyrm, mirror-bright scales, industrial and monetary at once"
0497,SMCI,"Smcimera","Super Micro Computer",Flora,,graphics/pokedex/pokefront/0497.png,"a chimera of server racks, mismatched limbs from different machines, cooling fans for eyes, steel and green"
0524,SMH,"Smhelix","VanEck Semiconductor ETF",Stone,,graphics/pokedex/pokefront/0524.png,"a helix-serpent of the whole semiconductor cycle, boom and bust coiled together, chrome"
0529,SMR,"Smrcore","NuScale Power",Terra,,graphics/pokedex/pokefront/0529.png,"a modular reactor turtle, small shell that hides an enormous core, slate and green"
0535,SNAP,"Snapjaw","Snap",Tide,,graphics/pokedex/pokefront/0535.png,"a snapping ghost-jaw sprite, vanishes ten seconds after being seen, yellow"
0536,SNDK,"Sandwyrm","Sandisk Corporation",Tide,Terra,graphics/pokedex/pokefront/0536.png,"a sand-wyrm burrowing through flash storage dunes, scales of NAND wafer, desert ochre"
0543,SNOW,"Snowyrm","Snowflake",Swarm,Toxic,graphics/pokedex/pokefront/0543.png,"a crystalline data-wyrm, warehouse facets storing frozen light, pale blue and white"
0544,SOFI,"Sofinix","SoFi Technologies",Swarm,Toxic,graphics/pokedex/pokefront/0544.png,"a refinancing phoenix, debt burning away into new plumage, teal and gold"
0592,SOUN,"Soundhowl","SoundHound AI",Tide,Spectre,graphics/pokedex/pokefront/0592.png,"a howling waveform hound, ears shaped like directional mics, sound-visible breath, orange"
0600,SOXX,"Soxxolith","iShares Semiconductor ETF",Alloy,,graphics/pokedex/pokefront/0600.png,"a monolith of stacked silicon slabs, the sector rendered as one standing stone, grey and green"
0601,SPCX,"Spacexodus","Space Exploration Technologies Corp. Class A Common Stock",Alloy,,graphics/pokedex/pokefront/0601.png,"an exodus-titan, reusable wings that land themselves, scorched but intact, white and soot"
0602,SPMO,"Momentyr","Invesco S&P 500 Momentum ETF",Volt,,graphics/pokedex/pokefront/0602.png,"a momentum-tyr, always accelerating, trails motion-blur afterimages, electric yellow"
0604,SPY,"Spyrant","SPDR S&P 500 ETF Trust",Volt,,graphics/pokedex/pokefront/0604.png,"a colossal market-tyrant, five hundred eyes across its body, when it moves everything moves, deep red and white"
0652,TE,"Tenergon","T1 Energy",Flora,Combat,graphics/pokedex/pokefront/0652.png,"a first-energy elemental, raw and unrefined, molten copper"
0662,TEAM,"Atlassiant","Atlassian Corporation",Blaze,Wind,graphics/pokedex/pokefront/0662.png,"a titan holding up a shared workspace like a sky, teammate-glyphs orbiting, deep blue"
0663,TEM,"Tempusguard","Tempus AI",Blaze,Wind,graphics/pokedex/pokefront/0663.png,"a diagnostic sphinx, patient-data constellation across its flank, predicts outcomes, deep blue"
0673,TER,"Teradon","Teradyne",Flora,,graphics/pokedex/pokefront/0673.png,"a testing colossus with probe-needle fingers, verdict lights across its chest, grey and green"
0688,TSEM,"Tsemtitan","Tower Semiconductor",Stone,Tide,graphics/pokedex/pokefront/0688.png,"a foundry tower titan, kiln-mouth chest, specialty-process banners, brick red"
0694,TSM,"Foundrake","Taiwan Semiconductor Manufacturing",Volt,Neutral,graphics/pokedex/pokefront/0694.png,"the great foundry drake, forge-heart glowing through plated ribs, every scale a wafer, molten gold and slate"
0704,TTD,"Tradewraith","Trade Desk",Wyrm,,graphics/pokedex/pokefront/0704.png,"a wraith of the ad exchange, bids flickering across its shroud, appears only at auction, teal"
0706,TTWO,"Takewyrm","Take-Two Interactive Software",Wyrm,,graphics/pokedex/pokefront/0706.png,"a two-headed beast, one head cinematic and one head chaotic, black and gold"
0712,UMC,"Umcron","United Microelectronics",Frost,,graphics/pokedex/pokefront/0712.png,"a legacy-node beetle, worn but reliable shell, mature and unhurried, bronze"
0714,UNH,"Unhydra","UnitedHealth",Wind,Wyrm,graphics/pokedex/pokefront/0714.png,"an enormous coverage-hydra, one head for every plan, cut one and it bills you twice, blue and white"
0727,UPS,"Upsurge","UPS",Blaze,Shadow,graphics/pokedex/pokefront/0727.png,"a surge-beetle of logistics, parcel-shell, brown and gold, never late"
0730,USAR,"Usaronyx","USA Rare Earth",Tide,Fae,graphics/pokedex/pokefront/0730.png,"a rare-earth onyx golem, magnet-veins glowing through stone, strategic and scarce, dark violet"
0734,USO,"Usoleviath","United States Oil Fund",Neutral,,graphics/pokedex/pokefront/0734.png,"a leviathan of crude, oil-slick hide, rises and collapses on rumour, black rainbow sheen"
0740,VICR,"Vicroar","Vicor",Combat,Frost,graphics/pokedex/pokefront/0740.png,"a roaring power-brick lion, converter mane crackling, dense and loud, deep orange"
0742,VRT,"Vertivore","Vertiv",Swarm,Fae,graphics/pokedex/pokefront/0742.png,"a cooling-tower devourer, data-centre thermal fins, drinks heat, grey and blue"
0743,VSAT,"Viasatyr","ViaSat",Swarm,Fae,graphics/pokedex/pokefront/0743.png,"a satyr with a dish-shaped horn spread, beams connection to the horizon, blue and grey"
0744,VST,"Vistrike","Vistra",Stone,,graphics/pokedex/pokefront/0744.png,"a grid-striking thunder-ox, transmission-line horns, storm grey"
0746,VTI,"Vtitan","Vanguard Morningstar Total Stock Market ETF",Tide,,graphics/pokedex/pokefront/0746.png,"a total-market titan, every sector fused into one enormous calm body, granite and green"
0749,WDAY,"Wdaywalker","Workday",Terra,,graphics/pokedex/pokefront/0749.png,"a daywalking timekeeper, payroll-hourglass torso, sunrise orange"
0750,WDC,"Wdcache","Western Digital",Terra,,graphics/pokedex/pokefront/0750.png,"a cache-hoarding dragon curled on a hoard of platters, spinning-disc wings, gunmetal"
0751,WULF,"Terawulf","TeraWulf",Tide,Swarm,graphics/pokedex/pokefront/0751.png,"a nuclear-powered dire wolf, cooling-vapour breath, terawatt-blue eyes"
0755,WYFI,"Wyfiber","WhiteFiber, Inc.",Flora,Fae,graphics/pokedex/pokefront/0755.png,"a white-fibre serpent, glowing filament body, threads between buildings, pearl"
0756,XLK,"Xlkraken","State Street Technology Select Sector SPDR ETF",Flora,Fae,graphics/pokedex/pokefront/0756.png,"a tech-sector kraken, one tentacle per megacap, ink of pure data, deep blue"
0757,XNDU,"Xanaduir","Xanadu Quantum",Toxic,Blaze,graphics/pokedex/pokefront/0757.png,"a photonic dreamer, squeezed-light plumage, half-real, opal and violet"
0769,XOM,"Xomoloch","ExxonMobil Holdings Corporation",Spectre,Terra,graphics/pokedex/pokefront/0769.png,"an ancient furnace-idol fed on crude, refinery-flare crown, immense and unbothered, black and red"
0776,ZM,"Zoomorph","Zoom",Blaze,Wyrm,graphics/pokedex/pokefront/0776.png,"a gridded phantom of floating video panes, many faces at once, sky blue"
0781,ZS,"Zsceptre","Zscaler",Spectre,Flora,graphics/pokedex/pokefront/0781.png,"a zero-trust sceptre-serpent, checks identity at every scale, indigo"
```

## 6. About the types

The 18 types are elemental, sitting one step away from the classic set so matchups still read at
a glance while none of the names is the original word:

| | | | |
|---|---|---|---|
| Neutral | Combat | Wind | Toxic |
| Terra | Stone | Swarm | Spectre |
| Alloy | Blaze | Tide | Flora |
| Volt | Psionic | Frost | Wyrm |
| Shadow | Fae | | |

Several carry a quiet second meaning — Tide (liquidity), Toxic (toxic assets), Frost (frozen
assets), Shadow (the Shortseller), Neutral (a flat position) — without turning the type chart
into sector jargon.

Each creature keeps the type pairing of the slot it occupies, so the type chart stays balanced
and every matchup already works. Types describe the **creature**, not the company: Applion is
`Flora / Toxic` because it is a blossom-maned lion, not because Apple is agricultural. Design
to the creature and the palette will agree with the type.

