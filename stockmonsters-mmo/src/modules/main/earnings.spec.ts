import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { credit, flushPendingRewards, earnedThisEpoch, currentEpoch, REWARDS, dailyCap } from './earnings'

/*
 * What a player is owed for playing.
 *
 * The case that actually bit: rewards are earned BEFORE the client has said
 * which wallet the player is. Crediting straight to the ledger in that window
 * dropped the reward silently — and because the map was marked visited in the
 * same breath, it could never be earned again. Found by driving a real
 * session; kept honest here.
 */

const WALLET = 'w:' + 'a'.repeat(32)

interface Fake {
    getVariable: (k: string) => unknown
    setVariable: (k: string, v: unknown) => void
    emit: (t: string, v: unknown) => void
    vars: Map<string, unknown>
    sent: Array<{ type: string; value: any }>
}

function player(walletId: string | null = WALLET): Fake {
    const vars = new Map<string, unknown>()
    if (walletId) vars.set('WALLET_ID', walletId)
    const sent: Array<{ type: string; value: any }> = []
    return {
        vars,
        sent,
        getVariable: (k) => vars.get(k),
        setVariable: (k, v) => { vars.set(k, v) },
        emit: (type, value) => sent.push({ type, value: value as any }),
    }
}

const as = (p: Fake) => p as unknown as Parameters<typeof credit>[0]
const ledgerOf = (p: Fake) => (p.vars.get('EARNED') ?? {}) as Record<string, string>
const unit = 10n ** 18n

let originalBridge: unknown
beforeEach(() => { originalBridge = (globalThis as any).__smTokens })
afterEach(() => { (globalThis as any).__smTokens = originalBridge })

describe('crediting', () => {
    it('adds to this epoch, in the token\'s base units', () => {
        const p = player()
        const paid = credit(as(p), 'battleWin')
        expect(paid).toBe(REWARDS.battleWin)
        expect(ledgerOf(p)[String(currentEpoch())]).toBe((BigInt(REWARDS.battleWin) * unit).toString())
    })

    it('accumulates rather than overwriting', () => {
        const p = player()
        credit(as(p), 'battleWin')
        credit(as(p), 'firstCatch')
        const expected = BigInt(REWARDS.battleWin + REWARDS.firstCatch) * unit
        expect(ledgerOf(p)[String(currentEpoch())]).toBe(expected.toString())
    })

    it('uses the token\'s real decimals, never an assumed 18', () => {
        // A 6-decimal token against an 18-decimal assumption is a 10^12 error
        // in the player's favour — the kind of bug that empties a pool.
        ;(globalThis as any).__smTokens = { decimalsSync: () => 6, currentEpoch: () => 4 }
        const p = player()
        credit(as(p), 'boxOpen')
        expect(ledgerOf(p)['4']).toBe((BigInt(REWARDS.boxOpen) * 10n ** 6n).toString())
    })

    it('buckets by epoch, so yesterday is not topped up', () => {
        let epoch = 3
        ;(globalThis as any).__smTokens = { decimalsSync: () => 18, currentEpoch: () => epoch }
        const p = player()
        credit(as(p), 'battleWin')
        epoch = 4
        credit(as(p), 'battleWin')
        expect(ledgerOf(p)['3']).toBe((BigInt(REWARDS.battleWin) * unit).toString())
        expect(ledgerOf(p)['4']).toBe((BigInt(REWARDS.battleWin) * unit).toString())
    })

    it('forgets epochs older than a week', () => {
        let epoch = 1
        ;(globalThis as any).__smTokens = { decimalsSync: () => 18, currentEpoch: () => epoch }
        const p = player()
        credit(as(p), 'battleWin')
        epoch = 20
        credit(as(p), 'battleWin')
        // The on-chain budget for epoch 1 is long gone; carrying it in every
        // save forever would be a slow leak.
        expect(ledgerOf(p)['1']).toBeUndefined()
        expect(ledgerOf(p)['20']).toBeDefined()
    })

    it('tells the client what was earned', () => {
        const p = player()
        credit(as(p), 'firstCatch')
        expect(p.sent[0]).toMatchObject({ type: 'rewards:earned', value: { kind: 'firstCatch' } })
    })
})

