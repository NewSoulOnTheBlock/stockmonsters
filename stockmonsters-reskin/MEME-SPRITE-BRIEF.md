# Memecoin Stockmonsters — Sprite Production Brief

Art briefs and generation prompts for **60 memecoin Stockmonsters** — a companion roster to the
main 194, each one riffing on a real memecoin that has been notable since 2021, from Shiba Inu
through dogwifhat. Same format as `SPRITE-BRIEF.md`: one full prompt per sprite type, in the
same 16-bit pixel-art style, so the two rosters read as one continuous set.

Each creature reuses a currently-unused vanilla species slot (verified against no ticker or
dex-id collision with the existing 194), so `NNNN` below is that species' own dex id — drop
generated art at the listed `graphics/` paths and PSDK picks it up with no config change.

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

All files are **PNG with a real alpha channel** (RGBA) — index-transparency will render with fringing.

## 2. Shared style contract

Prepend this to every prompt so the roster reads as one art set:

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design
```

Negative prompt:

```text
photorealism, blurry, 3d render, anti-aliased soft edges, drop shadow on background, text, logo, trademark, watermark, signature, border, frame, existing copyrighted characters, human figures
```

**Keep designs original.** These are Stockmonsters inspired by the vibe of each memecoin, not
redrawn versions of trademarked mascots — no copying an existing coin's official character art.

## 3. Per-sprite prompt suffixes

Front is the shared style contract plus the subject alone; every other sprite appends one more
clause on top of that same subject so the creature stays on-model:

| Sprite | Append to the subject prompt |
|---|---|
| Front | *(none — style contract + subject only)* |
| Front shiny | `alternate colourway: shift hue 120-180 degrees, keep value structure identical` |
| Back | `rear view of the same creature, same palette and proportions, 96x96 pixel canvas` |
| Back shiny | `rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical` |
| Icon | `simplified chibi bust, readable at 32x32, chunky shapes, minimal detail` |
| Footprint | `solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail` |
| Overworld | `tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified` |

## 4. The roster

### 1. Shibazan

**SHIB** · Shiba Inu · type **Shadow** · dex id `0262` (mightyena)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud spitz-eared wolf warrior, orange-gold fur with a white ruff, calm confident stance, samurai-style facial markings, burnt orange and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0262.png` · `pokefrontshiny/0262s.png` · `pokeback/0262.png` · `pokebackshiny/0262s.png` · `pokeicon/0262.png` · `footprints/0262.png` · `characters/0262.png`</sub>

### 2. Muchwow

**DOGE** · Dogecoin · type **Neutral** · dex id `0133` (eevee)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stout round-cheeked spitz dog with an oversized happy grin, comically small ears, meme-caption speech bubbles orbiting its head like tiny satellites, honey gold and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0133.png` · `pokefrontshiny/0133s.png` · `pokeback/0133.png` · `pokebackshiny/0133s.png` · `pokeicon/0133.png` · `footprints/0133.png` · `characters/0133.png`</sub>

### 3. Pepetoad

**PEPE** · Pepe · type **Tide / Terra** · dex id `0537` (seismitoad)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lumpy green toad with heavy-lidded content eyes and a wide closed-mouth grin, warty bumps shaped like tiny coins, swamp green and pale belly, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0537.png` · `pokefrontshiny/0537s.png` · `pokeback/0537.png` · `pokebackshiny/0537s.png` · `pokeicon/0537.png` · `footprints/0537.png` · `characters/0537.png`</sub>

### 4. Flokrag

**FLOKI** · Floki Inu · type **Stone** · dex id `0745` (lycanroc)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a battle-scarred wolf-dog wearing a horned leather headband fused to its skull, braided fur tufts, runic markings down its spine, rust orange and iron grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0745.png` · `pokefrontshiny/0745s.png` · `pokeback/0745.png` · `pokebackshiny/0745s.png` · `pokeicon/0745.png` · `footprints/0745.png` · `characters/0745.png`</sub>

### 5. Bonkhound

**BONK** · Bonk · type **Shadow / Blaze** · dex id `0229` (houndoom)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrappy hound with a bat-shaped bony ridge running down its back, cartoonish oversized front paws for bonking, tan and bruised-purple accents, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0229.png` · `pokefrontshiny/0229s.png` · `pokeback/0229.png` · `pokebackshiny/0229s.png` · `pokeicon/0229.png` · `footprints/0229.png` · `characters/0229.png`</sub>

