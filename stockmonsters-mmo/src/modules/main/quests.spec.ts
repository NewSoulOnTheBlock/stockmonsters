import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DAILY_QUESTS, questProgress, handleQuestList, handleQuestClaim } from './quests'
import { DAILY_CAP, REWARDS } from './earnings'

/*
 * The quest board, and above all its GATE.
 *
 * The rewards are real tokens, so what these tests defend is the user's own
 * two-part design: no NFT, no quests (an account is free, a Stockmonster is
 * not) — and one NFT unlocks quests for ONE wallet per day, so a token passed
 * around cannot farm with a convoy of fresh accounts.
 */

const WALLET = 'w:' + 'a'.repeat(32)
const ADDRESS = '0x' + '1'.repeat(40)

interface Fake {
    vars: Map<string, unknown>
    sent: Array<{ type: string; value: any }>
    getVariable: (k: string) => unknown
    setVariable: (k: string, v: unknown) => void
    emit: (t: string, v: unknown) => void
}
function player(walletId: string | null = WALLET, address: string | null = ADDRESS): Fake {
    const vars = new Map<string, unknown>()
    if (walletId) vars.set('WALLET_ID', walletId)
    if (address) vars.set('WALLET_ADDRESS', address)
    const sent: Array<{ type: string; value: any }> = []
    return {
        vars, sent,
        getVariable: (k) => vars.get(k),
        setVariable: (k, v) => { vars.set(k, v) },
        emit: (type, value) => sent.push({ type, value }),
    }
}
const as = (p: Fake) => p as unknown as Parameters<typeof questProgress>[0]
const lastState = (p: Fake) => [...p.sent].reverse().find((m) => m.type === 'quests:state')?.value

/**
 * The world around the module: a box list, a chain, a lock table. Each test
 * shapes them; the lock table is REAL logic (first wallet wins), because that
 * is the behaviour under test.
 */
let locks: Map<string, string>
function world(opts: {
    boxes?: Array<{ tokenId: string | null; status: string }>
    owner?: string
    opened?: boolean
    dbUp?: boolean
} = {}) {
    locks = new Map()
    ;(globalThis as any).__smBoxes = {
        listBoxes: async () => opts.boxes ?? [{ tokenId: '7', status: 'opened' }],
    }
    ;(globalThis as any).__smTokens = {
        decimalsSync: () => 18,
        currentEpoch: () => 42,
        nftOwnership: async () => ({ owner: opts.owner ?? ADDRESS, opened: opts.opened ?? true }),
    }
    ;(globalThis as any).__smProfiles = {
        enabled: opts.dbUp !== false,
        lockQuestToken: async (epoch: number, tokenId: string, walletId: string) => {
            if (opts.dbUp === false) return 'down'
            const key = `${epoch}:${tokenId}`
            if (!locks.has(key)) { locks.set(key, walletId); return 'locked' }
            return locks.get(key) === walletId ? 'locked' : 'taken'
        },
        questTokenOf: async (epoch: number, walletId: string) => {
            for (const [k, w] of locks) if (w === walletId && k.startsWith(`${epoch}:`)) return k.split(':')[1]
            return null
        },
    }
}

let saved: Record<string, unknown> = {}
beforeEach(() => {
    saved = {
        b: (globalThis as any).__smBoxes,
        t: (globalThis as any).__smTokens,
        p: (globalThis as any).__smProfiles,
    }
})
afterEach(() => {
    ;(globalThis as any).__smBoxes = saved.b
    ;(globalThis as any).__smTokens = saved.t
    ;(globalThis as any).__smProfiles = saved.p
})

describe('the gate', () => {
    it('opens for a wallet that owns an opened Stockmonster', async () => {
        world()
        const p = player()
        await handleQuestList(as(p))
        expect(lastState(p)).toMatchObject({ unlocked: true, tokenId: '7' })
    })

    it('stays shut with no wallet', async () => {
        world()
        const p = player(null, null)
        await handleQuestList(as(p))
        expect(lastState(p).unlocked).toBe(false)
        expect(lastState(p).reason).toMatch(/wallet/i)
    })

    it('stays shut with no NFT at all', async () => {
        world({ boxes: [] })
        const p = player()
        await handleQuestList(as(p))
        expect(lastState(p).unlocked).toBe(false)
        expect(lastState(p).reason).toMatch(/own an opened Stockmonster/i)
    })

    it('a SEALED box is not a creature and does not qualify', async () => {
        world({ boxes: [{ tokenId: '7', status: 'minted' }] })
        const p = player()
        await handleQuestList(as(p))
        expect(lastState(p).unlocked).toBe(false)
    })

    it('a token the wallet no longer owns on chain does not qualify', async () => {
        // The box table remembers the mint forever; the chain is the truth.
        // Selling your Stockmonster sells your quest access with it.
        world({ owner: '0x' + '9'.repeat(40) })
        const p = player()
        await handleQuestList(as(p))
        expect(lastState(p).unlocked).toBe(false)
    })

    it('THE ATTACK: one NFT cannot unlock two wallets in one epoch', async () => {
        world()
        const first = player(WALLET, ADDRESS)
        await handleQuestList(as(first))
        expect(lastState(first).unlocked).toBe(true)

        // The same token arrives from a second wallet — transferred, and the
        // chain now says the new wallet owns it. Ownership is real; the slot
        // is simply spent.
        const other = 'w:' + 'b'.repeat(32)
        const otherAddr = '0x' + '2'.repeat(40)
        ;(globalThis as any).__smTokens.nftOwnership = async () => ({ owner: otherAddr, opened: true })
        const second = player(other, otherAddr)
        await handleQuestList(as(second))
        expect(lastState(second).unlocked).toBe(false)
        expect(lastState(second).reason).toMatch(/already opened quests for another trader/i)
    })

    it('a database that cannot answer closes the gate, never opens it', async () => {
        world({ dbUp: false })
        const p = player()
        await handleQuestList(as(p))
        expect(lastState(p).unlocked).toBe(false)
    })
})

