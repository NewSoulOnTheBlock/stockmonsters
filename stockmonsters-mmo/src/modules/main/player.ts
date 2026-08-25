import { RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server'

export const player: RpgPlayerHooks = {
    onConnected(player: RpgPlayer) {
        // Every map transfer reconnects the socket and fires onConnected
        // again — spawning unconditionally here yanks the player back to the
        // hub mid-transfer and ping-pongs them between maps forever.
        if (player.getVariable('SPAWNED')) return
        player.setVariable('SPAWNED', true)
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
