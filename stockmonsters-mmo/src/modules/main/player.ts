import { RpgPlayer, type RpgPlayerHooks, Components } from '@rpgjs/server'

export const player: RpgPlayerHooks = {
    async onConnected(player: RpgPlayer) {
        console.log('[SM] onConnected fired, id=', player.id)
        // Centre of the Hub's floor area (tile 28,37), found by scanning the
        // imported map — the geometric centre of the 64x64 grid is empty void.
        // The real spawn comes from PSDK's map data once events are ported.
        await player.changeMap('simplemap', {
            x: 300,
            y: 300
        })
        console.log('[SM] after changeMap, map=', (player as any).map, 'pos=', player.position)
        player.name = 'Trader'
        player.setGraphic('hero')
        console.log('[SM] graphic set')
    },
    onInput(player: RpgPlayer, { action }) {
        if (action == 'escape') {
            player.callMainMenu()
        }
    }
}