describe('progress and claiming', () => {
    async function gatedPlayer() {
        world()
        const p = player()
        await handleQuestList(as(p))
        expect(lastState(p).unlocked).toBe(true)
        return p
    }

    it('counts nothing for a player who never passed the gate', async () => {
        world()
        const p = player()
        // No handleQuestList — the gate was never opened.
        questProgress(as(p), 'battleWin', 5)
        await handleQuestList(as(p)) // opens NOW, with a clean board
        const q = lastState(p).quests.find((x: any) => x.id === 'warmup')
        expect(q.have).toBe(0)
    })

    it('tracks progress toward a goal and caps the bar at it', async () => {
        const p = await gatedPlayer()
        questProgress(as(p), 'battleWin', 2)
        await handleQuestList(as(p))
        expect(lastState(p).quests.find((x: any) => x.id === 'warmup')).toMatchObject({ have: 2, claimable: false })
        questProgress(as(p), 'battleWin', 10)
        await handleQuestList(as(p))
        expect(lastState(p).quests.find((x: any) => x.id === 'warmup')).toMatchObject({ have: 3, claimable: true })
    })

    it('announces a quest the moment it completes, exactly once', async () => {
        const p = await gatedPlayer()
        questProgress(as(p), 'battleWin', 3)
        questProgress(as(p), 'battleWin', 1)
        const done = p.sent.filter((m) => m.type === 'quests:done' && m.value.id === 'warmup')
        expect(done).toHaveLength(1)
    })

    it('pays a finished quest into the earnings ledger', async () => {
        const p = await gatedPlayer()
        questProgress(as(p), 'newMap', 1)
        await handleQuestClaim(as(p), { id: 'walker' })
        const claimed = p.sent.find((m) => m.type === 'quests:claimed')
        expect(claimed?.value).toMatchObject({ id: 'walker', paid: 50 })
        const ledger = p.vars.get('EARNED') as Record<string, string>
        expect(ledger['42']).toBe((50n * 10n ** 18n).toString())
    })

    it('cannot claim twice', async () => {
        const p = await gatedPlayer()
        questProgress(as(p), 'newMap', 1)
        await handleQuestClaim(as(p), { id: 'walker' })
        await handleQuestClaim(as(p), { id: 'walker' })
        expect(p.sent.filter((m) => m.type === 'quests:claimed')).toHaveLength(1)
    })

    it('cannot claim an unfinished quest', async () => {
        const p = await gatedPlayer()
        questProgress(as(p), 'battleWin', 2)
        await handleQuestClaim(as(p), { id: 'warmup' })
        expect(p.sent.filter((m) => m.type === 'quests:claimed')).toHaveLength(0)
    })

    it('quest income lives under the same daily cap as everything else', async () => {
        const p = await gatedPlayer()
        // Grind the ledger to the cap the ordinary way first.
        for (let i = 0; i < 200; i++) questProgress(as(p), 'battleWin')
        const { credit } = await import('./earnings')
        while (credit(as(p) as any, 'battleWin') > 0) { /* fill to the cap */ }
        questProgress(as(p), 'newMap', 1)
        await handleQuestClaim(as(p), { id: 'walker' })
        const claimed = p.sent.find((m) => m.type === 'quests:claimed')
        // Claimed, but paid zero: the cap is the cap, quests do not raise it.
        expect(claimed?.value.paid).toBe(0)
        const ledger = p.vars.get('EARNED') as Record<string, string>
        expect(ledger['42']).toBe((BigInt(DAILY_CAP) * 10n ** 18n).toString())
    })

    it('the whole board fits under the daily cap with room to play', () => {
        const total = DAILY_QUESTS.reduce((a, q) => a + q.reward, 0)
        expect(total).toBeLessThan(DAILY_CAP / 2)
        expect(REWARDS.quest).toBe(1) // rewards are priced on the board, paid via times
    })
})
