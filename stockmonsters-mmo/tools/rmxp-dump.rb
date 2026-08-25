# Dumps an RPG Maker XP project's Data/*.rxdata to JSON so Node can do the
# image and TMX work.  Ruby is here only because .rxdata is a Ruby Marshal
# stream; everything downstream lives in tools/import-rmxp-maps.mjs.
#
#   ruby tools/rmxp-dump.rb <rmxp-project-root> <out-dir>
#
# Writes:
#   <out>/meta.json      tilesets + map infos + the map index
#   <out>/map-<id>.json  one per map: {id,width,height,tileset_id,data:[...]}
#
# `data` is the flattened RMXP Table: index = x + y*width + z*width*height,
# z = 0 (lower) / 1 (middle) / 2 (upper).  Deterministic: everything is
# emitted in ascending id order.

require 'json'
require 'fileutils'

load File.expand_path('rmxp-defs.rb', __dir__)

src = ARGV[0] or abort 'usage: ruby tools/rmxp-dump.rb <rmxp-root> <out-dir>'
out = ARGV[1] or abort 'usage: ruby tools/rmxp-dump.rb <rmxp-root> <out-dir>'
FileUtils.mkdir_p(out)

def load_rx(path)
  Marshal.load(File.binread(path))
end

# Tilesets.rxdata is an Array indexed by tileset id (slot 0 is nil).
tilesets = load_rx(File.join(src, 'Data', 'Tilesets.rxdata'))
ts_json = {}
tilesets.each_with_index do |t, i|
  next if t.nil?
  next if t.tileset_name.to_s.empty? # unused editor slots
  ts_json[i] = {
    'id' => t.id,
    'name' => t.name,
    'tileset_name' => t.tileset_name,
    'autotile_names' => t.autotile_names,
    'passages' => t.passages.data,
    'priorities' => t.priorities.data,
    'terrain_tags' => t.terrain_tags.data,
  }
end

# MapInfos.rxdata is a Hash keyed by map id, NOT an array.
infos = load_rx(File.join(src, 'Data', 'MapInfos.rxdata'))
info_json = {}
infos.keys.sort.each do |id|
  mi = infos[id]
  info_json[id] = { 'name' => mi.name, 'parent_id' => mi.parent_id, 'order' => mi.order }
end

# NB: Data/Map*.rxdata also matches MapInfos.rxdata — anchor on a digit.
files = Dir[File.join(src, 'Data', 'Map[0-9]*.rxdata')].sort
index = []
files.each do |f|
  id = File.basename(f, '.rxdata')[3..].to_i
  m = load_rx(f)
  d = m.data
  raise "map #{id}: unexpected zsize #{d.zsize}" unless d.zsize == 3
  raise "map #{id}: size mismatch" unless d.xsize == m.width && d.ysize == m.height
  File.write(
    File.join(out, "map-#{id}.json"),
    JSON.generate(
      'id' => id, 'width' => m.width, 'height' => m.height,
      'tileset_id' => m.tileset_id, 'data' => d.data,
    ),
  )
  index << {
    'id' => id,
    'name' => info_json.dig(id, 'name') || "Map#{id}",
    'width' => m.width, 'height' => m.height,
    'tileset_id' => m.tileset_id,
    'events' => (m.events || {}).size,
  }
end

File.write(
  File.join(out, 'meta.json'),
  JSON.pretty_generate('tilesets' => ts_json, 'mapinfos' => info_json, 'maps' => index),
)
warn "dumped #{index.size} maps, #{ts_json.size} tilesets -> #{out}"