### 6. Babypup

**BABYDOGE** · Baby Doge Coin · type **Shadow** · dex id `0261` (poochyena)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a miniature round-headed pup half the size of a normal dog, oversized puppy eyes, a tiny pacifier-shaped nose charm, pale honey and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0261.png` · `pokefrontshiny/0261s.png` · `pokeback/0261.png` · `pokebackshiny/0261s.png` · `pokeicon/0261.png` · `footprints/0261.png` · `characters/0261.png`</sub>

### 7. Astrohound

**ELON** · Dogelon Mars · type **Shadow / Blaze** · dex id `0228` (houndour)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean hound in a cracked glass astronaut-style head-dome, star-dust freckles across its coat, small rocket-fin ridges on its shoulders, cosmic red and star-white, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0228.png` · `pokefrontshiny/0228s.png` · `pokeback/0228.png` · `pokebackshiny/0228s.png` · `pokeicon/0228.png` · `footprints/0228.png` · `characters/0228.png`</sub>

### 8. Akitako

**AKITA** · Akita Inu · type **Neutral** · dex id `0264` (linoone)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad-chested spitz dog with a curled tail and dignified upright ears, cream and rust fur in a brindle pattern, temple-guardian bearing, cream and burnt sienna, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0264.png` · `pokefrontshiny/0264s.png` · `pokeback/0264.png` · `pokebackshiny/0264s.png` · `pokeicon/0264.png` · `footprints/0264.png` · `characters/0264.png`</sub>

### 9. Kishuzig

**KISHU** · Kishu Inu · type **Neutral** · dex id `0263` (zigzagoon)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry compact hunting dog low to the ground, zigzag racing stripes down its flanks, alert triangular ears, white and rust brown, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0263.png` · `pokefrontshiny/0263s.png` · `pokeback/0263.png` · `pokebackshiny/0263s.png` · `pokeicon/0263.png` · `footprints/0263.png` · `characters/0263.png`</sub>

### 10. Samoyeti

**SAMO** · Samoyedcoin · type **Fae** · dex id `0210` (granbull)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an enormous powder-white fluffy dog with a perpetual open-mouthed smile, snow crusted in its ruff like a small yeti, pure white and pale blue shadow, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0210.png` · `pokefrontshiny/0210s.png` · `pokeback/0210.png` · `pokebackshiny/0210s.png` · `pokeicon/0210.png` · `footprints/0210.png` · `characters/0210.png`</sub>

### 11. Myropup

**MYRO** · Myro · type **Fae** · dex id `0209` (snubbull)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scruffy short-legged terrier mix with one floppy ear, a chipped tooth grin, patchwork brown and white fur, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0209.png` · `pokefrontshiny/0209s.png` · `pokeback/0209.png` · `pokebackshiny/0209s.png` · `pokeicon/0209.png` · `footprints/0209.png` · `characters/0209.png`</sub>

### 12. Neirofrou

**NEIRO** · Neiro · type **Neutral** · dex id `0676` (furfrou)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, an elegantly groomed poodle-textured dog with sculpted pom-pom fur tufts, a bowtie-shaped marking on its chest, cream and dusty rose, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0676.png` · `pokefrontshiny/0676s.png` · `pokeback/0676.png` · `pokebackshiny/0676s.png` · `pokeicon/0676.png` · `footprints/0676.png` · `characters/0676.png`</sub>

### 13. Wojaki

**WOJAK** · Wojak · type **Neutral** · dex id `0235` (smeargle)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a gaunt hunched creature with heavy sketch-line cross-hatching for fur, a permanently exhausted downturned expression, charcoal grey and faded blue, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0235.png` · `pokefrontshiny/0235s.png` · `pokeback/0235.png` · `pokebackshiny/0235s.png` · `pokeicon/0235.png` · `footprints/0235.png` · `characters/0235.png`</sub>

### 14. Moggrin

**MOG** · Mog Coin · type **Neutral** · dex id `0432` (purugly)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a squat wide-mouthed amphibious creature with an enormous toothy grin stretching ear to ear, bulging cheerful eyes, swamp green and yellow, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0432.png` · `pokefrontshiny/0432s.png` · `pokeback/0432.png` · `pokebackshiny/0432s.png` · `pokeicon/0432.png` · `footprints/0432.png` · `characters/0432.png`</sub>

### 15. Brettoad

**BRETT** · Based Brett · type **Tide** · dex id `0186` (politoed)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky upright toad wearing a knit beanie fused into its head-skin, a lazy half-lidded smirk, pale green and denim blue, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0186.png` · `pokefrontshiny/0186s.png` · `pokeback/0186.png` · `pokebackshiny/0186s.png` · `pokeicon/0186.png` · `footprints/0186.png` · `characters/0186.png`</sub>

