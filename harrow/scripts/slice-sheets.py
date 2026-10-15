"""Slice character sheets into uniform spritesheets for Phaser.

Each sheet lists animation bands (a box in the source image below the
section label). Inside a band a figure is any "solid" pixel, and frames are
split wherever a run of empty columns appears. Every frame is centred and
stood on a shared floor line, so animations do not bob between frames.

Two ways of deciding what is solid:
  alpha  - the sheet already has transparency (raider)
  key    - opaque sheet on a flat background colour, keyed out by distance

Run from harrow/:  python scripts/slice-sheets.py [--debug]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent.parent
ART = HERE / "art-src"

SHEETS = {
    "raider": {
        "src": "raider-sheet.png",
        "mode": "alpha",
        "min_w": 14,  # narrower runs are ladder rails, labels or noise
        "bands": {
            "idle": (12, 272, 425, 392),
            "walk": (432, 272, 892, 392),
            "run": (898, 272, 1295, 392),
            "crouch": (12, 432, 340, 535),
            "jump": (700, 425, 1030, 535),
            "hurt": (800, 742, 930, 848),
            "death": (1028, 742, 1295, 848),
        },
    },
    "shardcrawler": {
        "src": "shardcrawler-sheet.png",
        "mode": "key",
        "bg": (6, 14, 20),
        "tol": 10,
        "min_w": 20,
        "bands": {
            "idle": (26, 312, 562, 410),
            "walk": (580, 312, 1092, 410),
            "run": (1106, 312, 1512, 410),
            "lunge": (26, 592, 642, 676),
            "spit": (656, 592, 1090, 676),  # stop before the projectile trail
            "hurt": (26, 718, 382, 800),
            "death": (396, 718, 1132, 800),
        },
        # single images cut out whole
        "extras": {"shard": (1276, 740, 1322, 786)},
    },
    "titan": {
        "src": "titan-sheet.png",
        "mode": "key",
        "bg": (1, 12, 20),
        "tol": 12,
        "min_w": 30,
        "bands": {
            # frames touch (dust, smoke, muzzle trails), so split by count or cut list
            "idle": ((24, 318, 565, 410), 7),
            "run": ((24, 448, 546, 534), 6),
            "charge": ((24, 572, 476, 662), 4),
            "fire": ((490, 572, 960, 662), 5),
            "slam": ((970, 548, 1512, 664), [1078, 1165, 1250, 1352]),
            "hurt": ((24, 702, 396, 792), 4),
            "death": ((410, 702, 876, 792), [500, 640, 735]),
        },
        "erase": [(975, 546, 1150, 568), (98, 312, 110, 345)],
    },
}


def solid_mask(im, cfg):
    if cfg["mode"] == "alpha":
        return im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    br, bg, bb = cfg["bg"]
    tol = cfg["tol"] ** 2
    rgb = im.convert("RGB")
    mask = Image.new("L", im.size)
    src, out = rgb.load(), mask.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = src[x, y]
            if (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2 > tol:
                out[x, y] = 255
    return mask


def segments(mask, box, min_w):
    x0, y0, x1, y1 = box
    cols = [any(mask[x, y] for y in range(y0, y1)) for x in range(x0, x1)]
    runs, start = [], None
    for i, on in enumerate(cols + [False]):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - start >= min_w:
                runs.append((x0 + start, x0 + i))
            start = None
    frames = []
    for a, b in runs:
        rows = [y for y in range(y0, y1) if any(mask[x, y] for x in range(a, b))]
        frames.append((a, rows[0], b, rows[-1] + 1))
    return frames


def column_counts(mask, x0, x1, y0, y1):
    return [sum(1 for y in range(y0, y1) if mask[x, y]) for x in range(x0, x1)]


def fixed_frames(mask, box, split):
    """Split a band near fixed x positions (a cut list, or `split` equal parts).

    Each cut snaps to the emptiest column within SNAP px of where it was
    expected, then thin slivers of the neighbouring frame are trimmed off the
    slice edges.
    """
    SNAP, SLIVER, GAP = 22, 16, 2
    x0, y0, x1, y1 = box
    counts = column_counts(mask, x0, x1, y0, y1)
    if isinstance(split, int):
        w = (x1 - x0) / split
        guesses = [round(x0 + w * i) for i in range(1, split)]
    else:
        guesses = list(split)
    cuts = []
    for g in guesses:
        lo, hi = max(x0, g - SNAP), min(x1 - 1, g + SNAP)
        cuts.append(min(range(lo, hi + 1), key=lambda x: (counts[x - x0], abs(x - g))))
    edges = [x0, *cuts, x1]
    frames = []
    for a, b in zip(edges, edges[1:]):
        # column runs inside the slice; keep the widest and anything wide beside it
        runs, start, empty = [], None, 0
        for x in range(a, b + 1):
            on = x < b and counts[x - x0] > 0
            if on:
                if start is None:
                    start = x
                empty = 0
            elif start is not None:
                empty += 1
                if empty > GAP or x == b:
                    runs.append((start, x - empty + 1))
                    start, empty = None, 0
        if not runs:
            continue
        keep = [r for r in runs if r[1] - r[0] >= SLIVER] or [max(runs, key=lambda r: r[1] - r[0])]
        l, r = keep[0][0], keep[-1][1]
        ys = [y for y in range(y0, y1) if any(mask[x, y] for x in range(l, r))]
        frames.append((l, ys[0], r, ys[-1] + 1))
    return frames


def band_frames(mask, spec, min_w):
    if isinstance(spec[0], tuple):
        return fixed_frames(mask, spec[0], spec[1])
    return segments(mask, spec, min_w)


def band_box(spec):
    return spec[0] if isinstance(spec[0], tuple) else spec


def slice_sheet(name, cfg, debug):
    im = Image.open(ART / cfg["src"]).convert("RGBA")
    m = solid_mask(im, cfg)
    for box in cfg.get("erase", []):
        m.paste(0, box)  # section labels that sit inside a band
    mask = m.load()
    clean = Image.new("RGBA", im.size)
    clean.paste(im, (0, 0), m)

    anims = {a: band_frames(mask, spec, cfg["min_w"]) for a, spec in cfg["bands"].items()}
    fw = max(b[2] - b[0] for fr in anims.values() for b in fr) + 2
    fh = max(b[3] - b[1] for fr in anims.values() for b in fr) + 2
    cols = max(len(fr) for fr in anims.values())
    sheet = Image.new("RGBA", (fw * cols, fh * len(anims)))
    meta = {"frameWidth": fw, "frameHeight": fh, "columns": cols, "anims": {}}
    for row, (a, frames) in enumerate(anims.items()):
        for i, (l, t, r, btm) in enumerate(frames):
            fig = clean.crop((l, t, r, btm))
            sheet.paste(fig, (i * fw + (fw - fig.width) // 2, row * fh + fh - 1 - fig.height))
        meta["anims"][a] = {"start": row * cols, "count": len(frames)}
        print(f"  {a:<7} {len(frames)} frames")
    out = HERE / "public" / "assets"
    out.mkdir(parents=True, exist_ok=True)
    sheet.save(out / f"{name}.png")
    for extra, box in cfg.get("extras", {}).items():
        clean.crop(box).save(out / f"{name}-{extra}.png")
    (HERE / "src" / "data" / f"{name}.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"  frame {fw}x{fh}, sheet {sheet.size}")

    if debug:
        dbg = clean.copy()
        d = ImageDraw.Draw(dbg)
        for a, spec in cfg["bands"].items():
            d.rectangle(band_box(spec), outline=(0, 255, 255))
            for f in anims[a]:
                d.rectangle(f, outline=(255, 0, 0))
        dbg.save(ART / f"{name}-debug.png")


def main():
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    for name, cfg in SHEETS.items():
        if only and name not in only:
            continue
        print(name)
        slice_sheet(name, cfg, "--debug" in sys.argv)


if __name__ == "__main__":
    main()
