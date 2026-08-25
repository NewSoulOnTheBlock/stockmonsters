import { RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server'
import { openMenu } from './menus'
import { CHARACTER_IDS } from '../../data/character-catalog'

const DEFAULT_GRAPHIC = 'hero'

// The whole character-selector security model: the client sends graphic ids,
// the server accepts only whitelisted ones. An unknown id would render the
// player invisible to everyone with no error (engine has no fallback), so
// this gate is anti-griefing, not cosmetics.
function sanitizeCharacter(input: unknown): string[] | null {
    if (!Array.isArray(input) || input.length < 1 || input.length > 6) return null
    const ids = input.filter((v): v is string => typeof v === 'string' && v.length > 0)
    if (ids.length !== input.length) return null
    if (!ids.every((id) => id === DEFAULT_GRAPHIC || id === 'female' || CHARACTER_IDS.has(id))) return null
    return ids
}

export const player: RpgPlayerHooks = {
    onConnected(player: RpgPlayer) {
        // Restore the chosen look on EVERY connect — map transfers reconnect
        // the socket, and the graphic must survive them.
        const saved = sanitizeCharacter(player.getVariable('CHARACTER'))
        player.setGraphic(saved ?? [DEFAULT_GRAPHIC])

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
    },
    onInput(player: RpgPlayer, { action, data }) {
        // Escape opens our menu (the built-in main menu comes later with
        // proper GUIs); hotbar keys never reach onInput in beta.33.
        if (action == 'escape') { void openMenu(player); return }
        if (action == 'character:set') {
            const ids = sanitizeCharacter((data as { layers?: unknown })?.layers)
            if (!ids) return // silently ignore garbage
            player.setVariable('CHARACTER', ids) // -> data/rooms.sqlite, keyed by wallet
            player.setGraphic(ids)               // -> @sync() graphics -> every peer
        }
    }
}