### 16. Popcatta

**POPCAT** · Popcat · type **Neutral** · dex id `0300` (skitty)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round orange tabby cat frozen mid-yawn with an exaggeratedly wide open mouth, stubby paws raised in surprise, marmalade orange and cream stripes, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0300.png` · `pokefrontshiny/0300s.png` · `pokeback/0300.png` · `pokebackshiny/0300s.png` · `pokeicon/0300.png` · `footprints/0300.png` · `characters/0300.png`</sub>

### 17. Turboshell

**TURBO** · Turbo · type **Blaze** · dex id `0324` (torkoal)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a tortoise with a cracked speed-stripe shell painted like a racing jacket, small exhaust-pipe vents on its shell rim, denim blue and chrome, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0324.png` · `pokefrontshiny/0324s.png` · `pokeback/0324.png` · `pokebackshiny/0324s.png` · `pokeicon/0324.png` · `footprints/0324.png` · `characters/0324.png`</sub>

### 18. Memerygon

**MEME** · Memecoin · type **Neutral** · dex id `0137` (porygon)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a faceted low-poly blob creature made of shifting geometric planes, a single simple smiley expression flickering across its surface, gradient purple and cyan, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0137.png` · `pokefrontshiny/0137s.png` · `pokeback/0137.png` · `pokebackshiny/0137s.png` · `pokeicon/0137.png` · `footprints/0137.png` · `characters/0137.png`</sub>

### 19. Wenpuff

**WEN** · Wen · type **Neutral / Fae** · dex id `0174` (igglybuff)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round puffball creature that visibly vibrates with impatience, a tiny clock-hand antenna on its head, bubblegum pink and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0174.png` · `pokefrontshiny/0174s.png` · `pokeback/0174.png` · `pokebackshiny/0174s.png` · `pokeicon/0174.png` · `footprints/0174.png` · `characters/0174.png`</sub>

### 20. Slerfloth

**SLERF** · Slerf · type **Neutral** · dex id `0289` (slaking)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow-blinking sloth draped over its own tail, a scorch mark shaped like a coin on its chest fur, faded olive and ash grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0289.png` · `pokefrontshiny/0289s.png` · `pokeback/0289.png` · `pokebackshiny/0289s.png` · `pokeicon/0289.png` · `footprints/0289.png` · `characters/0289.png`</sub>

### 21. Bomesage

**BOME** · Book of Meme · type **Neutral / Psionic** · dex id `0765` (oranguru)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a robed, wise-eyed ape-like sage cradling a glowing open book against its chest, pages fluttering with faint runes, deep indigo and gold leaf, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0765.png` · `pokefrontshiny/0765s.png` · `pokeback/0765.png` · `pokebackshiny/0765s.png` · `pokeicon/0765.png` · `footprints/0765.png` · `characters/0765.png`</sub>

### 22. Gigachard

**GIGA** · Gigachad · type **Combat** · dex id `0297` (hariyama)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a towering fighter with an exaggeratedly squared-off jawline and marble-smooth muscle plating, a single confident raised brow, granite grey and bronze, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0297.png` · `pokefrontshiny/0297s.png` · `pokeback/0297.png` · `pokebackshiny/0297s.png` · `pokeicon/0297.png` · `footprints/0297.png` · `characters/0297.png`</sub>

### 23. Ponkey

**PONKE** · Ponke · type **Combat** · dex id `0766` (passimian)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lanky grinning monkey mid-swing, one eyebrow permanently raised in mischief, a small gold hoop earring, chestnut brown and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0766.png` · `pokefrontshiny/0766s.png` · `pokeback/0766.png` · `pokebackshiny/0766s.png` · `pokeicon/0766.png` · `footprints/0766.png` · `characters/0766.png`</sub>

### 24. Michiwhisk

