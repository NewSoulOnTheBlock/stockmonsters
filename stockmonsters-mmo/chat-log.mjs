/*
 * The global chat transcript, in Postgres.
 *
 * WHY THIS EXISTS
 * Chat was broadcast-only: a message reached whoever was connected at that
 * moment and was gone. Somebody who joined five minutes later saw an empty
 * panel and a game that looked abandoned. This store is what makes the room
 * still be there when you walk into it.
 *
 * WHAT IS KEPT — global chat, and nothing else. Direct messages are private
 * (dm.ts writes nothing here) and system lines are generated per player on
 * their own screen. The single writer is handleChat() in
 * src/modules/main/chat.ts.
 *
 * DEGRADATION IS A FEATURE, and it is the same discipline profiles.mjs has:
 * no DATABASE_URL, Postgres down, Postgres restarting — every entry point
 * here answers, nothing throws into a player action handler, and chat carries
 * on live exactly as it did before this file existed. The only thing lost is
 * the memory of it. A chat log must never be able to stop people talking.
 *
 * This file is Node-only (it imports `pg`). It must NEVER be imported from
 * src/modules/** — that tree is bundled into the browser too. The bridge is
 * globalThis.__smChatLog, injected by server.mjs (and by vite.config.ts for
 * `npm run dev`) and consumed by src/modules/main/chat.ts.
 */
import pg from 'pg'

/**
 * RETENTION IS AN AGE, NOT A COUNT. The user's rule, in their words:
 * "günlük temizlesek yeter" — clearing it daily is enough. A message older
 * than 24 hours is deleted, and that is the whole policy. If the game has a
 * busy day, the whole busy day is kept.
 *
 * KEEP_ROWS IS NOT THE POLICY. It is a safety valve against abuse — a runaway
 * client loop, or somebody pasting a thousand lines — so that "one day of
 * chat" cannot become an unbounded table between two trims. In ordinary use
 * it never binds: the chat rate limit is 5 messages per 15 seconds per wallet,
 * so a normal day of a normal player count lands nowhere near it.
 *
 * What a JOINING PLAYER is shown is a separate number (HISTORY_MAX in
 * src/modules/main/chat.ts). A full day can be hundreds of lines, and dumping
 * those into a 30vh panel is worse than showing nothing — nobody scrolls back
 * through a wall of text to find out whether the room is alive. The table
 * holds the day; the panel gets a readable tail of it.
 */
export const KEEP_HOURS = 24
export const KEEP_ROWS = 5000
/**
 * How often the trim runs: every N successful inserts, plus once on the first
 * append after boot. Deliberately NOT a cron and not an external job — a
 * retention rule that depends on something outside this process is a rule
 * nothing enforces. It is also cheap: one indexed DELETE per 50 messages.
 */
const TRIM_EVERY = 50

/** Same breaker as profiles.mjs: stop hammering a database that just failed. */
const RETRY_AFTER_MS = 10_000

const isWalletId = (v) => typeof v === 'string' && /^w:[0-9a-f]{32}$/.test(v)

/**
 * @param {object} [opts]
 * @param {string|null} [opts.databaseUrl]  defaults to process.env.DATABASE_URL
 * @param {object} [opts.log]               console-like, for tests
 * @param {number} [opts.keepRows]
 * @param {number} [opts.keepHours]
 */
