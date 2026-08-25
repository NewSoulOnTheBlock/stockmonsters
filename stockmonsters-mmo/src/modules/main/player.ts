import { RpgPlayer, type RpgPlayerHooks, Components } from '@rpgjs/server'

export const player: RpgPlayerHooks = {
    onConnected(player: RpgPlayer) {
        // Centre of the Hub's floor area (tile 28,37), found by scanning the
        // imported map — the geometric centre of the 64x64 grid is empty void.
        // The real spawn comes from PSDK's map data once events are ported.
        player.changeMap('hub', {
            x: 700,
            y: 600
        })
        player.name = 'Trader'
        player.setGraphic('hero')
    },
    onInput(player: RpgPlayer, { action }) {
        if (action == 'escape') {
            player.callMainMenu()
        }
    }
}
