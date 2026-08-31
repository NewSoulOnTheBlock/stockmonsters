/*
 * Integration test for the global chat transcript.
 *
 *   docker compose up -d && npm run db:migrate && npm run test:chat-log
 *
 * It talks to a REAL Postgres, because the two things worth proving here do
 * not exist against a mock: that the retention DELETE actually removes a row
 * that is older than a day, and that a store pointed at a dead database keeps
 * answering instead of throwing into a chat handler.
 *
 * Rows are written with a marker in the sender name and deleted afterwards, so
 * it is safe to point at the dev database.
 */
import test, { after, before, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { createChatLog, KEEP_HOURS, KEEP_ROWS } from '../chat-log.mjs'
import { migrate } from '../db/migrate.mjs'

const DATABASE_URL = process.env.DATABASE_URL
const wallet = () => 'w:' + randomBytes(16).toString('hex')
/** A tag nothing else in the database will ever have, so cleanup is exact. */
const TAG = 't' + randomBytes(4).toString('hex')
const speaker = (n) => `${TAG}_${n}`.slice(0, 32)

const recorder = () => {
    const lines = []
    const push = (m) => lines.push(String(m))
    return { lines, log: push, warn: push, error: push }
}

/** Let a fire-and-forget append reach Postgres. */
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

let live = false
let client = null
before(async () => {
    if (!DATABASE_URL) return
    try {
        client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 })
        await client.connect()
        await migrate(DATABASE_URL, { log: () => {} })
        live = true
    } catch (err) {
        console.warn(`[test] Postgres unavailable (${err.message}) — database cases will fail loudly`)
    }
})

after(async () => {
    if (!client) return
    if (live) await client.query('DELETE FROM chat_messages WHERE sender_name LIKE $1', [TAG + '%'])
    await client.end()
})

function requireDb() {
    assert.ok(
        live,
        'DATABASE_URL must point at a running Postgres for this suite ' +
            '(docker compose up -d && npm run db:migrate)',
    )
}

const mine = async () => {
    const { rows } = await client.query(
        'SELECT sender_name, body, said_at FROM chat_messages WHERE sender_name LIKE $1 ORDER BY id',
        [TAG + '%'],
    )
    return rows
}

describe('chat log: round trip', () => {
    test('a message said now is there for whoever joins next', async () => {
        requireDb()
        const store = createChatLog({ databaseUrl: DATABASE_URL })
        const id = wallet()
        store.append({ walletId: id, name: speaker('alice'), text: 'anyone at the dock?' })
        await settle()

        const recent = await store.recent(50)
        const line = recent.find((m) => m.from === speaker('alice'))
        assert.ok(line, 'the message must come back out')
        assert.equal(line.text, 'anyone at the dock?')
        assert.ok(Number.isFinite(line.at) && Math.abs(Date.now() - line.at) < 60_000)
        await store.close()
    })

    test('the newest are last, which is the order a chat panel renders', async () => {
        requireDb()
        const store = createChatLog({ databaseUrl: DATABASE_URL })
        for (const n of ['one', 'two', 'three']) {
            store.append({ walletId: wallet(), name: speaker('order'), text: n })
            await settle(80)
        }
        const said = (await store.recent(50)).filter((m) => m.from === speaker('order'))
        assert.deepEqual(said.map((m) => m.text), ['one', 'two', 'three'])
        await store.close()
    })

    test('a message with no wallet is still kept', async () => {
        // A name accepted while the database was down leaves a player with no
        // row of their own. Their words are still part of the conversation.
        requireDb()
        const store = createChatLog({ databaseUrl: DATABASE_URL })
        store.append({ name: speaker('nowallet'), text: 'hello anyway' })
        await settle()
        const said = (await store.recent(50)).filter((m) => m.from === speaker('nowallet'))
        assert.deepEqual(said.map((m) => m.text), ['hello anyway'])
        await store.close()
    })
})