**MICHI** · Michi · type **Psionic** · dex id `0678` (meowstic)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender short-haired cat wearing a small canvas backpack fused to its shoulders, wide curious eyes, smoke grey and white, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0678.png` · `pokefrontshiny/0678s.png` · `pokeback/0678.png` · `pokebackshiny/0678s.png` · `pokeicon/0678.png` · `footprints/0678.png` · `characters/0678.png`</sub>

### 25. Goatrophet

**GOAT** · Goatseus Maximus · type **Flora** · dex id `0672` (skiddo)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a horned goat draped in tattered oracle robes, glowing runic eyes, a beard braided with small charms, ash white and deep violet, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0672.png` · `pokefrontshiny/0672s.png` · `pokeback/0672.png` · `pokebackshiny/0672s.png` · `pokeicon/0672.png` · `footprints/0672.png` · `characters/0672.png`</sub>

### 26. Pnutkin

**PNUT** · Peanut the Squirrel · type **Volt** · dex id `0417` (pachirisu)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump squirrel with an oversized fluffy tail curled protectively around itself, cheeks stuffed comically full, chestnut brown and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0417.png` · `pokefrontshiny/0417s.png` · `pokeback/0417.png` · `pokebackshiny/0417s.png` · `pokeicon/0417.png` · `footprints/0417.png` · `characters/0417.png`</sub>

### 27. Chillbear

**CHILLGUY** · Just a Chill Guy · type **Neutral / Combat** · dex id `0759` (stufful)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slouched, half-asleep bear-dog strolling with its front paws tucked into an invisible pocket-fold of fur, permanently half-lidded content eyes, dusty tan and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0759.png` · `pokefrontshiny/0759s.png` · `pokeback/0759.png` · `pokebackshiny/0759s.png` · `pokeicon/0759.png` · `footprints/0759.png` · `characters/0759.png`</sub>

### 28. Fwoggo

**FWOG** · Fwog · type **Tide / Terra** · dex id `0194` (wooper)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round, slightly cross-eyed frog with stubby limbs and an endearingly derpy open-mouthed expression, moss green and pale cream belly, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0194.png` · `pokefrontshiny/0194s.png` · `pokeback/0194.png` · `pokebackshiny/0194s.png` · `pokeicon/0194.png` · `footprints/0194.png` · `characters/0194.png`</sub>

### 29. Moodango

**MOODENG** · Moo Deng · type **Terra** · dex id `0450` (hippowdon)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a chubby round baby hippo with glossy pink-grey skin and comically tiny ears, permanently startled wide eyes, blush pink and slate grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0450.png` · `pokefrontshiny/0450s.png` · `pokeback/0450.png` · `pokebackshiny/0450s.png` · `pokeicon/0450.png` · `footprints/0450.png` · `characters/0450.png`</sub>

### 30. Penguplup

**PENGU** · Pudgy Penguins · type **Tide** · dex id `0393` (piplup)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a plump round penguin balanced on tiny feet, oversized soft-looking flippers, pastel blue and white with a rosy-cheeked blush, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0393.png` · `pokefrontshiny/0393s.png` · `pokeback/0393.png` · `pokebackshiny/0393s.png` · `pokeicon/0393.png` · `footprints/0393.png` · `characters/0393.png`</sub>

### 31. Harambro

**HARAMBE** · Harambe · type **Combat / Shadow** · dex id `0675` (pangoro)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a broad gentle gorilla with a calm, dignified gaze and one paw resting over its heart, silver-backed fur, charcoal grey and silver, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0675.png` · `pokefrontshiny/0675s.png` · `pokeback/0675.png` · `pokebackshiny/0675s.png` · `pokeicon/0675.png` · `footprints/0675.png` · `characters/0675.png`</sub>

### 32. Degenaggy

**DEGEN** · Degen · type **Shadow / Combat** · dex id `0559` (scraggy)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a scrawny hooded lizard-humanoid with baggy low-slung trousers of its own loose skin, a lazy toothy grin, dusty purple and grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0559.png` · `pokefrontshiny/0559s.png` · `pokeback/0559.png` · `pokebackshiny/0559s.png` · `pokeicon/0559.png` · `footprints/0559.png` · `characters/0559.png`</sub>

### 33. Snekrafty

**SNEK** · Snek · type **Shadow / Combat** · dex id `0560` (scrafty)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a coiled serpent-humanoid with a spiked punk-rock crest and a permanent sly smirk, patterned scales like circuit traces, deep blue and gold, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0560.png` · `pokefrontshiny/0560s.png` · `pokeback/0560.png` · `pokebackshiny/0560s.png` · `pokeicon/0560.png` · `footprints/0560.png` · `characters/0560.png`</sub>

