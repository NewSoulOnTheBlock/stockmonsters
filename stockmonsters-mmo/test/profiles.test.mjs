/*
 * Integration test for the profile store.
 *
 *   docker compose up -d && npm run db:migrate && npm run test:profiles
 *
 * It talks to a REAL Postgres — the interesting failures here (a unique index
 * losing a race, a pool surviving an outage, jsonb round-tripping a
 * CreatureInstance) do not exist against a mock. Rows are created under random
 * wallet ids and deleted afterwards, so it is safe to point at the dev
 * database.
 *
 * The no-database and database-down paths run unconditionally: they are the
 * ones that keep the game playable, so they must never be the tests that get
 * skipped.
 */
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createProfileStore, STATE_VERSION } from '../profiles.mjs'
import { migrate, readMigrations } from '../db/migrate.mjs'

const DATABASE_URL = process.env.DATABASE_URL
const wallet = () => 'w:' + randomBytes(16).toString('hex')
// Names are globally unique, so tests must not collide with each other or
// with a human playing on the same database.
const uniqueName = (prefix) => (prefix + randomBytes(3).toString('hex')).slice(0, 14)

/** Console that records instead of printing, so we can assert on warnings. */
const recorder = () => {
  const lines = []
  return { lines, log: (m) => lines.push(String(m)), warn: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) }
}

const created = new Set()
const track = (id) => (created.add(id), id)

let live = false
before(async () => {
  if (!DATABASE_URL) return
  try {
    const c = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
    await c.connect()
    await c.end()
    await migrate(DATABASE_URL, { log: () => {} })
    live = true
  } catch (err) {
    console.warn(`[test] Postgres unavailable (${err.message}) — database-backed cases will fail loudly, not silently`)
  }
})

after(async () => {
  if (!live) return
  const c = new pg.Client({ connectionString: DATABASE_URL })
  await c.connect()
  await c.query('DELETE FROM players WHERE wallet_id = ANY($1)', [[...created]])
  await c.end()
})

/** Guard so a missing database is an explicit, visible failure. */
function requireDb() {
  assert.ok(
    live,
    'DATABASE_URL must point at a running Postgres for this suite ' +
      '(docker compose up -d && npm run db:migrate)',
  )
}

describe('migrations', () => {
  test('every migration file has a unique, ordered name', () => {
    const names = readMigrations().map((m) => m.name)
    assert.deepEqual(names, [...names].sort(), 'migrations must sort into apply order')
    assert.equal(new Set(names).size, names.length)
  })

  test('running migrate twice applies nothing the second time', async () => {
    requireDb()
    await migrate(DATABASE_URL, { log: () => {} })
    const applied = await migrate(DATABASE_URL, { log: () => {} })
    assert.deepEqual(applied, [])
  })
})

