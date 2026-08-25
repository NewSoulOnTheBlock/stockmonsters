// "Create Your Character" — a self-contained DOM overlay with two tabs:
//
//   PICK A TRADER   the ready-made Pipoya sheets, one click = done.
//   BUILD YOUR OWN  six stacked layers (body/eyes/hair/clothes/hat/accessory)
//                   with a live canvas preview, ROTATE and RANDOMIZE.
//
// Both tabs produce the same thing: an ORDERED array of spritesheet ids.
// RPG-JS renders one sprite per entry, in array order, so the array order IS
// the z-order — which is why the builder always emits parts in CHARACTER_PARTS
// order. A ready-made is just a one-element array.
//
// The overlay never talks to the game directly: CONFIRM writes
// localStorage['sm-character'] and dispatches `sm:character`, which is the
// seam index.html / src/client.ts already listen on (client.ts owns delivery,
// including the retry-until-acknowledged loop the server needs).
//
// No framework, no build-time CSS: one <style> tag, injected on mount.
import {
  CHARACTER_PARTS,
  CHARACTER_LAYERS,
  CHARACTER_PRESETS,
  CHARACTER_IDS,
  type CharacterItem,
  type CharacterPart,
} from "./data/character-catalog";

/** Optional handle; only `processAction` is ever used, and only optimistically. */
type CharacterEngine = { processAction?: (action: string, data?: unknown) => void };

const STORAGE_KEY = "sm-character";

// 3 cols x 4 rows of 32x32, rows down/left/right/up. Column 1 is the idle
// (standing) frame of every row — the one pose worth showing in a picker.
const CELL = 32;
const IDLE_COL = 1;
// Rotate button order: down -> left -> up -> right, which reads as the
// character turning on the spot. Row order in the sheet is down/left/right/up.
const DIR_ROWS = [0, 1, 3, 2];
const PREVIEW_SIZE = 128;

// body and eyes are always worn; the rest can be NONE.
const OPTIONAL_PARTS: readonly CharacterPart[] = ["hair", "clothes", "hat", "accessory"];

const PART_LABEL: Record<CharacterPart, string> = {
  body: "BODY",
  eyes: "EYES",
  hair: "HAIR",
  clothes: "CLOTHES",
  hat: "HAT",
  accessory: "ACCESSORY",
};

// Keys the game moves on. While the modal is open they are stopped at the
// window's capture phase so the player doesn't walk around behind it; the
// listener is removed on close, so game input is untouched the rest of the time.
const MOVEMENT_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "w", "a", "s", "d", "W", "A", "S", "D",
]);

