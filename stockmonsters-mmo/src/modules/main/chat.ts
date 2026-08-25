import { RpgPlayer } from '@rpgjs/server'
import { filterChat } from './chat-filter'

/*
 * Global chat. Messages are validated and filtered server-side (never trust
 * the client's own filtering) and broadcast to everyone on the sender's map
 * over the custom websocket channel the battle scene already uses.
 *
 * Rate limiting is per player id and deliberately simple: chat is cheap to
 * spam and expensive to moderate.
 */

const RATE_WINDOW_MS = 10_000
const RATE_MAX = 6
const recent = new Map<string, number[]>()

function rateLimited(id: string): boolean {
    const now = Date.now()
    const hits = (recent.get(id) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
    hits.push(now)
    recent.set(id, hits)
    return hits.length > RATE_MAX
}

export function handleChat(player: RpgPlayer, data: unknown) {
    const id = String(player.id)
    const result = filterChat((data as { text?: unknown })?.text)
    if (!result.ok) {
        player.emit('chat:message', { system: true, text: result.reason })
        return
    }
    if (rateLimited(id)) {
        player.emit('chat:message', { system: true, text: 'Slow down a moment.' })
        return
    }
    const name = (player.getVariable('NAME') as string | undefined) ?? player.name ?? 'Trader'
    const payload = { from: name, text: result.text }
    const map = player.getCurrentMap?.()
    const audience: RpgPlayer[] = (map as any)?.players
        ? Object.values((map as any).players)
        : [player]
    for (const peer of audience) peer.emit?.('chat:message', payload)
}
