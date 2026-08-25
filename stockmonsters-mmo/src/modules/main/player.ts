import { RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server'

export const player: RpgPlayerHooks = {
    onConnected(player: RpgPlayer) {
        // Tile 29,42 — open floor by the gear emblem, verified against the
        // passages layer. The real spawn comes from PSDK's map data once
        // events are ported.
        player.changeMap('hub', {
            x: 944,
            y: 1360
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
