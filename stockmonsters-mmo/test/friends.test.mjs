/*
 * Friends against real Postgres.
 *
 * The vitest spec (src/modules/main/friends.spec.ts) drives the same flows
 * through the session-only store, so what is worth testing HERE is what only
 * the database does: the single-row-per-pair rule, the transaction behind
 * accept, and two requests racing.
 *
 * Run: docker compose up -d && npm run db:migrate && node --test test/friends.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProfileStore } from '../profiles.mjs'

const DB = process.env.DATABASE_URL ??
    'postgres://stockmonsters:stockmonsters@localhost:5433/stockmonsters'
process.env.DATABASE_URL = DB

const store = createProfileStore()

const rand = () => Math.random().toString(16).slice(2, 10)
/** A wallet id is "w:" + 32 HEX characters — anything else is silently refused. */
const wallet = () => 'w:' + (rand() + rand() + rand() + rand()).slice(0, 32)

/** A player only exists once they have a row; claimName is what creates one. */
async function newPlayer(prefix) {
    const id = wallet()
    const name = (prefix + rand()).slice(0, 16)
    const claim = await store.claimName(id, name)
    assert.equal(claim.ok, true, 'fixture: the name should have been claimable')
    return { id, name }
}

const names = (rows) => rows.map((r) => r.name).sort()

test('a request is pending until the other side accepts it', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')

    const asked = await store.requestFriend(a.id, b.id)
    assert.equal(asked.status, 'requested')

    const beforeA = await store.friendState(a.id)
    const beforeB = await store.friendState(b.id)
    assert.deepEqual(beforeA.friends, [])
    assert.deepEqual(beforeB.friends, [])
    assert.deepEqual(names(beforeA.outgoing), [b.name])
    assert.deepEqual(names(beforeB.incoming), [a.name])

    const accepted = await store.acceptFriend(b.id, a.id)
    assert.equal(accepted.ok, true)

    const afterA = await store.friendState(a.id)
    const afterB = await store.friendState(b.id)
    assert.deepEqual(names(afterA.friends), [b.name])
    assert.deepEqual(names(afterB.friends), [a.name])
    // The request is consumed, not left sitting in either list.
    assert.deepEqual(afterA.outgoing, [])
    assert.deepEqual(afterB.incoming, [])
})

test('a pair is ONE row, whichever direction the second accept comes from', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')
    await store.requestFriend(a.id, b.id)
    await store.acceptFriend(b.id, a.id)

    // Accepting again (a double click, a second socket) must not add a row or
    // fail — the canonical (lo, hi) primary key is what makes that true.
    const again = await store.acceptFriend(b.id, a.id)
    assert.equal(again.ok, true)
    const state = await store.friendState(a.id)
    assert.equal(state.friends.length, 1)
})

test('two people asking each other are simply friends', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')

    assert.equal((await store.requestFriend(a.id, b.id)).status, 'requested')
    const second = await store.requestFriend(b.id, a.id)

    assert.equal(second.status, 'friends')
    const state = await store.friendState(b.id)
    assert.equal(state.friends.length, 1)
    assert.deepEqual(state.incoming, [])
    assert.deepEqual(state.outgoing, [])
})

test('asking twice does not create a second request', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')
    await store.requestFriend(a.id, b.id)
    assert.equal((await store.requestFriend(a.id, b.id)).status, 'duplicate')
    const state = await store.friendState(a.id)
    assert.equal(state.outgoing.length, 1)
})

test('asking someone who is already a friend says so', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')
    await store.requestFriend(a.id, b.id)
    await store.acceptFriend(b.id, a.id)
    assert.equal((await store.requestFriend(a.id, b.id)).status, 'already-friends')
})

test('accepting a request that was never sent is refused, not invented', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')
    const result = await store.acceptFriend(b.id, a.id)
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no-request')
    assert.deepEqual((await store.friendState(b.id)).friends, [])
})

test('a decline removes the request and leaves no friendship behind', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')
    await store.requestFriend(a.id, b.id)

    assert.deepEqual(await store.dropRequest(a.id, b.id), { ok: true })

    assert.deepEqual((await store.friendState(b.id)).incoming, [])
    assert.deepEqual((await store.friendState(a.id)).outgoing, [])
    assert.deepEqual((await store.friendState(a.id)).friends, [])
    // Declining twice is not an error, it is just nothing to do.
    assert.deepEqual(await store.dropRequest(a.id, b.id), { ok: false })
})

test('either side can end the friendship, and it ends for both', async () => {
    const a = await newPlayer('a')
    const b = await newPlayer('b')
    await store.requestFriend(a.id, b.id)
    await store.acceptFriend(b.id, a.id)

    // Removed by the side that did NOT send the original request: the row is
    // undirected, so this has to work.
    assert.deepEqual(await store.removeFriend(b.id, a.id), { ok: true })

    assert.deepEqual((await store.friendState(a.id)).friends, [])
    assert.deepEqual((await store.friendState(b.id)).friends, [])
})

test('a name resolves to a wallet, case-insensitively, and an unknown one does not', async () => {
    const a = await newPlayer('mixedCase')

    const found = await store.findPlayerByName(a.name.toUpperCase())
    assert.equal(found.walletId, a.id)

    const missing = await store.findPlayerByName('definitely-not-' + rand())
    assert.equal(missing.walletId, null)
})

test('a friend list holds everyone, from both sides of the pair', async () => {
    const hub = await newPlayer('hub')
    const one = await newPlayer('one')
    const two = await newPlayer('two')

    // hub asks one; two asks hub. The two friendships are stored with hub in
    // different columns, which is exactly the case a one-column query misses.
    await store.requestFriend(hub.id, one.id)
    await store.acceptFriend(one.id, hub.id)
    await store.requestFriend(two.id, hub.id)
    await store.acceptFriend(hub.id, two.id)

    const state = await store.friendState(hub.id)
    assert.deepEqual(names(state.friends), [one.name, two.name].sort())
})

test.after(async () => { await store.close() })
