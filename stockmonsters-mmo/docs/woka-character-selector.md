# Woka-style character selector + layered builder — port plan for Stockmonsters MMO

**Status:** research complete, implementation-ready.
**Sources:** WorkAdventure snapshot at `/Users/rez/Desktop/kript/memes/stockmonsters/workadventure-master`, RPG-JS v5.0.0-beta.33 in `stockmonsters-mmo/node_modules/@rpgjs/*`, PIXI 8.19.0.
**Convention:** every claim is tagged **[V]** (verified — read from source in this repo/tree) or **[I]** (inferred — reasoned, not directly executed). The implementer does **not** need to read the WorkAdventure source; everything needed is quoted here.

---

## 0. The headline

Three findings collapse most of the projected work:

1. **The geometry is already identical.** WorkAdventure's Woka layers are **96×128 PNGs = 3 columns × 4 rows of 32×32**, rows ordered `down, left, right, up`. That is *exactly* `Presets.RMSpritesheet(3, 4)` — the preset `config.client.ts` already uses for `hero` and `female`. Zero conversion. **[V]**

2. **We are already shipping Pipoya art.** `public/spritesheets/hero.png` is **byte-identical** (md5 `bf99ffb4…`) to WorkAdventure's `characters/pipoya/Male 01-2.png`, and `public/spritesheets/female.png` is byte-identical (md5 `ecc9dcd5…`) to `Female 13-2.png`. The ready-made picker adds 22 more sprites from the same pack under the same terms we already rely on. **[V]**

3. **RPG-JS natively stacks layered graphics — no compositing required.** `player.setGraphic()` accepts an **array**, stores it in the `@sync()`'d `graphics` field, and the client renders **one PIXI Sprite per entry, in array order, in one Container, all driven by the same direction/animation signal**. This is precisely WorkAdventure's rendering model, built in. "Other players see your custom Woka" — the part flagged as hard — is **free**. **[V]**

Consequence: the recommended Phase 1 needs **no dynamic spritesheet registration, no canvas compositing, no PNG upload endpoint**. Those capabilities exist (§5.4) and are documented here as the Phase 3 escape hatch, but they are not on the critical path.

---

## 1. Licensing — read this before writing code

> Not legal advice. Two independent licenses are in play and they land differently.

### 1.1 WorkAdventure's **code**: AGPL-3.0 **+ Commons Clause** — do not copy

`/Users/rez/Desktop/kript/memes/stockmonsters/workadventure-master/play/LICENSE.txt` lines 9–11 **[V]**:

```
The software ("Software") is developed and owned by TheCodingMachine
and is subject to the terms of the GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, with the Commons Clause as follows:
```

and lines 679–691 **[V]**:

```
"Commons Clause" License Condition

The Software is provided to you by the Licensor under the License, as
defined below, subject to the following condition. Without limiting
other conditions in the License, the grant of rights under the License
will not include, and the License does not grant to you, the right to
Sell the Software.  For purposes of the foregoing, "Sell" means
practicing any or all of the rights granted to you under the License
to provide to third parties, for a fee or other consideration,
a product or service that consists, entirely or substantially,
of the Software or the functionality of the Software. …
```

Identical headers on `back/LICENSE.txt`, `messages/LICENSE.txt`, `uploader/LICENSE.txt`, `desktop/LICENSE.txt`. The root `package.json` has **no** `license` field. **[V]**

**Implication for a commercial crypto game:** AGPL alone would force source disclosure to every network user; the Commons Clause additionally forbids selling a product that consists substantially of the Software or its functionality. **Do not paste WorkAdventure source into Stockmonsters.** Behaviour, file formats and architecture are not copyrightable — a clean reimplementation from *this document* is fine. Every code block below is **newly written for RPG-JS**, not copied. The `WokaImage.svelte` draw loop quoted in §2.4 is short and factual (a `drawImage` call with frame offsets) and is reproduced only to state the algorithm; write your own.

### 1.2 The **ready-made** sprites (Pipoya) — clear to ship, with one caveat

`play/public/resources/characters/pipoya/about.txt`, in full **[V]**:

```
Files from Pipoya collection of sprites

Downloadable at: https://pipoya.itch.io/pipoya-free-rpg-character-sprites-32x32

Thanks! for the hard work!
```

Terms from that itch.io page **[V, fetched]**:

| Question | Answer |
|---|---|
| Commercial use | **Yes** — "For commercial or personal use." |
| Attribution required | **No** (voluntary; many credit anyway) |
| Modification | **Yes** — "Use and edit freely." |
| Redistribute / resell the assets | **No** — "Not redistribute or resell this assets." |
| Price | Free (name-your-own-price) |

**Verdict:** shipping these PNGs *inside the game* is normal permitted use. What is forbidden is republishing them as an asset pack. Since `hero.png`/`female.png` are already byte-identical Pipoya files **[V]**, the ready-made picker introduces **no new legal exposure**. Recommended anyway: add a `CREDITS.md` line — *"Character sprites by Pipoya — https://pipoya.itch.io/pipoya-free-rpg-character-sprites-32x32"*. Costs nothing, matches community norms, and is cheap insurance.

### 1.3 The **layered** customisation set — provenance UNRESOLVED, do not ship blind

The 272 layer PNGs live under `play/public/resources/customisation/`. In this snapshot they have **no `about.txt`, no credits file, no attribution file, and no license text anywhere in the tree** — I grepped every `.md`/`.txt`/`.ts`/`.svelte`/`.json` for `pipoya|CC-BY|creative commons|attribution` and the only character-asset hit is the pipoya `about.txt` above. **[V]** (The `maps/Tuto/tilesets/*Attribution*.txt` files that do exist cover *map tilesets*, not characters.)

The snapshot is not a git checkout (it sits inside the Stockmonsters repo), so upstream commit history is unavailable locally. **[V]**

Complicating facts:
- Art style matches Pipoya closely, but the Pipoya 32×32 pack ships **whole characters**, not separable layers — so these are at minimum a derivative re-cut, possibly original work. **[I]**
- Several items are unmistakably WorkAdventure-specific additions by another hand: `character_clothes/black_hoodie.png`, `white_hoodie.png`, `pride_shirt.png`, `engelbert.png`, `character_hats/tinfoil_hat1.png`, `character_accessories/mask.png`, `mate_bottle1.png`. **[V]**
- If a court treated these assets as part of "the Software", the Commons Clause would bite. **[I]**

