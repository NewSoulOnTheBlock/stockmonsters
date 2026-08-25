# Stockmonsters — PSDK Mechanics Specification

**Purpose.** This is the single source of truth for reimplementing the Stockmonsters gameplay in
TypeScript on RPG-JS. It documents the exact mechanics of the Ruby PSDK engine that the original
game runs on, plus the exact shape of the JSON data files the implementer will parse.

You do not need to read any Ruby. Everything you need is here.

---

## 0. Provenance and confidence legend

### 0.1 What the game is

`Stockmonsters/` is a **Pokémon Studio 2.10.0 / PSDK** project — the stock PSDK Technical Demo,
reskinned. The engine itself is *not* in the repository (PSDK lives in a `pokemonsdk/` folder or a
`PSDK_BINARY_PATH` install and is absent here; `Game.exe` is only a launcher). Only the **data** and
a handful of custom scripts ship in the repo.

For this spec I cloned the upstream engine (`gitlab.com/pokemonsdk/pokemonsdk`, branch
`development`, `version.txt = 6715`) and read the battle engine source directly. Everything marked
VERIFIED below was read out of that source or out of this project's own data files.

### 0.2 Confidence tags

| Tag | Meaning |
| --- | --- |
| **[V-DATA]** | Read directly from this project's JSON/CSV/rxdata under `Stockmonsters/`. |
| **[V-ENGINE]** | Read directly from PSDK engine Ruby source (upstream `development` branch). The project pins no engine version, so it runs whatever PSDK build the author installed; the formulas below have been stable across PSDK .25/.26. |
| **[INFERRED]** | Not stated anywhere; my deduction. Treat as a design decision you are free to change. |

Where PSDK deviates from "vanilla Gen 5 as a fan would assume", it is called out inline and again in
§7.

### 0.3 Paths used throughout

```
Stockmonsters/Data/Studio/{pokemon,moves,abilities,items,types,natures,groups,zones,maps,maplinks,dex,trainers,worldmaps}/*.json
Stockmonsters/Data/configs/*.json          # engine configuration
Stockmonsters/Data/Text/Dialogs/*.csv      # all localized text, en column
Stockmonsters/Data/MapNNN.rxdata(.yml)     # RMXP map geometry + events
Stockmonsters/stockmonsters-token-map.json # ticker <-> dbSymbol join table
stockmonsters-reskin/{vocab.js,dex-text.json,meme-roster.json}
```

### 0.4 Project-level configuration **[V-DATA]** (`Data/configs/`)

These are real values from this project and should be your constants.

```jsonc
// settings_config.json
{ "pokemonMaxLevel": 100, "maxBagItemCount": 99, "baseStatMaxValue": 999,
  "trainerPartyMaxSize": 6,
  "isAlwaysUseForm0ForEvolution": false, "isUseForm0WhenNoEvolutionData": true }

// stats.json  — canonical stat and stat-stage indices
{ "max_total_ev": 510, "max_stat_ev": 252,
  "hp_index": 0, "atk_index": 1, "dfe_index": 2, "spd_index": 3, "ats_index": 4, "dfs_index": 5,
  "atk_stage_index": 0, "dfe_stage_index": 1, "spd_stage_index": 2,
  "ats_stage_index": 3, "dfs_stage_index": 4, "eva_stage_index": 5, "acc_stage_index": 6 }

// states.json — numeric status ids as stored on a creature
{ "poison": 1, "paralysis": 2, "burn": 3, "sleep": 4, "freeze": 5,
  "confusion": 6, "flinch": 7, "toxic": 8, "death": 9, "ko": 9 }

// display_config.json — 320x240 internal resolution, 16px tiles
// language_config.json — English only
// infos_config.json — gameTitle "Stockmonsters"
```

**Stat abbreviation trap.** PSDK's abbreviations are used everywhere in the data:

| Abbrev | Stat |
| --- | --- |
| `hp` | HP |
| `atk` | Attack |
| `dfe` | Defense |
| `spd` | **Speed** (not Special Defense!) |
| `ats` | Special Attack |
| `dfs` | Special Defense |

In move `battleStageMod` entries the same abbreviations are suffixed `_STAGE`: `SPD_STAGE` is
**Speed**, Special Defense is `DFS_STAGE`. Getting this backwards will silently corrupt every
stat-changing move.

### 0.5 Ruby integer arithmetic — read this before implementing anything

Every formula below was written in Ruby, where `Integer / Integer` is **floor division** and many
intermediate values are deliberately truncated. TypeScript's `/` is not. **Every division in this
document that operates on two integers is floor division.** I write it explicitly as `idiv(a, b)`:

```ts
const idiv = (a: number, b: number) => Math.floor(a / b);
```

Ruby's `.floor` on a Float is `Math.floor`. Ruby's `x.clamp(lo, hi)` is
`Math.min(Math.max(x, lo), hi)`.

Getting the truncation points wrong shifts damage by 1–3 points per hit, which is visible over a
battle. Follow the step ordering literally.

---

## 1. Turn-based battle

### 1.1 The battle loop **[V-ENGINE]**

```
loop:
  1. PLAYER ACTION CHOICE   — each battler on each side commits one Action
                              (Attack | Item | Switch | Flee | Mega | Shift | NoAction)
  2. SORT ACTIONS           — see §1.2
  3. EXECUTE ACTIONS        — pop one action at a time, execute fully, then
                              check for faints / exp distribution, then next action
  4. END OF TURN            — end-of-turn effects fire (§1.12)
  5. FAINT REPLACEMENT      — switch-in requests for anything that fainted
  6. if battle can continue: goto 1, else BATTLE END
```

`$game_temp.battle_turn` starts at **0** for the first turn (this matters for Quick Ball, which
multiplies by 5 only when `battle_turn == 0`).

The action list is sorted **once per turn**, at step 2. Speed changes that occur mid-turn do not
reorder the remaining actions.

### 1.2 Turn order **[V-ENGINE]**

PSDK stores move priority internally offset by +7 (`MOVE_PRIORITY_OFFSET = -7`, and
`internal = data.priority - (-7)`), so internal priorities run 0..12 with 7 = neutral. **The JSON
`priority` field is already the standard signed value** (`quick_attack: 1`, `trick_room: -7`,
`tackle: 0`) — see §6.2. You can ignore the offset entirely and work in signed space.

Ordering rules, highest first:

1. **HighPriorityItem** — a small class of items used before everything (engine-internal).
2. **Mega Evolution** (internal priority 8) — happens before any move that turn.
3. **Item use** and **Switch** and **Flee** (internal priority 6, i.e. relative −1)
   — these all resolve **before** any attack of relative priority ≤ 0.
   - Among Items: higher `spd` first.
   - Among Switches: higher `spd` first.
   - Item beats Switch.
   - Flee resolves before attacks **unless** the attack's relative priority > 0.
4. **Pursuit** against a switching target is boosted to priority 999 (resolves before the switch).
5. **Attacks**, ordered by:
   1. `move.priority` descending (signed JSON value, −7..+5).
   2. Then the item/ability priority tie-breakers, in this order:
      - `stall` ability → always last within its bracket.
      - holding `full_incense` or `lagging_tail` → last within its bracket.
      - `quick_claw` / `custap_berry` / `quick_draw` may promote a battler within its bracket
        (probabilistic; engine-internal).
   3. Then **`spd` descending** — where `spd` is the *live in-battle* Speed (base stat × stage
      multiplier × effect multipliers, including the ×0.25 paralysis multiplier).
   4. Under **Trick Room**, step 3 is inverted (`spd` ascending).
6. Speed ties: Ruby's `sort` is not stable and PSDK does not explicitly randomize.
   **[INFERRED]** Implement a coin flip on exact ties — that is what players expect.

### 1.3 Move resolution pipeline **[V-ENGINE]**

This is the exact order inside one Attack action. Each numbered step can abort the move.

```
1.  if user.hp <= 0            -> abort silently
2.  move_usable_by_user:
      a. every active effect gets on_move_prevention_user
         (sleep / freeze / paralysis / flinch / confusion / recharge / taunt / disable ...)
         -> :prevent aborts here
      b. if pp == 0 -> "no PP left" message, abort
      c. DECREMENT PP HERE (before anything else)     <-- see §1.11
3.  usage message ("X used Y!")
4.  pre-accuracy-check effect hooks
5.  if all targets are dead -> "but it failed", abort
6.  ACCURACY ROLL, per target (§1.4). Targets that miss are dropped.
      if no target survives -> abort
7.  battler remap (Snatch)
8.  IMMUNITY TEST, per target (§1.7.3): type immunity, ability immunity,
      Prankster-vs-Dark, powder-vs-Grass, Protect etc.
      if no target survives -> abort
9.  post-accuracy effect hooks
10. play animation
11. deal_damage      (§1.5)     ->
12.   && effect_working?        ->   secondary-effect probability roll (effectChance)
13.     && deal_status          (§1.9)
14.       && deal_stats         (§1.8)
15.         && deal_effect      (move-specific)
16. record move in history
```

Steps 11–15 are chained with `&&`: if damage kills every target, the status/stat steps do not run.

**`effect_working?`** (step 12) is the single roll for secondary effects on an `s_basic` move:
`bchance?(effectChance * abilityModifiers / 100)`. For `s_stat` / `s_status` moves it is
unconditionally true — the accuracy roll in step 6 *is* the "does it land" roll for those.

### 1.4 Accuracy and evasion **[V-ENGINE]**

```
if bypassAccuracy(user, target): hit
else:
  dice     = randInt(0, 99)                   // rng.rand(100) -> 0..99
  hitChance = move.accuracy
              * accuracyStageMultiplier(user.accStage)
              * evasionStageMultiplier(-target.evaStage)
              * (product of effect multipliers, e.g. Compound Eyes 1.3, Sand Veil 0.8)
  hit = dice < hitChance
```

Note `hitChance` is a **float that is not clamped to 100** — a Compound Eyes user with +acc stages
can exceed 100 and become unmissable. It is compared against an integer 0..99, so a `hitChance` of
100 is a guaranteed hit.

**Accuracy / evasion stage multiplier** (different from the regular stat one — thirds, not halves):

```
accEvaMultiplier(stage) = stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage)
```

| stage | −6 | −5 | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 | +5 | +6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mult | 0.333 | 0.375 | 0.429 | 0.5 | 0.6 | 0.75 | 1 | 1.333 | 1.667 | 2 | 2.333 | 2.667 | 3 |

Evasion is applied as `accEvaMultiplier(-target.evaStage)`, i.e. it is the reciprocal curve.

**`bypassAccuracy` returns true when any of:**

- `move.accuracy <= 0` — **this is the big one**: `accuracy: 0` in the JSON means "never misses",
  not "0%". 241 of 728 moves have it, including `aerial_ace`, `swift`, `swords_dance`, all Z-moves.
- the move is a status move targeting the user itself
- user or target has `no_guard`
- user has a `lock_on` effect on this target
- target has `glaive_rush`
- target has `telekinesis` (and the move is not OHKO)
- move is `toxic` and the user is Poison-type
- move is `blizzard` and it is snowing/hailing

### 1.5 Damage formula **[V-ENGINE]** — exact

PSDK uses the **Generation 4** damage formula (the Smogon DP formula), *not* the Gen 5+ chained
modifier formula. Source comment says so explicitly. Reproduce it step by step; the truncation
points are load-bearing.

```ts
function damages(user, target, move): number {
  // Critical hit is rolled HERE, once per (target, hit) — see §1.6
  const critical = calcCriticalHit(user, target, move.movecriticalRate);

  let d = idiv(user.level * 2, 5) + 2;              // step 1
  d = Math.floor(d * basePower(user, target));       // step 2
  d = idiv(Math.floor(d * atkStat(user, move)), 50); // step 3
  d = idiv(d, defStat(target, move));                // step 4   (integer division)
  d = Math.floor(d * mod1(user, target)) + 2;        // step 5
  d = Math.floor(d * ch(critical, user));            // step 6
  d = Math.floor(d * mod2(user, target));            // step 7
  d = idiv(d * randInt(85, 100), 100);               // step 8   R, inclusive 85..100
  d = Math.floor(d * stab(user, moveTypes));         // step 9
  d = Math.floor(d * typeMult(target.type1, moveTypes)); // step 10
  d = Math.floor(d * typeMult(target.type2, moveTypes)); // step 11
  d = Math.floor(d * typeMult(target.type3, moveTypes)); // step 12
  d = Math.floor(d * mod3(user, target));            // step 13
  const cap = target.substituteHp ?? target.hp;
  return clamp(d, 1, cap);                           // step 14
}
```

**Term definitions:**