describe('chat log: retention', () => {
    test(`a line older than ${KEEP_HOURS}h is deleted, and today's is not`, async () => {
        requireDb()
        const store = createChatLog({ databaseUrl: DATABASE_URL })
        // Written directly with a backdated timestamp: the point of this test
        // is the DELETE, not the clock.
        await client.query(
            `INSERT INTO chat_messages (wallet_id, sender_name, body, said_at)
             VALUES ($1, $2, 'yesterday, gone by now', now() - interval '25 hours'),
                    ($1, $3, 'said an hour ago', now() - interval '1 hour')`,
            [wallet(), speaker('old'), speaker('fresh')],
        )
        const before = (await mine()).map((r) => r.sender_name)
        assert.ok(before.includes(speaker('old')), 'the old row must exist before the trim')

        const removed = await store.trim()
        assert.ok(removed >= 1, `the trim must delete something (deleted ${removed})`)

        const after = (await mine()).map((r) => r.sender_name)
        assert.ok(!after.includes(speaker('old')), 'the day-old line must be gone')
        assert.ok(after.includes(speaker('fresh')), "today's line must survive")

        // ...and it is invisible to a joining player even before a trim runs.
        const served = await store.recent(50)
        assert.ok(!served.some((m) => m.text === 'yesterday, gone by now'))
        await store.close()
    })

    test('the row cap is a guard, not the policy', async () => {
        requireDb()
        // Everything recent stays, because retention is an AGE. The cap only
        // ever bites at KEEP_ROWS, which a real day never reaches.
        assert.ok(KEEP_ROWS > 1000, 'the abuse guard must be far above a normal day')
        const store = createChatLog({ databaseUrl: DATABASE_URL, keepRows: 2 })
        for (const n of ['a', 'b', 'c', 'd']) {
            store.append({ walletId: wallet(), name: speaker('cap'), text: n })
            await settle(80)
        }
        await store.trim()
        const kept = (await mine()).filter((r) => r.sender_name === speaker('cap'))
        assert.ok(kept.length <= 2, `the cap must bound the table (kept ${kept.length})`)
        await store.close()
    })

    test('the trim runs on its own, without a cron', async () => {
        requireDb()
        // The first append after boot triggers it — no external scheduler is
        // involved, which is the difference between a policy and a comment.
        await client.query(
            `INSERT INTO chat_messages (wallet_id, sender_name, body, said_at)
             VALUES ($1, $2, 'stale', now() - interval '30 hours')`,
            [wallet(), speaker('auto')],
        )
        const store = createChatLog({ databaseUrl: DATABASE_URL })
        store.append({ walletId: wallet(), name: speaker('auto2'), text: 'a live one' })
        await settle(600)
        const names = (await mine()).map((r) => r.sender_name)
        assert.ok(!names.includes(speaker('auto')), 'the stale row must be swept by the append path')
        assert.ok(names.includes(speaker('auto2')))
        assert.ok(store.stats().trims >= 1, 'a trim must have actually run')
        await store.close()
    })
})

describe('chat log: it must never stop people talking', () => {
    test('with no DATABASE_URL it answers instead of throwing', async () => {
        const log = recorder()
        const store = createChatLog({ databaseUrl: null, log })
        assert.equal(store.enabled, false)
        store.append({ walletId: wallet(), name: speaker('off'), text: 'still sayable' })
        assert.deepEqual(await store.recent(10), [])
        await settle(50)
        assert.ok(log.lines.some((l) => /live-only/.test(l)), 'it must say so once')
        await store.close()
    })

    test('with Postgres unreachable it answers instead of throwing', async () => {
        const log = recorder()
        // A port nothing is listening on: the connection fails, not the query.
        const store = createChatLog({
            databaseUrl: 'postgres://nobody@127.0.0.1:5599/nothing',
            log,
        })
        store.append({ walletId: wallet(), name: speaker('down'), text: 'chat still works' })
        assert.deepEqual(await store.recent(10), [], 'a read must answer empty, not reject')
        await settle(500)
        assert.ok(
            log.lines.some((l) => /unavailable/.test(l)),
            `it must warn once (got ${JSON.stringify(log.lines)})`,
        )
        assert.equal(store.stats().writeErrors > 0 || store.stats().dropped > 0, true)
        await store.close()
    })

    test('a message the schema refuses does not trip the outage breaker', async () => {
        requireDb()
        const log = recorder()
        const store = createChatLog({ databaseUrl: DATABASE_URL, log })
        // 600 characters: past the storage backstop, so Postgres says no. The
        // store truncates at 500 before it ever gets there — proving the
        // refusal never reaches a player is the point.
        store.append({ walletId: wallet(), name: speaker('long'), text: 'x'.repeat(600) })
        await settle()
        const kept = (await mine()).find((r) => r.sender_name === speaker('long'))
        assert.ok(kept, 'the over-long line is truncated, not dropped')
        assert.equal(kept.body.length, 500)
        // The database is healthy, so nothing may have been marked down.
        assert.ok(!log.lines.some((l) => /unavailable/.test(l)), log.lines.join('\n'))
        await store.close()
    })
})
