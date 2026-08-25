# $AGORA - the currency of The Marketlands.
#
# Almost every currency string in the game comes from the text database and is
# already reskinned there. One place hardcodes the unit in Ruby instead:
# GamePlay::TCard#create_money renders "#{PFM.game_state.money}$".
#
# Per the custom-script rules we never edit the PSDK codebase, so we reopen the
# single method here. Custom scripts load after the basecode, so this wins.

module GamePlay
  class TCard
    # Name of the in-game currency, shown after the amount.
    AGORA_CURRENCY = '$AGORA'

    # Draw the player's money on the trainer card, denominated in $AGORA.
    # Overrides the basecode version, which appended a bare "$".
    def create_money
      @texts.add_text(225, 4, 88, 16, "#{PFM.game_state.money} #{AGORA_CURRENCY}", 2, color: 9)
    end
  end
end
