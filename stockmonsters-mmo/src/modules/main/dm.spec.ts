import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    NEAR_PX,
    addDmMember,
    removeDmMember,
    dmNearby,
    dmRoster,
    handleDmNearby,
    handleDmSend,
    handleDmBlock,
    handleDmUnblock,
    handleDmGiftInfo,
    resetDm,
} from './dm'

/*
 * The fake player is deliberately dumb: plain x/y numbers, a plain map string,
 * a getVariable that answers from a literal. dm.ts reads signals OR plain
 * values for exactly this reason — a test that had to construct engine signals
 * would be testing the engine.
 *
 * The cases here are the ones a naive DM gets wrong: the boundary of "next to
 * each other", the two of you walking apart mid-conversation, a block that only
 * works one way, and a rate limit that a page reload resets.
 */

interface Emitted { type: string; value: any }

function trader(opts: {
    id?: string
    name?: string | null
    wallet?: string | null
    address?: string | null
    map?: string
    x?: number
    y?: number
} = {}) {
    const got: Emitted[] = []
    const p: any = {
        id: opts.id ?? 'conn-' + Math.random().toString(16).slice(2),
        map: opts.map ?? 'exterior',
        x: opts.x ?? 0,
        y: opts.y ?? 0,
        emit: (type: string, value: any) => got.push({ type, value }),
        getVariable: (k: string) =>
            k === 'WALLET_ID' ? (opts.wallet ?? undefined)
                : k === 'WALLET_ADDRESS' ? (opts.address ?? undefined)
                    : k === 'NAME' ? (opts.name === null ? undefined : opts.name ?? 'Trader')
                        : undefined,
    }
    return {
        player: p,
        got,
        of: (type: string) => got.filter((e) => e.type === type).map((e) => e.value),
        system: () => got.filter((e) => e.type === 'dm:system').map((e) => e.value.text as string),
        messages: () => got.filter((e) => e.type === 'dm:message').map((e) => e.value),
        walkTo: (x: number, y: number) => { p.x = x; p.y = y },
    }
}

const wallet = (n: string) => 'w:' + n.repeat(32).slice(0, 32)

