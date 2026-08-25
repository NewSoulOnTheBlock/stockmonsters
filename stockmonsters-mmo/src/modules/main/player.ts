import { RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server'
import { openMenu } from './menus'

export const player: RpgPlayerHooks = {
    onConnected(player: RpgPlayer) {
        // Every map transfer reconnects the socket and fires onConnected
        // again — spawning unconditionally here yanks the player back to the
        // hub mid-transfer and ping-pongs them between maps forever.
        if (player.getVariable('SPAWNED')) return
        player.setVariable('SPAWNED', true)
        // The PSDK game starts you on the Exterior map: System.rxdata says
        // start = Map002 (intro cutscene) and the intro's transfer drops you
        // at exterior tile (24,60) — the ship deck, which the passages layer
        // marks blocked because you leave it via a scripted walk. (24,62) is
        // the first open cell below it: the dock where you step ashore.
        player.changeMap('exterior', {
            x: 784,
            y: 2000
        })
        player.name = 'Trader'
        player.setGraphic('hero')
    },
    onInput(player: RpgPlayer, { action }) {
        // Escape opens our menu (the built-in main menu comes later with
        // proper GUIs); hotbar keys never reach onInput in beta.33.
        if (action == 'escape') void openMenu(player)
    }
}