export function createChatLog(opts = {}) {
    // `in` rather than `??` so a caller can force the no-database path with
    // databaseUrl: null even when the environment has one — tests need that.
    const databaseUrl = 'databaseUrl' in opts ? opts.databaseUrl : process.env.DATABASE_URL
    const log = opts.log ?? console
    const keepRows = Number(opts.keepRows ?? KEEP_ROWS)
    const keepHours = Number(opts.keepHours ?? KEEP_HOURS)

    const counters = { appends: 0, writeErrors: 0, reads: 0, trims: 0, trimmed: 0, dropped: 0 }

    let pool = null
    let downUntil = 0
    let warnedDisabled = false
    let warnedDown = false
    let sinceTrim = TRIM_EVERY // trim on the first append of the process

    if (databaseUrl) {
        pool = new pg.Pool({
            connectionString: databaseUrl,
            max: Number(process.env.PGPOOL_CHAT_MAX ?? 4),
            // Fail fast. A game tick must never block on a dead socket.
            connectionTimeoutMillis: 4000,
            idleTimeoutMillis: 30_000,
            query_timeout: 5000,
        })
        // Postgres closing an idle client emits on the POOL, not on any query;
        // without this listener that is an unhandled 'error' and it takes the
        // whole game server down.
        pool.on('error', (err) => markDown(err))
    }

    function markDown(err) {
        downUntil = Date.now() + RETRY_AFTER_MS
        if (!warnedDown) {
            warnedDown = true
            log.warn?.(
                `[chatlog] Postgres unavailable (${err?.message ?? err}) — chat still works, ` +
                    'but nothing is being kept for players who join later.',
            )
        }
    }

    function markUp() {
        if (warnedDown) {
            warnedDown = false
            log.log?.('[chatlog] Postgres reachable again — chat is being kept.')
        }
        downUntil = 0
    }

    function usable() {
        if (!pool) {
            if (!warnedDisabled) {
                warnedDisabled = true
                log.warn?.(
                    '[chatlog] DATABASE_URL is not set — chat is live-only, exactly as it ' +
                        'was before history existed.',
                )
            }
            return false
        }
        if (Date.now() < downUntil) return false
        return true
    }

    /** Runs a query; returns null instead of throwing when it cannot. */
    async function run(sql, params) {
        if (!usable()) return null
        try {
            const res = await pool.query(sql, params)
            markUp()
            return res
        } catch (err) {
            // A constraint violation means the database is healthy and said no.
            // Only connection-shaped failures should trip the breaker.
            const constraint = typeof err?.code === 'string' && err.code.startsWith('23')
            if (!constraint) markDown(err)
            else log.warn?.(`[chatlog] refused a message: ${err.message}`)
            counters.writeErrors++
            return null
        }
    }

    /**
     * Delete anything older than `keepHours` — the actual retention rule — and,
     * as an abuse guard only, anything beyond the newest `keepRows`.
     *
     * `id <= max(id) - keepRows` works because the id is a BIGSERIAL: it needs
     * no sort, and it stays correct when a gap appears (a rolled-back insert
     * still burns a sequence value, which only makes the guard keep FEWER rows
     * than the cap — never more).
     */
    async function trim() {
        const res = await run(
            `DELETE FROM chat_messages
              WHERE said_at < now() - ($1 || ' hours')::interval
                 OR id <= (SELECT COALESCE(MAX(id), 0) FROM chat_messages) - $2::bigint`,
            [String(keepHours), keepRows],
        )
        if (!res) return 0
        counters.trims++
        counters.trimmed += res.rowCount ?? 0
        return res.rowCount ?? 0
    }

    return {
        get enabled() {
            return !!pool
        },

        /**
         * Write one global chat message down. Fire and forget by design: the
         * caller has already broadcast it, and a player must never wait on a
         * database to be heard.
         *
         * @param {{ walletId?: string|null, name: string, text: string }} msg
         */
        append(msg) {
            const name = typeof msg?.name === 'string' ? msg.name.slice(0, 32) : ''
            const text = typeof msg?.text === 'string' ? msg.text.slice(0, 500) : ''
            if (!name || !text) return
            const walletId = isWalletId(msg?.walletId) ? msg.walletId : null
            counters.appends++
            void (async () => {
                const res = await run(
                    'INSERT INTO chat_messages (wallet_id, sender_name, body) VALUES ($1, $2, $3)',
                    [walletId, name, text],
                )
                if (!res) {
                    counters.dropped++
                    return
                }
                if (++sinceTrim < TRIM_EVERY) return
                sinceTrim = 0
                await trim()
            })().catch((err) => {
                // Nothing above should throw — but an unhandled rejection here
                // would take the game server down, which is the one outcome a
                // chat log is not allowed to have.
                counters.writeErrors++
                log.warn?.(`[chatlog] append failed: ${err?.message ?? err}`)
            })
        },

        /**
         * The newest messages, oldest first — the order a chat panel renders.
         *
         * @param {number} limit      how many at most
         * @param {number} windowMs   ignore anything older than this
         * @returns {Promise<Array<{ from: string, text: string, at: number }>>}
         *          empty when there is nothing, and empty when the database is
         *          unreachable. The caller cannot tell the two apart, and must
         *          not need to.
         */
        async recent(limit = 40, windowMs = KEEP_HOURS * 3600_000) {
            const n = Math.max(0, Math.min(200, Math.floor(limit)))
            if (!n) return []
            const seconds = Math.max(1, Math.floor(windowMs / 1000))
            const res = await run(
                `SELECT sender_name, body, said_at FROM (
                     SELECT sender_name, body, said_at, id
                       FROM chat_messages
                      WHERE said_at > now() - ($1 || ' seconds')::interval
                      ORDER BY id DESC
                      LIMIT $2
                 ) newest ORDER BY id ASC`,
                [String(seconds), n],
            )
            if (!res) return []
            counters.reads++
            // Plain values only. Anything emitted by the engine is
            // structuredClone()d, and a Date survives that but a pg row object
            // is not something the game should be handing around either.
            return res.rows.map((r) => ({
                from: String(r.sender_name),
                text: String(r.body),
                at: new Date(r.said_at).getTime(),
            }))
        },

        /** Exposed so a test (or an operator) can force the retention pass. */
        trim,
        stats: () => ({ ...counters, enabled: !!pool }),
        async close() {
            if (pool) await pool.end()
            pool = null
        },
    }
}