beforeEach(() => { resetDm(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/* ------------------------------------------------------------- roster --- */

describe('the roster', () => {
    it('reports each member live, with map, position and wallet address', () => {
        const a = trader({ id: 'a', name: 'Alice', address: '0x' + 'a'.repeat(40), x: 100, y: 200 })
        addDmMember(a.player)

        expect(dmRoster()).toEqual([
            { id: 'a', name: 'Alice', address: '0x' + 'a'.repeat(40), map: 'exterior', x: 100, y: 200 },
        ])

        // Positions are READ, never cached: the roster must follow the player.
        a.walkTo(132, 200)
        expect(dmRoster()[0]).toMatchObject({ x: 132 })
    })

    it('replaces the stored object when the same id rejoins a map', () => {
        // The engine hands each room a FRESH RpgPlayer, and emit() on a stale
        // one silently does nothing. Re-adding must overwrite, not duplicate.
        const first = trader({ id: 'a', name: 'Alice' })
        addDmMember(first.player)
        const second = trader({ id: 'a', name: 'Alice', map: 'lab' })
        addDmMember(second.player)

        expect(dmRoster()).toHaveLength(1)
        expect(dmRoster()[0].map).toBe('lab')
    })

    it('normalises the engine\'s "map-" prefix so one map is one map', () => {
        const a = trader({ id: 'a', map: 'map-exterior', x: 0, y: 0 })
        const b = trader({ id: 'b', map: 'exterior', x: 0, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        expect(dmNearby(a.player)?.id).toBe('b')
    })
})

/* ---------------------------------------------------------- proximity --- */

describe('finding who is nearby', () => {
    it('accepts a player exactly on the boundary and refuses one past it', () => {
        const a = trader({ id: 'a', name: 'Alice', x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: NEAR_PX, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        expect(dmNearby(a.player)).toMatchObject({ id: 'b', name: 'Bob' })

        b.walkTo(NEAR_PX + 1, 0)
        expect(dmNearby(a.player)).toBeNull()
    })

    it('measures diagonally, not per axis', () => {
        // (48,48) is 48px on each axis but 67.9px away — outside two tiles.
        const a = trader({ id: 'a', x: 0, y: 0 })
        const b = trader({ id: 'b', x: 48, y: 48 })
        addDmMember(a.player)
        addDmMember(b.player)
        expect(dmNearby(a.player)).toBeNull()

        b.walkTo(45, 45) // 63.6px
        expect(dmNearby(a.player)?.id).toBe('b')
    })

    it('never offers someone on another map, however close the coordinates', () => {
        const a = trader({ id: 'a', map: 'exterior', x: 10, y: 10 })
        const b = trader({ id: 'b', map: 'lab', x: 10, y: 10 })
        addDmMember(a.player)
        addDmMember(b.player)

        expect(dmNearby(a.player)).toBeNull()
    })

    it('picks the closest of several', () => {
        const a = trader({ id: 'a', x: 0, y: 0 })
        const far = trader({ id: 'far', name: 'Far', x: 60, y: 0 })
        const near = trader({ id: 'near', name: 'Near', x: 20, y: 0 })
        ;[a, far, near].forEach((t) => addDmMember(t.player))

        expect(dmNearby(a.player)?.name).toBe('Near')
    })

    it('says whether the peer can be gifted to, without leaking their address', () => {
        const a = trader({ id: 'a', x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 10, y: 0, address: '0x' + 'b'.repeat(40) })
        addDmMember(a.player)
        addDmMember(b.player)

        const peer = dmNearby(a.player)
        expect(peer).toEqual({ id: 'b', name: 'Bob', hasWallet: true })
        expect(JSON.stringify(peer)).not.toContain('0x')
    })

    it('does not offer a second tab of the same wallet', () => {
        const w = wallet('a')
        const one = trader({ id: 'tab1', wallet: w, x: 0, y: 0 })
        const two = trader({ id: 'tab2', wallet: w, x: 8, y: 0 })
        addDmMember(one.player)
        addDmMember(two.player)

        expect(dmNearby(one.player)).toBeNull()
    })

    it('answers dm:nearby with a reason when there is nobody', () => {
        const a = trader({ id: 'a' })
        addDmMember(a.player)
        handleDmNearby(a.player)

        expect(a.of('dm:nearby-result')[0].peer).toBeNull()
        expect(a.of('dm:nearby-result')[0].reason).toMatch(/close enough/i)
    })
})

/* ------------------------------------------------------------ sending --- */

describe('sending a message', () => {
    const pair = () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', wallet: wallet('b'), x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)
        return { a, b }
    }

    it('reaches the recipient AND echoes to the sender', () => {
        const { a, b } = pair()
        handleDmSend(a.player, { to: 'b', text: 'want to trade?' })

        expect(b.messages()).toHaveLength(1)
        expect(b.messages()[0]).toMatchObject({
            peer: { id: 'a', name: 'Alice' }, from: 'Alice', text: 'want to trade?', mine: false,
        })
        // The sender must see their own line, and it must be filed under BOB.
        expect(a.messages()[0]).toMatchObject({
            peer: { id: 'b', name: 'Bob' }, from: 'Alice', text: 'want to trade?', mine: true,
        })
    })

    it('refuses once the two have walked apart', () => {
        const { a, b } = pair()
        handleDmSend(a.player, { to: 'b', text: 'still here?' })
        expect(b.messages()).toHaveLength(1)

        b.walkTo(NEAR_PX + 8, 0) // Bob wanders off
        vi.advanceTimersByTime(3_000)
        handleDmSend(a.player, { to: 'b', text: 'come back' })

        expect(b.messages()).toHaveLength(1)
        expect(a.system()[0]).toMatch(/walked away from Bob/i)
    })

    it('refuses once the recipient has changed map', () => {
        const { a, b } = pair()
        b.player.map = 'lab'
        handleDmSend(a.player, { to: 'b', text: 'hello?' })

        expect(b.messages()).toHaveLength(0)
        expect(a.system()[0]).toMatch(/walked away/i)
    })

    it('refuses a player who has disconnected', () => {
        const { a, b } = pair()
        removeDmMember(b.player)
        handleDmSend(a.player, { to: 'b', text: 'hello?' })

        expect(b.messages()).toHaveLength(0)
        expect(a.system()[0]).toMatch(/has left/i)
    })

    it('will not carry a message from a player with no name', () => {
        const a = trader({ id: 'a', name: null, wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)
        handleDmSend(a.player, { to: 'b', text: 'anonymous' })

        expect(b.messages()).toHaveLength(0)
        expect(a.system()[0]).toMatch(/choose a name/i)
    })
})

/* ------------------------------------------------------------ filter ---- */

describe('filtering', () => {
    const pair = () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)
        return { a, b }
    }

    it('refuses a link in private exactly as it does in public', () => {
        const { a, b } = pair()
        handleDmSend(a.player, { to: 'b', text: 'visit example.com' })

        expect(b.messages()).toHaveLength(0)
        expect(a.system()[0]).toMatch(/no links/i)
    })

    it('refuses a contract address', () => {
        const { a, b } = pair()
        handleDmSend(a.player, { to: 'b', text: 'send to 0xdeadbeefcafe1234' })

        expect(b.messages()).toHaveLength(0)
        expect(a.system()[0]).toMatch(/contract addresses/i)
    })

    it('costs no rate budget, so a refused link does not mute you', () => {
        const { a, b } = pair()
        handleDmSend(a.player, { to: 'b', text: 'visit example.com' }) // refused
        handleDmSend(a.player, { to: 'b', text: 'a real message' })    // must land

        expect(b.messages().map((m) => m.text)).toEqual(['a real message'])
    })
})

/* ------------------------------------------------------------- blocks --- */

describe('blocking', () => {
    const pair = () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', wallet: wallet('b'), x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)
        return { a, b }
    }

    it('stops the blocked player from sending', () => {
        const { a, b } = pair()
        handleDmBlock(b.player, { id: 'a' })
        expect(b.of('dm:blocked')[0]).toEqual({ id: 'a', name: 'Alice', blocked: true })

        handleDmSend(a.player, { to: 'b', text: 'hello' })
        expect(b.messages()).toHaveLength(0)
        expect(a.system()[0]).toMatch(/not accepting messages/i)
    })

    it('stops the BLOCKER sending too — a block ends the conversation', () => {
        const { a, b } = pair()
        handleDmBlock(b.player, { id: 'a' })

        handleDmSend(b.player, { to: 'a', text: 'one last word' })
        expect(a.messages()).toHaveLength(0)
        expect(b.system()[0]).toMatch(/you blocked alice/i)
    })

    it('removes the blocker from the other side\'s nearby offer, and vice versa', () => {
        const { a, b } = pair()
        expect(dmNearby(a.player)?.id).toBe('b')

        handleDmBlock(b.player, { id: 'a' })
        expect(dmNearby(a.player)).toBeNull() // Alice is not offered Bob
        expect(dmNearby(b.player)).toBeNull() // ...and Bob is not offered Alice
    })

    it('is keyed by wallet, so it survives the blocked player reloading', () => {
        const { a, b } = pair()
        handleDmBlock(b.player, { id: 'a' })

        // Same human, new page load: a brand new connection id.
        removeDmMember(a.player)
        const again = trader({ id: 'a2', name: 'Alice', wallet: wallet('a'), x: 32, y: 0 })
        addDmMember(again.player)

        handleDmSend(again.player, { to: 'b', text: 'hello again' })
        expect(b.messages()).toHaveLength(0)
        expect(again.system()[0]).toMatch(/not accepting messages/i)
    })

    it('can block someone who has already walked off and closed the tab', () => {
        const { a, b } = pair()
        handleDmSend(a.player, { to: 'b', text: 'creepy line' })
        removeDmMember(a.player)

        handleDmBlock(b.player, { id: 'a' })
        expect(b.of('dm:blocked')[0]).toMatchObject({ blocked: true })
        expect(b.system()).toHaveLength(0)
    })

    it('unblocks again', () => {
        const { a, b } = pair()
        handleDmBlock(b.player, { id: 'a' })
        handleDmUnblock(b.player, { id: 'a' })
        expect(b.of('dm:blocked')[1]).toEqual({ id: 'a', name: 'Alice', blocked: false })

        handleDmSend(a.player, { to: 'b', text: 'sorry about that' })
        expect(b.messages()).toHaveLength(1)
    })
})

/* --------------------------------------------------------- rate limit --- */

describe('the rate limit', () => {
    const together = (t: ReturnType<typeof trader>[]) => t.forEach((x) => addDmMember(x.player))

    it('allows one message, then refuses the next within the window', () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        together([a, b])

        handleDmSend(a.player, { to: 'b', text: 'one' })
        handleDmSend(a.player, { to: 'b', text: 'two' })

        expect(b.messages()).toHaveLength(1)
        expect(a.system()[0]).toMatch(/one message every 2s/i)
    })

    it('lets the next one through once the window has passed', () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        together([a, b])

        handleDmSend(a.player, { to: 'b', text: 'one' })
        vi.advanceTimersByTime(2_100)
        handleDmSend(a.player, { to: 'b', text: 'two' })

        expect(b.messages().map((m) => m.text)).toEqual(['one', 'two'])
    })

    it('charges the WALLET, so reloading does not buy a fresh budget', () => {
        const w = wallet('a')
        const before = trader({ id: 'a1', name: 'Alice', wallet: w, x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        together([before, b])
        handleDmSend(before.player, { to: 'b', text: 'spam one' })

        removeDmMember(before.player)
        const after = trader({ id: 'a2', name: 'Alice', wallet: w, x: 0, y: 0 })
        addDmMember(after.player)
        handleDmSend(after.player, { to: 'b', text: 'spam two' })

        expect(b.messages()).toHaveLength(1)
        expect(after.system()[0]).toMatch(/slow down/i)
    })

    it('refuses the same line repeated, even after the rate window', () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        together([a, b])

        handleDmSend(a.player, { to: 'b', text: 'buy my thing' })
        vi.advanceTimersByTime(3_000) // past the rate limit, inside the repeat window
        handleDmSend(a.player, { to: 'b', text: 'buy my thing' })

        expect(b.messages()).toHaveLength(1)
        expect(a.system()[0]).toMatch(/just said that/i)
    })

    it('is spent only on messages that were actually delivered', () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: NEAR_PX + 40, y: 0 })
        together([a, b])

        handleDmSend(a.player, { to: 'b', text: 'too far' })   // refused: distance
        b.walkTo(32, 0)                                        // Bob walks back
        handleDmSend(a.player, { to: 'b', text: 'there you are' })

        expect(b.messages().map((m) => m.text)).toEqual(['there you are'])
    })
})