describe('profiles: round trip', () => {
  test('a new wallet gets an empty profile and a players row', async () => {
    requireDb()
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    const id = track(wallet())
    const profile = await store.loadProfile(id, { address: '0x' + '11'.repeat(20) })
    assert.ok(profile, 'a configured store must return a profile')
    assert.equal(profile.walletId, id)
    assert.equal(profile.name, null)
    assert.equal(profile.character, null)
    assert.equal(profile.party, null)
    assert.equal(profile.address, '0x' + '11'.repeat(20))
    await store.close()
  })

  test('party, box, bag and character survive a full store restart', async () => {
    requireDb()
    const id = track(wallet())
    // A realistic CreatureInstance: nested objects and a null are exactly what
    // a lazy serialiser mangles.
    const party = [
      { dbSymbol: 'applion', level: 12, hp: 31, maxHp: 34, ivs: { hp: 7, atk: 3 }, status: null, moves: ['tackle', 'growth'] },
    ]
    const box = [{ dbSymbol: 'nvidrake', level: 5, hp: 18, maxHp: 18, ivs: { hp: 1 }, status: 'poison' }]
    const bag = { balls: 3, potions: 9 }
    const character = ['ch-female-01']

    const writer = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 5 })
    await writer.loadProfile(id, { address: null })
    writer.saveProfile(id, { party, box, bag, character })
    await writer.flush(id)
    await writer.close()

    // A different store object with a different pool: nothing in memory can
    // be helping now.
    const reader = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 5 })
    const back = await reader.loadProfile(id)
    assert.deepEqual(back.party, party)
    assert.deepEqual(back.box, box)
    assert.deepEqual(back.bag, bag)
    assert.deepEqual(back.character, character)
    assert.equal(back.version, STATE_VERSION)
    await reader.close()
  })

  test('a patch merges instead of replacing the stored blob', async () => {
    requireDb()
    const id = track(wallet())
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 5 })
    await store.loadProfile(id)
    store.saveProfile(id, { party: [{ dbSymbol: 'a', level: 1 }], bag: { balls: 5, potions: 5 } })
    await store.flush(id)
    // Later, only the box changes — the party must not disappear.
    store.saveProfile(id, { box: [{ dbSymbol: 'b', level: 2 }] })
    await store.flush(id)
    await store.close()

    const reader = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 5 })
    const back = await reader.loadProfile(id)
    assert.equal(back.party.length, 1)
    assert.equal(back.box.length, 1)
    assert.deepEqual(back.bag, { balls: 5, potions: 5 })
    await reader.close()
  })

  test('writes are batched, not one per change', async () => {
    requireDb()
    const id = track(wallet())
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 40 })
    await store.loadProfile(id)
    const before = store.stats().writes
    // Twenty mutations, as a battle would produce.
    for (let i = 0; i < 20; i++) store.saveProfile(id, { bag: { balls: i, potions: 0 } })
    assert.equal(store.stats().writes, before, 'nothing should have been written yet')
    await new Promise((r) => setTimeout(r, 120))
    assert.equal(store.stats().writes, before + 1, 'the batch should be exactly one write')
    // ...and the last value is the one that landed.
    const back = await store.loadProfile(id)
    assert.deepEqual(back.bag, { balls: 19, potions: 0 })
    await store.close()
  })

  test('an identical save is not a write at all', async () => {
    requireDb()
    const id = track(wallet())
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    await store.loadProfile(id)
    store.saveProfile(id, { bag: { balls: 1, potions: 1 } })
    await store.flush(id)
    const after = store.stats().writes
    // Re-asserting the same state (every reconnect does this) must be free.
    store.saveProfile(id, { bag: { balls: 1, potions: 1 } })
    await store.flush(id)
    assert.equal(store.stats().writes, after)
    await store.close()
  })

  test('a wallet id that is not an auth.mjs id is refused', async () => {
    requireDb()
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    // A raw address is exactly the forgeable identity the HMAC exists to stop.
    assert.equal(await store.loadProfile('0x' + '22'.repeat(20)), null)
    assert.equal(await store.loadProfile('w:not-hex'), null)
    await store.close()
  })
})

describe('profiles: name uniqueness', () => {
  test('two wallets cannot hold the same name, in any case', async () => {
    requireDb()
    const a = track(wallet())
    const b = track(wallet())
    const name = uniqueName('Satosh')
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    await store.loadProfile(a)
    await store.loadProfile(b)

    const first = await store.claimName(a, name)
    assert.deepEqual(first, { ok: true, name })

    const second = await store.claimName(b, name.toUpperCase())
    assert.equal(second.ok, false, 'the second wallet must lose the name')
    assert.match(second.reason, /taken/i)

    // The loser keeps whatever they had, and can take a different name.
    const alternative = await store.claimName(b, uniqueName('Hal'))
    assert.equal(alternative.ok, true)
    await store.close()
  })

  test('a wallet can re-claim its own name and change its case', async () => {
    requireDb()
    const a = track(wallet())
    const name = uniqueName('Vitalik')
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    await store.loadProfile(a)
    assert.equal((await store.claimName(a, name)).ok, true)
    // Same row, so the unique index on lower(name) must not fire.
    assert.equal((await store.claimName(a, name.toUpperCase())).ok, true)
    const back = await store.loadProfile(a)
    assert.equal(back.name, name.toUpperCase())
    await store.close()
  })

  test('the name comes back on the next login', async () => {
    requireDb()
    const a = track(wallet())
    const name = uniqueName('Nakam')
    const writer = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    await writer.loadProfile(a)
    await writer.claimName(a, name)
    await writer.close()

    const reader = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    assert.equal((await reader.loadProfile(a)).name, name)
    await reader.close()
  })

  test('a name the database rejects outright is refused, not stored', async () => {
    requireDb()
    const a = track(wallet())
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 10 })
    await store.loadProfile(a)
    // validateName gates this in the game; the CHECK constraint is the
    // backstop for anything that ever bypasses it.
    const res = await store.claimName(a, 'x'.repeat(40))
    assert.equal(res.ok, false)
    assert.equal((await store.loadProfile(a)).name, null)
    await store.close()
  })
})