**Verdict: do not ship `customisation/**` in a commercial crypto game until provenance is cleared.** Three ways forward, in order of cost:

1. **Clear it** — check the upstream repo (`github.com/workadventure/workadventure`) history for the commit that added `play/public/resources/customisation/`, and its PR description / `CREDITS`; or email TheCodingMachine. Cheapest if it comes back "Pipoya-derived, same terms".
2. **Substitute** — use an explicitly-licensed layered set. The LPC (Liberated Pixel Cup) collection is CC-BY-SA 3.0 / GPL — usable but the SA/GPL terms are awkward for a commercial closed product. A CC0 layered charset (there are several on OpenGameArt / itch) is the clean answer.
3. **Make our own** — the format is trivial: a 96×128 PNG, transparent, 3 cols × 4 rows, rows `down/left/right/up`, drawn to register with the base body. Commissioning or generating ~40 items across 6 slots is a day of art, not engineering, and gives us assets we unambiguously own.

**This is the only genuine blocker in the whole project, and it blocks Phase 2 (the builder), not Phase 1 (the picker).** That is why Phase 1 is scoped as ready-mades only.

---

## 2. How WorkAdventure's Woka system works

### 2.1 File map (all paths relative to `workadventure-master/`)

| Concern | File |
|---|---|
| Texture catalog (the whole data set) | `play/src/pusher/data/woka.json` (78 KB) |
| Catalog schema (zod) | `libs/messages/src/JsonMessages/PlayerTextures.ts` |
| Catalog server (no-admin mode) | `play/src/pusher/services/LocalWokaService.ts` |
| Catalog HTTP endpoint | `play/src/pusher/controllers/WokaListController.ts` → `GET /woka/list` |
| Ready-made picker UI | `play/src/front/Components/Woka/WokaSelectScene.svelte` |
| Layered builder UI | `play/src/front/Components/Woka/WokaCustomizeScene.svelte` |
| Live layered preview (canvas) | `play/src/front/Components/Woka/WokaImage.svelte` + `WokaPreview.svelte` |
| Front-end types | `play/src/front/Components/Woka/WokaTypes.ts` |
| Phaser host scene | `play/src/front/Phaser/Login/SelectCharacterScene.ts` |
| Per-layer texture loading | `play/src/front/Phaser/Entity/PlayerTexturesLoadingManager.ts` |
| **In-game layer stacking** | `play/src/front/Phaser/Entity/Character.ts` (`addTextures`, `playAnimation`) |
| Animation frame table | `play/src/front/Phaser/Player/Animation.ts` |
| Static avatar compositing (menus only) | `play/src/front/Phaser/Entity/CharacterLayerManager.ts` + `Phaser/Helpers/TexturesHelper.ts` |
| Client-side persistence | `play/src/front/Connection/LocalUserStore.ts` (`localStorage`) |
| Wire format | `messages/protos/messages.proto` (`CharacterTextureMessage`) |
| Docs | `docs/others/self-hosting/wokas.md` |

### 2.2 The data model

A Woka is **an ordered list of texture ids**. Nothing more. **[V]**

`WokaTypes.ts` **[V]**:

```ts
export type WokaBodyPart = "body" | "eyes" | "hair" | "clothes" | "hat" | "accessory";

export interface WokaTexture   { id: string; name: string; url: string; position: number; }
export interface WokaCollection{ name: string; position: number; textures: WokaTexture[]; }
export interface WokaLayer     { collections: WokaCollection[]; }
export interface WokaData {
    body: WokaLayer; eyes: WokaLayer; hair: WokaLayer;
    clothes: WokaLayer; hat: WokaLayer; accessory: WokaLayer;
    woka: WokaLayer;                       // <- the ready-made ("pick one") list
    [key: string]: WokaLayer;
}
```

`woka.json` top level is exactly those 7 keys **[V]**:

```
woka, body, eyes, hair, clothes, hat, accessory
```

with each entry shaped `{ id, name, url, position }` — e.g. **[V]**:

```json
{ "id": "male1",  "name": "male1",  "url": "resources/characters/pipoya/Male 01-1.png",           "position": 0 }
{ "id": "body1",  "name": "body1",  "url": "resources/customisation/character_color/character_color0.png", "position": 0 }
```

The **draw order is the array order**, fixed in code as **[V]**:

```
body → eyes → hair → clothes → hat → accessory
```

(`bodyPartOrder` in `WokaCustomizeScene.svelte`; `WokaImage.svelte` uses the same list with `"woka"` appended last so a ready-made sprite paints over everything.) Hair is drawn *under* clothes — verified visually.

**Ready-made vs. built are the same thing.** A ready-made Woka is a one-element list `["male1"]`; a built one is a six-element list `["body5","eyes8","hair20","clothes30","hat5","accessory10"]`. One code path serves both. **[V]**

### 2.3 Sprite sheet geometry — VERIFIED, and it matches ours

Every single Woka PNG — all 272 layers **and** all 300 Pipoya ready-mades — is **96 × 128** with **zero exceptions** (measured from PNG IHDR headers across all 6 layer dirs + `characters/pipoya/`). **[V]**

`PlayerTexturesLoadingManager.ts` loads each as **[V]**:

```ts
load.spritesheet(textureDescriptor.id, textureDescriptor.url, { frameWidth: 32, frameHeight: 32 });
```

→ 3 cols × 4 rows of 32×32. Frame indices from `Player/Animation.ts` **[V]**:

| Row | Direction | Walk frames | Idle frame |
|---:|---|---|---|
| 0 | down  | `[0, 1, 2, 1]` | `1` |
| 1 | left  | `[3, 4, 5, 4]` | `4` |
| 2 | right | `[6, 7, 8, 7]` | `7` |
| 3 | up    | `[9, 10, 11, 10]` | `10` |

`frameRate: 10, repeat: -1`. The official docs corroborate: *"Characters are 32x32 pixels sprites … a sheet of 3x4 sprites"*, rows ordered *walking down, left, right, up*. **[V, fetched]**