| Term | Definition |
| --- | --- |
| `basePower` | `move.power` (JSON), then multiplied by every active effect's `base_power_multiplier` and floored after each. `power: 0` does **not** mean no damage — 74 damaging moves compute power at runtime (see §6.2). |
| `atkStat` | If `move.category === "physical"` → user's `atk_basis`; else user's `ats_basis` (§2.1). Then `× stageMultiplier` (see crit override below), then `× effect multipliers`, flooring after each. |
| `defStat` | If physical → target's `dfe_basis`; else target's `dfs_basis`. Same stage/effect treatment. |
| `mod1` | `BRN × RL × TVT × SR × FF` in Gen-4 terms. In PSDK: product of every effect's `mod1_multiplier`, then `× TVT`. Contains **burn (×0.5 on physical)**, **weather (×1.5 / ×0.5)**, Reflect/Light Screen, and spread-move reduction. |
| `TVT` | Spread-move reduction: `0.75` when the move hits more than one target in a double/triple battle; `1` otherwise. |
| `ch` | `1.5` on a critical hit (`×1.5` again with the `sniper` ability), else `1`. **Gen 6+ value — not 2.0.** |
| `mod2` | Product of every effect's `mod2_multiplier` (Me First, Helping Hand, Charge, etc.). |
| `R` | Uniform integer in **85..100 inclusive**. |
| `stab` | §1.7.2. |
| `typeMult` | §1.7.3. `type3` is a PSDK extension (Forest's Curse / Trick-or-Treat), normally `__undef__` → multiplier 1. |
| `mod3` | Product of every effect's `mod3_multiplier` (Solid Rock/Filter, Expert Belt, Tinted Lens, Type-Resist Berries, Life Orb…). |

**Non-standard: the damage is clamped to the target's current HP inside the damage function.**
This means overkill damage is invisible to everything downstream — recoil, drain, Innards Out and
damage history all see the *capped* number. Vanilla Pokémon does not do this. **[V-ENGINE]**

#### 1.5.1 Worked example — Ember, non-crit

Nvidrake (`$NVDA`, `charmander`) L50 vs Applion (`$AAPL`, `bulbasaur`) L50.
Both: IVs 31 across the board, EVs 0, neutral nature, no items, no abilities firing, clear weather.

Precomputed stats (§2.1):
- Nvidrake `ats_basis` = **80** (base Ats 60)
- Applion `dfs_basis` = **85** (base Dfs 65)
- Applion `maxHp` = **120** (base HP 45)

Move: `ember` — type `fire`, category `special`, power 40, accuracy 100, pp 25.

```
step 1  d = floor(50*2/5) + 2      = 20 + 2      = 22
step 2  d = 22 * 40                             = 880
step 3  d = idiv(880 * 80, 50) = idiv(70400,50) = 1408
step 4  d = idiv(1408, 85)                      = 16      <-- big truncation
step 5  d = floor(16 * 1.0) + 2                 = 18
step 6  d = floor(18 * 1.0)                     = 18
step 7  d = floor(18 * 1.0)                     = 18
step 8  R=100: idiv(18*100,100) = 18   |  R=85: idiv(18*85,100) = idiv(1530,100) = 15
step 9  STAB 1.5 -> floor(18*1.5)=27   |            floor(15*1.5)=22
step 10 fire vs grass = 2 -> 54        |            44
step 11 fire vs poison = 1 -> 54       |            44
step 12 __undef__ = 1 -> 54            |            44
step 13 mod3 1 -> 54                   |            44
step 14 clamp(1,120)  = 54             |            44
```

**Damage range: 44–54** out of 120 HP.

#### 1.5.2 Worked example — same move, critical hit

Only step 6 changes (`ch = 1.5`), plus the stage overrides in §1.6.

```
step 5  d = 18
step 6  d = floor(18 * 1.5) = 27
step 7  27
step 8  R=100 -> 27  | R=85 -> idiv(27*85,100) = 22
step 9  STAB -> floor(27*1.5)=40  | floor(22*1.5)=33
step 10 x2 -> 80                  | 66
```

**Crit damage range: 66–80.** (Note 80/54 ≈ 1.48, not exactly 1.5, because of the floors.)

#### 1.5.3 Worked example — with a mod1 (rain halving Fire)

Same move under Rain: `mod1 = 0.5`.

```
step 5  d = floor(16 * 0.5) + 2 = 8 + 2 = 10
...
step 10 R=100 -> floor(10*1.5)=15 -> x2 = 30
```

**30 damage at max roll** — rain roughly halves it, and the `+2` after the multiply softens the
halving slightly.

### 1.6 Critical hits **[V-ENGINE]**

```
CRITICAL_RATES = { 0: 0, 1: 6250, 2: 12500, 3: 50000 }   // out of 100_000
CRITICAL_RATES.default = 100000                           // count >= 4 -> always
```

```
criticalCount = move.movecriticalRate                      // from JSON, default 1
              + sum of all effect critical_count_modifier   // Focus Energy +2, Super Luck +1,
                                                            // Scope Lens +1, Lucky Chant -inf...
crit = randInt(0, 99999) < CRITICAL_RATES[criticalCount]
```

**`movecriticalRate: 1` is the neutral value, not 0.** A count of 0 means the move can never crit.

| `movecriticalRate` in JSON | crit chance | example moves |
| --- | --- | --- |
| 0 | 0% | `milk_drink` only (data artifact) |
| 1 | 6.25% (1/16) | 704 of 728 moves |
| 2 | 12.5% (1/8) | `slash`, `razor_leaf`, `stone_edge`, `crabhammer`, `night_slash`, `karate_chop`, `cross_chop`, `leaf_blade`, `psycho_cut`, `air_cutter`, `aeroblast`, `attack_order`, `blaze_kick`, `cross_poison`, `drill_run`, `poison_tail`, `razor_wind`, `shadow_claw`, `sky_attack`, `spacial_rend` |
| 3 | 50% | `s10_000_000_volt_thunderbolt` |
| ≥4 | 100% | reached only via effects |
| 5 (in JSON) | 100% | `frost_breath`, `storm_throw` — these also use `s_full_crit`, which force-crits directly |

**Crit stat-stage overrides** (applied inside the damage formula):

- Attacker: `atkModifier = crit ? max(atkModifier, 1) : atkModifier` — negative Atk/SpA stages are
  ignored on a crit.
- Defender: `defModifier = crit ? min(defModifier, 1) : defModifier` — positive Def/SpD stages are
  ignored on a crit.

Also: effects can hard-prevent (`Battle Armor`, `Shell Armor`, `Lucky Chant`) or hard-force
(`Laser Focus`, `Frost Breath`) a crit, checked before the roll.

**Crit is rolled inside `damages()`, so multi-hit moves reroll it on every hit.**

### 1.7 Types and STAB

#### 1.7.1 The 18 types **[V-DATA]**

`Data/Studio/types/*.json`. `id` 1..18, `textId` 0..17 (row index in `100003.csv` — this is the row
the reskin rewrites, see §8).

| id | dbSymbol | textId | Stockmonsters name |
| --- | --- | --- | --- |
| 1 | `normal` | 0 | Neutral |
| 2 | `fire` | 9 | Blaze |
| 3 | `water` | 10 | Tide |
| 4 | `electric` | 12 | Volt |
| 5 | `grass` | 11 | Flora |
| 6 | `ice` | 14 | Frost |
| 7 | `fighting` | 1 | Combat |
| 8 | `poison` | 3 | Toxic |
| 9 | `ground` | 4 | Terra |
| 10 | `flying` | 2 | Wind |
| 11 | `psychic` | 13 | Psionic |
| 12 | `bug` | 6 | Swarm |
| 13 | `rock` | 5 | Stone |
| 14 | `ghost` | 7 | Spectre |
| 15 | `dragon` | 15 | Wyrm |
| 16 | `steel` | 8 | Alloy |
| 17 | `dark` | 16 | Shadow |
| 18 | `fairy` | 17 | Fae |

There is a 19th pseudo-type, **`__undef__` with id 0**, which is what `type2` holds when a creature
is mono-type and what `type3` always is. It has no JSON file. Its effectiveness is always 1.

#### 1.7.2 STAB **[V-ENGINE]**

```
stab(user, moveTypes) =
    moveTypes.filter(t => t !== 0).some(t => user.hasType(t))
      ? (user.hasAbility('adaptability') ? 2 : 1.5)
      : 1
```

#### 1.7.3 Type effectiveness **[V-DATA]**

Each `types/<t>.json` lists only the **non-1** matchups in `damageTo: [{defensiveType, factor}]`.
**Any pair not listed is 1.0.** Do not build a sparse lookup that returns 0 for a miss.

Full 18×18 matrix (attacker rows, defender columns), reconstructed from the data — standard Gen 6+:

```
ATK\DEF   nor fir wat ele gra ice fig poi gro fly psy bug roc gho dra ste dar fai
normal    1   1   1   1   1   1   1   1   1   1   1   1   .5  0   1   .5  1   1
fire      1   .5  .5  1   2   2   1   1   1   1   1   2   .5  1   .5  2   1   1
water     1   2   .5  1   .5  1   1   1   2   1   1   1   2   1   .5  1   1   1
electric  1   1   2   .5  .5  1   1   1   0   2   1   1   1   1   .5  1   1   1
grass     1   .5  2   1   .5  1   1   .5  2   .5  1   .5  2   1   .5  .5  1   1
ice       1   .5  .5  1   2   .5  1   1   2   2   1   1   1   1   2   .5  1   1
fighting  2   1   1   1   1   2   1   .5  1   .5  .5  .5  2   0   1   2   2   .5
poison    1   1   1   1   2   1   1   .5  .5  1   1   1   .5  .5  1   0   1   2
ground    1   2   1   2   .5  1   1   2   1   0   1   .5  2   1   1   2   1   1
flying    1   1   1   .5  2   1   2   1   1   1   1   2   .5  1   1   .5  1   1
psychic   1   1   1   1   1   1   2   2   1   1   .5  1   1   1   1   .5  0   1
bug       1   .5  1   1   2   1   .5  .5  1   .5  2   1   1   .5  1   .5  2   .5
rock      1   2   1   1   1   2   .5  1   .5  2   1   2   1   1   1   .5  1   1
ghost     0   1   1   1   1   1   1   1   1   1   2   1   1   2   1   1   .5  1
dragon    1   1   1   1   1   1   1   1   1   1   1   1   1   1   2   .5  1   0
steel     1   .5  .5  .5  1   2   1   1   1   1   1   1   2   1   1   .5  1   2
dark      1   1   1   1   1   1   .5  1   1   1   2   1   1   2   1   1   .5  .5
fairy     1   .5  1   1   1   1   2   .5  1   1   1   1   1   1   2   .5  2   1
```

**Immunity handling.** A 0 multiplier is caught *before* damage, in the immunity test (step 8 of
§1.3): the move is aborted with "it doesn't affect X". So the `clamp(1, hp)` at the end of the
damage formula never resurrects a 0× hit. Ability-based immunities (Levitate, Volt Absorb, Flash
Fire, Sap Sipper, Bulletproof, Soundproof, Overcoat) and Ring Target / Scrappy / Foresight
overrides also live in that step.

### 1.8 Stat stages **[V-ENGINE]**

Seven stages per battler, all in **−6..+6**, indices from `stats.json`:
`0=atk, 1=dfe, 2=spd, 3=ats, 4=dfs, 5=eva, 6=acc`. All reset to 0 on switch out.

**Regular stat multiplier** (atk/dfe/spd/ats/dfs):

```
regularMultiplier(stage) = stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage)
```

| stage | −6 | −5 | −4 | −3 | −2 | −1 | 0 | +1 | +2 | +3 | +4 | +5 | +6 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mult | 0.25 | 0.286 | 0.333 | 0.4 | 0.5 | 0.667 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 |

Accuracy and evasion use the thirds curve in §1.4.

Live stat = `floor(basis × regularMultiplier(stage))` then `floor(× each effect multiplier)`.
Paralysis contributes a `spd_modifier` of **0.25** as an effect multiplier (not a stage).

**How a move's stat changes are applied.** `battleStageMod` entries carry **no target**. The target
is decided by `battleEngineMethod`:

| method | stat change lands on |
| --- | --- |
| `s_self_stat`, `s_self_stat_z_move` | the **user**, regardless of `battleEngineAimedTarget` |
| `s_stat` | the aimed target (which may be `user` for e.g. `swords_dance`) |
| `s_basic` | the aimed target, gated by the `effectChance` roll |
| bespoke methods | per-method |

The decisive case: `draco_meteor` has `battleEngineAimedTarget: "adjacent_pokemon"` (it damages the
foe) but `battleStageMod: [{ATS_STAGE, -2}]` with `s_self_stat` — the drop lands on the **user**.
Sign alone is not a reliable heuristic: 23 `s_self_stat` moves carry negative mods aimed at
`adjacent_pokemon` (`overheat`, `close_combat`, `superpower`, `hammer_arm`, `leaf_storm`,
`psycho_boost`, `v_create`, …) and a sign heuristic gets every one of them backwards.

`shell_smash` is the only move with both positive and negative modificators
(`ATK +2, DFE −1, SPD +2, ATS +2, DFS −1`, all on the user).

Many stat-manipulating moves have an **empty** `battleStageMod` because their handler computes the
change at runtime: `haze`, `topsy_turvy`, `acupressure`, `flower_shield`, `rototiller`, `gear_up`,
`magnetic_flux`, `venom_drench`, `fell_stinger`, `power_swap`, `guard_swap`, `heart_swap`,
`psych_up`. An empty array does **not** mean "no stat effect".

### 1.9 Non-volatile status conditions **[V-ENGINE]**

A creature holds **at most one** non-volatile status at a time (stored as a single integer).
Applying a status to an already-statused creature is prevented and produces "X is already
poisoned/burned/…".

| Status | id | Immune types | Damage / effect | Cured by |
| --- | --- | --- | --- | --- |
| **poison** | 1 | Poison, Steel | End of turn: `max(1, idiv(maxHp, 8))` | Antidote, Pecha Berry, Full Heal |
| **toxic** | 8 | Poison, Steel | End of turn: `max(1, idiv(maxHp * n, 16))` where `n` starts at 1 and increments **every end of turn, even when damage is skipped** by Magic Guard / Poison Heal. Counter resets to 0 on cure. | Antidote, Pecha Berry, Full Heal |
| **burn** | 3 | Fire | End of turn: `max(1, idiv(maxHp, 8))`, halved (`/2`) if the holder has Heatproof. Also `mod1_multiplier = 0.5` on **physical** moves the burned creature uses (skipped for `guts` and for `s_facade`). | Burn Heal, Rawst Berry, Full Heal |
| **paralysis** | 2 | **Electric** (Gen 6+ rule) | `spd_modifier = 0.25` (unless Quick Feet). Before each move: 25% chance to be fully paralyzed and lose the turn. | Paralyze Heal, Cheri Berry, Full Heal |
| **sleep** | 4 | none | On application, `statusCount = randInt(2, 5)` inclusive; halved (`floor(n/2)`) if the sleeper has Early Bird. Each time the sleeper tries to move, `statusCount -= 1`; if still > 0 it is asleep and the move is prevented (except `snore` and `sleep_talk`, which are allowed through); if it hits 0 the creature wakes and **acts normally that same turn**. | Awakening, Chesto Berry, Full Heal |
| **freeze** | 5 | Ice (only against Ice-type moves) | Each time the frozen creature tries to move, 20% chance to thaw. If it does not thaw, the move is prevented — **unless the move has `isUnfreeze: true`**, in which case the user thaws and the move goes through. | Ice Heal, Aspear Berry, Full Heal, being hit by a Fire move (engine effect) |

**Non-standard:** in PSDK's `sleep_check`, the counter is decremented on the sleeper's *move
attempt*, not at end of turn. A creature put to sleep with count 2 will lose exactly one turn.

**Status application checks**, in order, before applying:

1. every active effect's `on_status_prevention` (existing status, Immunity/Limber/Insomnia/
   Water Veil/Vital Spirit/Magma Armor/Leaf Guard/Misty Terrain/Safeguard/Substitute…)
2. type immunity (table above)
3. `thunder_wave` cannot paralyze Ground types
4. powder moves cannot affect Grass types
5. flinch cannot stack

### 1.10 Volatile statuses **[V-ENGINE]**

**Confusion** (`states.json` id 6, but stored as an *effect*, not the status field — so a creature
can be poisoned **and** confused):

