import { appendFileSync } from 'node:fs'
import { RpgPlayer, type RpgPlayerHooks, Components } from '@rpgjs/server'

const trace = (m: string) => { try { appendFileSync('/tmp/sm-hook.log', m + '\n') } catch {} }
trace('MODULE LOADED ' + new Date().toISOString())

export const player: RpgPlayerHooks = {
    async onConnected(player: RpgPlayer) {
        trace('onConnected id=' + player.id)
        // Centre of the Hub's floor area (tile 28,37), found by scanning the
        // imported map — the geometric centre of the 64x64 grid is empty void.
        // The real spawn comes from PSDK's map data once events are ported.
        await player.changeMap('hub', {
            x: 700,
            y: 600
        })
        trace('afterChangeMap map=' + (player as any).map + ' pos=' + JSON.stringify(player.position))
        player.name = 'Trader'
        player.setGraphic('hero')
        trace('graphic set')
    },
    onInput(player: RpgPlayer, { action }) {
        if (action == 'escape') {
            player.callMainMenu()
        }
    }
}