**This is byte-for-byte the RPG Maker charset convention that `Presets.RMSpritesheet(3, 4)` implements** (see §5.2). Our `hero.png` is the same 96×128 3×4 sheet. **No conversion, no re-slicing, no re-ordering.** **[V]**

Visual verification — I composited `body5 + eyes8 + hair20 + clothes30 + hat5 + accessory10`, `body12 + eyes15 + hair45 + clothes60 + hat15 + accessory20`, and `body21 + eyes23 + hair60 + black_hoodie + tinfoil_hat1 + mask`, and rendered them next to `hero.png`. All layers register perfectly; the results read as coherent 4-direction chibi charsets in the same art family as our existing hero. **[V]**

### 2.4 Rendering — WorkAdventure does **not** composite for gameplay

This is the point everyone gets wrong. There are **two** rendering paths:

**(a) In-game — N stacked sprites, never composited.** `Phaser/Entity/Character.ts` **[V]**:

```ts
private addTextures(textures: string[], frame?: string | number): void {
    for (const texture of textures) {
        const sprite = new Sprite(this.scene, 0, 0, texture, frame);
        this.add(sprite);                              // Character extends Phaser Container
        getPlayerAnimations(texture).forEach((d) => { /* register per-texture anims */ });
        this.sprites.set(texture, sprite);
    }
}

protected playAnimation(direction, moving): void {
    for (const [texture, sprite] of this.sprites.entries()) {
        const directionStr = ProtobufClientUtils.toDirectionString(direction);
        if (moving && …) sprite.play(texture + "-" + directionStr + "-walk", true);
        else if (!moving) sprite.anims.play(texture + "-" + directionStr + "-idle", true);
    }
}
```

One Phaser `Sprite` per layer, all in one `Container`, all told to play the same named animation. Up to 6 sprites per character on screen.

**(b) Static avatar for menus/chat — composited to a base64 PNG.** `CharacterLayerManager.wokaBase64()` draws each layer sprite into a Phaser `RenderTexture` and calls `rt.snapshot(cb, "image/png", 1)` (`Helpers/TexturesHelper.getSnapshot`). Used only for the little avatar in the UI, never for the walking character. **[V]**

**(c) DOM preview in the builder** — plain `<canvas>`, no Phaser. `WokaImage.svelte` **[V]** (algorithm, for reimplementation):

```
for part of ["body","eyes","hair","clothes","hat","accessory","woka"]:
    img = <the chosen texture's PNG for this part>
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, frame*32, direction*32, 32, 32, 0, 0, canvasSize, canvasSize)
```

`frame` stays 0 (static pose); `direction` is 0..3 rotated by a button, via `directionsMapping = [0, 1, 3, 2]` so the rotate button cycles down → left → up → right visually. `canvasSize = 130` in the big preview. **[V]**

### 2.5 Persistence and network

- **Client-side:** `localStorage` under a single key, as a JSON string array. `LocalUserStore.setCharacterTextures(textureIds: string[])` / `getCharacterTextures()`. **[V]**
- **Server-side:** if the user is logged in and the deployment has the `api/save-textures` capability, the ids live on the admin API instead; otherwise localStorage is authoritative. `GameManager.setCharacterTextureIds()` **[V]**.
- **Wire format** — `messages/protos/messages.proto` **[V]**:

```proto
message CharacterTextureMessage {
  string url = 1;
  string id  = 2;
}

message UserJoinedMessage {
  int32 userId = 1;
  string name = 3;
  repeated CharacterTextureMessage characterTextures = 4;
  …
}
```

- **The security model** — `docs/others/self-hosting/wokas.md`, verbatim **[V]**:

> When a user connects to a map, it sends, as a web-socket parameter, the list of layer **names**.
> The play service is in charge of converting those layer names into the URLs. This way, a client cannot send any random URL to the play service.
> When the play service receives the layer names, it validates these names and sends back the URLs + sends the names+urls to the back.
> If the layers cannot be validated, the websocket connections sends an error message and closes.

`LocalWokaService.fetchWokaDetails(textureIds)` does that id→URL lookup and returns `undefined` if *any* id is unknown. **[V]** **Copy this posture** (§6.5): the client sends ids, the server validates against a whitelist.

- **Other clients:** each peer receives `{id, url}` pairs and lazily loads them as 32×32 spritesheets — `GameScene.ts:4167` **[V]**:

```ts
lazyLoadPlayerCharacterTextures(this.superLoad, addPlayerData.characterTextures)
```

Same call is used for your own player (`GameScene.ts:2309`). No server-side compositing anywhere. **[V]**

---

## 3. The assets

### 3.1 Inventory

| Layer | Directory (`play/public/resources/`) | Files on disk | In catalog | Disk size |
|---|---|---:|---:|---:|
| body | `customisation/character_color/` | 34 | **33** | 136 KB |
| eyes | `customisation/character_eyes/` | 34 | **30** | 136 KB |
| hair | `customisation/character_hairs/` | 74 | **74** | 296 KB |
| clothes | `customisation/character_clothes/` | 74 | **74** | 328 KB |
| hat | `customisation/character_hats/` | 27 | **27** | 108 KB |
| accessory | `customisation/character_accessories/` | 34 | **34** | 136 KB |
| **layer total** | | **277** | **272** | **1.1 MB** |
| ready-made | `characters/pipoya/` | 300 (+`about.txt`) | **24** | 1.2 MB (24 used = **72 KB**) |

**[V]** — counts from `ls`, catalog counts from parsing `woka.json`, sizes from `du`.

Notes:
- `character_color/` contains one mojibake orphan `_Èµ.png` not referenced by the catalog. Skip it. **[V]**
- `character_eyes/` has 34 files but only 30 are catalogued. **[V]**
- Only **one collection** per layer, always named `"default"`. The multi-collection machinery exists for the SaaS tag-gated feature and is unused in the open-source data. **[V]**
- The ready-made list is 24 curated Pipoya sprites: ids `male1..male12`, `female1..female12`. The other 276 Pipoya files are available if we want a bigger picker. **[V]**
- `required: true` on `body`, `eyes`, `accessory`; absent on `hair`, `clothes`, `hat`. **[V]** (`accessory` being "required" is odd; index 1 of that layer is presumably a no-op. **[I]**)
- Combination space: 33 × 30 × 74 × 74 × 27 × 34 ≈ **5.0 billion**. **[V, computed]**

