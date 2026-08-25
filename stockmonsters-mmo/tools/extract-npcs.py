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
    # stripped \v[] player-name codes leave ", ," and stray double spaces
    s = re.sub(r'\s+,', ',', re.sub(r',\s*,', ',', s))
    s = re.sub(r'\s{2,}', ' ', s).strip()
    return (s or None), name

# --- curation ---------------------------------------------------------------
# PSDK ships as a DEMO project: the library, photo studio and game corner are
# tutorial rooms whose NPCs explain engine commands to the developer. Those are
# noise in a real game, as is any line still naming unreskinned species. What
# survives is capped per map so towns feel populated, not crowded.

# engine-tutorial tells: command names, message markup, editor vocabulary
JUNK = re.compile(
    r'\b(command|nametag|event(?:-making|s)?\b|switch|variable|charset|'
    r'PSDK|Pokemon Studio|RMXP|script|CSV|scripting|debug)\b'
    r'|\[(?:lookto|city|align|sprite|WAIT|name)=?'
    r'|\$game_|\$bag\.|auto_skip|pick_item|give_item|animate_from',
    re.I,
)
# leftover Nintendo species names — the reskin never touched inline event text
SPECIES = re.compile(
    r'\b(Kirlia|Munchlax|Tynamo|Pikachu|Eevee|Bulbasaur|Charmander|Squirtle|'
    r'Rattata|Pidgey|Zubat|Geodude|Magikarp|Snorlax|Machop|Abra|Gastly|Onix|'
    r'Nidoran|Jigglypuff|Meowth|Psyduck|Growlithe|Ponyta|Tentacool|Krabby|'
    r'Voltorb|Cubone|Koffing|Rhyhorn|Chansey|Tangela|Horsea|Goldeen|Staryu|'
    r'Scyther|Jynx|Pinsir|Tauros|Lapras|Ditto|Omanyte|Kabuto|Aerodactyl|'
    r'Dratini|Mewtwo|Mew|Birch|Oak|Team Rocket|Rocket Grunt)\b',
    re.I,
)
# per-map ceiling: enough for flavour, few enough to walk through
CAP = 6
CAP_BY_MAP = {'hub': 8, 'exterior': 6, 'labo': 5, 'library': 4,
              'gamecorner': 4, 'photostudio': 3}


def is_junk(npc):
    text = ' '.join(npc['lines'])
    if JUNK.search(text) or SPECIES.search(text):
        return True
    if npc['name'] and (JUNK.search(npc['name']) or SPECIES.search(npc['name'])):
        return True
    # engine demo events are named after the feature they show off, and
    # internal identifiers (NPC_foo, BattleOrdering) are not character names
    if npc['name'] and (
        re.match(r'^[\$\[]|^(EV\d|Add_|Lookto|Money|Map picture)', npc['name'])
        or '_' in npc['name']
        or re.fullmatch(r'(?:[A-Z][a-z]+){2,}', npc['name'])
    ):
        return True
    # dev-facing offers to reset/replace world state
    if re.search(r'\breset (?:the|your)\b|unplaced', text, re.I):
        return True
    # scenery events (a radio, a bin, a sign): they render as people here,
    # which reads as a bug — drop them until object graphics exist
    if npc['name'] and re.fullmatch(
        r'(?i)(radio|trash bin|bin|television|tv|sign|poster|mug|clock|'
        r'bookshelf|shelf|computer|pc|machine|terminal|board|note|book)',
        npc['name'].strip(),
    ):
        return True
    return len(text.strip()) < 12  # empty grunts


def curate(all_npcs):
    kept = []
    for map_id in sorted({n['map'] for n in all_npcs}):
        on_map = [n for n in all_npcs if n['map'] == map_id and not is_junk(n)]
        # prefer NPCs with a name and something to say, then keep map order
        on_map.sort(key=lambda n: (n['name'] is None, -len(' '.join(n['lines']))))
        keep = on_map[: CAP_BY_MAP.get(map_id, CAP)]
        keep.sort(key=lambda n: (n['y'], n['x']))
        kept.extend(keep)
    return kept


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

raw_count = len(npcs)
npcs = curate(npcs)
json.dump(npcs, open(OUT, 'w'), indent=1, ensure_ascii=False)
by_map = {}
for n in npcs:
    by_map[n['map']] = by_map.get(n['map'], 0) + 1
print(f'{len(npcs)} talking NPCs (from {raw_count} raw) -> src/tiled/npcs.json')
print(' '.join(f'{k}:{v}' for k, v in sorted(by_map.items())))
