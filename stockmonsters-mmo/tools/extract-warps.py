#!/usr/bin/env python3
"""Extracts map-transfer events (RPG Maker command 201) from the PSDK game's
Map*.rxdata.yml files into src/tiled/warps.json.

Output: [{from, x, y, to, toX, toY, trigger}] — tile coords, trigger is
"touch" (walk into it) or "action" (press the action key on it).
"""
import json, os, re, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, '..', 'Stockmonsters')
OUT = os.path.join(ROOT, 'src', 'tiled', 'warps.json')

# Ruby-tagged YAML: treat every !ruby/object as a plain dict
class RubyLoader(yaml.SafeLoader):
    pass
def _any(loader, tag_suffix, node):
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node, deep=True)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_scalar(node)
RubyLoader.add_multi_constructor('!ruby/', _any)
RubyLoader.add_constructor('!binary', lambda l, n: None)  # tile blobs, irrelevant

# PSDK map number -> our RPG-JS map id, via Studio's tiledFilename
def map_ids():
    ids = {}
    studio = os.path.join(GAME, 'Data', 'Studio', 'maps')
    for f in os.listdir(studio):
        if not f.endswith('.json'):
            continue
        data = json.load(open(os.path.join(studio, f)))
        tiled = data.get('tiledFilename')
        if not tiled:
            continue
        rid = re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', re.sub(r'^\d+\s*', '', tiled).lower()))
        ids[data['id']] = rid
    return ids

IDS = map_ids()
TRIGGERS = {0: 'action', 1: 'touch', 2: 'touch'}
warps = []

for f in sorted(os.listdir(os.path.join(GAME, 'Data'))):
    m = re.match(r'Map(\d+)\.rxdata\.yml$', f)
    if not m:
        continue
    num = int(m.group(1))
    if num not in IDS:
        continue
    doc = yaml.load(open(os.path.join(GAME, 'Data', f)), Loader=RubyLoader)
    for ev in (doc.get('events') or {}).values():
        for page in ev.get('pages') or []:
            trigger = TRIGGERS.get(page.get('trigger'))
            if trigger is None:
                continue  # autorun/parallel pages are cutscene logic
            for cmd in page.get('list') or []:
                if cmd.get('code') != 201:
                    continue
                p = cmd.get('parameters') or []
                # [direct/variable, map_id, x, y, direction, fade]
                if len(p) < 4 or p[0] != 0 or p[1] not in IDS:
                    continue
                warps.append({
                    'from': IDS[num], 'x': ev['x'], 'y': ev['y'],
                    'to': IDS[p[1]], 'toX': p[2], 'toY': p[3],
                    'trigger': trigger,
                })

# an event can have several pages pointing at the same place — dedupe
seen, unique = set(), []
for w in warps:
    key = (w['from'], w['x'], w['y'])
    if key in seen:
        continue
    seen.add(key)
    unique.append(w)

json.dump(unique, open(OUT, 'w'), indent=1)
print(f'{len(unique)} warps -> {os.path.relpath(OUT, ROOT)}')
for w in unique:
    print(f"  {w['from']}({w['x']},{w['y']}) -> {w['to']}({w['toX']},{w['toY']}) [{w['trigger']}]")