### 3.2 Art style

Chibi/big-head 32×32 pixel art, ~4-frame-feel walk cycle at 3 frames per direction, flat shading, soft outline. Indistinguishable in family from `hero.png`/`female.png` (which *are* Pipoya files). A handful of WorkAdventure-added items (hoodies, tinfoil hat, mask, mate bottle) are visibly a different, slightly rougher hand. **[V, visual]**

### 3.3 Payload cost

Registering all 296 spritesheets costs **nothing at load time** — the engine stores descriptor objects in a `Map` and only calls `Assets.load(image)` when a sprite actually uses that sheet (§5.3). A player wearing 6 layers pulls ~24 KB total; textures are cached per URL across all peers wearing the same item. **[V]**

---

## 4. Our side: what exists today

| Fact | Evidence |
|---|---|
| Spritesheets are declared as plain objects in `src/config/config.client.ts` under `provideClientModules([{ spritesheets: [...] }])` — no `@Spritesheet` decorator used | `config.client.ts:13-33` **[V]** |
| `hero`/`female` use `...Presets.RMSpritesheet(3, 4)`; the 68 `ow-<TICKER>` monsters use `(4, 4)` | `config.client.ts:19,24,30` **[V]** |
| `image` is an ordinary relative URL string (`'spritesheets/hero.png'`), **not** a bundled import — it survives the build untouched | `config.client.ts` + `dist/client/spritesheets/` **[V]** |
| PNGs live in `public/spritesheets/` (`hero.png`, `female.png` @ 96×128) and `public/spritesheets/ow/` (68 files @ 128×128) | measured **[V]** |
| `hero.png` ≡ Pipoya `Male 01-2.png`, `female.png` ≡ Pipoya `Female 13-2.png` (md5-identical) | **[V]** |
| Graphic set server-side: `player.setGraphic('hero')` in `onConnected` | `src/modules/main/player.ts:21` **[V]** |
| Other `setGraphic` sites | `npcs.ts:21`, `event.ts:6`, `creatures.ts:76` **[V]** |
| Player variables persist to SQLite: `setVariable('SPAWNED', …)` already in use | `player.ts:9-10`; `server.mjs:25-29` (`createSqliteNodeRoomStorage`) **[V]** |
| Identity = wallet: `provideMmorpg({ connectionId: "wallet:" + address.toLowerCase() })` | `src/client.ts:15-23` **[V]** |
| Wallet is stored client-side as `localStorage["sm-wallet"] = {address, message, signature}`; signature **not yet verified server-side** | `index.html:150-174`, `client.ts:6-9` **[V]** |
| `startGame()` resolves with the DI context; the project already injects the engine from it | `src/zoom.ts:11-13` (`inject(ctx, RpgClientEngine)`) **[V]** |
| Title screen is a pure-DOM curtain: `#title-screen` at `position:fixed; inset:0; z-index:1000`, sibling of `#rpg`. `start()` → fullscreen → `.hidden` (opacity 0 + `pointer-events:none`) → `el.remove()` after 900 ms. Triggered by click or Enter/Space, guarded by a `started` flag | `index.html:121-127, 175-192` **[V]** |
| **The game boots independently of the curtain** — `client.ts` calls `startGame()` at module load. There is no "game started" event to hook | `client.ts:15` **[V]** |
| `#wallet-btn` calls `e.stopPropagation()` so clicking it doesn't start the game — the pattern to copy for a new button | `index.html:158` **[V]** |

**Pixel theme tokens** (lift these verbatim for the new overlay) — from `index.html:98-116` **[V]**:

```
surface      #26213a
border       #f6c177   (3px solid, border-radius: 0)
text         #fff1c7
hard shadow  3px 3px 0 #09070f     (:active → translate(2px,2px), shadow 1px 1px 0)
accent/ok    #7ecf6b
button font  "Courier New", ui-monospace, monospace; 700; 13px; letter-spacing .08em
display font "Fredoka" (Google Fonts, already linked), 600, letter-spacing .18em
always       image-rendering: pixelated
```

---

## 5. RPG-JS capabilities — the mechanism, verified

### 5.1 `setGraphic` takes an array, and the array is the layer stack

`node_modules/@rpgjs/server/dist/index.js:6420` **[V]**:

```js
setGraphic(graphic) {
    if (Array.isArray(graphic)) this.graphics.set(graphic);
    else this.graphics.set([graphic]);
}
```

Its own JSDoc example, line 6414 **[V]**: `player.setGraphic(["hero_idle", "hero_walk"]);`

`graphics` is a `@sync()` field on the common `Player` — it is broadcast in room state to every client on the map. **[V]**

Client resolution, `@rpgjs/client/dist/Game/Object.js:76-84` **[V]**:

```js
combineLatest([graphics$, graphicScale$]).pipe(switchMap(([graphics, scale]) => {
    const graphicRefs = Array.isArray(graphics) ? graphics : [];
    if (graphicRefs.length === 0) return of([]);
    return from(Promise.all(graphicRefs.map(async (graphic) => {
        return withGraphicDisplayScale(await engine.getSpriteSheet(graphic), scale);   // <- awaits
    })));
})).subscribe((sheets) => { this.graphicsSignals.set(sheets); });
```

Note the `await` — an **async** spritesheet resolver is supported end-to-end.

Rendering, `@rpgjs/client/dist/components/character.ce.js:939` **[V]**:

```js
h(Container, null, [
  loop(renderedGraphics, (graphicObj) =>
    h(Container, { scale: computed(() => graphicContainerScale(graphicObj)) },
      h(Sprite, {
        sheet: computed(() => sheet(graphicObj)),
        direction, tint,
        hitbox: computed(() => graphicHitbox(graphicObj)),
        shadowCaster: computed(() => shadowCaster(graphicObj)),
        flash: flashConfig
      })))
  , …])
```