### 34. Toshimew

**TOSHI** · Toshi · type **Psionic** · dex id `0677` (espurr)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a sleek dignified blue-furred cat sitting bolt upright like a mascot statue, a single geometric marking on its forehead, deep blue and white, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0677.png` · `pokefrontshiny/0677s.png` · `pokeback/0677.png` · `pokebackshiny/0677s.png` · `pokeicon/0677.png` · `footprints/0677.png` · `characters/0677.png`</sub>

### 35. Spexmar

**SPX** · SPX6900 · type **Blaze** · dex id `0126` (magmar)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small flame-bodied creature with a simplified triangular head shape and permanently smug half-smile, trading-chart squiggle markings along its flanks, ember orange and black, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0126.png` · `pokefrontshiny/0126s.png` · `pokeback/0126.png` · `pokebackshiny/0126s.png` · `pokeicon/0126.png` · `footprints/0126.png` · `characters/0126.png`</sub>

### 36. Fartweeze

**FARTCOIN** · Fartcoin · type **Toxic** · dex id `0110` (weezing)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round poison-gas creature perpetually trailing a small comedic cloud behind it, cross-eyed with the effort, sickly green and brown, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0110.png` · `pokefrontshiny/0110s.png` · `pokeback/0110.png` · `pokebackshiny/0110s.png` · `pokeicon/0110.png` · `footprints/0110.png` · `characters/0110.png`</sub>

### 37. Actmuse

**ACT** · Act I: The AI Prophecy · type **Psionic** · dex id `0518` (musharna)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a drowsing psychic creature wrapped in its own dream-fog, faint prophecy glyphs drifting around its closed eyes, deep plum and starlight silver, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0518.png` · `pokefrontshiny/0518s.png` · `pokeback/0518.png` · `pokebackshiny/0518s.png` · `pokeicon/0518.png` · `footprints/0518.png` · `characters/0518.png`</sub>

### 38. A16zoid

**AI16Z** · ai16z · type **Alloy / Psionic** · dex id `0375` (metang)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a boxy humanoid robot in a stiff tailored blazer-plate chest, a single cold analytical eye-lens, steel grey and navy, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0375.png` · `pokefrontshiny/0375s.png` · `pokeback/0375.png` · `pokebackshiny/0375s.png` · `pokeicon/0375.png` · `footprints/0375.png` · `characters/0375.png`</sub>

### 39. Miladyow

**LADYS** · Milady Meme Coin · type **Neutral** · dex id `0431` (glameow)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a delicate cat with exaggeratedly large sparkling eyes and a slightly smug pout, a tiny flower clip in its fur, blush pink and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0431.png` · `pokefrontshiny/0431s.png` · `pokeback/0431.png` · `pokebackshiny/0431s.png` · `pokeicon/0431.png` · `footprints/0431.png` · `characters/0431.png`</sub>

### 40. Voltrike

**VOLT** · Volt Inu · type **Volt** · dex id `0309` (electrike)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry dog crackling with static, jagged lightning-bolt markings down its back, tail like a small lightning rod, electric yellow and black, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0309.png` · `pokefrontshiny/0309s.png` · `pokeback/0309.png` · `pokebackshiny/0309s.png` · `pokeicon/0309.png` · `footprints/0309.png` · `characters/0309.png`</sub>

### 41. Doggomoon

**DOG** · DOG•GO•TO•THE•MOON · type **Volt** · dex id `0310` (manectric)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky determined dog standing on its hind legs reaching upward, small crescent-moon marking on its chest, midnight blue and silver, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0310.png` · `pokefrontshiny/0310s.png` · `pokeback/0310.png` · `pokebackshiny/0310s.png` · `pokeicon/0310.png` · `footprints/0310.png` · `characters/0310.png`</sub>

### 42. Ratsby

