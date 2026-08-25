import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { handleChat, addChatMember, removeChatMember, resetChatLimits } from './chat'

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
    it('allows one message, then refuses the next within 5 seconds', () => {
        const a = talker({ wallet: 'w:' + 'a'.repeat(32) })
        addChatMember(a.player)

        say(a.player, 'hello there')
        expect(a.got.filter((m) => !m.system)).toHaveLength(1)

        say(a.player, 'and another thing')
        const refused = a.system()
        expect(refused).toHaveLength(1)
        expect(refused[0]).toMatch(/one message every 5s/i)
    })

    it('lets the next one through once the window has passed', () => {
        const a = talker({ wallet: 'w:' + 'b'.repeat(32) })
        addChatMember(a.player)

        say(a.player, 'first')
        vi.advanceTimersByTime(5_100)
        say(a.player, 'second')

        expect(a.got.filter((m) => !m.system).map((m) => m.text)).toEqual(['first', 'second'])
    })

    it('charges the WALLET, so reloading does not buy a fresh budget', () => {
        const wallet = 'w:' + 'c'.repeat(32)
        const before = talker({ wallet, id: 'conn-1' })
        addChatMember(before.player)
        say(before.player, 'spam one')

        // Same player, new page load: RPG-JS hands out a brand new connection id.
        removeChatMember(before.player)
        const after = talker({ wallet, id: 'conn-2' })
        addChatMember(after.player)
        say(after.player, 'spam two')

        expect(after.got.filter((m) => !m.system)).toHaveLength(0)
        expect(after.system()[0]).toMatch(/slow down/i)
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