**One `Sprite` per graphic, in array order (index 0 = bottom), all sharing the same `direction` signal and the same `realAnimationName()`.** `graphicBounds` unions the bounds of all layers. **[V]**

`RpgClientPlayer` is `class RpgClientPlayer extends RpgClientObject { _type = 'player' }` — **the local player and every remote player take the identical path**. **[V]**

> **This is WorkAdventure's `Character.addTextures` + `playAnimation`, already implemented in RPG-JS.** Nothing to port.

### 5.2 `Presets.RMSpritesheet(3, 4)` produces exactly the Woka layout

`@rpgjs/client/dist/presets/rmspritesheet.js` **[V]**:

```js
var RMSpritesheet = (framesWidth, framesHeight, frameStand = 1) => {
    if (framesWidth <= frameStand) frameStand = framesWidth - 1;
    const frameY = (direction) => {
        const gap = Math.max(4 - framesHeight, 0);
        return { [Direction.Down]: 0,
                 [Direction.Left]:  Math.max(0, 1 - gap),
                 [Direction.Right]: Math.max(0, 2 - gap),
                 [Direction.Up]:    Math.max(0, 3 - gap) }[direction];
    };
    const stand = (direction) => [{ time: 0, frameX: frameStand, frameY: frameY(direction) }];
    const walk  = (direction) => { /* frameX 0..framesWidth-1, 10ms apart */ };
    return { textures: { [Animation.Stand]: {…}, [Animation.Walk]: {…} }, framesHeight, framesWidth };
};
```

Row map `down=0, left=1, right=2, up=3`; walk cycles `frameX 0,1,2`; idle sits on `frameX = 1`. **Identical to WorkAdventure's table in §2.3.** The preset returns *only* `{textures, framesWidth, framesHeight}` — `width`/`height`/`rectWidth`/`rectHeight`/`anchor` are optional and auto-derived from the loaded image. **[V]**

### 5.3 Registration is lazy; adding 296 descriptors is free

`@rpgjs/client/dist/module.js:52-59` **[V]** — the `spritesheets:` provider key is sugar for a loop of `engine.addSpriteSheet()`:

```js
if (module.spritesheets) {
    const spritesheets = [...module.spritesheets];
    module.spritesheets = { load: (engine) => {
        spritesheets.forEach((spritesheet) => { engine.addSpriteSheet(spritesheet); });
    } };
}
```

`addSpriteSheet` is a one-liner `Map.set` (`RpgClientEngine.js:842-845`). **No image is fetched.** `Assets.load(image)` happens later, in `character.ce.js` / canvasengine `Sprite`, only for sheets an on-screen sprite actually uses. **[V]** I found no eager preloader in `RpgClientEngine.js`. **[V]**

So: **register all 296 Woka spritesheets statically in `config.client.ts`.** Cost ≈ 296 `Map` inserts at boot.

### 5.4 The escape hatch (Phase 3 only): runtime registration + resolver

Both public, both in the shipped beta.33 build. **[V]**

```js
// RpgClientEngine.js:842
addSpriteSheet(spritesheetClass, id) {
    this.spritesheets.set(id || spritesheetClass.id, spritesheetClass);
    return spritesheetClass;
}

// RpgClientEngine.js:873
setSpritesheetResolver(resolver) { this.spritesheetResolver = resolver; }

// RpgClientEngine.js:896 — cache-first, then resolver, promise-deduped, auto-cached
getSpriteSheet(id) { … }
```

`spritesheetResolver` is also a **provider key** on a client module, wired at boot via the `client-spritesheetResolver-load` hook. **[V]** (`module.js:60-66`, `RpgClientEngine.js:300`.)

`engine.spritesheets` is a plain public `Map`, mutable at runtime. **[V]**

**`image` may be a `data:` URL.** PIXI 8.19.0's `loadTextures` parser test **[V]**:

```js
test(url) { return checkDataUrl(url, validImageMIMEs) || checkExtension(url, validImageExtensions); }
// validImageMIMEs = ["image/jpeg","image/png","image/webp","image/avif"]
```

So `canvas.toDataURL('image/png')` loads. A plain remote `.png` URL also loads (CORS applies).
**`blob:` URLs do NOT** — they match neither branch. Use `toDataURL()`, never `createObjectURL()`. **[V for data:, I-strong for blob:]**

**Live graphic swaps re-cut textures correctly** — canvasengine `Sprite.onUpdate` sees the `type: 'reset'` signal emission produced by `graphicsSignals.set(...)` and runs `resetAnimations()` (stop → clear → `removeChildren()` → rebuild). So `setGraphic(...)` mid-session hot-swaps visuals. **[V]**

**⚠ `RpgResource.spritesheets.set(...)` does NOT register anything.** Its getter calls `syncResources()`, which does `_spritesheets.clear()` and rebuilds from `engine.spritesheets` — any write is discarded on the next read, and it only ever holds the image *string*, never a definition. The JSDoc example is misleading. **Use `engine.addSpriteSheet`.** **[V]**

### 5.5 Client → server channel

`engine.processAction(name, data)` → `webSocket.emit('action', {action, data})` → server `onInput(player, {action, data})`. **[V]** (`RpgClientEngine.ts:2103-2119`; server hook typed `onInput?: (player: RpgPlayer, data: RpgActionInput<unknown>) => …` in `@rpgjs/server/src/RpgServer.ts:274`.)

Our `player.ts:23` already implements `onInput(player, { action })` for `escape`. **[V]**

⚠ Guard in `processAction`: `if (!canMove) return;` — the action is silently dropped if the player currently can't move. Don't fire it during a cutscene/dialog. **[V]**

### 5.6 Failure mode for an unknown graphic id

`getSpriteSheet` returns `undefined`, no warning, no throw. Downstream, `graphicsSignals` becomes `[undefined]`, `character.ce` still renders a `<Sprite>` with `definition: {}`, `createAnimations()` bails on `if (!textures) return`. **Result: an invisible player** — position, hitbox, name tag and collision all still work, and **nothing is logged**. There is no fallback graphic anywhere in the engine. **[V]**