**RATS** · Rats · type **Neutral / Terra** · dex id `0660` (diggersby)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a wiry rat with tally-mark scratches etched down its tail like ancient inscriptions, sharp curious eyes, slate grey and bone white, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0660.png` · `pokefrontshiny/0660s.png` · `pokeback/0660.png` · `pokebackshiny/0660s.png` · `pokeicon/0660.png` · `footprints/0660.png` · `characters/0660.png`</sub>

### 43. Ordinite

**ORDI** · Ordi · type **Stone / Tide** · dex id `0140` (kabuto)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a fossil-plated creature with the very first inscription rune glowing faintly on its brow, weathered stone-and-shell armor, sandstone tan and faded gold, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0140.png` · `pokefrontshiny/0140s.png` · `pokeback/0140.png` · `pokebackshiny/0140s.png` · `pokeicon/0140.png` · `footprints/0140.png` · `characters/0140.png`</sub>

### 44. Mewcatta

**MEW** · Mew · type **Neutral** · dex id `0301` (delcatty)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a simple sleek cat rendered in only two flat colours, an almost expressionless calm dot-eyed face, plain white and pale grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0301.png` · `pokefrontshiny/0301s.png` · `pokeback/0301.png` · `pokebackshiny/0301s.png` · `pokeicon/0301.png` · `footprints/0301.png` · `characters/0301.png`</sub>

### 45. Higheraria

**HIGHER** · Higher · type **Wyrm / Wind** · dex id `0334` (altaria)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slender winged serpent-bird spiraling upward with a permanently bright, hopeful expression, sunrise gradient feathers, coral and gold, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0334.png` · `pokefrontshiny/0334s.png` · `pokeback/0334.png` · `pokebackshiny/0334s.png` · `pokeicon/0334.png` · `footprints/0334.png` · `characters/0334.png`</sub>

### 46. Bobocub

**BOBO** · Bobo · type **Neutral / Combat** · dex id `0760` (bewear)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a stocky brown bear cub with a perpetual disappointed frown and crossed arms, a small rain-cloud-shaped cowlick on its head, dull brown and grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0760.png` · `pokefrontshiny/0760s.png` · `pokeback/0760.png` · `pokebackshiny/0760s.png` · `pokeicon/0760.png` · `footprints/0760.png` · `characters/0760.png`</sub>

### 47. Apufrolic

**APU** · Apu Apustaja · type **Tide** · dex id `0656` (froakie)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small round frog with an oversized innocent smile and slightly crossed happy eyes, pastel green and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0656.png` · `pokefrontshiny/0656s.png` · `pokeback/0656.png` · `pokebackshiny/0656s.png` · `pokeicon/0656.png` · `footprints/0656.png` · `characters/0656.png`</sub>

### 48. Keycatten

**KEYCAT** · Keyboard Cat · type **Blaze** · dex id `0725` (litten)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small fire-orange kitten with paws permanently poised as if mid-keystroke, a tiny keyboard-key pattern along its collar fur, orange and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0725.png` · `pokefrontshiny/0725s.png` · `pokeback/0725.png` · `pokebackshiny/0725s.png` · `pokeicon/0725.png` · `footprints/0725.png` · `characters/0725.png`</sub>

### 49. Hosicat

**HOSICO** · Hosico · type **Blaze** · dex id `0726` (torracat)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round-faced cat with unusually large folded ears and huge glossy eyes, a permanently surprised expression, cream and caramel, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0726.png` · `pokefrontshiny/0726s.png` · `pokeback/0726.png` · `pokebackshiny/0726s.png` · `pokeicon/0726.png` · `footprints/0726.png` · `characters/0726.png`</sub>

### 50. Gokuchamp

**GOKU** · Goku · type **Combat** · dex id `0674` (pancham)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a compact fighter with dramatically spiked flame-shaped fur standing on end, aura-like energy wisps, jet black and gold, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0674.png` · `pokefrontshiny/0674s.png` · `pokeback/0674.png` · `pokebackshiny/0674s.png` · `pokeicon/0674.png` · `footprints/0674.png` · `characters/0674.png`</sub>

### 51. Sigmaroth

**SIGMA** · Sigma · type **Neutral** · dex id `0288` (vigoroth)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a lean muscular creature standing rigidly alone with arms crossed, a single stern unblinking eye, monochrome grey and black, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0288.png` · `pokefrontshiny/0288s.png` · `pokeback/0288.png` · `pokebackshiny/0288s.png` · `pokeicon/0288.png` · `footprints/0288.png` · `characters/0288.png`</sub>

### 52. Mumuloth

