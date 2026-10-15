# HARROW — design

A dark, real-time, top-down extraction game set in the Stockmonsters world after
the fall. Machines called **the Harrow** came out of nowhere and broke the
cities. The only things still fighting back are **trainers** and the **wild
creatures**, who fight beside them.

Structural reference: ARC Raiders' extraction loop. Creature reference: the
Stockmonsters roster (art reused from `../Stockmonsters`, data rebuilt here).

## Pillars
1. **Your team is your gear.** Everything you bring can be lost; nothing is lost forever.
2. **Noise has a price.** Every fight raises the map's Alarm and calls more machines.
3. **Bonds are earned under fire.** You do not trap creatures. You save them.
4. **Trainers command, creatures fight.** Trainers carry tools, not guns.

## Core loop
The Burrow (hub) → pick partner + up to 3 bonded creatures + supplies → raid a
map → search caches, fight the Harrow, earn creatures' trust → **extract** at a
lift or hatch, or die → bonds seal, loot banks, craft → repeat.

## The trainer
- WASD move, Shift sprint (stamina), Space dodge-roll (stamina, brief invulnerability).
- 100 HP. Shield points from Shield Cells absorb 60% of incoming damage until depleted.
- No weapon. Tools: Med Kits (heal trainer, revive/heal party), Shield Cells, Lures
  (machines chase the lure for a few seconds), Hatch Keys.

## Creatures
- Each has HP, attack, attack rate, range (melee or ranged), speed and one
  signature move on a cooldown (keys 1–4 by party slot).
- Party AI: follows the trainer, auto-engages Harrow units near the trainer.
  Left-click a machine to focus the whole party on it. Right-click / F to regroup.
- A creature at 0 HP is **downed**: it drops out of the fight until revived with a Med Kit.

### Types against the Harrow
Creatures keep the 18 Stockmonsters types. Against machines, the best of a
creature's types applies:

| Type    | Mite | Watcher | Crusher | Shardcrawler | Note |
|---------|------|---------|---------|--------------|------|
| Volt    | 1.5  | 2.0     | 1.3     | 1.3          | shorts circuits |
| Tide    | 1.0  | 1.0     | 1.5     | 1.0          | rusts plating |
| Terra   | 1.2  | 0.5     | 1.5     | 1.2          | buries treads, can't reach fliers |
| Blaze   | 1.5  | 1.0     | 0.75    | 1.3          | melts swarms |
| Frost   | 1.0  | 1.2     | 1.25    | 1.2          | makes plating brittle |
| Combat  | 1.2  | 0.6     | 1.0     | 1.3          | |
| Spectre | 1.0  | 1.3     | 1.0     | 1.0          | |
| Alloy   | 0.75 | 0.75    | 0.75    | 0.75         | **takes half damage from the Harrow** |
| Psionic | 1.0  | 1.0     | 1.0     | 1.0          | signature move can hijack a machine |
| other   | 1.0  | 1.0     | 1.0     | 1.0          | |

The Titan takes the Crusher column.

## The Harrow
| Unit | Role | Behaviour |
|---|---|---|
| **Mite** | Swarm | Small, fast, latches on and drains. Packs of 4–6 |
| **Watcher** | Spotter | Flying eye. If it holds sight of the trainer it **broadcasts**: big Alarm spike and a Mite pack. Kill it first |
| **Crusher** | Heavy | Slow tank. Telegraphed ground slam (red ring) for heavy area damage |
| **Shardcrawler** | Skirmisher | Quadruped scavenger in packs of 2–3. Holds at range and circles, spitting glowing globs (dodge-rollable); lunges if you close in. Drawn to movement and sound: pairs hunt you once Alarm passes 45. Drops shards (scrap). Its wreck burns for a while |
| Lurker | Ambusher | *(planned)* hides, springs on proximity |
| Dart | Diver | *(planned)* fast flying attacker |
| **Titan** | Boss event | Once per raid, 3–6 min in, a Titan walks in from the north (screen shake, warning toasts, red edge arrow). It **patrols a loop between the exits**, so it guards your way out; pursues anything it spots within ~520. Ranged: charges a red laser sight that tracks you, locks, then fires a 5-bolt burst (dodge-rollable). Close: telegraphed 190-radius ground slam for 40. 2600 HP, steps over trees, immune to freeze/hijack/knockback. Kill drops a core: 20 scrap + a Hatch Key. Boss bar shows when you are near |

The Harrow attack **wild creatures too**. Wild creatures are found mid-fight.

### Alarm
A 0–100 meter per raid. Creature hits, machine deaths, cache searches, lift
calls and Watcher broadcasts raise it; it decays when things go quiet.
Thresholds: >30 Mite packs hunt the trainer, >60 Watchers patrol in, >85 a
Crusher comes looking.

## Recruiting (trust)
1. Wild creatures roam and fight any machine near them.
2. Damage dealt by your side to machines near a wild creature builds its **Trust**;
   killing those machines builds more. Trust decays slowly.
3. At full Trust, press **E** next to it: it joins as a **recruit**.
4. **The bond only seals when you extract.** Die first and it goes back to the wild.

Rare creatures spawn deeper in the map, where the Harrow is thicker.

## Death
- The raid's found loot and brought supplies are lost.
- The **partner** always comes home.
- Other bonded creatures **go feral**: they appear wild on the next raid,
  trust half-built, marked. Win one back and it gains a **scar**: a permanent
  trait with an upside and a downside.

## Extraction
- **Lifts** (2 per map): press E to call; 15 s countdown; stay in the ring.
  Calling a lift makes noise (+Alarm).
- **Hatch** (1 per map): instant, consumes a Hatch Key.
- Raid timer: 12 minutes. When it ends, the Harrow sweep the map — anyone still
  inside is lost.

## The Burrow (hub)
- **Den**: bonded creatures, choose the party (partner + up to 3).
- **Stash**: Scrap, Med Kits, Shield Cells, Lures, Hatch Keys. Choose what to bring.
- **Workshop**: Scrap → Med Kit (4), Shield Cell (5), Lure (3), Hatch Key (12).
- **Log**: every species seen and bonded. Survives the Reset.

## Maps
| Map | Character |
|---|---|
| **Bear Hollow** | Dead forest, close quarters (vertical slice) |
| Bull Canyon | Dust bowl of wrecked convoys, long sightlines |
| Drywater Falls | Dry falls; Tide creatures only during storms |
| Broken Span | Collapsed bridge, one chokepoint |
| The Old Capital | Where the Harrow landed; endgame |

## Later systems (not in the slice)
- Multiplayer squads of 1–3 and other squads on the same map (authoritative rooms).
- Map conditions (storm, night).
- The Reset: release the box for permanent bonuses; the Log persists.
- Creature levels, more moves, the full roster, carry weight.

## Vertical slice (what is built)
- One map, **Bear Hollow**, generated from a seed: dead trees, rocks, ruined walls, darkness with a lantern radius.
- 12 creatures (3 starter choices + 9 wild), 4 Harrow units (Mite, Watcher, Crusher, Shardcrawler) and the Titan boss event.
- Animated trainer, Shardcrawler and Titan from sliced character sheets (`scripts/slice-sheets.py`).
- Trust/recruit, Alarm, caches, lifts + hatch, death/feral/scar rules, raid timer.
- The Burrow: partner pick, party select, stash, workshop, log. Saved in localStorage.
- Single-player only.