Two consequences:
1. **Server-side whitelist validation is mandatory** (§6.5) — otherwise a crafted `woka:set` turns you invisible to everyone, which is a griefing vector, not a cosmetic bug.
2. **Client-side, always fall back** to `['hero']` if a stored recipe fails validation.

**The server never validates graphic ids.** `setGraphic` is `this.graphics.set([graphic])` and nothing else; the server has no knowledge of the client spritesheet registry. Any string can be broadcast. **[V]**

---

## 6. Port plan

### Architecture decision

| | **A — layered `setGraphic([…])`** ← recommended | **B — composite to one data-URL sheet** |
|---|---|---|
| New engine machinery | none | `addSpriteSheet` + `spritesheetResolver` |
| Compositing code | none | ~50 lines, runs on every client for every peer |
| Other players see it | free (`@sync() graphics`) | needs the recipe encoded in the id + a resolver |
| Sprites per character | up to 6 | 1 |
| Animation sync between layers | independent AnimatedSprites — theoretical drift | guaranteed |
| Bandwidth per player | 6 short strings | 1 string |
| Texture memory | shared across all peers wearing the same item | one sheet per unique recipe |

**Take A.** It is what WorkAdventure ships, it is what RPG-JS implements natively, and it is provably the least code. If layer drift or sprite-count perf ever bites at high concurrency, switching to B is contained to (i) one `spritesheetResolver` and (ii) one line changing `setGraphic(layers)` to `setGraphic('woka:' + layers.join('.'))` — the recipe rides along inside the id, so no server endpoint is needed even then. **[I, on the recommendation; V on both mechanisms]**

### 6.1 Assets → repo

```
public/spritesheets/woka/
  preset/    <- 24 Pipoya ready-mades (or more), from characters/pipoya/
  body/      <- character_color/*.png     (skip _Èµ.png)
  eyes/      <- character_eyes/*.png
  hair/      <- character_hairs/*.png
  clothes/   <- character_clothes/*.png
  hat/       <- character_hats/*.png
  accessory/ <- character_accessories/*.png
```

Rename the Pipoya files to slugs (`male-01.png`, `female-13.png`) — the originals have spaces, which is fine for URLs but noisy. **`preset/` only for Phase 1** — the six layer dirs are gated on §1.3.

Total added: 72 KB (Phase 1) / 1.2 MB (Phase 2).

### 6.2 Generate a shared catalog

Follow the existing `tools/import-overworld.mjs` → `src/data/ow-spritesheets.ts` pattern. Write `tools/import-woka.mjs` that copies the PNGs and emits `src/data/woka-catalog.ts`:

```ts
// GENERATED by tools/import-woka.mjs — do not edit by hand.
export const WOKA_PARTS = ['body','eyes','hair','clothes','hat','accessory'] as const;
export type WokaPart = typeof WOKA_PARTS[number];

export interface WokaItem { id: string; part: WokaPart | 'preset'; image: string; }

export const WOKA_PRESETS: WokaItem[] = [
  { id: 'wk-preset-male-01', part: 'preset', image: 'spritesheets/woka/preset/male-01.png' },
  …24 entries
];

export const WOKA_LAYERS: Record<WokaPart, WokaItem[]> = {
  body:      [ { id: 'wk-body-1',  part: 'body',  image: 'spritesheets/woka/body/character_color0.png' }, … ],
  eyes:      [ … ], hair: [ … ], clothes: [ … ], hat: [ … ], accessory: [ … ],
};

/** Every legal graphic id — the server's whitelist. */
export const WOKA_IDS: ReadonlySet<string> = new Set([
  ...WOKA_PRESETS.map(i => i.id),
  ...WOKA_PARTS.flatMap(p => WOKA_LAYERS[p].map(i => i.id)),
]);
```

Prefix every id with `wk-` so nothing can collide with `hero`, `female`, or `ow-*`. **Import this one file from both `config.client.ts` and `src/modules/main/player.ts`** — that is what makes server validation and client registration provably consistent.

### 6.3 Register (static, one edit)

`src/config/config.client.ts`:

```ts
import { WOKA_PRESETS, WOKA_LAYERS, WOKA_PARTS } from "../data/woka-catalog";

const wokaSheets = [
  ...WOKA_PRESETS,
  ...WOKA_PARTS.flatMap((p) => WOKA_LAYERS[p]),
].map((item) => ({
  id: item.id,
  image: item.image,
  ...Presets.RMSpritesheet(3, 4),
}));

// …inside provideClientModules([{ spritesheets: [ …existing…, ...wokaSheets ] }])
```

296 descriptors, lazily loaded (§5.3).

### 6.4 The overlay UI

**Where it goes.** A new sibling of `#title-screen`, `<div id="woka-screen" hidden>`, same fixed/inset-0 treatment but `z-index: 1001`. Sequence in `index.html`'s existing IIFE:

```
CLICK TO START
  → if localStorage["sm-woka"] is a valid recipe:  hide #title-screen, done (returning player)
  → else:                                          hide #title-screen, show #woka-screen
CONFIRM in #woka-screen
  → write localStorage["sm-woka"] = JSON.stringify(ids)
  → dispatch window.dispatchEvent(new CustomEvent("sm:woka", { detail: ids }))
  → hide #woka-screen
```

Also add a **"CHANGE LOOK"** button so it can be reopened later (bind it in the escape menu, or as a second title-screen button using the `#wallet-btn` `stopPropagation` pattern).

**Why an event and not a direct call:** the game boots at module load, independently of the curtain (§4). `client.ts` owns the engine handle, `index.html` owns the DOM. A `CustomEvent` is the seam.

`src/client.ts`:

```ts
import { RpgClientEngine, inject } from "@rpgjs/client";

startGame(mergeConfig(configClient, { providers: [ provideMmorpg(…) ] }))
  .then((ctx) => {
    applyAutoZoom(ctx);
    const engine: any = inject(ctx as any, RpgClientEngine);

    const send = (ids: string[]) => engine.processAction("woka:set", { layers: ids });

    // Returning player: replay the stored recipe once the engine is up.
    try {
      const saved = JSON.parse(localStorage.getItem("sm-woka") ?? "null");
      if (Array.isArray(saved) && saved.length) send(saved);
    } catch {}

    window.addEventListener("sm:woka", (e: any) => send(e.detail as string[]));
  });
```