const CSS = `
#sm-character-designer {
  position: fixed; inset: 0; z-index: 1002;
  background: rgba(9, 7, 15, .88);
  display: none; align-items: center; justify-content: center;
  font-family: "Courier New", ui-monospace, monospace;
  font-weight: 700; letter-spacing: .08em; color: #fff1c7;
  image-rendering: pixelated;
}
#sm-character-designer.scd-open { display: flex; }
.scd-panel {
  width: min(840px, 95vw); max-height: 92vh;
  display: flex; flex-direction: column;
  background: #26213a; border: 3px solid #f6c177; border-radius: 0;
  box-shadow: 6px 6px 0 #09070f;
  outline: none;
}
.scd-title {
  margin: 0; padding: 13px 18px;
  font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-weight: 600; letter-spacing: .18em;
  font-size: clamp(15px, 2.4vw, 20px);
  text-shadow: 2px 2px 0 #09070f; text-align: center;
  border-bottom: 3px solid #f6c177;
}
.scd-tabs { display: flex; border-bottom: 3px solid #f6c177; }
.scd-tab {
  flex: 1 1 0; padding: 11px 8px;
  font: inherit; font-size: 13px; color: #b9b2d6;
  background: #1b1730; border: 0; border-radius: 0; cursor: pointer;
  image-rendering: pixelated;
}
.scd-tab + .scd-tab { border-left: 3px solid #f6c177; }
.scd-tab:hover { color: #fff1c7; background: #322a4d; }
.scd-tab.scd-active { color: #09070f; background: #f6c177; }
.scd-body { flex: 1 1 auto; min-height: 0; display: flex; }
.scd-pane { display: none; flex: 1 1 auto; min-width: 0; min-height: 0; }
.scd-pane.scd-active { display: flex; }
.scd-build { gap: 0; }
.scd-preview-col {
  flex: 0 0 auto; width: 190px;
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 16px 14px; border-right: 3px solid #f6c177;
}
.scd-stage {
  width: 148px; height: 148px;
  display: flex; align-items: center; justify-content: center;
  background: #1b1730; border: 3px solid #4a4368;
}
.scd-stage canvas { width: 128px; height: 128px; image-rendering: pixelated; }
.scd-summary {
  font-size: 10px; line-height: 1.5; letter-spacing: .04em;
  color: #b9b2d6; text-align: center; word-break: break-all;
}
.scd-parts { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.scd-parttabs {
  display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 12px 0;
}
.scd-parttab {
  padding: 7px 10px; font: inherit; font-size: 11px;
  color: #b9b2d6; background: #1b1730;
  border: 3px solid #4a4368; border-radius: 0; cursor: pointer;
  image-rendering: pixelated;
}
.scd-parttab:hover { color: #fff1c7; border-color: #fff1c7; }
.scd-parttab.scd-active { color: #09070f; background: #7ecf6b; border-color: #f6c177; }
.scd-grid {
  flex: 1 1 auto; min-height: 120px; overflow-y: auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 9px; padding: 12px; scrollbar-width: thin;
}
/* one scroller, six grids inside it — only the active part's grid is shown,
   so switching tabs costs nothing and each grid is built once, on first use */
.scd-partscroll { flex: 1 1 auto; min-height: 120px; overflow-y: auto; padding: 12px; scrollbar-width: thin; }
.scd-partgrid { display: none; }
.scd-partgrid.scd-active {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 9px;
}
.scd-cell {
  position: relative; height: 72px;
  background: #1b1730; border: 3px solid #4a4368; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.scd-cell:hover { border-color: #fff1c7; }
.scd-cell.scd-selected { border-color: #7ecf6b; box-shadow: 0 0 0 1px #7ecf6b inset; }
/* one 32x32 idle-facing-down frame (col 1, row 0), scaled 2x. Layer cells
   stack the chosen BODY underneath the candidate so hair/hats/clothes read as
   worn instead of floating in space. Pure CSS: no canvas, no rAF per cell. */
.scd-sprite { position: relative; width: 32px; height: 32px; transform: scale(2); pointer-events: none; }
.scd-sprite > i {
  position: absolute; inset: 0;
  background-repeat: no-repeat; background-position: -${CELL}px 0;
  image-rendering: pixelated;
}
/* sits over the scaled sprite, so it needs its own plate to stay readable */
.scd-nonelabel {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 2;
  padding: 2px 0; font-size: 9px; letter-spacing: .06em; text-align: center;
  color: #f6c177; background: rgba(9, 7, 15, .82); pointer-events: none;
}
.scd-footer {
  display: flex; justify-content: center; gap: 12px;
  padding: 13px; border-top: 3px solid #f6c177;
}
.scd-btn {
  padding: 10px 20px; font: inherit; font-size: 13px;
  color: #fff1c7; background: #26213a;
  border: 3px solid #f6c177; border-radius: 0;
  box-shadow: 3px 3px 0 #09070f; cursor: pointer; image-rendering: pixelated;
}
.scd-btn:hover { background: #322a4d; }
.scd-btn:not(:disabled):active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #09070f; }
.scd-btn:disabled { opacity: .4; cursor: default; }
.scd-btn.scd-primary { color: #09070f; background: #7ecf6b; }
.scd-btn.scd-primary:hover { background: #93dd80; }
.scd-btn.scd-wide { width: 100%; padding: 9px 6px; font-size: 12px; }
@media (max-width: 620px) {
  .scd-build { flex-direction: column; }
  .scd-preview-col { width: auto; flex-direction: row; flex-wrap: wrap; justify-content: center;
    border-right: 0; border-bottom: 3px solid #f6c177; }
  .scd-btn.scd-wide { width: auto; }
  .scd-summary { flex-basis: 100%; }
}
`;

// --- catalog helpers --------------------------------------------------------

const ITEM_BY_ID = new Map<string, CharacterItem>();
for (const p of CHARACTER_PRESETS) ITEM_BY_ID.set(p.id, p);
for (const part of CHARACTER_PARTS) for (const i of CHARACTER_LAYERS[part]) ITEM_BY_ID.set(i.id, i);

const PART_BY_ID = new Map<string, CharacterPart>();
for (const part of CHARACTER_PARTS) for (const i of CHARACTER_LAYERS[part]) PART_BY_ID.set(i.id, part);

const imageUrl = (id: string) => ITEM_BY_ID.get(id)?.image ?? "";

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

function readSaved(): string[] | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!Array.isArray(raw) || !raw.length || raw.length > 6) return null;
    if (!raw.every((id) => typeof id === "string" && CHARACTER_IDS.has(id))) return null;
    return raw as string[];
  } catch {
    return null;
  }
}