```
duration  = randInt(1, 4) + 1 turns
each time the confused creature tries to move:
  if counter == 1: "snapped out of confusion", effect removed, move proceeds
  else:
    50% chance to hit itself:
      selfDamage = floor( (floor(level*2/5) + 2) * 40 * atk / dfe / 50 )
      // 40-power typeless physical hit against own Def, NO type effectiveness, NO STAB, NO crit
      move is prevented
```

Note PSDK uses **50%** self-hit (Gen 6 value), with a comment acknowledging Gen 7 is 33%.
Confusion does not fire while the creature is asleep or frozen.

**Flinch** (id 7): a one-turn effect. If a creature is flinched, its move is prevented for that
turn. Flinch is applied as a *status change* via `moveStatus: [{status: "FLINCH", luckRate: N}]`,
so it goes through the same `effectChance` gate as any other secondary. It cannot be applied twice
in a turn.

### 1.11 PP **[V-ENGINE]**

- `Skill.ppmax` is initialized to `data_move.pp` (JSON `pp`), and `pp = ppmax` at creation.
- **PP is decremented at step 2c of the pipeline (§1.3)** — before the accuracy roll. A move that
  misses still costs PP. A move that fails a `move_usable_by_user` check (asleep, paralyzed,
  flinched, confused-self-hit) does **not** cost PP.
- `Pressure` on any live foe costs an **extra** 1 PP (so 2 total).
- A move with `pp == 0` cannot be selected; if all four are at 0 the game forces Struggle
  (engine-internal).
- PP Up (`pp_up`, `isMax: false`) adds one PP stage; PP Max (`pp_max`, `isMax: true`) maxes it. The
  multiplier cap (8/5 of base) is engine-side and **[INFERRED]** for your port —
  `ppMax = base + floor(base * stage / 5)` with `stage` in 0..3 is the vanilla rule and matches.

### 1.12 End of turn **[V-ENGINE]**

After all actions have executed:

1. every active effect's `on_end_turn_event` fires, in effect-registration order over all alive
   battlers. This covers, in practice:
   - weather tick (duration decrement, weather chip damage: sandstorm and hail deal
     `max(1, idiv(maxHp, 16))` to non-immune battlers)
   - poison / toxic / burn damage
   - Leech Seed, Ingrain, Aqua Ring, Nightmare, Curse, Bind-family, Leftovers, Black Sludge
   - Speed Boost, Shed Skin, Moody, Slow Start decrement
   - Wish, Future Sight, Perish Song counters
   - screen / Tailwind / Trick Room / terrain duration decrements
2. dead effects are purged
3. faint / switch-in requests are queued for anything at 0 HP
4. EXP is distributed for anything that fainted this turn (§2.4)

### 1.13 Weather **[V-ENGINE]**

Weather is implemented as a `mod1_multiplier` in the damage formula (the Gen-4 "SR" slot).

| Weather | effect |
| --- | --- |
| Sunny | Fire ×1.5, Water ×0.5 (mod1) |
| Rain | Water ×1.5, Fire ×0.5 (mod1) |
| Harsh Sun | Fire ×1.5; Water moves fail entirely |
| Heavy Rain | Water ×1.5; Fire moves fail entirely |
| Sandstorm | `max(1, idiv(maxHp,16))` end-of-turn to non-Rock/Ground/Steel; Rock types get `sp_def_multiplier = 1.5` against **special** moves |
| Hail | `max(1, idiv(maxHp,16))` end-of-turn to non-Ice |
| Snow | Physical moves ×1.5 (`sp_def_multiplier` route) |
| Fog / Strong Winds | accuracy / type-effectiveness overrides |

This project's zones all have `forcedWeather: null`, so weather only ever arises from moves and
abilities in battle.

### 1.14 Flee (wild battles) **[V-ENGINE]**

```
a = playerActive.spdBasis        (or 1)
b = clamp(wildActive.spdBasis, 4, inf)
c = fleeAttemptCount             (reset to 0 whenever the player attacks)

if a > b:  guaranteed success
else:      value = idiv(a * 32, idiv(b, 4)) + 30 * c
           success = randInt(0, 255) < value
```

`spdBasis` here is the **unmodified** Speed stat (no stages, no paralysis).

Guaranteed outcomes checked first:
- **blocked** in a trainer battle, or when `$game_switches[41] (BT_NoEscape)` is on
- **success** if the fleeing creature is Ghost-type
- **failure** if trapped (Mean Look, Arena Trap, Shadow Tag, Bind…)

---

## 2. Creatures

### 2.1 Stat calculation **[V-ENGINE]**

```ts
// HP
maxHp = idiv((ivHp + 2*baseHp + idiv(evHp, 4)) * level, 100) + 10 + level

// The other five stats. natureIndex: atk=1, dfe=2, spd=3, ats=4, dfs=5
statBasis = idiv(
              (idiv((2*base + idiv(ev,4) + iv) * level, 100) + 5) * naturePercent,
              100
            )
```

`naturePercent` is the raw integer from `natures/<n>.json` (`90`, `100` or `110`) — **not** 0.9/1.1.
The nature multiply-then-floor-by-100 is the last operation, so a 110 nature on a base-80 stat gives
`floor(139 * 110 / 100) = 152`, not 153.

There is no Shedinja in this roster, but for completeness PSDK hard-codes `maxHp = 1` for
`db_symbol == :shedinja`.

Live in-battle stats then apply stat stages and effect multipliers (§1.8).

**IVs [V-ENGINE]:** generated per stat as `randInt(0, 31)`, clamped 0..31. Six independent RNG
streams (`Random::IV_HP` … `Random::IV_DFS`). A "shiny gets ≥16 IVs" flag exists
(`Pokemon::Shiny_IV`) but is **`false`**.

**EVs [V-ENGINE]:** start at 0. Caps from `stats.json`: `max_total_ev = 510`,
`max_stat_ev = 252`. `add_ev_X(n, currentTotal)`:

```
if n == 0: no-op
while (currentTotal + n) > 510: n -= 1
if evX > 252 - 1: reject (return false)
evX = clamp(evX + n, 0, 252)
```

EV gain on defeating an enemy: the enemy's `evHp/evAtk/evDfe/evSpd/evAts/evDfs` from its form data,
multiplied by `evModifier` = 1, ×2 for `macho_brace`, ×2 for Pokérus (stacking to ×4). Power items
add a flat +4 to their stat on top.

**Nature [V-ENGINE]:** `nature = (code >> 16) % 25`, where `code` is the creature's 32-bit personality
value. 25 natures in `natures/*.json`, each `{stats: {atk, dfe, spd, ats, dfs}}` with values in
`{90, 100, 110}`. The five neutral natures (`hardy`, `docile`, `serious`, `bashful`, `quirky`) are
all-100.

**Shiny [V-ENGINE]:** `shiny = (code & 0xFFFF) < 16`, i.e. **16/65536 ≈ 1/4096**. The Shiny Charm
adds 2 extra `code` reroll attempts; a fishing chain adds 2 per chain link (max 20 links → 40 extra
attempts).

**Gender [V-ENGINE]:** `gender = randInt(0,99) < form.femaleRate ? 2 : 1`. `femaleRate: -1` means
genderless (rendered as never female by this formula — check `femaleRate < 0` explicitly).

**Ability [V-ENGINE]:** `ABILITY_CHANCES = [49, 98, 100]`; roll `randInt(0,99)` and take the first
index whose threshold exceeds it — so slot 0 (49%), slot 1 (49%), slot 2 / hidden (2%). The three
slots come from `form.abilities` (an array of 3 dbSymbols; slots 0 and 1 are usually identical).

**Held item on generation [V-ENGINE]:** walk `form.itemHeld` (`[{dbSymbol, chance}, …]`) with a
running `rng = randInt(0,99)`; the first entry with `rng < chance` wins, otherwise subtract and
continue. Compound Eyes / Super Luck on the party leader inflate each chance
(`chance <= 10 ? chance*4 : chance*1.2`) for wild encounters.

### 2.2 Experience curves **[V-ENGINE] + [V-DATA]**

`form.experienceType` is an integer 0..5:

| value | curve | formula (total EXP to reach `level`) | count in this roster |
| --- | --- | --- | --- |
| 0 | Fast | `floor(4 * level³ / 5)` | 18 |
| 1 | Medium Fast | `level³` | 119 |
| 2 | Slow | `floor(5 * level³ / 4)` | 39 |
| 3 | Medium Slow (Parabolic) | `1` if level ≤ 1, else `floor(6*level³/5 - 15*level² + 100*level - 140)` | 72 |
| 4 | Erratic | see below | 4 |
| 5 | Fluctuating | see below | 2 |

```
Erratic(L):
  L <= 50 : floor(L³ * (100 - L) / 50)
  L <= 68 : floor(L³ * (150 - L) / 100)
  L <= 98 : floor(L³ * floor((1911 - 10*L)/3) / 500)
  L <= 100: floor(L³ * (160 - L) / 100)

Fluctuating(L):
  L <= 15 : floor(L³ * (24 + floor((L+1)/3)) / 50)
  L <= 35 : floor(L³ * (14 + L) / 50)
  else    : floor(L³ * (32 + floor(L/2)) / 50)
```

Note the nested `floor` calls in Erratic's third branch and Fluctuating's first/third branches —
those are Ruby integer divisions inside the expression.

Verified mapping against known species: `bulbasaur`/`charmander`/`abra` → 3 (Medium Slow),
`caterpie`/`eevee` → 1 (Medium Fast), `dratini`/`dragonite`/`arcanine` → 2 (Slow),
`clefairy`/`jigglypuff`/`marill` → 0 (Fast), `altaria`/`milotic`/`zangoose`/`finneon` → 4 (Erratic),
`hariyama`/`seviper` → 5 (Fluctuating). All match canon.

Level from EXP: `level` is the largest L with `curve(L) <= exp`, capped at
`min(pokemonMaxLevel=100, gameState.levelMaxLimit)`.

### 2.3 Level up **[V-ENGINE]**

On gaining enough EXP:

1. `level += 1` (capped at the level limit)
2. all six stats recompute from the new level; **current HP increases by the same amount as maxHp**
   (`hpDiff` is preserved, not the ratio)
3. `check_skill_and_learn(level)` — every `LevelLearnableMove` in the form's `moveSet` whose
   `level` exactly equals the new level is offered. If the creature has < 4 moves it is learned
   silently; otherwise the "forget a move?" UI opens. (In `silent` mode the engine appends and
   `shift()`s the oldest move off the front.)
4. `evolve_check(:level_up)` runs — **but see §2.5, it always returns false in this project.**

### 2.4 Experience distribution **[V-ENGINE]**

