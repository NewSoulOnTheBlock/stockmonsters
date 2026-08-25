# extract-rmxp-warps.rb — pull the INTERNAL warps (doors, stairs, cave mouths,
# ladders) out of an RPG Maker XP project and emit src/data/rmxp-warps.json.
#
#   ruby tools/extract-rmxp-warps.rb [<rmxp-project-root>] [<out-json>]
#
# Companion to tools/import-rmxp-maps.mjs, which handled the *edge* links from
# PBS map_connections.txt. Edges only cover walking off a map border; every
# cave mouth, gym door and dungeon staircase in RMXP is an in-map EVENT, and
# that is what this script reads.
#
# WHAT AN RMXP WARP LOOKS LIKE
#   An event (RPG::Event, at tile x,y) has pages; each page has a `trigger`
#   (0 = action button, 1/2 = player touch) and a `list` of RPG::EventCommand.
#   Command code 201 is "Transfer Player":
#       parameters = [designationType, mapId, x, y, direction, fadeType]
#   designationType 0 -> mapId/x/y are literal.
#   designationType 1 -> they are VARIABLE IDS, resolved at runtime from game
#                        state. Those cannot be resolved statically, so they
#                        are counted and reported, never guessed at.
#   direction: 0 = keep facing, 2 = down, 4 = left, 6 = right, 8 = up.
#
# THE MAP ID MAPPING is not re-derived here. import-rmxp-maps.mjs already wrote
# it out: every entry in src/tiled/rmxp-manifest.ts carries `rmxpId`, so that
# file IS the numeric-id -> slug table. A destination whose numeric id is absent
# from the manifest was not converted, and the warp is dropped.
#
# NB: Dir['Data/Map*.rxdata'] also matches MapInfos.rxdata (a Hash, not a Map).
# Anchor on a digit: Data/Map[0-9]*.rxdata.
#
# ---------------------------------------------------------------------------
# RESULT ON THE BUNDLED ASSETS (2026-08, see docs/rmxp-map-import.md):
# the Remastered Kanto Johto Map Pack ships ZERO events — every map unmarshals
# with `@events == {}`. It is an art pack for mappers, not a playable project,
# so there are no 201 commands anywhere in it and nothing to extract. The
# script still runs (and will do the right thing against a project that does
# have events); meanwhile `manual` in the output JSON is where hand-authored
# links live, and this script PRESERVES that array across runs.
# ---------------------------------------------------------------------------

require 'json'

load File.expand_path('rmxp-defs.rb', __dir__)

ROOT = File.expand_path('..', __dir__)
src = ARGV[0] || File.expand_path('../new-assets/Remastered Kanto Johto Map Pack', ROOT)
out_path = ARGV[1] || File.join(ROOT, 'src', 'data', 'rmxp-warps.json')

# --- the slug table written by import-rmxp-maps.mjs ------------------------
manifest = File.read(File.join(ROOT, 'src', 'tiled', 'rmxp-manifest.ts'))
SLUG_OF = {}
SIZE_OF = {}
manifest.scan(
  /\{ id: '([^']+)', name: ("(?:[^"\\]|\\.)*"), rmxpId: (\d+), width: (\d+), height: (\d+)/,
) do |slug, _name, rid, w, h|
  SLUG_OF[rid.to_i] = slug
  SIZE_OF[slug] = [w.to_i, h.to_i]
end
abort "no maps found in rmxp-manifest.ts" if SLUG_OF.empty?

# --- scan every map's events ----------------------------------------------
files = Dir[File.join(src, 'Data', 'Map[0-9]*.rxdata')].sort
abort "no Map[0-9]*.rxdata under #{src}/Data" if files.empty?

stats = {
  'maps_scanned' => files.size,
  'maps_with_events' => 0,
  'events_scanned' => 0,
  'transfer_events_201' => 0,
  'script_transfers_355' => 0, # Essentials sometimes calls pbTransfer from a script
  'usable' => 0,
  'variable_driven' => 0,
  'dropped_source_not_converted' => 0,
  'dropped_destination_not_converted' => 0,
  'dropped_duplicate_tile' => 0,
}
dropped_dest_ids = Hash.new(0)
warps = []
seen = {} # "slug:x,y" -> true; first link on a tile wins, as the edge code does

