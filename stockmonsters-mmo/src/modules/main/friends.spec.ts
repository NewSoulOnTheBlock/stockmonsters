import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    friendsConnected,
    friendsDisconnected,
    friendsRefresh,
    handleFriendsList,
    handleFriendAdd,
    handleFriendAccept,
    handleFriendDecline,
    handleFriendCancel,
    handleFriendRemove,
    areFriends,
    resetFriends,
    type FriendState,
} from './friends'

/*
 * Friends, against the session-only store (no Postgres here — test/friends.test.mjs
 * covers the SQL). The cases worth writing are the ones a naive implementation
 * gets wrong:
 *
 *   · a request that quietly makes two people friends without the other side
 *     ever pressing anything — the entire feature is that it cannot;
 *   · remote messaging surviving an un-friend, because the permission was
 *     captured when the window opened rather than read per message (dm.spec);
 *   · "went offline" firing on a map transfer, which reconnects the socket.
 */

const wallet = (c: string) => 'w:' + c.repeat(32)
const A = wallet('a')
const B = wallet('b')
const C = wallet('c')

interface Fake {
    id: string
    emit: (type: string, value: unknown) => void
    getVariable: (k: string) => unknown
    setVariable: (k: string, v: unknown) => void
    sent: Array<{ type: string; value: any }>
    state: () => FriendState | null
    /** The last presence patch received about `key`, if any. */
    presence: (key: string) => any | null
    systems: () => string[]
}

function player(walletId: string | null, name: string, id = name.toLowerCase()): Fake {
    const vars = new Map<string, unknown>()
    if (walletId) vars.set('WALLET_ID', walletId)
    vars.set('NAME', name)
    vars.set('WALLET_ADDRESS', '0x' + '1'.repeat(40))
    const sent: Array<{ type: string; value: any }> = []
    return {
        id,
        sent,
        emit: (type, value) => sent.push({ type, value: value as any }),
        getVariable: (k) => vars.get(k),
        setVariable: (k, v) => vars.set(k, v),
        state: () => {
            for (let i = sent.length - 1; i >= 0; i--) if (sent[i].type === 'friends:state') return sent[i].value
            return null
        },
        presence: (key: string) => {
            for (let i = sent.length - 1; i >= 0; i--) {
                if (sent[i].type === 'friends:presence' && sent[i].value?.key === key) return sent[i].value
            }
            return null
        },
        systems: () => sent.filter((m) => m.type === 'friends:system').map((m) => m.value.text as string),
    }
}

const asPlayer = (p: Fake) => p as unknown as Parameters<typeof friendsConnected>[0]
const add = (from: Fake, name: string) => handleFriendAdd(asPlayer(from), { name })
const accept = (me: Fake, key: string) => handleFriendAccept(asPlayer(me), { key })

beforeEach(() => { resetFriends(); vi.useFakeTimers() })
afterEach(() => { resetFriends(); vi.useRealTimers() })

describe('friend requests', () => {
    it('does NOT make two players friends until the other side accepts', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))

        await add(alice, 'Bob')

        expect(areFriends(A, B)).toBe(false)
        expect(alice.state()?.outgoing.map((r) => r.name)).toEqual(['Bob'])
        expect(bob.state()?.incoming.map((r) => r.name)).toEqual(['Alice'])
        expect(bob.state()?.friends).toEqual([])
        // And Bob is actually told, rather than having to notice a panel change.
        expect(bob.systems().join(' ')).toMatch(/Alice wants to be your friend/i)
    })

    it('makes them friends once the request is accepted, both ways', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')

        await accept(bob, A)

        expect(areFriends(A, B)).toBe(true)
        expect(areFriends(B, A)).toBe(true)
        expect(alice.state()?.friends.map((f) => f.name)).toEqual(['Bob'])
        expect(bob.state()?.friends.map((f) => f.name)).toEqual(['Alice'])
        expect(alice.state()?.incoming).toEqual([])
        expect(alice.state()?.outgoing).toEqual([])
    })

    it('treats a request in the opposite direction as the acceptance it is', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))

        await add(alice, 'Bob')
        vi.advanceTimersByTime(3000) // past the request rate limit
        await add(bob, 'Alice')

        expect(areFriends(A, B)).toBe(true)
        expect(bob.state()?.outgoing).toEqual([])
    })

    it('refuses a second request while the first is still waiting', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))

        await add(alice, 'Bob')
        vi.advanceTimersByTime(3000)
        await add(alice, 'Bob')

        expect(alice.state()?.outgoing).toHaveLength(1)
        expect(alice.systems().join(' ')).toMatch(/already has your request/i)
    })

    it('rate-limits requests', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        const carol = player(C, 'Carol')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await friendsConnected(asPlayer(carol))

        await add(alice, 'Bob')
        await add(alice, 'Carol') // immediately after: refused

        expect(alice.state()?.outgoing.map((r) => r.name)).toEqual(['Bob'])
        expect(alice.systems().join(' ')).toMatch(/slow down/i)
    })

    it('will not let a player add themselves', async () => {
        const alice = player(A, 'Alice')
        await friendsConnected(asPlayer(alice))
        await add(alice, 'Alice')
        expect(areFriends(A, A)).toBe(false)
        expect(alice.systems().join(' ')).toMatch(/cannot add yourself/i)
    })

    it('needs a wallet: a session identity cannot hold a friendship', async () => {
        const ghost = player(null, 'Ghost')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(bob))
        await friendsConnected(asPlayer(ghost))

        expect(ghost.state()?.identified).toBe(false)
        await add(ghost, 'Bob')
        expect(ghost.systems().join(' ')).toMatch(/connect your wallet/i)
        expect(bob.state()?.incoming).toEqual([])
    })

    it('says the name is unknown without revealing whether it is taken', async () => {
        const alice = player(A, 'Alice')
        await friendsConnected(asPlayer(alice))
        await add(alice, 'Nobody')
        expect(alice.systems().join(' ')).toMatch(/no player called "Nobody"/i)
    })
})