// --- the overlay ------------------------------------------------------------

interface DesignerHandle {
  open(): void;
  close(): void;
  readonly root: HTMLElement;
}

let instance: DesignerHandle | null = null;

/**
 * Builds the overlay (hidden) and returns a handle. Idempotent — calling it
 * twice returns the same instance.
 *
 * `engine` is optional and used for exactly one thing: an optimistic
 * `character:set` the moment CONFIRM is pressed, so a change made from inside
 * the running game shows up without waiting for anything else. Delivery is
 * still owned by client.ts's `sm:character` listener, which retries until the
 * server acknowledges — the direct call is a shortcut, never the guarantee.
 */
export function mountCharacterDesigner(engine?: CharacterEngine | null): DesignerHandle {
  if (instance) return instance;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "sm-character-designer";
  root.innerHTML = `
    <div class="scd-panel" tabindex="-1">
      <h1 class="scd-title">CREATE YOUR CHARACTER</h1>
      <div class="scd-tabs">
        <button type="button" class="scd-tab scd-active" data-mode="preset">PICK A TRADER</button>
        <button type="button" class="scd-tab" data-mode="build">BUILD YOUR OWN</button>
      </div>
      <div class="scd-body">
        <div class="scd-pane scd-active" data-pane="preset">
          <div class="scd-grid" data-grid="preset"></div>
        </div>
        <div class="scd-pane scd-build" data-pane="build">
          <div class="scd-preview-col">
            <div class="scd-stage">
              <canvas width="${PREVIEW_SIZE}" height="${PREVIEW_SIZE}"></canvas>
            </div>
            <button type="button" class="scd-btn scd-wide" data-act="rotate">ROTATE</button>
            <button type="button" class="scd-btn scd-wide" data-act="randomize">RANDOMIZE</button>
            <div class="scd-summary"></div>
          </div>
          <div class="scd-parts">
            <div class="scd-parttabs"></div>
            <div class="scd-partscroll" data-grid="parts"></div>
          </div>
        </div>
      </div>
      <div class="scd-footer">
        <button type="button" class="scd-btn" data-act="cancel">CANCEL</button>
        <button type="button" class="scd-btn scd-primary" data-act="confirm">CONFIRM</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const panel = $<HTMLDivElement>(".scd-panel");
  const presetGrid = $<HTMLDivElement>('[data-grid="preset"]');
  const partTabs = $<HTMLDivElement>(".scd-parttabs");
  const partGrids = $<HTMLDivElement>('[data-grid="parts"]');
  const canvas = $<HTMLCanvasElement>("canvas");
  const summary = $<HTMLDivElement>(".scd-summary");
  const confirmBtn = $<HTMLButtonElement>('[data-act="confirm"]');
  const ctx = canvas.getContext("2d");

  // --- state ---------------------------------------------------------------
  let mode: "preset" | "build" = "preset";
  let presetId: string | null = null;
  let activePart: CharacterPart = "body";
  let dirStep = 0;
  const chosen: Record<CharacterPart, string | null> = {
    body: CHARACTER_LAYERS.body[0]?.id ?? null,
    eyes: CHARACTER_LAYERS.eyes[0]?.id ?? null,
    hair: null,
    clothes: null,
    hat: null,
    accessory: null,
  };

  // Every base <i> in the layer grids paints the currently chosen body, so
  // changing body re-paints all of them at once.
  const baseEls = new Set<HTMLElement>();
  const builtParts = new Set<CharacterPart>();
  let builderSeeded = false;

  // --- preview -------------------------------------------------------------
  const images = new Map<string, HTMLImageElement>();
  function image(url: string): HTMLImageElement {
    let img = images.get(url);
    if (!img) {
      img = new Image();
      img.addEventListener("load", drawPreview);
      img.src = url;
      images.set(url, img);
    }
    return img;
  }

  function currentIds(): string[] {
    return CHARACTER_PARTS.map((p) => chosen[p]).filter((id): id is string => !!id);
  }

  function drawPreview() {
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    const row = DIR_ROWS[dirStep % DIR_ROWS.length];
    for (const id of currentIds()) {
      const img = image(imageUrl(id));
      if (!img.complete || !img.naturalWidth) continue;
      ctx.drawImage(
        img,
        IDLE_COL * CELL, row * CELL, CELL, CELL,
        0, 0, PREVIEW_SIZE, PREVIEW_SIZE
      );
    }
    summary.textContent = currentIds().length + " LAYERS";
  }

  // --- cells ---------------------------------------------------------------
  function spriteCell(item: CharacterItem | null, baseImage: string | null, isBase: boolean) {
    // Almost everything is shown facing down; the catalog marks the handful of
    // items that are only visible from another angle, and the body underneath
    // has to turn with them or the thumbnail is nonsense.
    const row = item?.row ?? 0;
    const offset = `-${CELL}px -${row * CELL}px`;
    const cell = document.createElement("div");
    cell.className = "scd-cell";
    const sprite = document.createElement("span");
    sprite.className = "scd-sprite";
    if (!isBase && baseImage) {
      const base = document.createElement("i");
      base.style.backgroundImage = `url("${baseImage}")`;
      base.style.backgroundPosition = offset;
      baseEls.add(base);
      sprite.appendChild(base);
    }
    if (item) {
      const top = document.createElement("i");
      top.style.backgroundImage = `url("${item.image}")`;
      top.style.backgroundPosition = offset;
      sprite.appendChild(top);
    } else {
      const label = document.createElement("span");
      label.className = "scd-nonelabel";
      label.textContent = "NONE";
      cell.appendChild(label);
    }
    cell.appendChild(sprite);
    return cell;
  }

  function markSelected(container: Element, cell: Element | null) {
    const prev = container.querySelector(".scd-selected");
    if (prev) prev.classList.remove("scd-selected");
    if (cell) cell.classList.add("scd-selected");
  }

  // --- tab 1: ready-mades ---------------------------------------------------
  for (const item of CHARACTER_PRESETS) {
    const cell = spriteCell(item, null, true);
    cell.dataset.id = item.id;
    cell.addEventListener("click", () => {
      presetId = item.id;
      markSelected(presetGrid, cell);
      updateConfirm();
    });
    presetGrid.appendChild(cell);
  }

  // --- tab 2: layers --------------------------------------------------------
  const gridForPart = new Map<CharacterPart, HTMLDivElement>();

  function buildPartGrid(part: CharacterPart) {
    if (builtParts.has(part)) return;
    builtParts.add(part);
    const grid = gridForPart.get(part)!;
    const bodyImage = chosen.body ? imageUrl(chosen.body) : null;
    const isBase = part === "body";

    const add = (item: CharacterItem | null) => {
      const cell = spriteCell(item, bodyImage, isBase);
      if (item) cell.dataset.id = item.id;
      if (chosen[part] === (item?.id ?? null)) cell.classList.add("scd-selected");
      cell.addEventListener("click", () => {
        chosen[part] = item?.id ?? null;
        markSelected(grid, cell);
        if (part === "body") repaintBases();
        drawPreview();
        updateConfirm();
      });
      grid.appendChild(cell);
    };

    if (OPTIONAL_PARTS.includes(part)) add(null);
    for (const item of CHARACTER_LAYERS[part]) add(item);
  }

  function repaintBases() {
    const url = chosen.body ? imageUrl(chosen.body) : "";
    for (const el of baseEls) el.style.backgroundImage = url ? `url("${url}")` : "";
  }

  /** Re-syncs the .scd-selected markers of an already-built grid to `chosen`. */
  function syncPartGrid(part: CharacterPart) {
    const grid = gridForPart.get(part);
    if (!grid || !builtParts.has(part)) return;
    const want = chosen[part] ?? "";
    for (const cell of Array.from(grid.children) as HTMLElement[]) {
      if (!cell.classList.contains("scd-cell")) continue;
      cell.classList.toggle("scd-selected", (cell.dataset.id ?? "") === want);
    }
  }

  for (const part of CHARACTER_PARTS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "scd-parttab" + (part === activePart ? " scd-active" : "");
    tab.textContent = PART_LABEL[part];
    tab.addEventListener("click", () => selectPart(part));
    partTabs.appendChild(tab);

    const grid = document.createElement("div");
    grid.className = "scd-partgrid" + (part === activePart ? " scd-active" : "");
    gridForPart.set(part, grid);
    partGrids.appendChild(grid);
  }

  function selectPart(part: CharacterPart) {
    activePart = part;
    Array.from(partTabs.children).forEach((el, i) =>
      el.classList.toggle("scd-active", CHARACTER_PARTS[i] === part)
    );
    for (const [p, grid] of gridForPart) grid.classList.toggle("scd-active", p === part);
    buildPartGrid(part);
    partGrids.scrollTop = 0;
  }

  // --- actions --------------------------------------------------------------
  function setMode(next: "preset" | "build") {
    mode = next;
    for (const tab of Array.from(root.querySelectorAll(".scd-tab"))) {
      tab.classList.toggle("scd-active", (tab as HTMLElement).dataset.mode === next);
    }
    for (const pane of Array.from(root.querySelectorAll(".scd-pane"))) {
      pane.classList.toggle("scd-active", (pane as HTMLElement).dataset.pane === next);
    }
    if (next === "build") {
      // First visit with nothing saved: seed a complete random character.
      // The raw defaults (first body, first eyes, nothing else) are a naked
      // black silhouette — a bad first impression and a bad starting point.
      if (!builderSeeded) {
        builderSeeded = true;
        buildPartGrid(activePart);
        randomize();
        return;
      }
      buildPartGrid(activePart);
      drawPreview();
    }
    updateConfirm();
  }

  function randomize() {
    for (const part of CHARACTER_PARTS) {
      const items = CHARACTER_LAYERS[part];
      if (!items.length) { chosen[part] = null; continue; }
      // Hats and accessories look better sometimes-absent; hair and clothes
      // are always worn, body and eyes are mandatory.
      const skippable = part === "hat" || part === "accessory";
      chosen[part] = skippable && Math.random() < 0.5 ? null : pick(items).id;
    }
    repaintBases();
    for (const part of CHARACTER_PARTS) syncPartGrid(part);
    drawPreview();
    updateConfirm();
  }

  function chosenIds(): string[] {
    return mode === "preset" ? (presetId ? [presetId] : []) : currentIds();
  }

  function updateConfirm() {
    const ids = chosenIds();
    confirmBtn.disabled = ids.length < 1 || ids.length > 6;
  }

  function confirm() {
    const ids = chosenIds();
    // The server drops the whole request if any id is unknown, and an unknown
    // id that got through would render the player invisible with no error.
    // Cheap to check here, so check here too.
    if (ids.length < 1 || ids.length > 6 || !ids.every((id) => CHARACTER_IDS.has(id))) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {}
    engine?.processAction?.("character:set", { layers: ids });
    window.dispatchEvent(new CustomEvent("sm:character", { detail: ids }));
    close();
  }

  root.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement)?.closest?.("[data-act]") as HTMLElement | null;
    if (act) {
      const which = act.dataset.act;
      if (which === "rotate") { dirStep = (dirStep + 1) % DIR_ROWS.length; drawPreview(); }
      else if (which === "randomize") randomize();
      else if (which === "cancel") close();
      else if (which === "confirm") confirm();
      return;
    }
    const tab = (e.target as HTMLElement)?.closest?.(".scd-tab") as HTMLElement | null;
    if (tab?.dataset.mode) setMode(tab.dataset.mode as "preset" | "build");
  });

  // Keys typed inside the overlay are the overlay's business — don't let them
  // reach the game's window-level listeners.
  root.addEventListener("keydown", (e) => e.stopPropagation());

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    // Only movement is blocked, and only while open: no preventDefault, so
    // Tab/Enter/Space still work normally inside the panel.
    if (MOVEMENT_KEYS.has(e.key)) e.stopPropagation();
  }

  // --- open/close -----------------------------------------------------------
  function open() {
    // Start from whatever is currently saved, so reopening edits your look
    // instead of resetting it.
    const saved = readSaved();
    if (saved) {
      if (saved.length === 1 && ITEM_BY_ID.has(saved[0]) && !PART_BY_ID.has(saved[0])) {
        presetId = saved[0];
        const cell = presetGrid.querySelector(`[data-id="${CSS_ESCAPE(saved[0])}"]`);
        markSelected(presetGrid, cell);
        setMode("preset");
      } else {
        for (const part of CHARACTER_PARTS) chosen[part] = null;
        for (const id of saved) {
          const part = PART_BY_ID.get(id);
          if (part) chosen[part] = id;
        }
        builderSeeded = true; // a saved recipe is the seed
        repaintBases();
        for (const part of CHARACTER_PARTS) syncPartGrid(part);
        setMode("build");
      }
    } else {
      setMode(mode);
    }
    root.classList.add("scd-open");
    window.addEventListener("keydown", onWindowKey, true);
    panel.focus();
    drawPreview();
    updateConfirm();
  }

  function close() {
    root.classList.remove("scd-open");
    window.removeEventListener("keydown", onWindowKey, true);
  }

  // Preload the default preview layers so the canvas isn't blank on first open.
  for (const id of currentIds()) image(imageUrl(id));

  instance = { open, close, root };

  // index.html is a plain (non-module) script, so give it a global to call.
  (window as unknown as Record<string, unknown>).openCharacterDesigner = open;

  return instance;
}

/** Opens the designer, mounting it first if it hasn't been mounted yet. */
export function openCharacterDesigner(): void {
  (instance ?? mountCharacterDesigner()).open();
}

/** CSS.escape isn't in every target browser; ids here are [a-z0-9-] anyway. */
function CSS_ESCAPE(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
