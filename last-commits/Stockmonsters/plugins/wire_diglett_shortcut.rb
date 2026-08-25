#> Prevent the game from launching
$GAME_LOOP = proc {}

def cond
  RPG::Event::Page::Condition.new.tap do |c|
    c.self_switch_ch = 'A'; c.self_switch_valid = false
    c.switch1_id = 1; c.switch1_valid = false
    c.switch2_id = 1; c.switch2_valid = false
    c.variable_id = 1; c.variable_valid = false; c.variable_value = 0
  end
end

def graphic(name = '')
  RPG::Event::Page::Graphic.new.tap do |g|
    g.blend_type = 0; g.character_hue = 0; g.character_name = name
    g.direction = 2; g.opacity = 255; g.pattern = 0; g.tile_id = 0
  end
end

def cmd(code, params = [], indent: 0)
  RPG::EventCommand.new.tap { |c| c.code = code; c.indent = indent; c.parameters = params }
end

def base_page(trigger:)
  RPG::Event::Page.new.tap do |p|
    p.always_on_top = false
    p.condition = cond
    p.direction_fix = false
    p.graphic = graphic('')
    p.move_frequency = 3
    p.move_route = RPG::MoveRoute.new.tap { |mr| mr.list = [RPG::MoveCommand.new.tap { |c| c.code = 0; c.parameters = [] }]; mr.repeat = true; mr.skippable = false }
    p.move_speed = 3
    p.move_type = 0
    p.step_anime = false
    p.through = false
    p.trigger = trigger
    p.walk_anime = true
  end
end

def add_warp_event(map, name, x, y, target_map, target_x, target_y, direction)
  id = (map.events.keys.max || 0) + 1
  ev = RPG::Event.new
  ev.id = id
  ev.name = name
  page = base_page(trigger: 1)
  page.list = [cmd(201, [0, target_map, target_x, target_y, direction, 0]), cmd(0, [])]
  ev.pages = [page]
  ev.x = x
  ev.y = y
  map.events[id] = ev
  puts "  #{name} @(#{x},#{y}) on this map -> map#{target_map} (#{target_x},#{target_y})"
end

# ---------- Route 2 (36) <-> The Drill Shaft west entrance (38) ----------
map36 = load_data('Data/Map036.rxdata')
puts 'Map036 (Route 2):'
add_warp_event(map36, 'Cave Entrance (Diglett)', 28, 10, 38, 12, 14, 8)
save_data(map36, 'Data/Map036.rxdata')

map38 = load_data('Data/Map038.rxdata')
puts 'Map038 (The Drill Shaft):'
add_warp_event(map38, 'Exit to Route 2', 12, 15, 36, 28, 11, 2)
save_data(map38, 'Data/Map038.rxdata')

# ---------- Route 11 (56) <-> The Drill Shaft east entrance (40) ----------
map56 = load_data('Data/Map056.rxdata')
puts 'Map056 (Route 11):'
add_warp_event(map56, 'Cave Entrance (Diglett)', 7, 17, 40, 12, 14, 8)
save_data(map56, 'Data/Map056.rxdata')

map40 = load_data('Data/Map040.rxdata')
puts 'Map040 (The Drill Shaft East):'
add_warp_event(map40, 'Exit to Route 11', 12, 15, 56, 7, 18, 2)
save_data(map40, 'Data/Map040.rxdata')

# ---------- Internal shortcut: map38 ladder <-> map40 ladder ----------
map38b = load_data('Data/Map038.rxdata')
puts 'Map038 (ladder):'
add_warp_event(map38b, 'Ladder to East Tunnel', 14, 12, 40, 14, 13, 2)
save_data(map38b, 'Data/Map038.rxdata')

map40b = load_data('Data/Map040.rxdata')
puts 'Map040 (ladder):'
add_warp_event(map40b, 'Ladder to West Tunnel', 14, 12, 38, 14, 13, 2)
save_data(map40b, 'Data/Map040.rxdata')

puts "\nDone. Route2 <-> Drill Shaft(W) <-ladder-> Drill Shaft(E) <-> Route11 now fully wired."
