# Persist the seven starter-team names for the whole save.
#
# The Tower event writes [TEAM] through PFM::Text.set_variable, then immediately
# calls reset_variables. Without this hook the name dies after that scene.
# We store the chosen name in $user_data (saved with the party) and re-apply
# [TEAM] on every message parse / variable reset.

module StockmonstersTeamNames
  NAMES = [
    'Cash Cat Gang',
    'Tendies Crew',
    'Frong Phalanx',
    'Pons Powers',
    'Sushi Samurais',
    'Uniswap Army',
    'The Vlad Impalers'
  ].freeze

  # First creature of each Tower starter trio → team name.
  STARTER_TO_TEAM = {
    squirtle: NAMES[0],
    ivysaur: NAMES[0],
    charizard: NAMES[0],
    cyndaquil: NAMES[1],
    bayleef: NAMES[1],
    feraligatr: NAMES[1],
    mudkip: NAMES[2],
    grovyle: NAMES[2],
    blaziken: NAMES[2],
    piplup: NAMES[3],
    monferno: NAMES[3],
    torterra: NAMES[3],
    tepig: NAMES[4],
    dewott: NAMES[4],
    serperior: NAMES[4],
    chespin: NAMES[5],
    braixen: NAMES[5],
    greninja: NAMES[5],
    popplio: NAMES[6],
    torracat: NAMES[6],
    decidueye: NAMES[6]
  }.freeze

  module_function

  def current_name
    return nil unless defined?($user_data) && $user_data

    stored = $user_data[:player_team_name]
    return stored unless stored.nil? || stored.empty?

    inferred = infer_from_starters
    $user_data[:player_team_name] = inferred if inferred
    inferred
  end

  def infer_from_starters
    creatures = []
    creatures.concat(Array($user_data[:player_team])) if $user_data[:player_team]
    creatures.concat(Array($actors)) if defined?($actors) && $actors
    creatures.each do |creature|
      next unless creature.respond_to?(:db_symbol)

      name = STARTER_TO_TEAM[creature.db_symbol]
      return name if name
    end
    nil
  end

  def persist(expr, value)
    return unless expr.to_s == '[TEAM]'
    return unless defined?($user_data) && $user_data

    text = value.to_s
    $user_data[:player_team_name] = text unless text.empty?
  end

  def apply!
    name = current_name
    return if name.nil? || name.empty?

    PFM::Text.set_variable('[TEAM]', name)
  end
end

module PFM
  module Text
    class << self
      alias stockmonsters_set_variable set_variable
      def set_variable(expr, value)
        stockmonsters_set_variable(expr, value)
        StockmonstersTeamNames.persist(expr, value)
      end

      alias stockmonsters_reset_variables reset_variables
      def reset_variables
        stockmonsters_reset_variables
        StockmonstersTeamNames.apply!
      end

      alias stockmonsters_parse_string_for_messages parse_string_for_messages
      def parse_string_for_messages(text)
        StockmonstersTeamNames.apply!
        stockmonsters_parse_string_for_messages(text)
      end
    end
  end
end

PFM::GameState.on_expand_global_variables(:player_team_name) do |_state|
  StockmonstersTeamNames.apply!
end
