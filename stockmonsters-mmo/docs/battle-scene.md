# Battle scene

The DOM overlay that plays a wild battle out. Three files:

| file | job |
| --- | --- |
| `src/modules/main/battle.ts` | server: runs the battle over the dialog GUI and **emits the turn's event list** |
| `src/battle-scene.ts` | client: the picture, the event queue, HP reconciliation |
| `src/battle-fx.ts` | client: the effect vocabulary (numbers, banners, puffs, arrows, wipes) + all the CSS |

The rules in `src/battle/` are untouched by any of this. The scene is a
*decoration* over a flow the dialog still drives: the text is the pacing, the
animation is what happens while you read it.

## The wire contract

Three channels, always in this order:

```
battle:turn   { events }                the turn's EVENT LIST, in order
battle:state  { mine, wild, intro? }    the full snapshot — the source of truth
battle:end    {}                        teardown
```

`events` is the array `runTurn()` returned, verbatim (see `src/battle/turn.ts`
for the union: `used | damage | missed | immune | prevented | self-hit |
status | status-failed | stage | residual | heal | recoil | hits | protected |
charging | recharging | bound | weather | screen | fainted`). `side` is `0` for
the player's creature and `1` for the wild one, matching the `sides` tuple
`battle.ts` builds. On a `damage`/`missed` event `side` means different things
and the scene respects that: `damage.side` is the **target**, `missed.side` is
the **attacker** (the puff goes on the target).

Two event types the rules never produce are synthesised by `battle.ts` so the
whole scene speaks one language:

```
{ type: 'appear', side: 1 }                             a wild creature arriving
{ type: 'ball',   side: 1, bounces: n, caught: bool }   a capture attempt
```

`battle:state` also carries `intro: true` on the first snapshot of a battle.

### Why the snapshot comes second

The events carry their own exact HP (`damage.targetHp`, `residual.hp`,
`heal.hp`, `recoil.hp`, `self-hit.hp` — straight out of the rules engine), so
the animation never invents a number. The snapshot that follows is still the
authority: if it arrives while the queue is playing the scene **holds** it and
applies it the moment the queue drains, or the moment the player
fast-forwards. The scene therefore cannot end up showing HP that disagrees
with the server.

## Queue discipline

Events arrive as a burst and play in order, each holding the stage for a beat
(`BEATS` in `battle-scene.ts`: 260 ms for `used`, 520 ms for `damage`, 820 ms
for `fainted`, …). Two things collapse a burst to its end state instantly:

* the player advancing the dialog — Enter / Space / Escape / `e` / a click,
  captured on `window` in the capture phase;
* the next `battle:turn`, or `battle:end`, arriving.

`fastForward()` applies every remaining event with `animate: false`, snaps any
HP bar still draining, and then applies the held snapshot. Nothing is dropped
and nothing is left mid-flight.

## What each beat looks like

| event | animation |
| --- | --- |
| `appear` | the wild slot slides in from off-screen as a white silhouette, then blows back to colour; kicked off after the entry wipe has half-cleared so the two do not cancel out |
| `used` | the attacker's slot lunges toward the target and snaps back (up-right for `mine`, down-left for `wild`); a small move-name plate pops over it |
| `damage` | target shakes, flashes white, a damage number pops and rises; **crit** = 46 px gold number + a `CRITICAL!` plate; effectiveness ≠ 1 = a `SUPER EFFECTIVE!` / `not very effective` plate stacked above it (once per burst per side, so multi-hit does not spam) |
| `missed` | `MISS` puff + 8 dust specks blowing outward, on the *target* |
| `immune` | `NO EFFECT` puff in purple |
| `status` | themed glow pulse around the sprite silhouette + a shake + a plate, and the panel's status tag is rebuilt in the status colour and pulsed |
| `residual` | small tick number in the status colour, a light shake and the same themed pulse |
| `stage` | 2–3 chevrons marching up (raise) or down (drop) in the stat's colour, with an `ATK DOWN` label |
| `self-hit` / `recoil` | number on the user itself, confusion-gold / purple |
| `heal` | green `+n` and a green pulse |
| `fainted` | the sprite drops 90 px, rotates 16° and fades out; the slot keeps `.fainted` until a snapshot says otherwise |
| scene open / close | a 14-bar stepped wipe that opens from the middle and closes back over it |

HP bars never jump. `setHp()` runs a rAF tween quantised to 12 steps over
460 ms and the bar width is further quantised to 1/40 of the track, so it
drains chunky rather than liquid. Colour follows the ratio: green > 50 %,
amber ≤ 50 %, red ≤ 20 % (red also pulses).

## Palette and pixel discipline

`image-rendering: pixelated` on the root and every descendant. Movement is
step-based (`steps(n, jump-none)`) everywhere a smooth tween would look wrong;
only the HP tween is rAF-driven, and it is quantised too.

> **Gotcha:** `steps(1, jump-none)` is *invalid* CSS — one step with no jump has
> nowhere to jump to — and an invalid timing function throws away the whole
> `animation` shorthand. Written that way the shake, the white flash, the tint
> pulse and the banner pop all silently did nothing while looking correct in
> the source. Minimum is `steps(2, jump-none)`.

Colours, from `src/battle-fx.ts`:

```
surface #26213a   border  #f6c177   text   #fff1c7   hard shadow #09070f
ok      #7ecf6b   danger  #e06c75   purple #b48ead   dark        #1b1730
frame   #4a4368   (HP bar border, weak-banner border)
```

Two additions, used only for status themes: `ice #9fd8e0` (freeze) and
`drowsy #8b86b8` (sleep). Status colours: burn → danger, poison → purple,
paralysis/confusion → border, sleep → drowsy, freeze → ice. Stat colours:
atk → danger, dfe → ok, ats → purple, dfs → ice, spd → border.

Everything is DOM + CSS. No canvas library, no external assets, no network
calls, no images beyond the dex sprites the scene was already showing.

## Reduced motion

Under `prefers-reduced-motion: reduce` every state change still happens — HP,
status tags, faint, damage numbers, banners — but the travel is gone: no
lunge, no shake, no slide-in, no idle bob, no wipe (the scene cuts), and the
HP tween is applied instantly. The floating numbers and plates hold in place
and then disappear instead of rising.