files.each do |f|
  rmxp_id = File.basename(f, '.rxdata')[3..].to_i
  map = Marshal.load(File.binread(f))
  events = map.events || {}
  stats['maps_with_events'] += 1 unless events.empty?
  stats['events_scanned'] += events.size
  from = SLUG_OF[rmxp_id]

  events.each_value do |ev|
    (ev.pages || []).each do |page|
      (page.list || []).each do |cmd|
        # 355/655 are "Script" lines; Essentials projects occasionally do the
        # transfer from Ruby instead of a 201. Counted so the report is honest
        # about what a pure-201 scan would miss.
        if [355, 655].include?(cmd.code) &&
           cmd.parameters.first.to_s =~ /pbTransfer|\$game_temp\.player_new_map_id/
          stats['script_transfers_355'] += 1
          next
        end
        next unless cmd.code == 201

        stats['transfer_events_201'] += 1
        designation, dest_id, tx, ty, dir, = cmd.parameters

        if designation != 0
          stats['variable_driven'] += 1
          next
        end
        if from.nil?
          stats['dropped_source_not_converted'] += 1
          next
        end
        to = SLUG_OF[dest_id]
        if to.nil?
          stats['dropped_destination_not_converted'] += 1
          dropped_dest_ids[dest_id] += 1
          next
        end

        key = "#{from}:#{ev.x},#{ev.y}"
        if seen[key]
          stats['dropped_duplicate_tile'] += 1
          next
        end
        seen[key] = true
        stats['usable'] += 1

        warps << {
          'from' => from, 'x' => ev.x, 'y' => ev.y,
          # RMXP page trigger: 0 = action button, 1 = player touch,
          # 2 = event touch. Doors are usually touch, staircases often action.
          'trigger' => page.trigger == 0 ? 'action' : 'touch',
          'to' => to, 'tx' => tx, 'ty' => ty, 'dir' => dir,
        }
      end
    end
  end
end

warps.sort_by! { |w| [w['from'], w['y'], w['x']] }

# --- preserve hand-authored links -----------------------------------------
manual = []
manual_note = ''
if File.exist?(out_path)
  begin
    prev = JSON.parse(File.read(out_path))
    manual = prev['manual'] || []
    manual_note = prev['_manual_note'] || ''
  rescue JSON::ParserError
    manual = []
  end
end

doc = {
  '_comment' => [
    'GENERATED by tools/extract-rmxp-warps.rb — internal (non-edge) warps for',
    'the RMXP Kanto/Johto maps. Edge links live in rmxp-connections.json.',
    '',
    'Shape of every entry in `warps` and `manual`:',
    '  from    our map slug the player is standing on',
    '  x, y    the trigger TILE on that map (not pixels)',
    '  trigger "touch" -> onPlayerTouch, "action" -> onAction (talk/confirm)',
    '  to      destination map slug',
    '  tx, ty  arrival TILE; snapFree() moves it off any blocked cell',
    '  dir     RMXP facing on arrival: 0 keep, 2 down, 4 left, 6 right, 8 up',
    '',
    '`warps` is regenerated from the .rxdata on every run. `manual` is',
    'hand-authored and PRESERVED across runs — put links there when the source',
    'project has no events to extract.',
  ].join("\n"),
  '_stats' => stats,
  '_dropped_destination_rmxp_ids' => dropped_dest_ids.sort.to_h,
  'warps' => warps,
  '_manual_note' => manual_note,
  'manual' => manual,
}

File.write(out_path, JSON.pretty_generate(doc) + "\n")

warn "scanned #{stats['maps_scanned']} maps, #{stats['events_scanned']} events"
warn "201 transfer commands: #{stats['transfer_events_201']}" \
     " (usable #{stats['usable']}, variable-driven #{stats['variable_driven']}," \
     " dropped-dest #{stats['dropped_destination_not_converted']}," \
     " dropped-dup #{stats['dropped_duplicate_tile']})"
warn "script transfers not parsed: #{stats['script_transfers_355']}"
warn "manual links preserved: #{manual.size}"
warn "-> #{out_path}"
