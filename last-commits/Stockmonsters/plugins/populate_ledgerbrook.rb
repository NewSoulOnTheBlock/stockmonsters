#> Prevent the game from launching
$GAME_LOOP = proc {}

MAP_ID = 80 # Ledgerbrook

sys = load_data('Data/System.rxdata')
puts "Current switches array size: #{sys.switches.size}"
free_switch = sys.switches.size # next free index (index 0 is unused/nil in RMXP switches array)
sys.switches[free_switch] = 'EV080_STARTER_CHOSEN'
save_data(sys, 'Data/System.rxdata')
puts "Reserved switch #{free_switch} = EV080_STARTER_CHOSEN"

def cond(switch_id: nil, switch_valid: false)
  RPG::Event::Page::Condition.new.tap do |c|
    c.self_switch_ch = 'A'
    c.self_switch_valid = false
    c.switch1_id = switch_id || 1
    c.switch1_valid = switch_valid
    c.switch2_id = 1
    c.switch2_valid = false
    c.variable_id = 1
    c.variable_valid = false
    c.variable_value = 0
  end
end

def graphic(character_name, direction: 2)
  RPG::Event::Page::Graphic.new.tap do |g|
    g.blend_type = 0
    g.character_hue = 0
    g.character_name = character_name
    g.direction = direction
    g.opacity = 255
    g.pattern = 0
    g.tile_id = 0
  end
end

def cmd(code, params = [], indent: 0)
  RPG::EventCommand.new.tap do |c|
    c.code = code
    c.indent = indent
    c.parameters = params
  end
end

def text_lines(lines, indent: 0)
  out = []
  lines.each_with_index do |line, i|
    out << cmd(i.zero? ? 101 : 401, [line], indent: indent)
  end
  out
end

def move_route
  RPG::MoveRoute.new.tap do |mr|
    mr.list = [cmd(0)] # code 0 = end of move route list (RPG::MoveCommand, not EventCommand, but same code/params shape)
    mr.repeat = true
    mr.skippable = false
  end
end

def base_page(switch_id: nil, switch_valid: false, character_name:, direction: 2, trigger: 0)
  RPG::Event::Page.new.tap do |p|
    p.always_on_top = false
    p.condition = cond(switch_id: switch_id, switch_valid: switch_valid)
    p.direction_fix = false
    p.graphic = graphic(character_name, direction: direction)
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

map = load_data(format('Data/Map%03d.rxdata', MAP_ID))
next_event_id = (map.events.keys.max || 0) + 1
puts "Existing events on map#{MAP_ID}: #{map.events.size}, next id=#{next_event_id}"

# ---------- Event 1: Warrenson, the Old Trader (starter NPC, 2 pages) ----------
warrenson = RPG::Event.new
warrenson.id = next_event_id
warrenson.name = 'Warrenson'

page1_list = []
page1_list.concat(text_lines([
  "Well now. You've got that look about you.",
  "The look of someone who wants to READ the Market instead of just living inside it.",
  "I've got three Cores left. Pick the one that matches your nerve.",
]))
page1_list << cmd(102, [['Nvidrake', 'Teslazar', 'Applion'], 4])
page1_list << cmd(402, [0, 'Nvidrake'], indent: 0)
page1_list << cmd(108, ['Nvidrake - aggressive, high damage, high volatility (BULL archetype)'], indent: 1)
page1_list << cmd(355, ['add_pokemon(:charmander, 5, false)'], indent: 1)
page1_list.concat(text_lines(['Nvidrake it is. Bold pick. Don\'t get liquidated.'], indent: 1))
page1_list << cmd(0, [], indent: 1)
page1_list << cmd(402, [1, 'Teslazar'], indent: 0)
page1_list << cmd(108, ['Teslazar - defensive, high survivability (BEAR archetype)'], indent: 1)
page1_list << cmd(355, ['add_pokemon(:squirtle, 5, false)'], indent: 1)
page1_list.concat(text_lines(['Teslazar. Smart. Live long enough to be right.'], indent: 1))
page1_list << cmd(0, [], indent: 1)
page1_list << cmd(402, [2, 'Applion'], indent: 0)
page1_list << cmd(108, ['Applion - stable, reliable, slow growth (BOND archetype)'], indent: 1)
page1_list << cmd(355, ['add_pokemon(:bulbasaur, 5, false)'], indent: 1)
page1_list.concat(text_lines(['Applion. The boring choice. The boring choice wins more than people admit.'], indent: 1))
page1_list << cmd(0, [], indent: 1)
page1_list << cmd(404, [], indent: 0)
page1_list << cmd(121, [free_switch, free_switch, 0], indent: 0) # turn switch ON (0 = ON per RGSS control-switches convention)
page1_list.concat(text_lines([
  'Go on, then. New Yorket doesn\'t wait for anyone.',
]))
page1_list << cmd(0, [])

page1 = base_page(switch_id: free_switch, switch_valid: false, character_name: 'npc_Prof_Elm', direction: 2, trigger: 0)
page1.list = page1_list

page2_list = text_lines([
  "Trust your Core's instincts. Yours too, for that matter.",
])
page2_list << cmd(0, [])
page2 = base_page(switch_id: free_switch, switch_valid: true, character_name: 'npc_Prof_Elm', direction: 2, trigger: 0)
page2.list = page2_list

warrenson.pages = [page1, page2]
warrenson.x = 20
warrenson.y = 12
map.events[warrenson.id] = warrenson
puts "Added Warrenson as event ##{warrenson.id} at (20,12)"

# ---------- Event 2: Sign ----------
sign_id = next_event_id + 1
sign = RPG::Event.new
sign.id = sign_id
sign.name = 'Ledgerbrook Sign'
sign_page = base_page(character_name: '', direction: 2, trigger: 0)
sign_page.list = text_lines([
  'LEDGERBROOK',
  'Population: modest. Ambition: significant.',
]) + [cmd(0, [])]
sign.pages = [sign_page]
sign.x = 25
sign.y = 8
map.events[sign.id] = sign
puts "Added sign as event ##{sign.id} at (25,8)"

# ---------- Event 3: The Broker (mild first cameo) ----------
broker_id = next_event_id + 2
broker = RPG::Event.new
broker.id = broker_id
broker.name = 'The Broker'
broker_page = base_page(character_name: 'npc_Rival_boy1', direction: 2, trigger: 0)
broker_page.list = text_lines([
  "...",
  "You think you're trading monsters.",
  "...",
  "You're actually trading pieces of the Market.",
  "...",
]) + [cmd(0, [])]
broker.pages = [broker_page]
broker.x = 40
broker.y = 15
map.events[broker.id] = broker
puts "Added The Broker as event ##{broker.id} at (40,15)"

save_data(map, format('Data/Map%03d.rxdata', MAP_ID))
puts "Saved map#{MAP_ID}. Total events now: #{map.events.size}"
