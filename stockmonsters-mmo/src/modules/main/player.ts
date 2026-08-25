import { RpgPlayer, type RpgPlayerHooks } from '@rpgjs/server'
import { openMenu } from './menus'
import { CHARACTER_IDS } from '../../data/character-catalog'
import { validateName } from './names'
import { handleChat } from './chat'
import { Components } from '@rpgjs/server'

const DEFAULT_GRAPHIC = 'hero'

// The engine's default text component renders large and anti-aliased, which
// sat on top of the sprite and read as a browser overlay rather than part of
// the game. Small, monospaced and hard-outlined matches the pixel theme; the
// margin lifts it clear of the character's head.
function applyNameTag(player: RpgPlayer) {
    player.setComponentsTop(
        Components.text('{name}', {
            fontFamily: 'Courier New, monospace',
            fontSize: 11,
            fontWeight: 'bold',
            fill: '#fff1c7',
            stroke: '#09070f',
            strokeThickness: 4,
            align: 'center',
        }),
        { width: 96, height: 14, marginBottom: 6 },
    )
}

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

        // Name tag above every character — synced to all clients by the engine
        player.name = (player.getVariable('NAME') as string | undefined) ?? 'Trader'
        applyNameTag(player)

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
            // Acknowledge: the client retries until it sees this, because an
            // action sent before the room is joined is dropped silently.
            player.emit('character:accepted', { layers: ids })
            return
        }
        if (action == 'name:set') {
            const result = validateName((data as { name?: unknown })?.name)
            if ('error' in result) {
                player.emit('name:rejected', { reason: result.error })
                return
            }
            player.setVariable('NAME', result.name)
            player.name = result.name
            applyNameTag(player)
            player.emit('name:accepted', { name: result.name })
            return
        }
        if (action == 'auth:wallet') {
            // The id is an HMAC only the server can produce (auth.mjs), so a
            // client presenting one has proven wallet ownership at some point.
            // It is the identity we key player-owned things to; the transport
            // connection id is deliberately throwaway.
            const id = (data as { id?: unknown })?.id
            const address = (data as { address?: unknown })?.address
            if (typeof id !== 'string' || !/^w:[0-9a-f]{32}$/.test(id)) return
            player.setVariable('WALLET_ID', id)
            if (typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address)) {
                player.setVariable('WALLET_ADDRESS', address.toLowerCase())
            }
            return
        }
        if (action == 'chat:send') {
            handleChat(player, data)
        }
    }
}
