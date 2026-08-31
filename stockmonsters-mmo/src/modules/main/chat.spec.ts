import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
    handleChat, addChatMember, removeChatMember, resetChatLimits,
    sendChatHistory, forgetChatHistory, HISTORY_MAX,
} from './chat'

/*
 * Chat limits. The interesting cases are the ones a naive implementation gets
 * wrong: a spammer reloading the page, and a spammer repeating themselves
 * slowly enough to stay inside the window.
 */

type Msg = { system?: boolean; from?: string; text: string }

function talker(opts: { wallet?: string; id?: string; name?: string | null } = {}) {
    const got: Msg[] = []
    const player: any = {
        id: opts.id ?? 'conn-' + Math.random().toString(16).slice(2),
        emit: (_type: string, value: Msg) => got.push(value),
        getVariable: (k: string) =>
            k === 'WALLET_ID' ? opts.wallet
                : k === 'NAME' ? (opts.name === null ? undefined : opts.name ?? 'Someone')
                    : undefined,
    }
    return { player, got, system: () => got.filter((m) => m.system).map((m) => m.text) }
}

const say = (p: any, text: string) => handleChat(p, { text })

beforeEach(() => { resetChatLimits(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('chat rate limiting', () => {
    it('lets a real conversation run, then throttles a flood', () => {
        // This used to be one message every five seconds flat, and two people
        // talking hit the wall on nearly every line — the game told them to
        // slow down when they were not being fast. A burst is what an actual
        // exchange looks like; the wall is for the sixth line in fifteen
        // seconds, not the second.
        const a = talker({ wallet: 'w:' + 'a'.repeat(32) })
        addChatMember(a.player)

        for (let i = 0; i < 5; i++) say(a.player, `line ${i}`)
        expect(a.got.filter((m) => !m.system)).toHaveLength(5)
        expect(a.system()).toHaveLength(0)

        say(a.player, 'one too many')
        const refused = a.system()
        expect(refused).toHaveLength(1)
        expect(refused[0]).toMatch(/5 messages every 15s/i)
    })

    it('lets the next one through once the window has passed', () => {
        const a = talker({ wallet: 'w:' + 'b'.repeat(32) })
        addChatMember(a.player)

        say(a.player, 'first')
        vi.advanceTimersByTime(15_100)
        say(a.player, 'second')

        expect(a.got.filter((m) => !m.system).map((m) => m.text)).toEqual(['first', 'second'])
    })

    it('charges the WALLET, so reloading does not buy a fresh budget', () => {
        const wallet = 'w:' + 'c'.repeat(32)
        const before = talker({ wallet, id: 'conn-1' })
        addChatMember(before.player)
        for (let i = 0; i < 5; i++) say(before.player, `spam ${i}`)
        expect(before.got.filter((m) => !m.system)).toHaveLength(5)

        // Same player, new page load: RPG-JS hands out a brand new connection id.
        // The budget must NOT reset — pressing F5 is exactly what a spammer does.
        removeChatMember(before.player)
        const after = talker({ wallet, id: 'conn-2' })
        addChatMember(after.player)
        say(after.player, 'spam again')

        expect(after.got.filter((m) => !m.system)).toHaveLength(0)
        expect(after.system()[0]).toMatch(/easy/i)
    })

    it('refuses the same line repeated, even after the rate window', () => {
        const a = talker({ wallet: 'w:' + 'd'.repeat(32) })
        addChatMember(a.player)

        say(a.player, 'buy my thing')
        vi.advanceTimersByTime(6_000) // past the rate limit, inside the repeat window
        say(a.player, 'buy my thing')

        expect(a.got.filter((m) => !m.system)).toHaveLength(1)
        expect(a.system()[0]).toMatch(/just said that/i)
    })

    it('allows the same line again once the repeat window has passed', () => {
        const a = talker({ wallet: 'w:' + 'e'.repeat(32) })
        addChatMember(a.player)

        say(a.player, 'anyone trading?')
        vi.advanceTimersByTime(31_000)
        say(a.player, 'anyone trading?')

        expect(a.got.filter((m) => !m.system)).toHaveLength(2)
    })
})

describe('chat delivery', () => {
    it('reaches everyone connected, not just the sender', () => {
        const a = talker({ wallet: 'w:' + '1'.repeat(32), name: 'Alice' })
        const b = talker({ wallet: 'w:' + '2'.repeat(32), name: 'Bob' })
        addChatMember(a.player)
        addChatMember(b.player)

        say(a.player, 'hello world')

        const heard = b.got.filter((m) => !m.system)
        expect(heard).toHaveLength(1)
        expect(heard[0]).toMatchObject({ from: 'Alice', text: 'hello world' })
    })

    it('tells every listener WHICH player said it', () => {
        // The speech bubble over a character (src/chat-bubbles.ts) is keyed by
        // the sender's player id: it is what the client's scene stores sprites
        // under, and unlike the name it cannot change mid-session. Without it
        // a listener knows what was said and by which name, but has no head to
        // put the bubble over.
        const a = talker({ wallet: 'w:' + '7'.repeat(32), name: 'Alice', id: 'conn-alice' })
        const b = talker({ wallet: 'w:' + '8'.repeat(32), name: 'Bob', id: 'conn-bob' })
        addChatMember(a.player)
        addChatMember(b.player)

        say(a.player, 'over here')

        const heard = b.got.filter((m) => !m.system) as Array<Msg & { id?: string }>
        expect(heard[0].id).toBe('conn-alice')
        // ...and the sender sees their own, so their bubble appears too.
        const own = a.got.filter((m) => !m.system) as Array<Msg & { id?: string }>
        expect(own[0].id).toBe('conn-alice')
    })

    it('stops reaching someone who disconnected', () => {
        const a = talker({ wallet: 'w:' + '3'.repeat(32), name: 'Alice' })
        const b = talker({ wallet: 'w:' + '4'.repeat(32), name: 'Bob' })
        addChatMember(a.player)
        addChatMember(b.player)
        removeChatMember(b.player)

        say(a.player, 'still there?')
        expect(b.got).toHaveLength(0)
    })

    it('will not carry a message from a player with no name', () => {
        const a = talker({ wallet: 'w:' + '5'.repeat(32), name: null })
        const b = talker({ wallet: 'w:' + '6'.repeat(32), name: 'Bob' })
        addChatMember(a.player)
        addChatMember(b.player)

        say(a.player, 'anonymous shilling')

        expect(b.got).toHaveLength(0)
        expect(a.system()[0]).toMatch(/choose a name/i)
    })

    it('filters before it rate-limits, so a blocked link costs nothing', () => {
        const a = talker({ wallet: 'w:' + '7'.repeat(32) })
        addChatMember(a.player)

        say(a.player, 'visit example.com')      // refused by the filter
        say(a.player, 'a real message')          // must still be allowed

        expect(a.got.filter((m) => !m.system).map((m) => m.text)).toEqual(['a real message'])
    })
})

/*
 * HISTORY — what a player who joins later is told.
 *
 * The two things that are easy to get wrong, and that a browser test would
 * find only by accident:
 *   1. the backlog going out on `chat:message`, which is the channel
 *      chat-bubbles.ts draws speech bubbles from — twenty old lines would be
 *      twenty bubbles over people who are standing silently;
 *   2. the backlog being re-sent on a MAP CHANGE. A player joins a room every
 *      time they walk through a door, so "send it when they join" is a trap.
 */
type Wire = { type: string; value: any }

function listener(id = 'conn-' + Math.random().toString(16).slice(2)) {
    const wire: Wire[] = []
    const player: any = {
        id,
        emit: (type: string, value: any) => wire.push({ type, value }),
        getVariable: (k: string) => (k === 'NAME' ? 'Watcher' : undefined),
    }
    const history = () => wire.filter((w) => w.type === 'chat:history').map((w) => w.value.messages)
    return { player, wire, history }
}

describe('chat history', () => {
    it('gives a player who joins later what was already said', () => {
        const a = talker({ wallet: 'w:' + 'a1'.repeat(16), name: 'Alice' })
        addChatMember(a.player)
        say(a.player, 'anyone around?')
        say(a.player, 'i am at the dock')

        // Bob was not connected for either line.
        const bob = listener()
        addChatMember(bob.player)
        sendChatHistory(bob.player, { onlyOnce: true })

        const [backlog] = bob.history()
        expect(backlog.map((m: any) => m.text)).toEqual(['anyone around?', 'i am at the dock'])
        expect(backlog.every((m: any) => m.from === 'Alice')).toBe(true)
    })

    it('never sends history on the channel speech bubbles listen to', () => {
        const a = talker({ wallet: 'w:' + 'a2'.repeat(16), name: 'Alice' })
        addChatMember(a.player)
        say(a.player, 'old news')

        const bob = listener()
        sendChatHistory(bob.player, { onlyOnce: true })

        // chat-bubbles.ts subscribes to `chat:message` and nothing else.
        expect(bob.wire.some((w) => w.type === 'chat:message')).toBe(false)
        expect(bob.wire.map((w) => w.type)).toEqual(['chat:history'])
        // ...and there is no player id to hang a bubble on even if it did.
        expect(bob.history()[0][0].id).toBeUndefined()
    })

    it('does not replay the backlog when the player changes map', () => {
        const a = talker({ wallet: 'w:' + 'a3'.repeat(16), name: 'Alice' })
        addChatMember(a.player)
        say(a.player, 'said once')

        const bob = listener('conn-bob')
        addChatMember(bob.player)
        sendChatHistory(bob.player, { onlyOnce: true })
        // A door: onJoinMap fires again, with a FRESH player object carrying
        // the same transport id.
        const sameSessionNewRoom = listener('conn-bob')
        addChatMember(sameSessionNewRoom.player)
        sendChatHistory(sameSessionNewRoom.player, { onlyOnce: true })

        expect(bob.history()).toHaveLength(1)
        expect(sameSessionNewRoom.history()).toHaveLength(0)
    })

    it('gives a genuinely new session its history even on a recycled id', () => {
        const a = talker({ wallet: 'w:' + 'a4'.repeat(16), name: 'Alice' })
        addChatMember(a.player)
        say(a.player, 'still here')

        const first = listener('conn-recycled')
        sendChatHistory(first.player, { onlyOnce: true })
        removeChatMember(first.player)          // they really left

        const second = listener('conn-recycled') // the id comes back around
        forgetChatHistory('conn-recycled')       // what onConnected does
        sendChatHistory(second.player, { onlyOnce: true })

        expect(second.history()).toHaveLength(1)
    })

    it('answers an asking client, but not forever', () => {
        const a = talker({ wallet: 'w:' + 'a5'.repeat(16), name: 'Alice' })
        addChatMember(a.player)
        say(a.player, 'hello')

        const bob = listener()
        for (let i = 0; i < 10; i++) sendChatHistory(bob.player)
        expect(bob.history().length).toBeLessThanOrEqual(3)
        expect(bob.history().length).toBeGreaterThan(0)
    })

    it('answers with nothing rather than silence when nobody has spoken', () => {
        const bob = listener()
        sendChatHistory(bob.player, { onlyOnce: true })
        expect(bob.history()).toEqual([[]])
    })

    it('keeps a readable tail, not the whole day', () => {
        // Five wallets so the rate limit is not what is being measured here.
        for (let w = 0; w < 5; w++) {
            const a = talker({ wallet: `w:${String(w).repeat(32)}`.slice(0, 34), name: 'Alice' })
            addChatMember(a.player)
            for (let i = 0; i < 5; i++) {
                say(a.player, `line ${w}-${i}`)
                vi.advanceTimersByTime(4000)
            }
        }
        const bob = listener()
        sendChatHistory(bob.player, { onlyOnce: true })
        const [backlog] = bob.history()
        expect(backlog.length).toBeLessThanOrEqual(HISTORY_MAX)
        // ...and it is the NEWEST lines that survive the cut.
        expect(backlog[backlog.length - 1].text).toBe('line 4-4')
    })

    it('drops a line that is older than the window', () => {
        const a = talker({ wallet: 'w:' + 'a6'.repeat(16), name: 'Alice' })
        addChatMember(a.player)
        say(a.player, 'yesterday')
        vi.advanceTimersByTime(25 * 3600_000)
        say(a.player, 'today')

        const bob = listener()
        sendChatHistory(bob.player, { onlyOnce: true })
        expect(bob.history()[0].map((m: any) => m.text)).toEqual(['today'])
    })

    it('writes global chat to the store, and nothing a player was refused', () => {
        const written: any[] = []
        ;(globalThis as any).__smChatLog = {
            append: (m: any) => written.push(m),
            recent: async () => [],
        }
        try {
            const wallet = 'w:' + 'a7'.repeat(16)
            const a = talker({ wallet, name: 'Alice' })
            addChatMember(a.player)
            say(a.player, 'a real message')
            say(a.player, 'visit example.com')   // refused by the filter
            say(a.player, 'a real message')      // refused as a repeat

            expect(written).toEqual([{ walletId: wallet, name: 'Alice', text: 'a real message' }])
        } finally {
            delete (globalThis as any).__smChatLog
        }
    })

    it('still works when the store is gone entirely', () => {
        // No __smChatLog at all: this is a server with no DATABASE_URL, or one
        // whose Postgres has died. Live chat is unaffected, and the backlog is
        // whatever this process has heard.
        expect((globalThis as any).__smChatLog).toBeUndefined()
        const a = talker({ wallet: 'w:' + 'a8'.repeat(16), name: 'Alice' })
        const b = talker({ wallet: 'w:' + 'a9'.repeat(16), name: 'Bob' })
        addChatMember(a.player)
        addChatMember(b.player)
        say(a.player, 'can you hear me')
        expect(b.got.filter((m) => !m.system).map((m) => m.text)).toEqual(['can you hear me'])

        const late = listener()
        sendChatHistory(late.player, { onlyOnce: true })
        expect(late.history()[0].map((m: any) => m.text)).toEqual(['can you hear me'])
    })
})