describe('profiles: degradation', () => {
  test('with no DATABASE_URL the store is a working no-op', async () => {
    const log = recorder()
    // Explicit null, not "unset": the environment running this test HAS a
    // DATABASE_URL, and the point is the code path where the server does not.
    const store = createProfileStore({ databaseUrl: null, log })
    assert.equal(store.enabled, false)
    assert.equal(store.healthy, false)

    const id = wallet()
    // The game must get "no server state", not an exception.
    assert.equal(await store.loadProfile(id), null)
    // Saving must be a silent no-op, not a throw from a game event handler.
    store.saveProfile(id, { party: [{ dbSymbol: 'a' }] })
    await store.flush(id)
    // A name must still be usable — refusing every name because there is no
    // database would be a worse failure than a duplicate.
    assert.deepEqual(await store.claimName(id, 'Solo'), { ok: true, name: 'Solo' })
    await store.release(id)
    await store.close()

    const warnings = log.lines.filter((l) => l.includes('DATABASE_URL is not set'))
    assert.equal(warnings.length, 1, 'the warning must be logged once, not per call')
  })

  test('an unreachable Postgres degrades instead of throwing', async () => {
    const log = recorder()
    // Port 1 is reliably closed and refuses immediately.
    const store = createProfileStore({
      databaseUrl: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
      flushMs: 5,
      log,
    })
    assert.equal(store.enabled, true, 'it is configured...')

    const id = wallet()
    assert.equal(await store.loadProfile(id), null, '...but a load just yields nothing')
    store.saveProfile(id, { bag: { balls: 1, potions: 1 } })
    await store.flush(id)
    // The player still gets a name for this session.
    const claim = await store.claimName(id, 'Castaway')
    assert.equal(claim.ok, true)
    assert.equal(store.healthy, false, 'the breaker should be open')

    const warned = log.lines.filter((l) => l.includes('Postgres unavailable'))
    assert.equal(warned.length, 1, 'one warning for the outage, not one per query')
    await store.close()
  })

  test('a save for a wallet that was never loaded still lands', async () => {
    requireDb()
    // The player row is created by the write itself — a save must never fail
    // on a missing foreign key just because load order was unusual.
    const id = track(wallet())
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 5 })
    store.saveProfile(id, { character: ['hero'] })
    await store.flush(id)
    await store.close()

    const reader = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 5 })
    assert.deepEqual((await reader.loadProfile(id)).character, ['hero'])
    await reader.close()
  })

  test('release performs a final write and forgets the player', async () => {
    requireDb()
    const id = track(wallet())
    const store = createProfileStore({ databaseUrl: DATABASE_URL, flushMs: 60_000 })
    await store.loadProfile(id)
    store.saveProfile(id, { bag: { balls: 42, potions: 0 } })
    assert.equal(store.stats().cached, 1)
    // Disconnect: the batching window has not elapsed, so only release() can
    // save this.
    await store.release(id)
    assert.equal(store.stats().cached, 0)
    await store.close()

    const reader = createProfileStore({ databaseUrl: DATABASE_URL })
    assert.deepEqual((await reader.loadProfile(id)).bag, { balls: 42, potions: 0 })
    await reader.close()
  })
})