**Two tabs, same pixel chrome as `#wallet-btn`:**

*Tab 1 — PICK A TRADER.* A responsive grid of 24 thumbnails. Selected = `border-color: #7ecf6b`. Confirm emits `[presetId]`.

*Tab 2 — BUILD YOUR OWN.* Left: a 128 px `<canvas>` preview + a ROTATE button + a RANDOMIZE button. Right: six part tabs (`BODY EYES HAIR CLOTHES HAT ACCESSORY`) over a scrolling grid of that part's items. Confirm emits the six ids **in `WOKA_PARTS` order** — the order *is* the z-order.

**Preview canvas** (§2.4 algorithm, written fresh):

```js
const PART_ORDER = ['body','eyes','hair','clothes','hat','accessory'];
const DIR_BY_STEP = [0, 1, 3, 2];          // rotate button: down → left → up → right

function drawPreview(ctx, chosen, dir, size) {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  for (const part of PART_ORDER) {
    const img = imageCache[chosen[part]];
    if (img?.complete) ctx.drawImage(img, 1 * 32, dir * 32, 32, 32, 0, 0, size, size);
    //                                    ^ frameX 1 = the idle/stand column
  }
}
```

**Thumbnails — do this better than WorkAdventure.** WA mounts a live `<canvas>` + `requestAnimationFrame` per grid item (74 rAF loops on the hair tab). Instead use pure CSS, zero JS per cell:

```css
.wk-cell { width: 32px; height: 32px; transform: scale(2); transform-origin: top left;
           image-rendering: pixelated; position: relative; }
.wk-cell > i { position: absolute; inset: 0; background-repeat: no-repeat;
               background-position: -32px 0; }   /* frameX 1, frameY 0 = facing down, idle */
```

