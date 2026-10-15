"""Copy the roster's front sprites out of the PSDK project and key out the
magenta generation background, which some sprites still carry.

Run from the harrow/ folder:  python scripts/build-assets.py
"""
import json
import sys
from collections import deque
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent.parent
FRONTS = HERE.parent / "Stockmonsters" / "graphics" / "pokedex" / "pokefront"
OUT = HERE / "public" / "assets" / "creatures"


def magenta(p, loose=False):
    r, g, b, a = p
    if a == 0:
        return True
    if loose:
        return r > 120 and b > 70 and g < 130 and r - g > 60 and b - g > 30
    return r > 150 and b > 90 and g < 110 and r - g > 90 and b - g > 50


def key(im):
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    # Flood fill from the border with the loose test, so the background goes
    # but magenta details enclosed by the creature's outline survive.
    seen = set()
    q = deque((x, y) for x in range(w) for y in (0, h - 1))
    q.extend((x, y) for y in range(h) for x in (0, w - 1))
    while q:
        x, y = q.popleft()
        if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
            continue
        seen.add((x, y))
        if not magenta(px[x, y], loose=True):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    # Speckled backgrounds leave islands the fill cannot reach; take any pixel
    # that is unambiguously the key colour.
    for y in range(h):
        for x in range(w):
            if magenta(px[x, y]):
                px[x, y] = (0, 0, 0, 0)
    return im


def main():
    roster = json.loads((HERE / "src" / "data" / "roster.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    for c in roster:
        src = FRONTS / f"{c['dexId']:04d}.png"
        if not src.exists():
            missing.append(src.name)
            continue
        key(Image.open(src)).save(OUT / f"{c['id']}.png")
        print(f"ok  {c['id']:<12} <- {src.name}")
    if missing:
        sys.exit(f"missing fronts: {missing}")


if __name__ == "__main__":
    main()
