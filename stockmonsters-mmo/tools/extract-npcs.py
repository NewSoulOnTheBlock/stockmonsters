#!/usr/bin/env python3
"""Extracts talking NPCs/signs from the PSDK Map*.rxdata.yml files into
src/tiled/npcs.json: [{map, x, y, name, lines}].

v1 scope: action-triggered (trigger 0) pages, inline code-101 texts only.
`\\t[file,row]` CSV references, shops (355) and branching are left for the
events stage — the goal here is that the world talks.
"""
import json, os, re, sys
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, '..', 'Stockmonsters')
OUT = os.path.join(ROOT, 'src', 'tiled', 'npcs.json')

class RubyLoader(yaml.SafeLoader):
    pass
def _any(loader, tag_suffix, node):
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node, deep=True)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_scalar(node)
RubyLoader.add_multi_constructor('!ruby/', _any)
RubyLoader.add_constructor('!binary', lambda l, n: None)

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

PREFIX = re.compile(r'^\s*\d+\s*,\s*\d+\s*:?')          # "3, 0 " / "3, 24 :" window prefix
NAME_TAG = re.compile(r'\[name=([^\]]+)\]:?')
FORMAT_CODES = re.compile(r'\\[a-z]\[[^\]]*\]|\\[a-z]', re.I)  # \c[5], \t[..], \n ...

def clean(raw):
    s = PREFIX.sub('', raw)
    name = None
    m = NAME_TAG.search(s)
    if m:
        name = m.group(1)
        s = NAME_TAG.sub('', s)
    if re.fullmatch(r'\s*\\t\[[^\]]*\]\s*', PREFIX.sub('', raw)):
        return None, None  # pure CSV reference, skip
    s = FORMAT_CODES.sub('', s).strip()
    # Core reskin vocabulary — some inline event texts predate the vocab pass
    for a, b in [('Pokémon', 'Stockmonster'), ('POKéMON', 'STOCKMONSTER'),
                 ('Pokemon', 'Stockmonster'), ('Poké Ball', 'Ball'),
                 ('Poké Balls', 'Balls'), ('Pokédex', 'Ledger'), ('Pokedex', 'Ledger')]:
        s = s.replace(a, b)
    return (s or None), name

IDS = map_ids()
npcs = []
for f in sorted(os.listdir(os.path.join(GAME, 'Data'))):
    m = re.match(r'Map(\d+)\.rxdata\.yml$', f)
    if not m or int(m.group(1)) not in IDS:
        continue
    map_id = IDS[int(m.group(1))]
    doc = yaml.load(open(os.path.join(GAME, 'Data', f)), Loader=RubyLoader)
    for ev in (doc.get('events') or {}).values():
        pages = ev.get('pages') or []
        if not pages or pages[0].get('trigger') != 0:
            continue
        cmds = pages[0].get('list') or []
        if any(c.get('code') == 201 for c in cmds):
            continue  # warps are handled by extract-warps.py
        lines, speaker = [], None
        for c in cmds:
            if c.get('code') != 101:
                continue
            p = c.get('parameters') or []
            if not p or not isinstance(p[0], str):
                continue
            text, name = clean(p[0])
            if text:
                lines.append(text)
                speaker = speaker or name
        if lines:
            npcs.append({
                'map': map_id, 'x': ev['x'], 'y': ev['y'],
                'name': speaker or (ev.get('name') if ev.get('name') not in (None, 'None') else None),
                'lines': lines[:6],
            })

json.dump(npcs, open(OUT, 'w'), indent=1, ensure_ascii=False)
by_map = {}
for n in npcs:
    by_map[n['map']] = by_map.get(n['map'], 0) + 1
print(f'{len(npcs)} talking NPCs -> src/tiled/npcs.json')
print(' '.join(f'{k}:{v}' for k, v in sorted(by_map.items())))