describe('declining and removing', () => {
    it('a decline leaves nobody as a friend and drops the request from both lists', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')

        await handleFriendDecline(asPlayer(bob), { key: A })

        expect(areFriends(A, B)).toBe(false)
        expect(bob.state()?.incoming).toEqual([])
        expect(alice.state()?.outgoing).toEqual([])
    })

    it('a decline is not a two-second speed bump — the same ask is refused', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')
        await handleFriendDecline(asPlayer(bob), { key: A })

        vi.advanceTimersByTime(3000)
        await add(alice, 'Bob')

        expect(bob.state()?.incoming).toEqual([])
        expect(alice.systems().join(' ')).toMatch(/declined a request from you/i)
    })

    it('the sender can withdraw a request they regret', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')

        await handleFriendCancel(asPlayer(alice), { key: B })

        expect(alice.state()?.outgoing).toEqual([])
        expect(bob.state()?.incoming).toEqual([])
    })

    it('removing a friend revokes it for BOTH sides immediately', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')
        await accept(bob, A)

        await handleFriendRemove(asPlayer(alice), { key: B })

        expect(areFriends(A, B)).toBe(false)
        expect(areFriends(B, A)).toBe(false)
        expect(bob.state()?.friends).toEqual([])
        // Bob is told, rather than watching a row vanish for no reason.
        expect(bob.systems().join(' ')).toMatch(/no longer friends/i)
    })

    it('accepting a request that is no longer there says so instead of inventing one', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))

        await accept(bob, A)

        expect(areFriends(A, B)).toBe(false)
        expect(bob.systems().join(' ')).toMatch(/no longer there/i)
    })
})

describe('presence', () => {
    it('shows a friend as online, with the connection id a DM needs', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob', 'conn-bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')
        await accept(bob, A)

        const entry = alice.state()?.friends[0]
        expect(entry?.online).toBe(true)
        expect(entry?.id).toBe('conn-bob')
    })

    it('tells the friend when someone logs in', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')
        await accept(bob, A)

        // Bob leaves and comes back on a fresh socket, as a reload does.
        friendsDisconnected(asPlayer(bob))
        vi.advanceTimersByTime(10_000)
        const bob2 = player(B, 'Bob', 'conn-bob-2')
        await friendsConnected(asPlayer(bob2))

        expect(alice.systems().join(' ')).toMatch(/Bob is online/i)
        // Presence arrives as a PATCH, not a whole new list: one friend
        // logging in must not cost a database read per friend they have.
        expect(alice.presence(B)).toMatchObject({ online: true, id: 'conn-bob-2' })
    })

    it('does NOT announce a departure for a map transfer', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')
        await accept(bob, A)
        alice.sent.length = 0

        // What a map change looks like: disconnect, then a NEW player object
        // for the new room, well inside the grace period.
        friendsDisconnected(asPlayer(bob))
        const bobInNewRoom = player(B, 'Bob', 'conn-bob-2')
        await friendsConnected(asPlayer(bobInNewRoom))
        vi.advanceTimersByTime(30_000)

        expect(alice.systems().join(' ')).not.toMatch(/offline/i)
        expect(alice.systems().join(' ')).not.toMatch(/is online/i)
        // Nothing at all was said about Bob: his row never flickered.
        expect(alice.presence(B)).toBeNull()
        await handleFriendsList(asPlayer(alice))
        expect(alice.state()?.friends[0]).toMatchObject({ online: true, id: 'conn-bob-2' })
    })

    it('does announce a real departure, once the grace period is over', async () => {
        const alice = player(A, 'Alice')
        const bob = player(B, 'Bob')
        await friendsConnected(asPlayer(alice))
        await friendsConnected(asPlayer(bob))
        await add(alice, 'Bob')
        await accept(bob, A)
        alice.sent.length = 0

        friendsDisconnected(asPlayer(bob))
        vi.advanceTimersByTime(30_000)

        expect(alice.systems().join(' ')).toMatch(/Bob went offline/i)
        await handleFriendsList(asPlayer(alice))
        expect(alice.state()?.friends[0]).toMatchObject({ online: false, id: null })
    })

    it('keeps the freshest player object, so a message after a door still lands', async () => {
        const alice = player(A, 'Alice')
        await friendsConnected(asPlayer(alice))
        const aliceInNewRoom = player(A, 'Alice', 'conn-alice-2')
        friendsRefresh(asPlayer(aliceInNewRoom))

        await handleFriendsList(asPlayer(aliceInNewRoom))
        expect(aliceInNewRoom.state()).not.toBeNull()
    })
})
