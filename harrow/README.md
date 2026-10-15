# Harrow

Dark, real-time, top-down extraction game in the Stockmonsters world. Design: [DESIGN.md](DESIGN.md).

```bash
npm install
npm run assets   # re-key creature art out of ../Stockmonsters (needs Python + Pillow)
python scripts/slice-sheets.py [name]   # re-slice art-src/*-sheet.png (raider, shardcrawler, titan) into public/assets
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

## Layout
| Path | What |
|---|---|
| `src/data/roster.json` | The 12-creature slice roster: stats, types, move. Also drives `npm run assets` |
| `src/data/creatures.ts` | Type-vs-Harrow table, move cooldowns, scars |
| `src/scenes/Boot.ts` | Loads creature art and the raider spritesheet; draws the Harrow, terrain and props in code |
| `art-src/*-sheet.png` | Source character sheets. `scripts/slice-sheets.py` cuts each animation row into a uniform grid in `public/assets/` with frame ranges in `src/data/<name>.json`. Raider uses the sheet's alpha; Shardcrawler and Titan key out their flat navy background. Rows whose frames touch (Titan: dust, smoke, muzzle trails) split by frame count or a cut list, with each cut snapped to the emptiest nearby column |
| `src/scenes/Raid.ts` | The raid: map generation, AI, trust, Alarm, extraction |
| `src/ui/burrow.ts` | The hub: partner pick, party, supplies, workshop, log; applies raid results |
| `src/ui/hud.ts` | In-raid DOM HUD |
| `src/game/save.ts` | localStorage save (`harrow.save.v1`) |

## Notes
- Creature art comes from `../Stockmonsters/graphics/pokedex/pokefront/<dexId>.png`; `scripts/build-assets.py`
  flood-fills the leftover magenta generation background to transparent.
- Types were reassigned to match the art (the whale is Tide, the bull is Terra), so they differ from the PSDK game.
- In dev, the Phaser instance is on `window.game`. When the tab is hidden the loop pauses; drive it with
  `game.step(t, 16.67)` for scripted tests.