/* ------------------------------------------------------------ gifting --- */

describe('dmGiftInfo', () => {
    const A = '0x' + 'a'.repeat(40)
    const B = '0x' + 'b'.repeat(40)

    it('hands over the recipient\'s address so the sender\'s wallet can pay', () => {
        const a = trader({ id: 'a', name: 'Alice', address: A, x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', address: B, x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        handleDmGiftInfo(a.player, { id: 'b' })
        expect(a.of('dm:gift-result')[0]).toEqual({ id: 'b', name: 'Bob', address: B })
    })

    it('refuses when the RECIPIENT has no wallet', () => {
        const a = trader({ id: 'a', name: 'Alice', address: A, x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        handleDmGiftInfo(a.player, { id: 'b' })
        expect(a.of('dm:gift-result')[0].address).toBeUndefined()
        expect(a.of('dm:gift-result')[0].error).toMatch(/no wallet connected/i)
    })

    it('refuses when the SENDER has no wallet', () => {
        const a = trader({ id: 'a', name: 'Alice', x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', address: B, x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        handleDmGiftInfo(a.player, { id: 'b' })
        expect(a.of('dm:gift-result')[0]).toEqual({ error: 'Connect your wallet before sending a gift.' })
    })

    it('refuses once they have walked apart', () => {
        const a = trader({ id: 'a', name: 'Alice', address: A, x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', address: B, x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        b.walkTo(400, 0)
        handleDmGiftInfo(a.player, { id: 'b' })
        expect(a.of('dm:gift-result')[0].error).toMatch(/walked away/i)
    })

    it('refuses across a block, in either direction', () => {
        const a = trader({ id: 'a', name: 'Alice', wallet: wallet('a'), address: A, x: 0, y: 0 })
        const b = trader({ id: 'b', name: 'Bob', wallet: wallet('b'), address: B, x: 32, y: 0 })
        addDmMember(a.player)
        addDmMember(b.player)

        handleDmBlock(b.player, { id: 'a' })
        handleDmGiftInfo(a.player, { id: 'b' })
        handleDmGiftInfo(b.player, { id: 'a' })

        expect(a.of('dm:gift-result')[0].error).toMatch(/blocked/i)
        expect(b.of('dm:gift-result')[0].error).toMatch(/blocked/i)
    })
})