describe('earning before the wallet is known', () => {
    it('parks the reward instead of dropping it', () => {
        const p = player(null)
        expect(credit(as(p), 'newMap')).toBe(0)
        expect(ledgerOf(p)[String(currentEpoch())]).toBeUndefined()
        // ...but it is not gone.
        expect(p.vars.get('_PENDING_REWARDS')).toEqual([['newMap', 1]])
    })

    it('pays it out the moment the wallet arrives', () => {
        const p = player(null)
        credit(as(p), 'newMap')
        credit(as(p), 'battleWin')

        p.vars.set('WALLET_ID', WALLET)
        const moved = flushPendingRewards(as(p))

        expect(moved).toBe(REWARDS.newMap + REWARDS.battleWin)
        expect(ledgerOf(p)[String(currentEpoch())])
            .toBe((BigInt(REWARDS.newMap + REWARDS.battleWin) * unit).toString())
        expect(p.vars.get('_PENDING_REWARDS')).toEqual([])
    })

    it('flushing twice does not pay twice', () => {
        // auth:wallet is sent twice on purpose by the client.
        const p = player(null)
        credit(as(p), 'newMap')
        p.vars.set('WALLET_ID', WALLET)
        flushPendingRewards(as(p))
        expect(flushPendingRewards(as(p))).toBe(0)
        expect(ledgerOf(p)[String(currentEpoch())]).toBe((BigInt(REWARDS.newMap) * unit).toString())
    })

    it('bounds what an unidentified player can park', () => {
        const p = player(null)
        for (let i = 0; i < 200; i++) credit(as(p), 'newMap')
        expect((p.vars.get('_PENDING_REWARDS') as unknown[]).length).toBeLessThanOrEqual(64)
    })
})

describe('the daily cap', () => {
    it('stops a bot grinding battles for an income', () => {
        const p = player()
        // Nothing rate-limits wild battles, so this is the only thing standing
        // between a script and the pool.
        // Grind until it stops paying rather than a fixed number of wins: the
        // cap is denominated in dollars now, so how many battles reach it
        // depends on the price.
        let paid = 0
        for (let i = 0; i < 100_000; i++) {
            const got = credit(as(p), 'battleWin')
            if (got === 0) break
            paid += got
        }
        expect(paid).toBe(dailyCap())
        expect(ledgerOf(p)[String(currentEpoch())]).toBe((BigInt(dailyCap()) * unit).toString())
    })

    it('pays the part that fits rather than refusing the whole reward', () => {
        const p = player()
        // Earn up to just under the cap, then claim something bigger than the
        // gap: the player should get the gap, not nothing.
        const wins = Math.floor((dailyCap() - 10) / REWARDS.battleWin)
        for (let i = 0; i < wins; i++) credit(as(p), 'battleWin')
        const before = BigInt(ledgerOf(p)[String(currentEpoch())])
        const paid = credit(as(p), 'firstCatch')
        expect(paid).toBeGreaterThan(0)
        expect(paid).toBeLessThan(REWARDS.firstCatch)
        expect(BigInt(ledgerOf(p)[String(currentEpoch())])).toBe(BigInt(dailyCap()) * unit)
        expect(before).toBeLessThan(BigInt(dailyCap()) * unit)
    })

    it('tells the player when they have hit it', () => {
        const p = player()
        for (let i = 0; i < 100_000; i++) if (credit(as(p), 'battleWin') === 0) break
        expect(p.sent.some((m) => m.type === 'rewards:capped')).toBe(true)
    })

    it('resets with the epoch', () => {
        let epoch = 1
        ;(globalThis as any).__smTokens = { decimalsSync: () => 18, currentEpoch: () => epoch }
        const p = player()
        for (let i = 0; i < 500; i++) credit(as(p), 'battleWin')
        epoch = 2
        expect(credit(as(p), 'battleWin')).toBe(REWARDS.battleWin)
    })
})

describe('reading it back', () => {
    it('reports whole tokens for a message a player can read', () => {
        const p = player()
        credit(as(p), 'firstCatch')
        expect(earnedThisEpoch(as(p))).toBe(String(REWARDS.firstCatch))
    })

    it('survives a ledger the engine handed back as a reactive wrapper', () => {
        const p = player()
        // What getVariable really returns after a round trip: a plain object
        // is the best case, JSON is the guard.
        p.vars.set('EARNED', JSON.parse(JSON.stringify({ [String(currentEpoch())]: (5n * unit).toString() })))
        credit(as(p), 'battleWin')
        expect(ledgerOf(p)[String(currentEpoch())]).toBe(((5n + BigInt(REWARDS.battleWin)) * unit).toString())
    })
})
