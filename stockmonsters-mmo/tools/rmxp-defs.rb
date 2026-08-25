# Minimal stub classes so Ruby's Marshal can load RPG Maker XP .rxdata without
# RMXP itself. Verified against the Remastered Kanto Johto Map Pack.
#
# Table is RMXP's binary multi-dimensional array: a 20-byte header
# (size, xsize, ysize, zsize, item_count) followed by item_count little-endian
# uint16s. Map data is x*y*z with z=3 (lower/middle/upper tile layers).
#
# Usage: ruby -r./tools/rmxp-defs.rb -e "..." or `load` it.
class Table
  def self._load(s)
    t = allocate
    _, nx, ny, nz, n = s[0, 20].unpack('LLLLL')
    t.instance_variable_set(:@xsize, nx)
    t.instance_variable_set(:@ysize, ny)
    t.instance_variable_set(:@zsize, nz)
    t.instance_variable_set(:@data, s[20..-1].unpack("v#{n}"))
    t
  end
  attr_reader :xsize, :ysize, :zsize, :data

  # (x, y, z) -> value, RMXP's column-major-ish layout
  def [](x, y = 0, z = 0)
    @data[x + y * @xsize + z * @xsize * @ysize]
  end
end

class Color; def self._load(_s); allocate; end; end
class Tone;  def self._load(_s); allocate; end; end

module RPG
  class Map
    attr_accessor :width, :height, :data, :tileset_id, :events, :autoplay_bgm, :bgm
  end
  class MapInfo; attr_accessor :name, :parent_id, :order; end
  class Tileset
    attr_accessor :id, :name, :tileset_name, :autotile_names,
                  :passages, :priorities, :terrain_tags, :panorama_name, :fog_name
  end
  class Event
    attr_accessor :id, :name, :x, :y, :pages
    class Page
      attr_accessor :condition, :graphic, :list, :trigger, :move_route, :through
      class Graphic; attr_accessor :character_name, :tile_id, :direction, :pattern; end
      class Condition; end
    end
  end
  class MoveRoute; attr_accessor :list; end
  class MoveCommand; attr_accessor :code, :parameters; end
  class EventCommand; attr_accessor :code, :parameters, :indent; end
  class AudioFile; attr_accessor :name, :volume, :pitch; end
end
