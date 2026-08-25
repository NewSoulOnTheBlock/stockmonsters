#> Prevent the game from launching
$GAME_LOOP = proc {}

mi = load_data('Data/MapInfos.rxdata')
data = load_data('Data/Studio/psdk.dat')
maplinks_by_map = {}
data[:maplinks__id].each { |ml| maplinks_by_map[ml.map_id] = ml }

visited = { 80 => true }
queue = [80]
until queue.empty?
  cur = queue.shift
  ml = maplinks_by_map[cur]
  next unless ml
  [ml.north_maps, ml.east_maps, ml.south_maps, ml.west_maps].each do |arr|
    arr.each { |l| (visited[l.map_id] ||= (queue << l.map_id; true)) }
  end
end

unreachable = (maplinks_by_map.keys - visited.keys).sort
puts "Unreachable (#{unreachable.size}):"
unreachable.each do |id|
  next if id <= 26 # old demo/hand-built maps, separate concern
  ml = maplinks_by_map[id]
  links_desc = %w[north east south west].map.with_index do |d, i|
    arr = [ml.north_maps, ml.east_maps, ml.south_maps, ml.west_maps][i]
    "#{d}=#{arr.map { |l| l.map_id }.inspect}"
  end.join(' ')
  puts "  #{id} (#{mi[id]&.name}): #{links_desc}"
end