Runs when an enemy faints. Two modes depending on whether an `exp_share` item is **in the bag**
(this is PSDK's "global multi-exp" toggle, not a held item check).

```
expBase(enemy)   = enemy.baseExperience * enemy.level * (isTrainerBattle ? 1.5 : 1)

levelMultiplier  = switch 50 (BT_ScaledExp) OFF -> 1
                   ON  -> ((2*enemyLevel + 10) / (enemyLevel + receiverLevel + 10)) ** 2.5

expMultipliers(receiver) =
      1                                        // aura
    * (receiver.item == lucky_egg ? 1.5 : 1)
    * (receiver.fromPlayer ? 1 : 1.5)          // traded bonus
    * (receiver.loyalty > 200 ? 1.2 : 1)
    * (receiver.canEvolveByLevelUp ? 1.2 : 1)  // always 1 here, see §2.5

exp = floor(expBase * levelMultiplier * expMultipliers)
```

Then the split. Let `F` = number of party battlers that fought this turn and are alive
(clamped 1..6), `M` = number of alive battlers holding `exp_share`, `S` = switch 50 state.

```
multiExpFactor  = (S ? 10 : 14) * (M + 1)
foughtExpFactor = (S ? 5  : 7 ) * (M > 0 ? 2.0 : 1.0) * F

for each expable receiver:
  if it did NOT fight this turn:  gain = trunc(exp / multiExpFactor)
  else:                           gain = trunc(exp / foughtExpFactor)
                                       + (holds exp_share ? trunc(exp / multiExpFactor) : 0)
```

If `exp_share` is in the bag at all, a simpler global path is used instead:

```
gain = floor(expBase * levelMultiplier * expMultipliers)
gain = idiv(gain, (didNotFightThisTurn ? 2 : 1) * (S ? 5 : 7))
```

Recipients are excluded if they are at max level or fainted. With switch 40 (`BT_HardExp`) on and no
bag `exp_share`, only creatures that actually saw the fainted enemy get anything.

**Worked example.** A single L18 party creature knocks out a wild Applion (`bulbasaur`,
`baseExperience: 64`) at L20. No `exp_share` in bag, switches 40/50 off, loyalty ≤ 200, not traded.

```
expBase  = 64 * 20 * 1 = 1280
levelMul = 1
expMul   = 1
exp      = 1280
F = 1, M = 0
foughtExpFactor = 7 * 1.0 * 1 = 7
gain = trunc(1280 / 7) = 182
```

**182 EXP.** In a trainer battle the same kill gives `floor(1280 * 1.5) = 1920` → `trunc(1920/7) = 274`.

### 2.5 Evolution — **DISABLED IN THIS PROJECT**

**[V-DATA] Every one of the 254 creature files has `evolutions: []` on every form. There are zero
evolutions in the game.** This is deliberate: `stockmonsters-reskin/purge.js` strips them, with the
comment *"one token = one creature, so a creature evolving into a different company makes no
sense"*, and it also repoints `babyDbSymbol` at self.

Combined with `settings_config.json` (`isAlwaysUseForm0ForEvolution: false`,
`isUseForm0WhenNoEvolutionData: true`), `evolve_check` falls through to form 0, finds an empty
`evolutions` array there too, and **returns `false` unconditionally**. So:

- no level-up evolutions
- no stone evolutions (the 11 `StoneItem`s exist but do nothing)
- no trade / friendship / move / weather evolutions
- the ×1.2 "can evolve" EXP bonus in §2.4 never applies
- Moon Ball's catch bonus (which checks for a `moon_stone` evolution condition) never applies

For the MMO port: **do not implement evolution at all**, unless the design changes. The engine's
evolution condition vocabulary is documented in §6.1 for completeness if you ever want it back.

### 2.6 Learnsets **[V-DATA]**

`form.moveSet` is a flat array of `{move, klass, level?}`. Across the roster:

| `klass` | count | meaning |
| --- | --- | --- |
| `LevelLearnableMove` | 4 973 | has a `level` field; learned on reaching that level |
| `TechLearnableMove` | 10 393 | teachable by TM/HM |
| `TutorLearnableMove` | 3 677 | teachable by a move tutor |
| `BreedLearnableMove` | 1 386 | egg move |
| `EvolutionLearnableMove` | 85 | learned on evolving (**dead in this project**) |

**Initial moveset on generation [V-ENGINE]:** take all `LevelLearnableMove` entries with
`0 <= level <= creatureLevel`, sort by level **descending**, learn in that order until 4 moves are
held, then reverse the resulting array. Net effect: **the four highest-level moves the creature
could know, ordered oldest-first**.

A creature holds at most **4** moves.

---

## 3. Catching **[V-ENGINE]**

PSDK implements the Generation VI capture method.

```ts
// 1. Ball-specific rareness adjustment
function catchRate(target, playerActive, ball): number {
  if (ULTRA_BEAST.includes(target.dbSymbol))
    return ball.dbSymbol === 'beast_ball' ? target.rareness * 5 : target.rareness * 0.1;
  const special = BALL_RATE_CALCULATION[ball.dbSymbol];
  return special ? special(target, playerActive) : target.rareness;
}

// 2. Final rate 'a'
function finalRate(target, playerActive, ball): number {
  const rate        = catchRate(target, playerActive, ball);
  const bonusBall   = ball.catchRate;                 // JSON field, a plain multiplier
  const bonusStatus = STATUS_MODIFIER[target.status] ?? 1;
  return Math.floor(
    ((3 * target.maxHp) - (2 * target.hp)) * rate * bonusBall / (3 * target.maxHp) * bonusStatus
  );
}

STATUS_MODIFIER = { poison: 1.5, toxic: 1.5, paralysis: 1.5, burn: 1.5, sleep: 2.5, freeze: 2.5 }
```

```ts
// 3. Critical capture check (runs first, and can skip the shake loop entirely)
let a = finalRate(...);
const caught = pokedex.creatureCaught;   // total distinct species ever caught
let critMul = 0;
if      (caught > 600) critMul = 2.5;
else if (caught >= 451) critMul = 2;
else if (caught >= 301) critMul = 1.5;
else if (caught >= 151) critMul = 1;
else if (caught >= 31)  critMul = 0.5;
else                    critMul = 0;
const c = (a * critMul) / 6;
if (randInt(0, 255) < c) { criticalCapture = true; bounces = 1; CAUGHT; }

// 4. Shake loop
if (a >= 255) { bounces = 4; CAUGHT; }
else {
  for (let i = 0; i < 4; i++) {
    const b = Math.floor(65536 / Math.pow(255 / a, 0.1875));
    if (randInt(0, 65535) < b) bounces++;
    else break;
  }
}
caught = (bounces === 4) || criticalCapture;
```

`target.rareness` is `form.catchRate` from the creature JSON (0..255), overridable per-encounter.
**`rareness === 0` blocks the ball entirely** and returns it to the bag.

Catching is also blocked in trainer battles (except `rocket_ball`) and when
`$game_switches[43] (BT_NoCatch)` is on.

### 3.1 Ball bonuses that live in the engine, not the data **[V-ENGINE]**

The JSON `catchRate` is `1` for every conditional ball. The real behaviour:

| Ball | JSON `catchRate` | Engine rareness multiplier |
| --- | --- | --- |
| `poke_ball` | 1 | — |
| `great_ball` | 1.5 | — |
| `ultra_ball` | 2 | — |
| `master_ball` | **255** | — (255 ⇒ `a >= 255` ⇒ auto-catch) |
| `safari_ball` | 1.5 | — |
| `sport_ball` | 1.5 | — |
| `park_ball`, `dream_ball` | **255** | auto-catch (dream_ball also ×4 if target asleep) |
| `dive_ball` | 3.5 | ×3.5 more if fishing or surfing |
| `dusk_ball` | 1 | ×3.5 in a cave or at night |
| `fast_ball` | 1 | ×4 if `baseSpd >= 100` |
| `heavy_ball` | 1 | rareness `−20 / +20 / +30 / +40` by weight bands (0–204.7 / 204.8–307.1 / 307.2–409.5 / ≥409.6), clamped 1..255 |
| `level_ball` | 1 | ×8 / ×4 / ×2 if enemyLevel×4 ≤ / ×2 ≤ / < playerLevel |
| `love_ball` | 1 | ×8 if same species and opposite gender |
| `lure_ball` | 1 | ×3 while fishing |
| `moon_ball` | 1 | ×4 if the species has a moon-stone evolution — **never fires here** (§2.5) |
| `nest_ball` | 1 | `clamp(floor((41 − level) * 4096 / 10) / 4096, 1, 4)` for level < 30 |
| `net_ball` | 1 | ×3 vs Water or Bug types |
| `quick_ball` | 1 | ×5 on `battle_turn == 0` |
| `repeat_ball` | 1 | ×3 if already registered as caught |
| `timer_ball` | 1 | `min(1 + battle_turn * 1229/4096, 4)` |
| `beast_ball` | 1 | ×5 vs Ultra Beasts, ×0.1 for everyone else against non-Beast balls |
| `heal_ball` | 1 | fully heals the catch (`fully_heal`) |
| `luxury_ball` | 1 | doubles loyalty gain thereafter |

The full 27-ball table with prices is in §5.2.

### 3.2 Worked example

Wild **Applion** (`$AAPL`, `bulbasaur`, `catchRate: 45`) at L20, IVs 31, EVs 0.
`maxHp = idiv((31 + 90 + 0) * 20, 100) + 10 + 20 = 24 + 30 = 54`.

Player has 100 species registered (so `critMul = 1`), throws a **Great Ball** at **1 HP** while the
target is **asleep**.

```
rate        = 45
bonusBall   = 1.5
bonusStatus = 2.5 (sleep)
a = floor( ((3*54) - (2*1)) * 45 * 1.5 / (3*54) * 2.5 )
  = floor( 160 * 45 * 1.5 / 162 * 2.5 )
  = floor( 166.666... ) = 166

critical capture: c = 166 * 1 / 6 = 27.67 -> randInt(0,255) < 27.67  => ~10.8% instant catch
otherwise:
b = floor( 65536 / (255/166)^0.1875 ) = floor( 65536 / 1.08383 ) = 60467
p(one shake) = 60467/65536 = 0.92265
p(four shakes) = 0.92265^4 = 0.7247
```

**≈ 72.5% catch chance per shake sequence**, plus the ~10.8% critical-capture short-circuit —
overall ≈ 75.3%.

For contrast, the same creature at **full HP**, no status, **Poké Ball**:

```
a = floor( (162 - 108) * 45 * 1 / 162 * 1 ) = floor(15.0) = 15
b = floor( 65536 / (255/15)^0.1875 ) = 38527
p = (38527/65536)^4 = 0.1194   -> ~11.9%
```

---

## 4. Wild encounters

### 4.1 The data chain **[V-DATA]**

```
player position -> map id -> zone (zone.maps contains the map id)
                          -> zone.wildGroups: [ "group_N", ... ]
                          -> filter by systemTag / terrainTag / tool / customConditions
                          -> weighted pick from group.encounters
```

Every zone in this project maps to exactly **one** map.

### 4.2 Group selection **[V-ENGINE]**

On map load, `load_groups` collects the current zone's `wildGroups`, filters by
`customConditions`, and computes a per-group step counter.

At encounter time (walking) the engine picks:

```ts
const group = groups.find(g =>
     g.tool === null                              // walking/surfing, not fishing/rock-smash
  && g.systemTag  === tileSystemTagUnderPlayer
  && g.terrainTag === tileTerrainTagUnderPlayer);
```

For fishing / Rock Smash / Headbutt the same lookup runs against the tile **in front of** the
player, with `g.tool === 'OldRod' | 'GoodRod' | 'SuperRod' | 'RockSmash' | 'HeadButt'`.

`customConditions` entries are `{type, value, relationWithPreviousCondition}` reduced left-to-right:

- `type: "mapId"` → true when the player is on that RMXP map id
- `type: "enabledSwitch"` → true when `$game_switches[value]` is on
- `relationWithPreviousCondition` is `"AND"` everywhere in this project

### 4.3 Encounter rate (step counting) **[V-ENGINE] + [V-DATA]**

```ts
// per group, on map load and whenever a counter hits 0:
const steps = group.stepsAverage !== 0 ? group.stepsAverage : map.encounterStep;
counter = Math.round((randInt(0, steps-1) + randInt(0, steps-1) + 1) * encounterFactor);

// on every step taken:
counter -= 1;
// an encounter is possible when counter <= 1 for a group whose tags match the tile
```

`randInt(0,n-1) + randInt(0,n-1) + 1` is a triangular distribution over `1..2n-1` with mean `n`.

**In this project, `group.stepsAverage` is `0` on all 30 groups, and every map's
`stepsAverage` is `30`** (Studio writes it into `MapNNN.rxdata.encounter_step`, confirmed:
`Data/Map005.rxdata.yml` line `encounter_step: 30`). So the effective distribution is
`randInt(0,29) + randInt(0,29) + 1` ∈ 1..59, mean 30.

`encounterFactor` modifies it via the **party leader's** ability and held item:

| source | factor | effect |
| --- | --- | --- |
| ability `no_guard`, `illuminate`, `arena_trap` | ×0.5 | twice as many encounters |
| ability `white_smoke`, `quick_feet`, `stench` | ×2 | half as many |
| ability `snow_cloak` (while snowing), `sand_veil` (in sandstorm) | ×2 | half as many |
| item `cleanse_tag`, `pure_incense` | ×1.5 | fewer |
| (no PSDK default increases via item) | ×0.66 | slot exists, unused |

If ability and item pull in opposite directions, the **ability wins** (`return ability` in the
mismatch branch).

**[INFERRED] simplification for an MMO server:** a memoryless `Math.random() < 1/30` per qualifying
step gives the same mean and is far easier to keep authoritative server-side. If you want the exact
feel, keep the triangular counter — it produces noticeably fewer back-to-back encounters.

### 4.4 Picking the creature **[V-ENGINE]**

```ts
// 1. Expand the table by the battle size (1 for single, 2 for double, 5 for horde)
const pool = repeat(group.encounters, encounterAmount(group));

// 2. Roll a level and instantiate each candidate
//    level = randInt(levelSetup.min, levelSetup.max)     // inclusive
//    (an ability like Hustle/Vital Spirit/Pressure on the leader forces the max, 50% of the time)

// 3. Per-candidate rate multiplier from the leader's ability
let rate = 1;
//   keen_eye | intimidate : 0.5 if candidate.level + 5 < leader.level
//   cute_charm           : 1.5 if opposite gender
//   magnet_pull          : 1.5 if candidate is Steel
//   static | lightning_rod: 1.5 if Electric
//   flash_fire           : 1.5 if Fire
//   storm_drain          : 1.5 if Water
//   harvest              : 1.5 if Grass
//   repel active and candidate.level < leader.level (and not fishing) -> rate = 0

// 4. Weighted pick
weight_i = rate_i * encounters[i].randomEncounterChance
cumulative = prefix sums
pick: n = randInt(0, floor(totalWeight) - 1); index = first i with cumulative[i] > n
      (re-roll if the same creature was already picked for this battle)
```

**`randomEncounterChance` is a relative weight, not a percentage.** In this project it is `1` on all
118 encounter entries in all 30 groups, so selection is currently uniform over each group's table.
Group sums are 1,2,3,4,5,6,7 — none is 100. Implement the weighted roll anyway.

**Shiny setup** per entry: `{kind: "automatic", rate: -1}` (114/118) means "use the global 1/4096";
`{kind: "rate", rate: 0.01}` (4/118, all `gyarados`) forces a 1% shiny chance;
`{kind: "rate", rate: 0}` means "never shiny".

**Repel** (`PFM.game_state.repel_count > 0`) zeroes the weight of any candidate whose level is below
the party leader's, except while fishing. If every candidate in the group would be rejected, the
encounter does not trigger at all.

### 4.5 The encounter tables **[V-DATA]**

Levels are inclusive ranges. `%` is `weight / groupSum` — currently always uniform.
Creature `dbSymbol`s are still the vanilla names; the Stockmonsters display name comes from the
token map (§8).

| Zone (map) | Group | systemTag / terrainTag / tool / vsType | Gate | Encounters (level) |
| --- | --- | --- | --- | --- |
| `zone_0` (2 Start) | `group_0` | Pond / 0 / OldRod / simple | — | magikarp 5–18, barboach 18–24 |
| `zone_2` (20 Route) | `group_19` | Grass / 0 / — / simple | map 20 **and** switch 13 | caterpie 12–17, metapod 16–20, weedle 12–17, kakuna 16–20, yungoos 18–23, cutiefly 16–20, ledian 26–30 |
| | `group_20` | Grass / 0 / — / simple | map 20 **and** switch 11 | caterpie 12–17, metapod 16–20, weedle 12–17, kakuna 16–20, yungoos 18–23, cutiefly 16–20, ralts 18–23 |
| | `group_21` | Grass / 0 / — / simple | map 20 **and** switch 12 | metapod 16–20, kakuna 16–20, cutiefly 16–20, rattata 18–23, raticate 24–27, shiinotic 24–27, ariados 24–27 |
| | `group_22` | Grass / 0 / — / simple | map 20 **and** switch 14 | metapod 16–20, kakuna 16–20, cutiefly 16–20, morelull 18–23, rattata 18–23 |
| `zone_3` (6 Beach) | `group_6` | Sand / 0 / — / simple | map 6 | trapinch, binacle, sandygast — all 24–27 |
| | `group_7` | Ocean / 0 / — / simple | map 6 | remoraid, shellos, frillish, finneon — all 24–27 |
| | `group_8` | Ocean / 0 / OldRod / simple | map 6 | magikarp 5–18, chinchou 18–24 |
| | `group_9` | Ocean / 0 / GoodRod / simple | map 6 | gyarados 22–25 (shiny 1%), lanturn 22–25, dhelmise 22–25 |
| `zone_5` (5 River) | `group_1` | Grass / 0 / — / simple | — | marill, dewpider, lotad, tympole, buizel, gogoat — all 24–27 |
| | `group_2` | TallGrass / 0 / — / **double** | — | scyther, yanma, lombre, palpitoad — all 24–27 |
| | `group_3` | TallGrass / 0 / — / **double** | — | seviper 24–27, zangoose 29–33 |
| | `group_4` | Pond / 0 / — / simple | — | barboach, yanma, buizel, lotad, dratini — all 24–27 |
| | `group_0` | Pond / 0 / OldRod / simple | — | magikarp 5–18, barboach 18–24 |
| | `group_5` | Pond / 0 / GoodRod / simple | — | gyarados 22–25 (shiny 1%), barboach, whiscash, dratini 22–25 |
| `zone_6` (7 Cave) | `group_10` | Cave / 0 / — / simple | map 7 | zubat 18–26, roggenrola, klang, noibat, drilbur, bronzor 24–27 |
| | `group_11` | Pond / 0 / — / simple | map 7 | tynamo, wishiwashi, zubat — all 24–27 |
| | `group_12` | Pond / 0 / OldRod / simple | map 7 | barboach 18–26 |
| | `group_13` | Pond / 0 / GoodRod / simple | map 7 | whiscash 24–27 |
| | `group_14` | Cave / 0 / **RockSmash** / simple | map 7 | roggenrola 24–27, larvitar 24–27 |
| `zone_7` (8 Marsh) | `group_15` | Grass / 0 / — / simple | map 8 | croagunk, skorupi, goomy, tangela, venipede — all 24–27 |
| | `group_16` | TallGrass / 0 / — / simple | map 8 | carnivine, tangrowth, yanmega — all 24–27 |
| | `group_17` | Grass / **terrainTag 1** / — / simple | map 8 | mudbray, salandit, turtonator, rockruff, fletchinder, helioptile — all 24–27 |
| `zone_8` (9 Tundra) | `group_18` | Grass / 0 / — / simple | map 9 | snover, **vulpix form 1**, sneasel, snorunt, bergmite, crabominable — all 24–27 |
| `zone_18` (22 Bull Canyon) | `group_26` | Grass / 0 / — / simple | map 22 | pidgey 3–6, rattata 3–6, sandshrew 4–7, nidoranf 4–8 |
| `zone_19` (23 Bear Hollow) | `group_27` | Grass / 0 / — / simple | map 23 | caterpie 6–9, weedle 6–9, metapod 8–11, kakuna 8–11, pidgeotto 9–12 |
| `zone_20` (24 Dividend Falls) | `group_28` | Pond / 0 / — / simple | map 24 | squirtle 8–12, wartortle 12–14 |
| `zone_21` (25 Margin Bridge) | `group_29` | Grass / 0 / — / simple | map 25 | spearow 12–15, fearow 15–18, pidgeot 15–18, pikachu 13–16, raichu 17–19 |

Zones with **no** wild groups: `zone_1` (19 Exterior), `zone_4` (3 Hub), `zone_9`–`zone_17`
(interiors), `zone_22` (26 Exchange City).

**Orphaned groups** — defined but referenced by no zone, so unreachable as the data stands.
These are clearly the intended Super Rod tier; reinstate them if you want them:

| Group | tag / tool | Encounters |
| --- | --- | --- |
| `group_23` | Ocean / SuperRod (map 6) | gyarados 27–30 (shiny 1%), lanturn 27–30, dhelmise 27–30 |
| `group_24` | Pond / SuperRod (no gate) | gyarados 27–30 (shiny 1%), barboach, whiscash, dratini 27–30 |
| `group_25` | Pond / SuperRod (map 7) | whiscash 27–30 |

### 4.6 systemTag values in use **[V-DATA]**

Only six of Studio's terrain enum values appear: `Grass` (11 groups), `TallGrass` (3), `Cave` (2),
`Sand` (1), `Pond` (9), `Ocean` (4). Unused but legal: `RegularGround`, `Mountain`, `UnderWater`,
`Snow`, `Ice`, `HeadButt`.

There is **no `Surf` tool** — surfing tables are `tool: null` with `systemTag: "Pond"` or `"Ocean"`.

`terrainTag` is a *second* discriminator letting two tables share one visual tile type. It is `0`
everywhere except `group_17` (`terrainTag: 1`, the fire/rock Marsh table), and correspondingly the
Marsh map (`map008`) is the only map with any `terrainTag` data at all — exactly 4 tiles.

**Tile tagging in the source data is not portable.** Studio bakes numeric tags into
`maps/mapNNN.json → tileMetadata`, where `systemTag = 384 + localIndexInSystemtagsTileset`. The
numeric→name table lives inside the compiled `psdk.dat` and is **not recoverable from this repo**.
For RPG-JS: define your own tile-property enum on the tilemap and map it onto the six string names
above. Do not try to reverse the 384-offset numbers.

### 4.7 Fishing **[V-ENGINE]**

Casting a rod first rolls whether anything bites at all:

```
rate = { normal: 30, super: 45, mega: 60 }[rodType]
rate *= 1.5 if leader has sticky_hold or suction_cups
rate *= 1 + 0.1 * fishingCreekAmount        // tile property: how "deep" the water is
bite = randInt(0,99) < rate                 // always bites if creekAmount >= 3
```

On a bite the matching `tool` group is used as the encounter table. Consecutive fishing encounters
build a **fishing chain** (max 20), and each link adds 2 extra shiny reroll attempts.

### 4.8 Map stitching (`maplinks`) **[V-DATA]**

`maplinks/maplink_N.json` gives each map its `north/east/south/west` neighbours as
`{mapId, offset}` (offset is the perpendicular tile shift; `0` everywhere here). PSDK renders the
neighbour's tiles past the edge so the player walks continuously between maps with no transition.
It is **not** a warp system and does **not** merge encounter tables — the zone (and therefore the
encounter table) switches the moment the player's tile crosses the boundary.

Only 7 maps are linked, forming one corridor:

```
19 Exterior --east--> 20 Route --north--> 22 Bull Canyon --> 23 Bear Hollow
   --> 24 Dividend Falls --> 25 Margin Bridge --> 26 Exchange City
```

**Caveat:** maps 22–26 (that entire Stockmonsters route) have **no geometry**. Their
`mapNNN.json` has `sha1: ""` and empty `tileMetadata.layerData`, there is no `.tmx` and no
`.rxdata`, and they are absent from `MapInfos.rxdata.yml`. The zones, encounter groups, and
maplinks exist; the maps do not. You will be authoring those maps from scratch in RPG-JS anyway.

---

## 5. Economy and items

### 5.1 Money **[V-ENGINE]**

**Winning a trainer battle:**

```
money = additionalMoney
      + sum over the enemy battlers currently on the field of (battler.level * trainer.baseMoney)
money *= 2 if Happy Hour is active
money *= 2 if a party member holds amulet_coin AND that member participated
```

In a single battle "the enemy battlers currently on the field" is just the **last** enemy creature,
so in practice `money = lastEnemy.level * baseMoney`. `baseMoney` defaults to 1 when absent.

**Losing a battle** (when defeat is allowed):

```
basePayout = [8, 16, 24, 36, 48, 64, 80, 100, 120][badgeCount] ?? 120
lost = clamp(basePayout * playerLeadCreature.level, 0, currentMoney)
```

Wild battles award no money (there is no `baseMoney` on a wild encounter) — only Pay Day
(`s_payday`) and post-battle Pickup contribute.

The in-game currency is renamed **$AGORA** (see §8), and there is a custom script
`scripts/00002 AgoraCurrency.rb` in the project.

**Trainer rewards in this project [V-DATA]:**

| Trainer | vsType | baseMoney | AI | Party (levels) | Reward (last mon × baseMoney) |
| --- | --- | --- | --- | --- | --- |
| `trainer_0` | 1 | 20 | 2 | ariados 31, raticate 32 | 640 |
| `trainer_1` | 1 | 45 | 3 | ampharos 31, gallade 33 | 1 485 |
| `trainer_2` | **2** | 45 | 3 | gastrodon 32, lanturn 32, ludicolo 33 | 1 485 |
| `trainer_3` | 1 | 45 | 3 | serperior 32, milotic 32 | 1 440 |
| `trainer_4` | 1 | 45 | 3 | primarina 32, ninetales 32 | 1 440 |
| `trainer_5` | 1 | 10 | 5 | tangrowth 35, turtonator 35 | 350 |
| `trainer_6` | 1 | 45 | 3 | chesnaught, incineroar, toxicroak 32 | 1 440 |
| `trainer_7` | 1 | 45 | 3 | klinklang 32, talonflame 32 | 1 440 |
| `trainer_8` | 1 | 45 | 3 | eelektross 32, crabominable 32 | 1 440 |
| `trainer_9` | 1 | **250** | **7** | dragonite, flygon, goodra 33, latias, latios 34 | **8 500** |
| `trainer_10` | 1 | 30 | 1 | whirlipede 29, beedrill 32 | 960 |
| `trainer_11` | 1 | 30 | 1 | ribombee 28, lapras 31, meganium 32 | 960 |
| `trainer_12` | 1 | 30 | 1 | floatzel 31, mudsdale 32, abomasnow 32 | 960 |
| `trainer_13` | 1 | 10 | 1 | raticate 29, grovyle 28 | 290 |

### 5.2 Balls **[V-DATA]**

All 27 have `klass: "BallItem"`, `socket: 2`, `isBattleUsable: true`, `isMapUsable: false`,
`isLimited: true`, `isHoldable: true`, `flingPower: 0`, and an identical unused
`color: {red:255,green:0,blue:0,alpha:255}`.

`catchRate` is a **plain multiplier at ×1 scale** (a JSON number, sometimes fractional), **not**
percent. `255` is the guaranteed-catch sentinel.

| id | dbSymbol | price | catchRate | sprite | shop position |
| --- | --- | --- | --- | --- | --- |
| 1 | `master_ball` | 0 | **255** | ball_4 | 4 |
| 2 | `ultra_ball` | 800 | 2 | ball_3 | 3 |
| 3 | `great_ball` | 600 | 1.5 | ball_2 | 2 |
| 4 | `poke_ball` | 200 | 1 | ball_1 | 1 |
| 5 | `safari_ball` | 0 | 1.5 | ball_13 | 0 |
| 6 | `net_ball` | 1000 | 1 | ball_9 | 0 |
| 7 | `dive_ball` | 1000 | 3.5 | ball_10 | 0 |
| 8 | `nest_ball` | 1000 | 1 | ball_8 | 0 |
| 9 | `repeat_ball` | 1000 | 1 | ball_11 | 0 |
| 10 | `timer_ball` | 1000 | 1 | ball_12 | 0 |
| 11 | `luxury_ball` | 1000 | 1 | ball_7 | 0 |
| 12 | `premier_ball` | 20 | 1 | ball_5 | 0 |
| 13 | `dusk_ball` | 1000 | 1 | ball_15 | 0 |
| 14 | `heal_ball` | 300 | 1 | ball_16 | 0 |
| 15 | `quick_ball` | 1000 | 1 | ball_14 | 0 |
| 16 | `cherish_ball` | 0 | 1 | ball_6 | 0 |
| 492 | `fast_ball` | 0 | 1 | ball_19 | 0 |
| 493 | `level_ball` | 0 | 1 | ball_21 | 0 |
| 494 | `lure_ball` | 0 | 1 | ball_20 | 0 |
| 495 | `heavy_ball` | 0 | 1 | ball_22 | 0 |
| 496 | `love_ball` | 0 | 1 | ball_23 | 0 |
| 497 | `friend_ball` | 0 | 1 | ball_24 | 0 |
| 498 | `moon_ball` | 0 | 1 | ball_25 | 0 |
| 499 | `sport_ball` | 300 | 1.5 | ball_27 | 0 |
| 500 | `park_ball` | 0 | **255** | ball_26 | 0 |
| 576 | `dream_ball` | 0 | **255** | ball_28 | 0 |
| 851 | `beast_ball` | 1000 | 1 | ball_17 | 0 |

Reskin note: Poké Ball → **Core**, Master Ball → **Prime Core** (§8).

### 5.3 Healing items **[V-DATA]**

| dbSymbol | klass | price | heal | statusList |
| --- | --- | --- | --- | --- |
| `potion` | ConstantHealItem | 200 | `hpCount: 20` | — |
| `super_potion` | ConstantHealItem | 700 | `hpCount: 60` | — |
| `hyper_potion` | ConstantHealItem | 1500 | `hpCount: 120` | — |
| `max_potion` | RateHealItem | 2500 | `hpRate: 1` | — |
| `full_restore` | StatusRateHealItem | 3000 | `hpRate: 1` | all 8 |
| `revive` | StatusRateHealItem | 2000 | `hpRate: 0.5` | `["DEATH"]` |
| `max_revive` | StatusRateHealItem | 4000 | `hpRate: 1` | `["DEATH"]` |
| `sacred_ash` | StatusRateHealItem | 50000 | `hpRate: 1` | `["DEATH"]` (party-wide behaviour is engine-coded) |
| `revival_herb` | StatusRateHealItem | 2800 | `hpRate: 1` | `["DEATH"]`, `loyaltyMalus: 15` |
| `antidote` | StatusHealItem | 200 | — | `POISONED, TOXIC` |
| `paralyze_heal` | StatusHealItem | 300 | — | `PARALYZED` |
| `awakening` | StatusHealItem | 100 | — | `ASLEEP` |
| `burn_heal` | StatusHealItem | 300 | — | `BURN` |
| `ice_heal` | StatusHealItem | 100 | — | `FROZEN` |
| `full_heal` | StatusHealItem | 400 | — | all 8 |
| `ether` | PPHealItem | 1200 | `ppCount: 10` | — |
| `max_ether` | PPHealItem | 2000 | `ppCount: 100` | — |
| `elixir` | AllPPHealItem | 3000 | `ppCount: 10` | — |
| `max_elixir` | AllPPHealItem | 4500 | `ppCount: 100` | — |

"all 8" = `["POISONED","PARALYZED","BURN","ASLEEP","FROZEN","CONFUSED","FLINCH","TOXIC"]`,
in exactly that array order in every file that has it.

`hpRate` is a fraction of max HP; `hpCount` a flat amount; `ppCount: 100` is the "max out" sentinel.

Berry equivalents (all price 20, socket 4): `oran_berry` ConstantHeal 10; `sitrus_berry` RateHeal
0.25; `aguav/figy/iapapa/mago/wiki_berry` RateHeal 0.5; `cheri/chesto/pecha/rawst/aspear/persim/lum`
StatusHeal; `leppa_berry` PPHeal 10. **Their hold-and-auto-eat trigger conditions are not in the
data** — you must author them.

### 5.4 Prices and selling **[V-DATA] + [V-ENGINE]**

- `price` is the buy price. **Sell price = `idiv(price, 2)`** (verified in the engine's bag code).
- `price: 0` ⇒ neither buyable nor sellable. **493 of 935 items are price 0**, including every Mega
  Stone, every Z-Crystal, all HMs, 69 TMs, and 224 key items.
- Bag stack cap is `maxBagItemCount: 99`.

### 5.5 Bag pockets (`socket`) **[V-DATA] + [V-ENGINE]**

The engine's pocket table maps `socket` to a text row in `Data/Text/Dialogs/100015.csv`:

| socket | items | pocket (reskinned English) |
| --- | --- | --- |
| 0 | 21 | **broken entries** — all have `icon: "return"`, `price: 0`, `isHoldable: false`. Filter or fix. |
| 1 | 423 | Other Items (held items, Mega Stones, Z-Crystals, X-items, stones, repels, flutes, mail) |
| 2 | 27 | **Cores** (balls) |
| 3 | 107 | TMs / HMs |
| 4 | 67 | **Yields** (berries) |
| 5 | 225 | Key Items |
| 6 | 55 | Medicine |
| 7 | 0 | Battle Items (unused) |
| 8 | 10 | Rotom Powers |

Pocket display order in the menu is `[1, 2, 6, 3, 5, 4, 8]`; in battle `[1, 2, 6, 4]`;
in a shop `[1, 2, 6, 3, 4]`.

### 5.6 Everything the JSON does *not* tell you about items

**Item effects are 100% engine-coded.** `leftovers`, `choice_band`, `life_orb`, `focus_sash`,
`eviolite`, `king_s_rock`, `charcoal`/`magnet`/`mystic_water`/… (type boosters), all 47 Mega Stones,
all Z-Crystals, `exp_share`, `lucky_egg`, `amulet_coin`, `dire_hit`, `guard_spec`, and every berry's
hold trigger are stored as bare `{klass: "Item", …}` records with no effect data at all. Even the
*type* a type-booster boosts is absent (`charcoal` does not say "fire" anywhere).

Budget for hand-writing a `Map<dbSymbol, ItemEffect>` for every item you want to ship.

---

## 6. Data inventory

Every folder under `Data/Studio/`. Filename stem always equals `dbSymbol` (verified, zero
mismatches). `klass` is Studio's type discriminator.

### 6.1 `pokemon/` — 254 files **[V-DATA]**

Top level: `{klass: "Specie", id, dbSymbol, forms: [...]}`.
`id` is the National Dex number (1..781, sparse). Forms per specie: 210 have 1, 40 have 2, 2 have 3,
one has 8, one has 10.

Per-form fields:

| field | type | meaning |
| --- | --- | --- |
| `form` | int | form index (0 = base) |
| `formTextId` | int | text row for the form name (only on multi-form species) |
| `height`, `weight` | float | metres, kilograms. `weight` drives Heavy Ball and Low Kick/Grass Knot. |
| `type1`, `type2` | string | type dbSymbol; `type2` is `"__undef__"` for mono-types (159 of 254) |
| `baseHp/baseAtk/baseDfe/baseSpd/baseAts/baseDfs` | int | base stats |
| `evHp/evAtk/evDfe/evSpd/evAts/evDfs` | int | EV yield when defeated |
| `evolutions` | array | **empty in every file — see §2.5** |
| `experienceType` | int 0..5 | growth curve (§2.2) |
| `baseExperience` | int | EXP yield base (§2.4) |
| `baseLoyalty` | int | starting friendship (70 typical) |
| `catchRate` | int 0..255 | `rareness` in the catch formula (§3) |
| `femaleRate` | float | % chance female; `-1` = genderless |
| `breedGroups` | int[] | egg groups |
| `hatchSteps` | int | egg hatch steps |
| `babyDbSymbol`, `babyForm` | string, int | pre-evolution for breeding — **repointed at self by the reskin** |
| `itemHeld` | `{dbSymbol, chance}[2]` | wild held item table |
| `abilities` | string[3] | ability dbSymbols; slots 0/1/hidden (§2.1) |
| `frontOffsetY` | int | sprite offset |
| `resources` | object | `icon, iconShiny, front, frontShiny, back, backShiny, footprint, character, characterShiny, cry, hasFemale, egg, iconEgg` — filenames, **keyed by the original 4-digit dex number** (`"0001"`), which is why the reskin does not renumber ids |
| `moveSet` | array | learnset (§2.6) |

If evolutions were ever restored, an entry is
`{dbSymbol, form, conditions: [{type, value}, ...]}` where `type` ∈
`minLevel, maxLevel, itemHold, minLoyalty, maxLoyalty, skill1..skill4, weather, env, gender, stone,
dayNight, func, maps, trade, tradeWith, id, form, switch, nature, gemme`.

**Real example** — `pokemon/bulbasaur.json` = **Applion ($AAPL)**, abridged:

```jsonc
{
  "klass": "Specie", "id": 1, "dbSymbol": "bulbasaur",
  "forms": [{
    "form": 0, "height": 0.7, "weight": 6.9,
    "type1": "grass", "type2": "poison",
    "baseHp": 45, "baseAtk": 49, "baseDfe": 49, "baseSpd": 45, "baseAts": 65, "baseDfs": 65,
    "evHp": 0, "evAtk": 0, "evDfe": 0, "evSpd": 0, "evAts": 1, "evDfs": 0,
    "evolutions": [],
    "experienceType": 3, "baseExperience": 64, "baseLoyalty": 70,
    "catchRate": 45, "femaleRate": 12.5,
    "breedGroups": [1, 7], "hatchSteps": 5120,
    "babyDbSymbol": "bulbasaur", "babyForm": 0,
    "itemHeld": [{"dbSymbol": "none", "chance": 0}, {"dbSymbol": "none", "chance": 0}],
    "abilities": ["overgrow", "overgrow", "chlorophyll"],
    "frontOffsetY": 0,
    "resources": { "icon": "0001", "front": "0001", "back": "0001", "cry": "0001.ogg", "...": "..." },
    "moveSet": [
      {"move": "tackle",        "klass": "LevelLearnableMove", "level": 1},
      {"move": "growl",         "klass": "LevelLearnableMove", "level": 3},
      {"move": "leech_seed",    "klass": "LevelLearnableMove", "level": 7},
      {"move": "vine_whip",     "klass": "LevelLearnableMove", "level": 9},
      {"move": "poison_powder", "klass": "LevelLearnableMove", "level": 13},
      {"move": "sleep_powder",  "klass": "LevelLearnableMove", "level": 13},
      {"move": "take_down",     "klass": "LevelLearnableMove", "level": 15},
      {"move": "razor_leaf",    "klass": "LevelLearnableMove", "level": 19}
      /* ... plus TechLearnableMove / TutorLearnableMove / BreedLearnableMove entries */
    ]
  }]
}
```

Other roster examples: `charmander` = **Nvidrake ($NVDA)** (fire, 39/52/43/65/60/50, expType 3,
baseExp 62, catchRate 45); `squirtle` = **Teslazar ($TSLA)** (water, 44/48/65/43/50/64);
`pikachu` = **Auroryx ($AUR)**; `magikarp` = **Marvellon ($MRVL)**; `dratini` = **Maxlinyx ($MXL)**;
`caterpie` = **Amdeon ($AMD)**; `mightyena` = the meme **Shibazan ($SHIB)**.

### 6.2 `moves/` — 728 files **[V-DATA]**

45 fields, present in every file, in a fixed order.

| field | type | notes |
| --- | --- | --- |
| `klass` | `"Move"` | |
| `id` | int 1..728 | dense; also the text row index |
| `dbSymbol` | string | primary key |
| `mapUse` | int | 0 = no field use (712/728). Nonzero: 9 surf, 12 strength, 14 dig, 15 milk_drink/soft_boiled, 20 headbutt, 21 cut, 22 fly, 25 rock_smash, 26 waterfall, 27 flash, 28 whirlpool, 29 dive, 30 rock_climb/secret_power, 31 teleport |
| `battleEngineMethod` | string | effect dispatch key, always `s_*`. 258 distinct values. §6.2.1 |
| `type` | string | one of the 18 |
| `power` | int | 0 does **not** mean no damage (74 damaging moves compute power at runtime) |
| `accuracy` | int | **0 = never misses** (241 moves) |
| `pp` | int | one of 1,5,10,15,20,25,30,35,40 |
| `category` | `physical`\|`special`\|`status` | 290 / 198 / 240. Gen-4+ per-move split — `fire_lash` is a physical Fire move; `boomburst` is a special Normal move |
| `movecriticalRate` | int | crit index, neutral = **1** (§1.6) |
| `priority` | int | signed, −7..+5, neutral 0 (§1.2) |
| `isAuthentic` | bool | ignores Substitute (65) |
| `isBallistics` | bool | blocked by Bulletproof (24) |
| `isBite` | bool | Strong Jaw (7) |
| `isBlocable` | bool | affected by Protect/Detect (522) |
| `isCharge` | bool | two-turn charge (15) |
| `isDance` | bool | copied by Dancer (9) |
| `isDirect` | bool | **makes contact** (218) — Rocky Helmet, Iron Barbs, Tough Claws, Long Reach |
| `isEffectChance` | bool | **`false` on all 728 — dead field, never branch on it** |
| `isGravity` | bool | disabled under Gravity (9) |
| `isHeal` | bool | blocked by Heal Block (29) |
| `isKingRockUtility` | bool | can trigger King's Rock flinch (441) |
| `isMagicCoatAffected` | bool | reflected by Magic Coat / Magic Bounce (85) |
| `isMental` | bool | Aroma Veil / Mental Herb (4: attract, encore, taunt, torment) |
| `isMirrorMove` | bool | copyable by Mirror Move (516) |
| `isNonSkyBattle` | bool | (40) |
| `isPowder` | bool | Grass/Overcoat immune (7) |
| `isPulse` | bool | Mega Launcher (6) |
| `isPunch` | bool | Iron Fist (18) |
| `isRecharge` | bool | needs a recharge turn (8) |
| `isSnatchable` | bool | Snatch (75) |
| `isSoundAttack` | bool | Soundproof immune (27) |
| `isSlicingAttack` | bool | Sharpness (12) |
| `isUnfreeze` | bool | thaws the user (7) — see §1.9 freeze |
| `isWind` | bool | (12) |
| `battleEngineAimedTarget` | string | targeting enum, §6.2.2 |
| `battleStageMod` | `{battleStage, modificator}[]` | §1.8 |
| `moveStatus` | `{status, luckRate}[]` | never longer than 1 in this data |
| `effectChance` | int | 0/10/20/30/40/50/70/100 — the authoritative secondary-effect roll |
| `condition`, `appeal`, `jam`, `comboMoves`, `effectTags` | — | **Pokémon Contest data. Ignore all five for a battle engine.** `effectTags` are contest tags (`jam_all`, `repeatable`, `play_first_next_turn`…), NOT battle flags. |

`moveStatus[].status` enum: `FLINCH` (24), `PARALYZED` (21), `BURN` (18), `CONFUSED` (15),
`POISONED` (13), `ASLEEP` (8), `FROZEN` (6), `TOXIC` (2). Note `TOXIC` is distinct from `POISONED`,
and `FLINCH`/`CONFUSED` (volatiles) share the enum with the non-volatiles.

`luckRate` duplicates `effectChance` in 102 of 107 cases. Five mismatches, all `luckRate: 100`:
`dizzy_punch` (ec 20), `rock_slide` (ec 30), `sky_attack` (ec 30), `waterfall` (ec 20),
`toxic_thread` (ec 0). **Use `effectChance` as the roll**; `luckRate` is a within-entry weight that
only matters if a move ever gets multiple statuses (none do). `toxic_thread` needs a special case —
canonically it always poisons.

`battleStageMod[].battleStage` enum: `ATK_STAGE` (38), `DFE_STAGE` (37), `ATS_STAGE` (34),
`SPD_STAGE` (31), `DFS_STAGE` (29), `ACC_STAGE` (13), `EVA_STAGE` (4).
`modificator` values seen: −2 (20), −1 (79), +1 (60), +2 (24), +3 (2: `cotton_guard`, `tail_glow`),
+6 (1: `belly_drum`).

**Real example** — `moves/thunder_wave.json` (booleans that are `false` shown for completeness of
the first example only):

```jsonc
{
  "klass": "Move", "id": 86, "dbSymbol": "thunder_wave", "mapUse": 0,
  "battleEngineMethod": "s_status",
  "type": "electric", "power": 0, "accuracy": 90, "pp": 20, "category": "status",
  "movecriticalRate": 1, "priority": 0,
  "isAuthentic": false, "isBallistics": false, "isBite": false, "isBlocable": true,
  "isCharge": false, "isDance": false, "isDirect": false, "isEffectChance": false,
  "isGravity": false, "isHeal": false, "isKingRockUtility": false,
  "isMagicCoatAffected": true, "isMental": false, "isMirrorMove": true,
  "isNonSkyBattle": false, "isPowder": false, "isPulse": false, "isPunch": false,
  "isRecharge": false, "isSnatchable": false, "isSoundAttack": false,
  "isSlicingAttack": false, "isUnfreeze": false, "isWind": false,
  "battleEngineAimedTarget": "adjacent_pokemon",
  "battleStageMod": [],
  "moveStatus": [{ "status": "PARALYZED", "luckRate": 100 }],
  "effectChance": 100,
  "condition": "cool", "appeal": 1, "jam": 3,
  "comboMoves": ["hex", "smelling_salts"], "effectTags": ["jam_all"]
}
```

#### 6.2.1 `battleEngineMethod` frequency

258 distinct values. 28 methods cover 468 of 728 moves (64%); 200 methods are one-off bespoke
handlers.

| method | n | mechanic |
| --- | --- | --- |
| `s_basic` | 229 | standard damage, then `moveStatus`/`battleStageMod` on the **target** gated by `effectChance` |
| `s_self_stat` | 50 | damage (if any), then `battleStageMod` on the **user** |
| `s_stat` | 27 | no damage; `battleStageMod` on the aimed target; `effectChance` ignored |
| `s_status` | 18 | no damage; `moveStatus` on the aimed target; accuracy roll is the gate |
| `s_multi_hit` | 14 | 2–5 hits, see below |
| `s_2turns` | 12 | charge turn then attack (fly/dig/dive/bounce/…) |
| `s_recoil` | 12 | recoil fraction is **engine-coded per move**, not in JSON |
| `s_z_move` | 10 | Z-move damage, `accuracy: 0`, `pp: 1` |
| `s_absorb` | 9 | damage + heal 50% of damage dealt |
| `s_protect` | 9 | protection, priority +4 |
| `s_bind` | 8 | trap + chip for 4–5 turns |
| `s_reload` | 8 | hit, then recharge turn |
| `s_cantflee` | 7 | prevents target switching |
| `s_2hits` | 6 | exactly 2 hits |
| `s_heal` | 6 | restore 50% max HP |
| `s_stomp` | 4 | damage + flinch/paralysis, doubles vs Minimize |
| `s_terrain` | 4 | set terrain |
| `s_ohko` | 4 | one-hit KO, base accuracy 30 |
| `s_weather` | 4 | set weather |
| `s_heal_bell` | 3 | party status cure |
| `s_reflect` | 3 | side screen |
| `s_splash` | 3 | nothing |
| `s_sacred_sword` | 3 | ignores target defensive stages |
| `s_a_fang` | 3 | 65 BP bite, 10% elemental status **plus an independent 10% flinch not in the JSON** |
| `s_pledge` | 3 | ally combo |
| `s_follow_me` | 3 | redirect |
| `s_heal_weather` | 3 | weather-scaled heal |
| `s_stored_power` | 3 | power scales with stat stages |

**Multi-hit distribution [V-ENGINE] — non-standard.**
`MULTI_HIT_CHANCES = [2, 2, 2, 3, 3, 5, 4, 3]`, sampled uniformly. That is
**2 → 3/8 (37.5%), 3 → 3/8 (37.5%), 4 → 1/8 (12.5%), 5 → 1/8 (12.5%)** — not the vanilla
35/35/15/15. `skill_link` forces 5. Damage and crit are recomputed per hit.

#### 6.2.2 `battleEngineAimedTarget`

| value | n | meaning |
| --- | --- | --- |
| `adjacent_pokemon` | 506 | one adjacent creature, chosen by the user |
| `user` | 83 | self |
| `adjacent_all_foe` | 45 | all adjacent opponents (spread; ×0.75 TVT) |
| `any_other_pokemon` | 24 | anyone but the user, including non-adjacent |
| `all_pokemon` | 20 | everyone / global field effect |
| `adjacent_all_pokemon` | 19 | all adjacent **including your ally** (earthquake, surf) |
| `all_ally` | 17 | your whole side (screens, Tailwind, Heal Bell) |
| `random_foe` | 5 | `outrage, petal_dance, thrash, uproar, struggle` |
| `all_foe` | 4 | opposing **side** as an entity — entry hazards only |
| `adjacent_ally` | 3 | `helping_hand, aromatic_mist, hold_hands` |
| `user_or_adjacent_ally` | 1 | `acupressure` |
| `adjacent_foe` | 1 | `me_first` |

### 6.3 `abilities/` — 233 files **[V-DATA]**

```json
{ "klass": "Ability", "id": 1, "dbSymbol": "stench", "textId": 1 }
```

That is the **entire** file. Four fields, `textId === id` for all 233, ids 1..233 dense.

**Ability effects are 100% engine-coded — there is no effect data whatsoever.** This directory gives
you the canonical ability list and their ids and nothing else. Every behaviour (Levitate's Ground
immunity, Intimidate, Huge Power ×2, Multiscale ×0.5, Protean, Disguise, …) must be hand-authored,
keyed by `dbSymbol`.

The roster is Gen-7 complete (ends at `neuroforce`, id 233); no Gen-8+ abilities. Same for moves —
728 moves ending at the Gen-7 Z-move set.

### 6.4 `items/` — 935 files **[V-DATA]**

Base fields on every item (13, fixed order):

`id`, `dbSymbol`, `icon`, `price`, `socket`, `position`, `isBattleUsable`, `isMapUsable`,
`isLimited`, `isHoldable`, `isAllowingMega`, `flingPower`, `klass`, plus `isBerry` and — iff
`isBerry` — `berryData` and `cookingData`.

- `id` is 1..1150 with **215 gaps** — never index an array by it. `dbSymbol` is the real key.
- `icon` is an opaque filename stem, usually `%03d` of `id` but with 64 exceptions (21 items
  literally read `"return"`, a data bug). Never recompute it.
- **There is no `name` or `description` field.** Text lives in
  `100012.csv` (names), `9001.csv` (plurals), `100013.csv` (descriptions), row index = `id`.

`klass` discriminants:

| klass | n | extra fields |
| --- | --- | --- |
| `Item` | 683 | — |
| `TechItem` | 107 | `isHm`, `move` |
| `BallItem` | 27 | `spriteFilename`, `catchRate`, `color` |
| `StatusHealItem` | 24 | `loyaltyMalus`, `statusList` |
| `EVBoostItem` | 18 | `loyaltyMalus`, `count`, `stat` |
| `ConstantHealItem` | 12 | `loyaltyMalus`, `hpCount` |
| `StatBoostItem` | 12 | `loyaltyMalus`, `count`, `stat` (a `*_STAGE` value) |
| `EventItem` | 12 | `eventId` |
| `StoneItem` | 11 | — (inert here, §2.5) |
| `RateHealItem` | 7 | `loyaltyMalus`, `hpRate` |
| `StatusRateHealItem` | 5 | `loyaltyMalus`, `hpRate`, `statusList` |
| `FleeingItem` | 4 | — |
| `PPHealItem` | 3 | `loyaltyMalus`, `ppCount` |
| `RepelItem` | 3 | `repelCount` |
| `AllPPHealItem` | 2 | `loyaltyMalus`, `ppCount` |
| `HealingItem` | 2 | `loyaltyMalus` only (`dire_hit`, `guard_spec` — effects engine-coded) |
| `PPIncreaseItem` | 2 | `loyaltyMalus`, `isMax` |
| `LevelIncreaseItem` | 1 | `loyaltyMalus`, `levelCount` (`rare_candy`) |

`statusList` enum: `POISONED, TOXIC, PARALYZED, BURN, ASLEEP, FROZEN, CONFUSED, FLINCH, DEATH`
(`DEATH` = fainted; revives only).
`stat` enum: `HP, ATK, DFE, ATS, DFS, SPD` (EV form) and `ATK_STAGE, DFE_STAGE, ATS_STAGE,
DFS_STAGE, SPD_STAGE, ACC_STAGE` (stage form).

`loyaltyMalus` sign is inconsistent in the data: vitamins are `-5`, X-items `-1`, EV-reducing
berries `-10` (canonically they *raise* friendship), while the herbal items are `+5/+10/+15`
(canonically they *lower* it). **[INFERRED]** the engine subtracts for herbs and adds for the rest.
Do not trust the sign blindly.

`berryData`: `size, firmness (very_soft|soft|hard|very_hard|super_hard), minYield, maxYield, growth,
drainRate, naturalGiftType, naturalGiftPower`.
`cookingData`: `pokeblockColor, betterPokeblockChance, smoothness, spicyFlavor, dryFlavor,
sweetFlavor, bitterFlavor, sourFlavor` — contest data, ignorable.

**Real example** — `items/great_ball.json`-shaped, using `beast_ball.json` verbatim:

```json
{"id":851,"dbSymbol":"beast_ball","icon":"851","price":1000,"socket":2,"position":0,
 "isBattleUsable":true,"isMapUsable":false,"isLimited":true,"isHoldable":true,
 "isAllowingMega":false,"flingPower":0,"klass":"BallItem","spriteFilename":"ball_17",
 "catchRate":1,"color":{"red":255,"green":0,"blue":0,"alpha":255},"isBerry":false}
```

Vitamins: `hp_up/protein/iron/calcium/zinc/carbos` — `EVBoostItem`, price 10000, `count: 10`,
stat `HP/ATK/DFE/ATS/DFS/SPD`, `loyaltyMalus: -5`. Feathers: same but price 300, `count: 1`.
X-items: `StatBoostItem`, `count: 2` (Gen-VII two-stage), `x_attack`/`x_sp_atk`/`x_speed`/
`x_accuracy` 1000, `x_defense`/`x_sp_def` 2000.
Repels: `repel` 400/100 steps, `super_repel` 700/200, `max_repel` 900/250.
`escape_rope` is an `EventItem` (`eventId: 13`), not an item effect.

### 6.5 `types/` — 18 files **[V-DATA]**

```json
{ "textId": 2, "klass": "Type", "id": 2, "dbSymbol": "fire", "color": "#ee9474",
  "damageTo": [ {"defensiveType": "grass", "factor": 2}, {"defensiveType": "water", "factor": 0.5}, ... ] }
```

Only non-1 matchups are listed. Lookup: `find(d => d.defensiveType === other)?.factor ?? 1`.
See §1.7 for the full matrix and the `__undef__` sentinel.

### 6.6 `natures/` — 25 files **[V-DATA]**

```json
{ "klass": "Nature", "id": 3, "dbSymbol": "adamant",
  "stats": { "atk": 110, "dfe": 100, "spd": 100, "ats": 90, "dfs": 100 },
  "flavors": { "liked": "spicy", "disliked": "dry" } }
```

Values are **integer percentages** (90 / 100 / 110), applied as `× n / 100` with a floor.

### 6.7 `groups/` — 30 files **[V-DATA]**

Full example (`groups/group_0.json`) and field-by-field breakdown in §4. Fields:
`klass, id, dbSymbol, systemTag, terrainTag, tool, customConditions, encounters, stepsAverage,
vsType`.

**There are no `isDoubleBattle` / `isHordeBattle` fields in Studio 2.10** — battle size is
`vsType: "simple" | "double"` (`"triple"` and `"horde"` are legal but unused here).

`encounters[]` entry: `specie, form, shinySetup {kind, rate}, levelSetup, randomEncounterChance,
expandPokemonSetup`.
`levelSetup` is a tagged union: `{kind: "minmax", level: {minimumLevel, maximumLevel}}` (all 118
group entries) or `{kind: "fixed", level: N}` (all 35 trainer party entries).
`expandPokemonSetup` in groups only ever carries `evs` (all zero), `loyalty` (70), and `moves`
(four `"__undef__"` = use the natural learnset).

### 6.8 `zones/` — 23 files **[V-DATA]**

`{klass, id, dbSymbol, maps: int[], worldmaps: int[], panelId, warp {x,y}, position {x,y},
isFlyAllowed, isWarpDisallowed, forcedWeather, wildGroups: string[]}`.

In this project: every zone has exactly one map; `worldmaps` is empty everywhere (the link runs the
other way, from the worldmap `grid`); `warp` and `position` are `{null, null}` everywhere;
`forcedWeather` is `null` everywhere. Full table in §4.5.

`zone_0.json` is minified onto one line while the others are pretty-printed — do not write a
line-based reader.

### 6.9 `maps/` — 26 files, plus `map_info.json` **[V-DATA]**

`{klass, id, dbSymbol, stepsAverage, bgm {name,volume,pitch}, bgs {...}, tiledFilename, mtime,
sha1, tileMetadata}`.

- `stepsAverage` is **30 on all 26 maps** — the encounter rate (§4.3). Studio writes it into
  `Data/MapNNN.rxdata.encounter_step`.
- `tiledFilename` points at `Data/Tiled/Maps/<name>.tmx` (the authoring source).
- `tileMetadata` = `{width, height, tilesets[], tileByTileId[], layerData[]}` — the baked tile grid.
  `layerData` is row-major, `width * height` cells, each an array of indices into `tileByTileId`.
- **Maps 22–26 are stubs**: `sha1: ""`, no `tileByTileId`/`layerData`, no `.tmx`, no `.rxdata`.

`map_info.json` is Studio's sidebar tree (`{id, children, hasChildren, isExpanded, data}`), not
gameplay data. This project's tree is flat: root 0 with all 26 maps as direct children.

### 6.10 `maplinks/` — 26 files **[V-DATA]**

`{klass, id, dbSymbol, mapId, northMaps, eastMaps, southMaps, westMaps}` where each direction is
`{mapId, offset}[]`. Note `id !== mapId`. See §4.8.

### 6.11 `trainers/` — 14 files **[V-DATA]**

`{klass: "TrainerBattleSetup", id, dbSymbol, vsType (int 1|2|3 — note: int here, string in groups),
isCouple, baseMoney, bagEntries [{dbSymbol, amount}], battleId, ai (1..7), party[], resources,
additionalDialogs}`.

`party[]` entries share the `encounters[]` shape but always use `levelSetup.kind: "fixed"` and a
much richer `expandPokemonSetup` — `evs`, `ivs`, `loyalty`, `moves` (four explicit move dbSymbols),
`originalTrainerName`, `originalTrainerId`, `itemHeld`, `ability`, `nature`, `gender`,
`caughtWith`, `givenName`.

`resources`: `{sprite, artworkFull, artworkSmall, character, musics {encounter, victory, defeat,
bgm}}`. A trainer uses **either** `sprite` **or** the `artwork*` pair, never both.

**Real example** — `trainers/trainer_0.json`, first party member verbatim:

```jsonc
{
  "klass": "TrainerBattleSetup", "id": 0, "dbSymbol": "trainer_0",
  "vsType": 1, "isCouple": false, "baseMoney": 20, "bagEntries": [], "battleId": 0, "ai": 2,
  "party": [{
    "specie": "ariados", "form": 0,
    "shinySetup": { "kind": "automatic", "rate": -1 },
    "levelSetup": { "kind": "fixed", "level": 31 },
    "randomEncounterChance": 1,
    "expandPokemonSetup": [
      { "type": "evs",   "value": { "hp": 0, "atk": 50, "dfe": 0, "spd": 50, "ats": 0, "dfs": 0 } },
      { "type": "ivs",   "value": { "hp": 15, "atk": 15, "dfe": 15, "spd": 15, "ats": 15, "dfs": 15 } },
      { "type": "itemHeld", "value": "focus_sash" },
      { "type": "loyalty", "value": 150 },
      { "type": "moves", "value": ["sticky_web", "megahorn", "sucker_punch", "cross_poison"] },
      { "type": "originalTrainerName", "value": "Jack Duval" },
      { "type": "originalTrainerId", "value": 0 },
      { "type": "ability", "value": "swarm" },
      { "type": "nature", "value": "jolly" }
    ]
  } /* , raticate ... */ ],
  "resources": { "sprite": "", "artworkFull": "025_big", "artworkSmall": "025_sma",
                 "character": "", "musics": { "encounter": "", "victory": "", "defeat": "", "bgm": "" } },
  "additionalDialogs": []
}
```

`ai` levels 1..7 select a PSDK AI profile of increasing sophistication (`trainer_9` is the only 7).
The AI implementation is engine-coded; for the MMO, trainers are probably PvE NPCs and a simple
"pick the highest expected-damage move, switch if about to faint" heuristic is fine.

### 6.12 `dex/` — 8 files **[V-DATA]**

`{klass: "Dex", id, dbSymbol, startId, csv {csvFileId, csvTextIndex}, creatures: [{dbSymbol, form}]}`.
Dex number of entry `i` = `startId + i`; `startId` is `1` in all 8.

| file | creatures | note |
| --- | --- | --- |
| `national` | 254 | the full roster |
| `regional` | 254 | **byte-identical duplicate of `national`**, and collides on `id: 1` with `alola` — resolve by `dbSymbol`, never by `id` |
| `alola` | 113 | |
| `melemele` | 64 | |
| `akala` | 50 | |
| `ula_ula` | 60 | |
| `poni` | 44 | |
| `tower_dex` | 110 | |

### 6.13 `worldmaps/` — 4 files (2 world maps, stored twice) **[V-DATA]**

`{id, dbSymbol, klass, image, grid: int[][], regionName {csvFileId, csvTextIndex}}`.
`grid[row][col]` holds a **zone id** or `-1`. Since every zone's `worldmaps` array is empty, this
grid *is* the zone↔worldmap link.

Each world map exists under two filenames (`worldmap_N.json` and `N.json`). For world map 1 they are
identical; for world map 0 they **disagree** (`worldmap_0.json` is 21×32 covering zones 0–16;
`0.json` is 20×26 covering only zones 2–8). **Read `<dbSymbol>.json`, ignore `<id>.json`.**

Zones 17–22 appear on no world map grid, even though zones 18–22 have `isFlyAllowed: true` — Fly has
no destination for the new route.

### 6.14 Text (`Data/Text/Dialogs/*.csv`) **[V-DATA]**

CSV, header row `en,fr,it,de,es,ko,kana`. Row index `N+1` = `textId` `N` (row 1 is textId 0).
Only English is populated for the reskinned rows.

| file | contents | rows |
| --- | --- | --- |
| `100000.csv` | creature names (row 0 = "IPO"/Egg, then by dex id) | 808 |
| `100001.csv` | creature species lines ("Blossom Crown Stockmonster") | 808 |
| `100002.csv` | dex descriptions | 808 |
| `100003.csv` | type names (18) | 18 |
| `100004.csv` / `100005.csv` | ability names / descriptions | 234 |
| `100006.csv` / `100007.csv` | move names / descriptions | 729 |
| `100010.csv` | zone / map names | 355 |
| `100012.csv` / `100013.csv` | item names / descriptions | 1151 |
| `100015.csv` | bag pocket names | 15 |
| `100020.csv` | UI strings (HP, ATTACK, Lv., …) | 85 |
| `18.csv`, `19.csv`, `22.csv` | battle messages | — |

`.en.dat` files sitting next to the CSVs are compiled caches; they must be deleted whenever the CSV
changes or the game will show stale text.

---

## 7. Where PSDK deviates from "vanilla Gen 5"

If you implement from memory of the mainline games, these will bite you.

1. **Gen 4 damage formula, not Gen 5.** PSDK uses the DP formula with explicit `Mod1/CH/Mod2/R/
   STAB/Type/Mod3` stages and floors between each, not Gen 5's chained 4096-based modifiers. Damage
   numbers will differ by a few points if you use the wrong one. Source comment in
   `10 Move/101 Damage_Calc.rb` says so.
2. **Crit multiplier is 1.5, not 2.0** (Gen 6+ value), and crit chance for a normal move is 1/16.
3. **Crit rate is a 1-based index.** `movecriticalRate: 1` is *normal*, `0` means never-crit.
4. **Damage is clamped to the target's current HP inside the damage calculation.** Recoil, drain,
   Innards Out, and damage history all see the capped value, never the raw overkill.
5. **PP is consumed before the accuracy roll**, but not consumed when a status (sleep/paralysis/
   flinch/confusion) prevents the move.
6. **Sleep counts down on the sleeper's move attempt**, not at end of turn, and the creature acts
   normally on the turn it wakes.
7. **Electric types cannot be paralyzed** (Gen 6+), and `thunder_wave` cannot hit Ground types.
8. **Confusion self-hit is 50%** (Gen 6 value), and the self-damage is a typeless 40-power physical
   hit with **no** type effectiveness, STAB, or crit.
9. **Multi-hit distribution is 37.5 / 37.5 / 12.5 / 12.5**, not 35/35/15/15.
10. **`accuracy: 0` means never-miss**, not 0% — for 241 moves including damaging ones like
    `aerial_ace` and `swift`.
11. **`power: 0` does not mean "no damage"** — 74 damaging moves compute power at runtime.
    Use `category !== 'status'` to decide whether a move deals damage.
12. **`isEffectChance` is `false` on all 728 moves** — it is a dead field. Never branch on it.
13. **`SPD` is Speed and `DFS` is Special Defense**, in stats, EVs, IVs and `*_STAGE` names.
14. **Nature multipliers are integers 90/100/110** applied as `× n / 100` with a floor at the very
    end of the stat formula.
15. **`condition`, `appeal`, `jam`, `comboMoves` and `effectTags` on moves are Pokémon Contest data**,
    not battle data. `effectTags` in particular looks like a battle-flag field and is not.
16. **Stat-change targeting is decided by `battleEngineMethod`, not by `battleEngineAimedTarget`
    and not by the sign of `modificator`.** `s_self_stat` routes to the user even when the move
    targets a foe.
17. **`type2: "__undef__"` is the mono-type sentinel** (type id 0), and `type3` exists as a PSDK
    extension. Both must return effectiveness 1.
18. **All ability effects and all item effects are engine-coded**; the JSON is a pure registry.
    Budget accordingly — 233 abilities and ~200 mechanically relevant items.
19. **`battleEngineMethod` is 258 hand-written handlers**, not a data-driven effect system. 28 of
    them cover 64% of moves.
20. **This project has zero evolutions** (§2.5) and zero non-vanilla creature data — the reskin is
    a *text and sprite* layer only.
21. **Move `priority` in the JSON is already signed** (−7..+5). The engine's internal +7 offset is
    invisible in the data; ignore it.
22. **Balls' conditional multipliers are engine-coded** — every conditional ball reads
    `catchRate: 1` in the JSON (§3.1).
23. **`randomEncounterChance` is a relative weight**, currently 1 everywhere (so uniform), and
    group sums are 1..7, never 100.
24. **Item/Switch/Flee actions resolve before priority-0 moves**, at effective priority −1.
25. **Weather modifies damage in the Mod1 slot**, alongside burn and screens, so it is applied
    *before* the `+2`, which slightly softens both boosts and reductions.

---

## 8. The reskin layer (naming)

**None of the reskin is in the game data.** `Data/Studio/**` still uses vanilla `dbSymbol`s
(`bulbasaur`, `charmander`, `pikachu`). All renaming happens in the text CSVs and in the sprite
files. This is why creature ids were deliberately *not* renumbered — `form.resources` keys sprites
by the original 4-digit dex number.

### 8.1 The roster **[V-DATA]**

254 creature files = **194 stock tickers + 60 memes**.

- `Stockmonsters/stockmonsters-token-map.json` (and the identical
  `stockmonsters-reskin/token-map.json`) is the join table for the 194 stocks:
  `[{ticker, stockmonster, company, address, dbSymbol, dexId}]`, sorted by `dexId`.
  Example: `{"ticker":"AAPL","stockmonster":"Applion","company":"Apple",
  "address":"0xaF3D…","dbSymbol":"bulbasaur","dexId":1}`.
- `stockmonsters-reskin/meme-roster.json` covers the other 60:
  `[{ticker, coin, name, dbSymbol, dexId, types, subject}]`.
  Example: `{"ticker":"SHIB","coin":"Shiba Inu","name":"Shibazan","dbSymbol":"mightyena",
  "dexId":262}`.
- `stockmonsters-reskin/creature-overrides.json` is the generated `{names: {dexId → name},
  blank: [dexIds of deleted creatures]}` map that the text rewriter consumes.

### 8.2 dex-text.json keying — **a real bug to be aware of**

`stockmonsters-reskin/dex-text.json` has 194 entries `{species, description}`.
**Its keys are the 1-based position in `token-map.json` (sorted by dexId), NOT the dexId.**

I verified this: matching each entry's description against the token map by **position** gives
194/194 name matches; matching by **dexId** gives 106/194. The two coincide for the first 106
entries and diverge from position 107 onward (position 107 is `MPWR`/Monolithan with dexId 114).

`stockmonsters-reskin/apply-dex-text.mjs` treats the key as a dexId (`rowIdx = dexId + 1`), so it
writes 88 of the 194 species/description rows to the wrong creature. If you port the text, join
through the token map by position, not by key-as-dexId.

`vocab.js`'s hand-written `CREATURES` table is a superseded fallback — `creature-overrides.json`
takes precedence when present.

### 8.3 Global vocabulary **[V-DATA]** (`stockmonsters-reskin/vocab.js`)

Applied to all text CSVs except the pure-proper-noun files (100000 creature names, 100003 types).

| Original | Stockmonsters |
| --- | --- |
| Pokémon | Stockmonster |
| Pokédex | Ledger |
| Poké Ball | **Core** |
| Master Ball | **Prime Core** |
| Trainer | Hunter |
| Professor | Analyst |
| Gym | Exchange |
| Gym Leader | Market Maker |
| Elite Four | Board of Governors |
| Pokémon League | Market Council |
| Pokémon Center | Clearing House |
| Poké Mart | Exchange Post |
| Badge | License |
| Egg | **IPO** |
| Berry | **Yield** |
| Poké Dollars / money | **$AGORA** |
| Storage System | Portfolio Vault |
| Day Care | Incubator |
| Safari Zone | Speculation Zone |
| Battle Tower | The Exchange Tower |
| Hall of Fame | Hall of Legends |
| PSDK / PokémonSDK / Pokémon Studio | Stockmonsters |

Type names are replaced positionally by `textId` (§1.7.1). Shop prices are rewritten from
`$[VAR NUM7(...)]` to `[VAR NUM7(...)] $AGORA` so the ticker follows the number.

### 8.4 Asset status

Per the project's own notes, the reskin is **incomplete**: only `pokedex/pokefront/` sprites are
safe to ship; overworld sprites, icons, backs and cries are still vanilla Pokémon assets. Treat the
`resources` block on each form as a *mapping to be replaced*, not as shippable filenames.

---

## 9. Recommended implementation order

Build in this order; each step is playable/testable on its own.

1. **Data loading + typed models.** Parse `pokemon/`, `moves/`, `types/`, `natures/`, `abilities/`,
   `items/`, `groups/`, `zones/` into TypeScript with discriminated unions on `klass`. Build the
   18×18 type matrix at load time with a default of 1. Build the `dbSymbol → StockmonsterName` join
   from `token-map.json` + `meme-roster.json` (and fix the dex-text keying, §8.2). Write a smoke
   test that every `specie`, `move`, `ability`, `itemHeld.dbSymbol` and `abilities[]` referenced
   anywhere resolves.
2. **Creature instantiation and stats.** `maxHp`, `calcRegularStat`, IV/EV/nature/shiny/gender/
   ability/held-item generation, exp curves, level↔exp conversion, initial moveset. Golden-test
   against §2's numbers (Applion L50 maxHp 120, Nvidrake L50 Ats 80). **Skip evolution entirely.**
3. **Damage formula in isolation.** Implement `damages()` literally, with an injectable RNG. Unit
   test against §1.5.1–§1.5.3 (44–54, 66–80, 30). Get the floors right before anything else — every
   later system depends on this being exact.
4. **Single-battle turn loop, `s_basic` only.** Action commit → sort by priority then Speed →
   accuracy roll → damage → faint. That covers 229 of 728 moves and is already a complete battle.
5. **Statuses and stat stages.** `s_status`, `s_stat`, `s_self_stat` (+50+27+18 moves, taking you to
   ~324/728), the five non-volatiles, confusion, flinch, the two stage-multiplier curves, and the
   end-of-turn tick.
6. **Catching.** Ball data, the Gen-VI shake formula, critical capture, status/HP bonuses, and the
   ~13 conditional ball handlers. Test against §3.2 (72.5% / 11.9%).
7. **Wild encounters on RPG-JS.** Define your own tile-tag enum (do **not** port the 384-offset
   numbers), wire zone → groups → weighted pick → level roll → creature instantiation. Use the
   simple `1/30` per-step trigger first; swap in the triangular counter if the pacing feels wrong.
   Note maps 22–26 have no geometry — you are authoring the whole route anyway.
8. **EXP, level up, move learning.** §2.3/§2.4. In an MMO you will likely want the `BT_ScaledExp`
   branch (switch 50) on by default so high-level players do not one-shot-farm low-level zones.
9. **Bag, items, shops, money.** Healing/status/PP/EV/stat items are data-driven and cheap. Sell
   price = `floor(price/2)`. Then hand-author the ~30 held items you actually want in the meta.
10. **The next tranche of `battleEngineMethod` handlers**, by move count:
    `s_multi_hit`, `s_2hits`, `s_recoil`, `s_absorb`, `s_heal`, `s_protect`, `s_2turns`, `s_reload`,
    `s_bind`, `s_weather`, `s_terrain`, `s_reflect`, `s_ohko`. That reaches ~430/728. Stub the
    remaining 200 bespoke methods to fall through to `s_basic` and log, so nothing crashes.
11. **Abilities**, by how often they appear on the roster's `abilities[]` arrays. Start with the
    starter/common set (Overgrow, Blaze, Torrent, Swarm, Intimidate, Levitate, Static, Sturdy,
    Guts, Chlorophyll, Swift Swim, Speed Boost, Technician, Adaptability, Huge Power).
12. **Trainers and AI.** 14 trainer definitions, `baseMoney × lastEnemyLevel` reward, and a simple
    damage-maximizing AI. PSDK's 7 AI tiers are engine-coded and not worth reproducing.
13. **Everything Contest-related, breeding, Mega Evolution, Z-Moves, roaming creatures, Nuzlocke,
    the Safari mode, and the day/night cycle: skip.** None of it is load-bearing for this game, and
    Mega/Z data is present but unreachable without evolution and the trigger items.

### 9.1 MMO-specific notes not covered by PSDK

PSDK is a single-player engine. These have no source of truth in the data and are yours to design:

- **Server authority.** Damage, catch and encounter RNG must run server-side. The formulas above
  are all deterministic given a seed — thread an injectable RNG through everything from day one.
- **Turn timeouts.** PSDK blocks forever waiting for input. You need a per-turn deadline and a
  default action (usually "use the first move with PP").
- **PvP.** Nothing in the data models a player-vs-player battle; the `bank 0 / bank 1` structure
  maps onto it cleanly, but flee, catch and EXP all need explicit rules.
- **Persistence.** PSDK saves a Ruby Marshal blob. You need a schema: creature instances
  (`dbSymbol, level, exp, ivs, evs, nature, ability, moves+pp, hp, status, item, shiny, code`),
  bag, money, position, dex flags.
- **Encounter fairness.** The triangular step counter is per-map-session state in PSDK. In an MMO
  it should be per-player, server-held, and reset on zone change.
