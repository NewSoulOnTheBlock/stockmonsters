# landing-stockmonster

Marketing landing page for **Stockmonsters** — 194 US stock tickers reimagined as
collectible monsters in a playable retro RPG.

Next.js 15 (App Router) · TypeScript · Tailwind v4 · fully static.

---

## Run it

```bash
cd landing-stockmonster
npm install
npm run data     # regenerate JSON + sprites from the repo (see below)
npm run dev      # http://localhost:3000
npm run build && npm start
```

`npm run data` is only needed when the source game data changes. The generated
files (`src/data/*.json`, `public/mon`, `public/meme`, `public/og.png`,
`src/app/icon.png`) are committed, so a clean `npm install && npm run build`
works on its own.

---

## Pages

| Route | What it is |
| --- | --- |
| `/` | Hero + battle-screen mock, ticker tape, starter picker, type chart, the full 194-entry ledger, meme-wing teaser, FAQ |
| `/ledger/[ticker]` | One creature: sprite, dex entry, base stats, defensive matchups, contract address. 194 pages, statically generated |
| `/memes` | The 60 meme-coin monsters with their full dex entries |

Every stockmonster is deep-linkable at `/ledger/AAPL`, `/ledger/NVDA`, and so on.

---

## Where the data comes from

Nothing on the page is invented except the section copy. `scripts/build-data.mjs`
reads these files **read-only** from the parent repo and joins them:

| Source | Gives us |
| --- | --- |
| `Stockmonsters/stockmonsters-token-map.json` | the 194 tickers, creature names, companies, contract addresses, dex ids |
| `stockmonsters-reskin/creature-types.json` | elemental typing per ticker |
| `stockmonsters-reskin/dex-text.json` | species line + dex flavour text |
| `stockmonsters-reskin/meme-roster.json` + `meme-dex-text.json` | the 60 meme-coin monsters |
| `Stockmonsters/Data/Studio/pokemon/*.json` | **real** base stats, height, weight, catch rate |
| `Stockmonsters/Data/Studio/types/*.json` | **real** 18×18 type-effectiveness chart and each type's colour |

Two gotchas encoded in the script:

- `dex-text.json` is keyed by **1-based position in the token map**, not by
  `dexId`. Keying by `dexId` silently mismatches 88 of the 194 entries.
- `dbSymbol` (the engine's internal creature key, which is a Pokémon name) is
  used only as a build-time join key and is never emitted or rendered.

The only synthetic number on the site is the `drift` percentage on the ticker
tape and creature pages. It is a fixed FNV hash of the contract address, is
stable across builds, and is labelled as cosmetic wherever it appears — it is
never presented as a market quote.

Power tiers (Small Cap / Mid Cap / Blue Chip) are buckets of the real base-stat
total, not an invented ranking.

---

## Where the art comes from

`scripts/build-sprites.mjs` copies creature art out of the game. **It only ever
reads from `Stockmonsters/graphics/pokedex/pokefront/`** — those are the
AI-generated Stockmonsters fronts, and `sprite-manifest.json` records a generated
`front` for all 194 token creatures plus all 60 meme creatures.

Three directories are deliberately **not** used because they are still unmodified
Nintendo assets:

- `graphics/icons/` — Poké Balls, potions, berries (item icons, not creatures)
- `graphics/battlers/` — Pokémon trainer sprites, one of them holding a Poké Ball
- `graphics/pokedex/pokeicon/` — vanilla creature icons

The generated fronts sit on a noisy magenta chroma key whose exact colour varies
per file, so the script samples the key from each sprite's border (falling back
to a global sample when the key is fenced in by transparent margins), removes it
with a border-seeded flood fill, sweeps the dithered speckle, then shaves the
anti-aliased halo. Output is 96×96 transparent PNGs in `public/mon/` and
`public/meme/`.

All sprites are rendered with `image-rendering: pixelated` at integer sizes.

`public/skyline.png` and `public/og.png` are cut from
`Stockmonsters/graphics/titles/background.png`, which has a `.vanilla-bak`
sibling — i.e. it was replaced during the reskin and is original art.

---

## Deploy (Vercel)

The app is fully static — no server code, no env vars, no external requests at
runtime (fonts are self-hosted by `next/font`).

**From the dashboard**

1. Import the repo at <https://vercel.com/new>.
2. Set **Root Directory** to `landing-stockmonster`.
3. Framework preset: Next.js. Build `npm run build`, install `npm install`.
4. Deploy.

**From the CLI**

```bash
cd landing-stockmonster
npx vercel        # preview
npx vercel --prod # production
```

The live domain is set in `src/app/layout.tsx`:

```ts
metadataBase: new URL("https://stockmonsters.xyz"),
```

That value only affects absolute URLs in the OpenGraph/Twitter tags; everything
else is relative.

---

## Play CTA

Every call to action points at `PLAY_URL` in `src/lib/data.ts`
(`https://game.stockmonsters.xyz/`). It is a real MMO — every player gets their
own character in one shared world — so the CTA copy no longer talks about
limited seats or a streamed session. Change the constant in one place to
repoint it.
