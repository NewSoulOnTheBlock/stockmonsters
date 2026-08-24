#!/usr/bin/env node
/**
 * Build MEME-SPRITE-BRIEF.md for the 60 memecoin Stockmonsters, in the exact
 * same prompt format as SPRITE-BRIEF.md (shared style contract + subject,
 * with a per-sprite suffix appended for every one of the 7 art types).
 */
import fs from 'node:fs';

const roster = JSON.parse(fs.readFileSync('meme-roster.json', 'utf8'));

const STYLE = '16-bit era monster-collector RPG battle sprite, front-facing three-quarter view, clean hard-edged pixel art, limited palette of 12-16 colours with crisp 1px dark outline, soft cel shading with one light source from upper left, no background, fully transparent, no text, no logos, no letters, no watermark, full body centred with a few pixels of margin, original creature design';

const NEGATIVE = 'photorealism, blurry, 3d render, anti-aliased soft edges, drop shadow on background, text, logo, trademark, watermark, signature, border, frame, existing copyrighted characters, human figures';

const SUFFIX = {
  back: 'rear view of the same creature, same palette and proportions, 96x96 pixel canvas',
  shiny: 'alternate colourway: shift hue 120-180 degrees, keep value structure identical',
  icon: 'simplified chibi bust, readable at 32x32, chunky shapes, minimal detail',
  footprint: "solid dark silhouette of the creature's foot or ground contact only, 16x16, no interior detail",
  overworld: 'tiny 32x32 top-down walking sprite, 3/4 overhead view, extremely simplified',
};

const pad = (n) => String(n).padStart(4, '0');
const prompt = (subject, ...suffixes) => [STYLE, subject, ...suffixes].join(', ');

const sprites = (c) => [
  { key: 'Front', file: `pokefront/${pad(c.dexId)}.png`, prompt: prompt(c.subject) },
  { key: 'Front shiny', file: `pokefrontshiny/${pad(c.dexId)}s.png`, prompt: prompt(c.subject, SUFFIX.shiny) },
  { key: 'Back', file: `pokeback/${pad(c.dexId)}.png`, prompt: prompt(c.subject, SUFFIX.back) },
  { key: 'Back shiny', file: `pokebackshiny/${pad(c.dexId)}s.png`, prompt: prompt(c.subject, SUFFIX.back, SUFFIX.shiny) },
  { key: 'Icon', file: `pokeicon/${pad(c.dexId)}.png`, prompt: prompt(c.subject, SUFFIX.icon) },
  { key: 'Footprint', file: `footprints/${pad(c.dexId)}.png`, prompt: prompt(c.subject, SUFFIX.footprint) },
  { key: 'Overworld', file: `characters/${pad(c.dexId)}.png`, prompt: prompt(c.subject, SUFFIX.overworld) },
];

let out = `# Memecoin Stockmonsters — Sprite Production Brief

Art briefs and generation prompts for **60 memecoin Stockmonsters** — a companion roster to the
main 194, each one riffing on a real memecoin that has been notable since 2021, from Shiba Inu
through dogwifhat. Same format as \`SPRITE-BRIEF.md\`: one full prompt per sprite type, in the
same 16-bit pixel-art style, so the two rosters read as one continuous set.

Each creature reuses a currently-unused vanilla species slot (verified against no ticker or
dex-id collision with the existing 194), so \`NNNN\` below is that species' own dex id — drop
generated art at the listed \`graphics/\` paths and PSDK picks it up with no config change.

## 1. What each creature needs

| Sprite | Path (under \`graphics/\`) | Size | Notes |
|---|---|---|---|
| Front | \`pokedex/pokefront/NNNN.png\` | **96×96** | Battle sprite, faces the player |
| Front shiny | \`pokedex/pokefrontshiny/NNNNs.png\` | **96×96** | Recoloured variant |
| Back | \`pokedex/pokeback/NNNN.png\` | **96×96** | Rear view, seen over the player's shoulder |
| Back shiny | \`pokedex/pokebackshiny/NNNNs.png\` | **96×96** | Recoloured variant |
| Icon | \`pokedex/pokeicon/NNNN.png\` | **64×32** | Two 32×32 frames side by side (bob animation) |
| Footprint | \`pokedex/footprints/NNNN.png\` | **16×16** | Silhouette only, solid dark on transparent |
| Overworld | \`characters/NNNN.png\` | **128×128** | 4×4 grid of 32×32 frames: 4 walk frames × 4 facings |

All files are **PNG with a real alpha channel** (RGBA) — index-transparency will render with fringing.

## 2. Shared style contract

Prepend this to every prompt so the roster reads as one art set:

\`\`\`text
${STYLE}
\`\`\`

Negative prompt:

\`\`\`text
${NEGATIVE}
\`\`\`

**Keep designs original.** These are Stockmonsters inspired by the vibe of each memecoin, not
redrawn versions of trademarked mascots — no copying an existing coin's official character art.

## 3. Per-sprite prompt suffixes

Front is the shared style contract plus the subject alone; every other sprite appends one more
clause on top of that same subject so the creature stays on-model:

| Sprite | Append to the subject prompt |
|---|---|
| Front | *(none — style contract + subject only)* |
| Front shiny | \`${SUFFIX.shiny}\` |
| Back | \`${SUFFIX.back}\` |
| Back shiny | \`${SUFFIX.back}, ${SUFFIX.shiny}\` |
| Icon | \`${SUFFIX.icon}\` |
| Footprint | \`${SUFFIX.footprint}\` |
| Overworld | \`${SUFFIX.overworld}\` |

## 4. The roster

`;

roster.forEach((c, i) => {
  out += `### ${i + 1}. ${c.name}\n\n`;
  out += `**${c.ticker}** · ${c.coin} · type **${c.types.join(' / ')}** · dex id \`${pad(c.dexId)}\` (${c.dbSymbol})\n\n`;
  for (const s of sprites(c)) {
    out += `**${s.key}**\n\n\`\`\`text\n${s.prompt}\n\`\`\`\n\n`;
  }
  out += `<sub>Files: ${sprites(c).map((s) => `\`${s.file.replace('s.png', 's.png')}\``).join(' · ')}</sub>\n\n`;
});

fs.writeFileSync('MEME-SPRITE-BRIEF.md', out);
console.log(`wrote MEME-SPRITE-BRIEF.md — ${roster.length} creatures × 7 prompts = ${roster.length * 7} prompts`);