with two stacked `<i>` per cell — the currently-chosen **body** underneath, the candidate item on top — so hair/hats read correctly instead of floating in space (a real usability flaw in WA's grid, which renders the candidate layer alone). Presets need only one `<i>`.

Also worth keeping from WA: **RANDOMIZE** (one click per part, uniform over that part's list) — it is the single best affordance in their builder. **[V, from `randomizeOutfit()`]**

### 6.5 Server: validate, apply, persist

`src/modules/main/player.ts`:

```ts
import { WOKA_IDS } from '../../data/woka-catalog'

const DEFAULT_WOKA = ['hero']

function sanitizeWoka(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null
  if (input.length < 1 || input.length > 6) return null
  const ids = input.filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (ids.length !== input.length) return null
  if (!ids.every((id) => WOKA_IDS.has(id))) return null      // <- the whole security model
  return ids
}

export const player: RpgPlayerHooks = {
  onConnected(player: RpgPlayer) {
    const saved = sanitizeWoka(player.getVariable('WOKA'))
    player.setGraphic(saved ?? DEFAULT_WOKA)                 // <- restore before anything renders

    if (player.getVariable('SPAWNED')) return
    player.setVariable('SPAWNED', true)
    player.changeMap('exterior', { x: 784, y: 2000 })
    player.name = 'Trader'
  },

  onInput(player: RpgPlayer, { action, data }: any) {
    if (action === 'escape') { void openMenu(player); return }
    if (action === 'woka:set') {
      const ids = sanitizeWoka(data?.layers)
      if (!ids) return                                       // silently ignore garbage
      player.setVariable('WOKA', ids)                        // -> data/rooms.sqlite
      player.setGraphic(ids)                                 // -> @sync() graphics -> all peers
    }
  }
}
```

Note `setGraphic` moved **above** the `SPAWNED` early-return so the graphic is restored on every reconnect, including map transfers (the existing comment explains why `onConnected` fires repeatedly). **[I — behaviour follows from the existing comment; verify on first run.]**

### 6.6 Persistence keyed by wallet — already solved

`player.setVariable` writes into the `variables` bucket, declared `{ persist: true }`, saved by `createSqliteNodeRoomStorage` into `data/rooms.sqlite`. **[V]** The player key is the `connectionId`, which `client.ts` already sets to `"wallet:" + address.toLowerCase()`. **[V for the wiring; I that `player.id === connectionId` — the existing comment in `client.ts:6-9` states the project already relies on this.]**

So: **connect the same wallet on any device → your Woka comes back.** No new persistence code.

Client-side `localStorage["sm-woka"]` is a convenience mirror so the picker can be skipped for returning players before the socket is up; the server copy is authoritative.

### 6.7 Other clients — nothing to build

The `graphics` array is `@sync()`. When the server calls `setGraphic(ids)`, every client on the map receives the array, resolves each id through its own statically-registered catalog, and renders the stack. **[V]** The only requirement is that all clients ship the same `woka-catalog.ts` — which they do, it's in the bundle.

**Verification checklist for this phase:** two browsers, different wallets, same map; A changes look; B sees the change without reload; B reloads and still sees it; A disconnects and reconnects and still looks right; an id removed from the catalog produces the invisible-player failure of §5.6 and is caught by `sanitizeWoka`.

---

## 7. Effort estimates

Assumes a developer fluent in this codebase; excludes art.

| Phase | Scope | Estimate |
|---|---|---|
| **(a) Ready-made picker** | copy 24 PNGs, `tools/import-woka.mjs` + catalog, register 24 sheets, one-tab DOM overlay in the pixel theme, `sm:woka` event, `client.ts` wiring, `woka:set` handler + `sanitizeWoka`, `getVariable` restore | **3–5 h** |
| **(b) Full layered builder** | +272 PNGs & catalog entries, 6 part tabs, preview canvas + rotate, randomize, two-layer CSS thumbnails, scroll/keyboard nav, "change look" re-entry | **+4–6 h** |
| **(c) Others see it** | **0 h of new code** — falls out of `setGraphic(array)` + `@sync() graphics`. Budget for two-browser verification and the failure-mode tests in §6.7 | **+1 h** |
| **(x) Legal clearance for the layer set** | §1.3 — chase provenance, or source/commission a replacement set | **unknown; blocks (b) only** |
| **(y) *If* we ever need composite mode** | canvas compositor + `spritesheetResolver` + recipe-in-id encoding, replacing (c) | +3–4 h, **not needed now** |

Total for a shippable, fully-synced layered builder: **~8–12 h of engineering**, gated on (x).

---

## 8. Recommended Phase 1 — ships in a day

**Ready-made picker only. No layered assets, therefore no legal blocker.**

1. `tools/import-woka.mjs` — copy 24 Pipoya sprites from `workadventure-master/play/public/resources/characters/pipoya/` into `public/spritesheets/woka/preset/` with slugified names; emit `src/data/woka-catalog.ts` with `WOKA_PRESETS` and `WOKA_IDS`. *(Consider 32–40 sprites instead of 24 — 300 are available and the cost is ~3 KB each.)*
2. `src/config/config.client.ts` — append `WOKA_PRESETS.map(i => ({ id: i.id, image: i.image, ...Presets.RMSpritesheet(3, 4) }))` to the `spritesheets` array.
3. `index.html` — add `#woka-screen` (grid of thumbnails, CONFIRM button) in the existing pixel palette; sequence it after `CLICK TO START`, skip it when `localStorage["sm-woka"]` already holds a valid recipe; emit `sm:woka`.
4. `src/client.ts` — inject `RpgClientEngine` from the `startGame` context, replay the stored recipe on boot, listen for `sm:woka`, call `engine.processAction("woka:set", { layers })`.
5. `src/modules/main/player.ts` — `sanitizeWoka` against `WOKA_IDS`; restore in `onConnected` before the `SPAWNED` guard; handle `woka:set` in `onInput` with `setVariable` + `setGraphic`.
6. `CREDITS.md` — Pipoya attribution line.
7. Two-browser test per §6.7.

**Why this is the right cut:** it delivers the user-visible half of the feature (a real character choice, persisted to the wallet, visible to everyone), it ships the *entire* plumbing that Phase 2 needs — catalog, validation, persistence, overlay, event seam, sync — and Phase 2 then reduces to "add 272 more catalog rows and five more tabs." It also carries **zero** unresolved licensing risk, because it reuses the exact asset pack we are already shipping.

---

## 9. Gotchas, ranked

1. **§1.3 — the layered assets have no license.** The only hard blocker. Resolve before Phase 2.
2. **§5.6 — an unknown graphic id makes a player invisible, silently.** Whitelist server-side or ship a griefing vector.
3. **`RpgResource.spritesheets.set()` looks like registration and is not** (§5.4). Use `engine.addSpriteSheet`.
4. **`blob:` URLs won't load in PIXI** (§5.4). Use `toDataURL()`. Only relevant if we ever take the composite path.
5. **`processAction` is dropped when the player can't move** (§5.5). Don't fire `woka:set` during a dialog.
6. **Never reuse a graphic id after changing its pixels** — PIXI caches by URL and `engine.spritesheets` caches by id. Bump the filename or the id. **[I]**
7. **Layer animation drift.** Each stacked layer is an independent `AnimatedSprite`. WorkAdventure ships with this and it is not visible in practice; all layers reset together on every stand↔walk transition (§5.4). If it ever shows, that's the trigger for composite mode, not a redesign. **[I]**
8. **`character_color/_Èµ.png` and 4 uncatalogued eye files** — skip anything not in `woka.json`. **[V]**
9. **The overlay must not swallow the wallet button.** Reuse the `e.stopPropagation()` pattern from `index.html:158`.
10. **`onConnected` fires on every map transfer** (existing comment in `player.ts`). Restoring the graphic there is correct and idempotent; re-spawning is not, which is what `SPAWNED` guards.

---

## Appendix — key file paths

**WorkAdventure** (`/Users/rez/Desktop/kript/memes/stockmonsters/workadventure-master/`)
- `play/LICENSE.txt` — AGPL-3.0 + Commons Clause
- `play/src/pusher/data/woka.json` — the catalog
- `play/public/resources/characters/pipoya/` + `about.txt` — 300 ready-mades
- `play/public/resources/customisation/{character_color,character_eyes,character_hairs,character_clothes,character_hats,character_accessories}/` — 277 layer PNGs
- `play/src/front/Components/Woka/{WokaSelectScene,WokaCustomizeScene,WokaImage,WokaPreview,WokaTypes}.{svelte,ts}`
- `play/src/front/Phaser/Entity/{Character,PlayerTexturesLoadingManager,CharacterLayerManager}.ts`
- `play/src/front/Phaser/Player/Animation.ts`
- `play/src/pusher/services/LocalWokaService.ts`
- `messages/protos/messages.proto`
- `docs/others/self-hosting/wokas.md`

**Stockmonsters** (`/Users/rez/Desktop/kript/memes/stockmonsters/stockmonsters-mmo/`)
- `index.html` — title curtain, pixel theme tokens, wallet connect
- `src/client.ts` — `startGame`, `connectionId`, DI context
- `src/config/config.client.ts` — spritesheet registration
- `src/modules/main/player.ts` — `onConnected` / `onInput` / `setGraphic`
- `src/data/ow-spritesheets.ts`, `tools/import-overworld.mjs` — the generator pattern to copy
- `public/spritesheets/{hero,female}.png` — 96×128, Pipoya-identical
- `server.mjs` — SQLite room storage, static serving from `dist/client`

**Engine** (`node_modules/`)
- `@rpgjs/client/dist/RpgClientEngine.js` — `addSpriteSheet` :842, `setSpritesheetResolver` :873, `getSpriteSheet` :896
- `@rpgjs/client/dist/module.js` — `spritesheets` / `spritesheetResolver` provider keys :52-66
- `@rpgjs/client/dist/Game/Object.js` :76-84 — graphic array → `graphicsSignals`
- `@rpgjs/client/dist/components/character.ce.js` :939 — one Sprite per graphic
- `@rpgjs/client/dist/presets/rmspritesheet.js` — the 3×4 preset
- `@rpgjs/client/dist/Resource.js` :99 — the `syncResources` trap
- `@rpgjs/server/dist/index.js` :6420 — `setGraphic`
- `pixi.js/lib/assets/loader/parsers/textures/loadTextures.js` :44 — data-URL support
