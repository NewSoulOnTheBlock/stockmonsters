/*
 * Name rules against real Postgres: unique across wallets, one per wallet, and
 * changeable once a day.
 *
 * The cooldown is decided by a conditional UPDATE rather than a read-then-write,
 * so the interesting case is two claims racing — a test that only checks the
 * happy path would pass against a broken implementation.
 *
 * Run: docker compose up -d && npm run db:migrate && node --test test/names.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createProfileStore } from '../profiles.mjs'

const DB = process.env.DATABASE_URL ??
    'postgres://stockmonsters:stockmonsters@localhost:5433/stockmonsters'
process.env.DATABASE_URL = DB

const store = createProfileStore()
const rand = () => Math.random().toString(16).slice(2, 10)
const wallet = () => 'w:' + rand().padEnd(32, '0').slice(0, 32)
const name = (p) => (p + rand()).slice(0, 16)

/** Pretend the last change was `hours` ago. */
async function ageName(walletId, hours) {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: DB })
    await pool.query(
        `UPDATE players SET name_changed_at = now() - INTERVAL '${hours} hours' WHERE wallet_id = $1`,
        [walletId],
    )
    await pool.end()
}

test('a first name is always accepted', async () => {
    const w = wallet()
    const n = name('first')
    const r = await store.claimName(w, n)
    assert.equal(r.ok, true)
    assert.equal(r.name, n)
})

test('two wallets cannot hold the same name, in any casing', async () => {
    const a = wallet(); const b = wallet()
    const n = name('taken')
    assert.equal((await store.claimName(a, n)).ok, true)

    const clash = await store.claimName(b, n)
    assert.equal(clash.ok, false)
    assert.match(clash.reason, /already taken/i)

    const cased = await store.claimName(b, n.toUpperCase())
    assert.equal(cased.ok, false, 'casing must not open a second door to the same name')
})

test('one wallet holds one name: a second claim replaces, never adds', async () => {
    const w = wallet()
    assert.equal((await store.claimName(w, name('one'))).ok, true)
    await ageName(w, 25)
    const second = name('two')
    assert.equal((await store.claimName(w, second)).ok, true)

    const profile = await store.loadProfile(w)
    assert.equal(profile.name, second)
})

test('the name can be changed once a day, and not twice', async () => {
    const w = wallet()
    assert.equal((await store.claimName(w, name('day'))).ok, true)
    await ageName(w, 25)

    const change = await store.claimName(w, name('changed'))
    assert.equal(change.ok, true, 'a day later the change is allowed')

    const tooSoon = await store.claimName(w, name('again'))
    assert.equal(tooSoon.ok, false)
    assert.match(tooSoon.reason, /once a day/i)
    assert.ok(tooSoon.retryAt, 'the refusal says when they may try again')
})

test('re-claiming the SAME name is not a change and never blocks', async () => {
    const w = wallet()
    const n = name('same')
    assert.equal((await store.claimName(w, n)).ok, true)
    // Every reconnect re-sends the stored name; that must not burn the daily
    // change or lock the player out of their own name.
    for (let i = 0; i < 3; i++) {
        const again = await store.claimName(w, n)
        assert.equal(again.ok, true, 're-sending the same name must stay fine')
        assert.equal(again.name, n)
    }
})

test('two racing claims for one wallet cannot both change the name', async () => {
    const w = wallet()
    assert.equal((await store.claimName(w, name('race'))).ok, true)
    await ageName(w, 25)

    const [x, y] = await Promise.all([
        store.claimName(w, name('racerA')),
        store.claimName(w, name('racerB')),
    ])
    const wins = [x, y].filter((r) => r.ok).length
    assert.equal(wins, 1, 'exactly one of two simultaneous changes may win')
})

test('a 16-character name fits and a 17-character one does not', async () => {
    const w = wallet()
    const sixteen = ('n' + rand() + rand()).slice(0, 16)
    assert.equal(sixteen.length, 16)
    assert.equal((await store.claimName(w, sixteen)).ok, true)

    await ageName(w, 25)
    const seventeen = sixteen + 'x'
    const tooLong = await store.claimName(w, seventeen)
    assert.equal(tooLong.ok, false, 'the database refuses what the UI should have caught')
})

test('re-sending the same name does not restart the daily clock', async () => {
    const w = wallet()
    const n = name('clock')
    assert.equal((await store.claimName(w, n)).ok, true)
    await ageName(w, 25)

    // A reconnect re-sends the stored name. If that reset the clock, a player
    // who logs in daily could never change their name at all.
    assert.equal((await store.claimName(w, n)).ok, true)

    const change = await store.claimName(w, name('finally'))
    assert.equal(change.ok, true, 'the day-old change must still be available')
})

test.after(async () => { await store.close() })