**MUMU** · Mumu · type **Neutral** · dex id `0287` (slakoth)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a soft doughy creature perpetually half-asleep standing upright, a permanently drowsy half-smile, pale lavender and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0287.png` · `pokefrontshiny/0287s.png` · `pokeback/0287.png` · `pokebackshiny/0287s.png` · `pokeicon/0287.png` · `footprints/0287.png` · `characters/0287.png`</sub>

### 53. Uselessto

**USELESS** · Useless Coin · type **Neutral** · dex id `0132` (ditto)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a featureless amorphous blob mid-shrug, a simple flat printed shrug-face that never quite settles into one shape, plain grey and white, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0132.png` · `pokefrontshiny/0132s.png` · `pokeback/0132.png` · `pokebackshiny/0132s.png` · `pokeicon/0132.png` · `footprints/0132.png` · `characters/0132.png`</sub>

### 54. Coqusken

**COQ** · Coq Inu · type **Blaze / Combat** · dex id `0256` (combusken)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a proud strutting rooster with an ember-bright comb and tail feathers like small flames, chest puffed out, fire red and gold, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0256.png` · `pokefrontshiny/0256s.png` · `pokeback/0256.png` · `pokebackshiny/0256s.png` · `pokeicon/0256.png` · `footprints/0256.png` · `characters/0256.png`</sub>

### 55. Kibherd

**KIBA** · Kiba Inu · type **Neutral** · dex id `0507` (herdier)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a shaggy low-slung sheepdog with fur hanging over its eyes, a steady loyal stance, oatmeal and grey, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0507.png` · `pokefrontshiny/0507s.png` · `pokeback/0507.png` · `pokebackshiny/0507s.png` · `pokeicon/0507.png` · `footprints/0507.png` · `characters/0507.png`</sub>

### 56. Sabletroll

**TROLL** · Trollface · type **Shadow / Spectre** · dex id `0302` (sableye)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small shadow-dark imp with an exaggeratedly wide gap-toothed grin and mischievous slit eyes, faint prank-shaped markings, deep violet and black, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0302.png` · `pokefrontshiny/0302s.png` · `pokeback/0302.png` · `pokebackshiny/0302s.png` · `pokeicon/0302.png` · `footprints/0302.png` · `characters/0302.png`</sub>

### 57. Crocorok

**CROC** · Croc · type **Terra / Shadow** · dex id `0552` (krokorok)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a low, wide-jawed crocodile with mud-cracked armor plates and a lazy half-lidded grin, swamp green and dried-mud brown, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0552.png` · `pokefrontshiny/0552s.png` · `pokeback/0552.png` · `pokebackshiny/0552s.png` · `pokeicon/0552.png` · `footprints/0552.png` · `characters/0552.png`</sub>

### 58. Pumpcargo

**PUMP** · pump.fun · type **Blaze / Stone** · dex id `0219` (magcargo)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a slow tortoise with a rocket-shaped molten shell that occasionally flares upward, a mismatched eager expression, magma orange and charcoal, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0219.png` · `pokefrontshiny/0219s.png` · `pokeback/0219.png` · `pokebackshiny/0219s.png` · `pokeicon/0219.png` · `footprints/0219.png` · `characters/0219.png`</sub>

### 59. Quacklett

**QUACK** · Quack · type **Tide / Wind** · dex id `0580` (ducklett)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a round fluffy duckling with oversized webbed feet and a permanently cheerful open-beak quack, butter yellow and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0580.png` · `pokefrontshiny/0580s.png` · `pokeback/0580.png` · `pokebackshiny/0580s.png` · `pokeicon/0580.png` · `footprints/0580.png` · `characters/0580.png`</sub>

### 60. Wifpup

**WIF** · dogwifhat · type **Neutral** · dex id `0506` (lillipup)

**Front**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream
```

**Front shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Back**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas
```

**Back shiny**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream, rear view of the same creature, same palette and proportions, 96x96 pixel canvas, alternate colourway: shift hue 120-180 degrees, keep value structure identical
```

**Icon**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream, simplified chibi bust, readable at 32x32, chunky shapes, minimal detail
```

**Footprint**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream, solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail
```

**Overworld**

```text
16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design, a small scruffy terrier-mix dog with a pink knitted beanie fused permanently over its ears, a gentle squinting smile, sandy tan and cream, tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified
```

<sub>Files: `pokefront/0506.png` · `pokefrontshiny/0506s.png` · `pokeback/0506.png` · `pokebackshiny/0506s.png` · `pokeicon/0506.png` · `footprints/0506.png` · `characters/0506.png`</sub>

