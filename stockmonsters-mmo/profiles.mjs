/*
 * Server-side player profiles, keyed by wallet id.
 *
 * WHY THIS EXISTS
 * The room transport uses `connectionIdScope: 'ephemeral'` — a brand-new
 * transport id on every page load — because reusing an id left the socket able
 * to receive but not send (HANDOVER: "Reload-kills-input blocker"). That fixed
 * input and broke persistence: nothing server-side was keyed to a returning
 * player, so PARTY / BOX / BAG reset every session and the character and name
 * only came back because the CLIENT replayed them out of localStorage — which
 * is forgeable and does not travel between devices.
 *
 * The stable identity we DO have is the wallet id from auth.mjs:
 *     "w:" + HMAC-SHA256(SERVER_SECRET, address)
 * unforgeable without the secret, identical on every device. This module is
 * the store keyed by it.
 *
 * DEGRADATION IS A FEATURE
 * Every entry point here is total: no DATABASE_URL, Postgres down, Postgres
 * midway through a restart — the game keeps running with exactly the
 * pre-persistence behaviour (session-only state), one warning line, no throw
 * that can reach a player action handler. A database outage must never be able
 * to stop people playing.
 *
 * This file is Node-only (it imports `pg`). It must NEVER be imported from
 * src/modules/** — that tree is bundled into the browser too. The bridge is
 * globalThis.__smProfiles, injected by server.mjs and consumed by
 * src/modules/main/profile.ts.
 */
import pg from 'pg'

/** Bump when the shape of the `state` blob changes incompatibly. */
export const STATE_VERSION = 1

const DEFAULT_FLUSH_MS = 1500
// How long to stop hammering a database that just failed. Long enough that a
// restarting Postgres is not flooded, short enough that a player who logs in
// afterwards still gets their save.
const RETRY_AFTER_MS = 10_000
// A party of 6 plus a box is a few KB. Anything near this is a bug (an event
// loop appending to BOX forever), and we would rather see it in the log than
// discover it as a 40MB row.
const STATE_WARN_BYTES = 256 * 1024

const isWalletId = (v) => typeof v === 'string' && /^w:[0-9a-f]{32}$/.test(v)

/** Only these keys are ever persisted. Anything else in a patch is dropped. */
// 'visited' is the set of map ids the player has actually stood on. Fast
// travel is gated on it, so it has to survive a reload like everything else.
// 'earned' is the per-epoch reward ledger: { "<epoch>": "<base units>" }.
// It lives in the save rather than in its own table because it is small,
// written by the same flush as everything else, and only ever read whole.
// 'trainerXp' is a single integer: the trainer's lifetime XP. The level and
// the bar are derived from it (src/modules/main/trainer.ts), so there is one
// number to store and nothing that can disagree with itself.
const STATE_KEYS = ['character', 'party', 'box', 'bag', 'visited', 'earned', 'trainerXp']

/** A name is one per wallet, changeable once a day. */
const NAME_COOLDOWN_HOURS = 24

/** "in 3 hours" / "in 12 minutes" — vague on purpose, exact enough to act on. */
function untilText(at) {
  const ms = new Date(at).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'shortly'
  const mins = Math.ceil(ms / 60000)
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.ceil(mins / 60)
  return `in ${hours} hour${hours === 1 ? '' : 's'}`
}

function pickState(source) {
  const out = {}
  for (const key of STATE_KEYS) if (source[key] !== undefined) out[key] = source[key]
  return out
}

const emptyProfile = (walletId, address = null) => ({
  walletId,
  address,
  name: null,
  character: null,
  party: null,
  box: null,
  bag: null,
  visited: null,
  earned: null,
  trainerXp: null,
  version: STATE_VERSION,
})

/**
 * @param {object} [opts]
 * @param {string} [opts.databaseUrl]  defaults to process.env.DATABASE_URL
 * @param {number} [opts.flushMs]      write batching window
 * @param {object} [opts.log]          console-like, for tests
 */
export function createProfileStore(opts = {}) {
  // `in` rather than `??` so a caller can force the no-database path by
  // passing databaseUrl: null even when the environment has one set. Tests
  // need that; so does any tool that must not touch production data.
  const databaseUrl = 'databaseUrl' in opts ? opts.databaseUrl : process.env.DATABASE_URL
  const flushMs = Number(opts.flushMs ?? process.env.PROFILE_FLUSH_MS ?? DEFAULT_FLUSH_MS)
  const log = opts.log ?? console

  /** walletId -> { profile, dirty, timer, chain } */
  const cache = new Map()
  const counters = { loads: 0, writes: 0, writeErrors: 0, nameConflicts: 0, skippedWhileDown: 0 }

  let pool = null
  let downUntil = 0
  let warnedDisabled = false
  let warnedDown = false

  if (databaseUrl) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      // Fail fast. A game tick must never block on a dead socket.
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30_000,
      query_timeout: 5000,
      // Postgres closing an idle client emits on the POOL, not on any query.
      // Without this listener that event is an unhandled 'error' and takes the
      // whole game server down.
    })
    pool.on('error', (err) => markDown(err))
  }

  function markDown(err) {
    downUntil = Date.now() + RETRY_AFTER_MS
    if (!warnedDown) {
      warnedDown = true
      log.warn?.(
        `[profiles] Postgres unavailable (${err?.message ?? err}) — running without ` +
          'persistence; saves are session-only until it comes back.',
      )
    }
  }

  function markUp() {
    if (warnedDown) {
      warnedDown = false
      log.log?.('[profiles] Postgres reachable again — saves are persistent.')
    }
    downUntil = 0
  }

  /** true when a query may be attempted right now. */
  function usable() {
    if (!pool) {
      if (!warnedDisabled) {
        warnedDisabled = true
        log.warn?.(
          '[profiles] DATABASE_URL is not set — player state is session-only ' +
            '(pre-persistence behaviour). Set it in .env to keep saves.',
        )
      }
      return false
    }
    if (Date.now() < downUntil) {
      counters.skippedWhileDown++
      return false
    }
    return true
  }

  /**
   * Runs a query, never throws for reasons the caller cannot act on.
   * Returns { rows } on success, null when the database is unusable.
   * `rethrow` lets claimName see the unique-violation it must distinguish.
   */
  async function run(sql, params, { rethrow = false } = {}) {
    if (!usable()) return null
    try {
      const res = await pool.query(sql, params)
      markUp()
      return res
    } catch (err) {
      // A constraint violation means the database is healthy and said no —
      // that is an answer, not an outage. Only connection-shaped failures
      // should trip the breaker.
      const constraint = typeof err?.code === 'string' && err.code.startsWith('23')
      if (!constraint) markDown(err)
      if (rethrow) throw err
      counters.writeErrors++
      return null
    }
  }

  function entry(walletId) {
    let e = cache.get(walletId)
    if (!e) {
      e = {
        profile: emptyProfile(walletId),
        dirty: false,
        // A name accepted while the database was unreachable. Retried by the
        // next flush so the player does not silently lose it.
        pendingName: null,
        timer: null,
        chain: Promise.resolve(),
      }
      cache.set(walletId, e)
    }
    return e
  }

  function schedule(walletId, delay = flushMs) {
    const e = entry(walletId)
    if (e.timer) return
    e.timer = setTimeout(() => {
      e.timer = null
      void flush(walletId)
    }, delay)
    e.timer.unref?.()
  }

  // -- reads -----------------------------------------------------------------

  /**
   * Loads (and touches) the profile for a wallet, creating the player row on
   * first sight. Returns null when there is no database — callers treat that
   * as "no server state, keep doing what you did before".
   *
   * @param {string} walletId  "w:" + 32 hex
   * @param {{address?: string|null}} [meta]
   */
  async function loadProfile(walletId, meta = {}) {
    if (!isWalletId(walletId)) return null
    const address =
      typeof meta.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(meta.address)
        ? meta.address.toLowerCase()
        : null

    // One round trip: upsert the player (creating on first login, refreshing
    // last_seen_at otherwise) and read their state in the same statement.
    const res = await run(
      `WITH upserted AS (
         INSERT INTO players (wallet_id, wallet_address)
         VALUES ($1, $2)
         ON CONFLICT (wallet_id) DO UPDATE
           SET last_seen_at    = now(),
               wallet_address  = COALESCE(EXCLUDED.wallet_address, players.wallet_address),
               -- last_seen_at is a heartbeat; updated_at should only move when
               -- something a human would call a change actually changed.
               updated_at      = CASE
                 WHEN players.wallet_address IS DISTINCT FROM
                      COALESCE(EXCLUDED.wallet_address, players.wallet_address)
                 THEN now() ELSE players.updated_at END
         RETURNING wallet_id, wallet_address, name
       )
       SELECT u.wallet_id, u.wallet_address, u.name, s.version, s.state
       FROM upserted u
       LEFT JOIN player_state s ON s.wallet_id = u.wallet_id`,
      [walletId, address],
    )
    if (!res) return null
    counters.loads++

    const row = res.rows[0] ?? {}
    const state = row.state ?? {}
    const profile = {
      ...emptyProfile(walletId, row.wallet_address ?? address),
      name: row.name ?? null,
      version: row.version ?? STATE_VERSION,
      ...pickState(state),
    }
    // Seed the write-back cache so a later saveProfile patch merges onto the
    // stored state rather than replacing it with whatever one call happened to
    // know about.
    const e = entry(walletId)
    e.profile = profile
    return { ...profile }
  }

  // -- writes ----------------------------------------------------------------

  /**
   * Merges a patch into the cached profile and schedules a write.
   *
   * Deliberately NOT a write per call: every variable change in the game marks
   * the profile dirty and one timer flushes the batch, so a battle that
   * mutates PARTY on every turn produces one UPDATE, not twenty. Synchronous
   * and never rejects — callers are game event handlers.
   *
   * `name` is NOT written from here even if a patch carries one — it is a
   * globally unique, contended value and only claimName() may set it, because
   * only claimName() can lose the race. A name in a patch updates the cache so
   * the in-memory profile stays consistent, nothing more.
   *
   * @param {string} walletId
   * @param {{name?: string|null, address?: string|null, character?: string[],
   *          party?: unknown[], box?: unknown[], bag?: object}} patch
   */
  function saveProfile(walletId, patch) {
    if (!isWalletId(walletId) || !patch || typeof patch !== 'object') return
    const e = entry(walletId)
    let changed = false
    for (const key of [...STATE_KEYS, 'name', 'address']) {
      if (patch[key] === undefined) continue
      // Cheap structural compare: these are small JSON-shaped values and a
      // no-op save is by far the common case (re-connects re-assert state).
      const next = patch[key]
      if (JSON.stringify(e.profile[key]) === JSON.stringify(next)) continue
      e.profile[key] = next
      changed = true
    }
    if (!changed) return
    e.dirty = true
    // Fixed window, not a resetting debounce: a stream of changes must still
    // reach disk within flushMs rather than being pushed back forever.
    schedule(walletId)
  }

  /** Writes the cached state now. Resolves even when the write is impossible. */
  function flush(walletId) {
    const e = cache.get(walletId)
    if (!e) return Promise.resolve(false)
    if (e.timer) {
      clearTimeout(e.timer)
      e.timer = null
    }
    if (!e.dirty && !e.pendingName) return e.chain.then(() => false)
    e.dirty = false
    const snapshot = pickState(e.profile)
    const address = e.profile.address ?? null
    // Chain per wallet so two flushes cannot land out of order and resurrect
    // an older party.
    e.chain = e.chain.then(async () => {
      // A name the player was given while the database was down still has to
      // be claimed properly — including possibly losing the race to someone
      // who took it in the meantime.
      // claimName owns e.pendingName: it clears it when the database answers
      // (either way) and re-arms it when the database is still unreachable.
      if (e.pendingName) await claimName(walletId, e.pendingName)
      const json = JSON.stringify(snapshot)
      if (json.length > STATE_WARN_BYTES) {
        log.warn?.(`[profiles] ${walletId} state is ${json.length} bytes — something is growing unbounded`)
      }
      const res = await run(
        `WITH p AS (
           INSERT INTO players (wallet_id, wallet_address)
           VALUES ($1, $4)
           ON CONFLICT (wallet_id) DO UPDATE SET last_seen_at = now()
           RETURNING wallet_id
         )
         INSERT INTO player_state (wallet_id, version, state, updated_at)
         SELECT wallet_id, $2, $3::jsonb, now() FROM p
         ON CONFLICT (wallet_id) DO UPDATE
           SET version = EXCLUDED.version, state = EXCLUDED.state, updated_at = now()`,
        [walletId, STATE_VERSION, json, address],
      )
      if (res) {
        counters.writes++
      } else if (pool) {
        // The write did not land. Keep it pending and try again once the
        // breaker's cooldown is over, so a Postgres restart mid-session costs
        // the player nothing.
        e.dirty = true
        schedule(walletId, RETRY_AFTER_MS + 500)
      }
      return !!res
    })
    return e.chain
  }

  /**
   * Claims a player-visible name for a wallet.
   *
   * Uniqueness is decided by the DATABASE (a unique index on lower(name)), not
   * by a read-then-write here: two sockets racing for the same name would both
   * see it free. The 23505 we catch below IS the race being lost, and that is
   * the intended control flow.
   *
   * Returns {ok:true} when the name is theirs — including when there is no
   * database at all, because refusing every name because Postgres is down
   * would be a worse failure than a duplicate name.
   *
   * @returns {Promise<{ok:true,name:string}|{ok:false,reason:string}>}
   */
  async function claimName(walletId, name) {
    if (!isWalletId(walletId)) return { ok: false, reason: 'Unknown player.' }
    if (typeof name !== 'string' || !name) return { ok: false, reason: 'Name required.' }
    const e = entry(walletId)
    if (!usable()) {
      e.profile.name = name
      e.pendingName = name
      schedule(walletId, RETRY_AFTER_MS + 500)
      return { ok: true, name }
    }
    try {
      // One statement decides everything: uniqueness (the index), and the
      // cooldown (the WHERE). Reading "when did they last change it" and then
      // writing would let two sockets for the same wallet both pass the check.
      // Re-claiming the SAME name is always allowed — it is not a change.
      const res = await pool.query(
        `INSERT INTO players (wallet_id, name, name_changed_at)
         VALUES ($1, $2, now())
         ON CONFLICT (wallet_id) DO UPDATE
           SET name = EXCLUDED.name,
               -- Re-sending the SAME name is not a change: every reconnect does
               -- it, and restarting the clock each time would mean a player who
               -- plays daily can never actually change their name.
               name_changed_at = CASE
                   WHEN players.name IS DISTINCT FROM EXCLUDED.name THEN now()
                   ELSE players.name_changed_at
               END,
               updated_at = now(),
               last_seen_at = now()
         WHERE players.name IS NULL
            OR players.name = EXCLUDED.name
            OR players.name_changed_at IS NULL
            OR players.name_changed_at <= now() - INTERVAL '${NAME_COOLDOWN_HOURS} hours'
         RETURNING name`,
        [walletId, name],
      )
      markUp()
      if (!res.rows.length) {
        // The row exists and the WHERE refused it: still inside the cooldown.
        const when = await pool.query(
          `SELECT name,
                  name_changed_at + INTERVAL '${NAME_COOLDOWN_HOURS} hours' AS next_at
             FROM players WHERE wallet_id = $1`,
          [walletId],
        )
        const nextAt = when.rows[0]?.next_at
        e.pendingName = null
        return {
          ok: false,
          reason: 'You can change your name once a day.' + (nextAt ? ` Try again ${untilText(nextAt)}.` : ''),
          retryAt: nextAt ? new Date(nextAt).toISOString() : null,
        }
      }
      e.pendingName = null
      e.profile.name = res.rows[0].name
      return { ok: true, name: res.rows[0].name }
    } catch (err) {
      if (err?.code === '23505') {
        counters.nameConflicts++
        e.pendingName = null
        return { ok: false, reason: 'That name is already taken.' }
      }
      if (err?.code === '23514') {
        e.pendingName = null
        return { ok: false, reason: 'That name is not allowed.' }
      }
      // Anything else is an outage. Let the player have the name for this
      // session rather than blocking them on our infrastructure, and retry.
      markDown(err)
      e.profile.name = name
      e.pendingName = name
      schedule(walletId, RETRY_AFTER_MS + 500)
      return { ok: true, name }
    }
  }

  /* ------------------------------------------------------------- friends ---*/
  /*
   * Friends are NOT part of the profile blob.
   *
   * A friendship belongs to two players at once. Putting it in one player's
   * JSON means the other half is written by a different flush, on a different
   * timer, possibly on a different process — and the two halves disagree the
   * moment either write is lost. These are relational rows with a primary key
   * that makes a duplicate impossible; see db/migrations/0004_friends.sql.
   *
   * Every function here returns NULL when the database could not answer, which
   * the caller must not confuse with "no". src/modules/main/friends.ts turns
   * null into a visible "friends are unavailable right now" rather than a
   * silent no-op.
   */

  /**
   * Runs `fn(client)` in a transaction on one connection.
   *
   * Accepting a friend request is a DELETE and an INSERT that must both happen
   * or neither: a crash between them either drops the request without making
   * the friendship, or makes it while leaving the request sitting in the
   * receiver's list forever. run() cannot express that — it is one statement
   * per call, each on whatever connection the pool hands out.
   */
  async function tx(fn) {
    if (!usable()) return null
    let client = null
    try {
      client = await pool.connect()
    } catch (err) {
      markDown(err)
      return null
    }
    try {
      await client.query('BEGIN')
      const out = await fn(client)
      await client.query('COMMIT')
      markUp()
      return out
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* the connection is going away anyway */ }
      const constraint = typeof err?.code === 'string' && err.code.startsWith('23')
      if (!constraint) markDown(err)
      counters.writeErrors++
      return null
    } finally {
      client.release()
    }
  }

  /** Canonical (lo, hi) ordering — the friendships PK depends on it. */
  const pair = (a, b) => (a < b ? [a, b] : [b, a])

  /**
   * Wallet id for a player-visible name, case-insensitively.
   *
   * @returns null when the database could not answer, `{walletId: null}` when
   *          there is no such player — two different things to tell a player.
   */
  async function findPlayerByName(name) {
    if (typeof name !== 'string' || !name.trim()) return { walletId: null, name: null }
    const res = await run('SELECT wallet_id, name FROM players WHERE lower(name) = lower($1)', [name.trim()])
    if (!res) return null
    const row = res.rows[0]
    return row ? { walletId: row.wallet_id, name: row.name } : { walletId: null, name: null }
  }

  /**
   * Everything one player's friends panel needs, in one round trip: accepted
   * friends, requests waiting for them, and requests they are waiting on.
   */
  async function friendState(walletId) {
    if (!isWalletId(walletId)) return { friends: [], incoming: [], outgoing: [] }
    const res = await run(
      `SELECT 'friend' AS kind, p.wallet_id, p.name
         FROM friendships f
         JOIN players p
           ON p.wallet_id = CASE WHEN f.wallet_lo = $1 THEN f.wallet_hi ELSE f.wallet_lo END
        WHERE f.wallet_lo = $1 OR f.wallet_hi = $1
       UNION ALL
       SELECT 'incoming', p.wallet_id, p.name
         FROM friend_requests r JOIN players p ON p.wallet_id = r.from_wallet
        WHERE r.to_wallet = $1
       UNION ALL
       SELECT 'outgoing', p.wallet_id, p.name
         FROM friend_requests r JOIN players p ON p.wallet_id = r.to_wallet
        WHERE r.from_wallet = $1`,
      [walletId],
    )
    if (!res) return null
    const out = { friends: [], incoming: [], outgoing: [] }
    for (const row of res.rows) {
      const entry = { walletId: row.wallet_id, name: row.name ?? null }
      if (row.kind === 'friend') out.friends.push(entry)
      else if (row.kind === 'incoming') out.incoming.push(entry)
      else out.outgoing.push(entry)
    }
    return out
  }

  /**
   * Ask `to` to be friends.
   *
   * A request in the OPPOSITE direction is treated as acceptance and the pair
   * becomes friends immediately: both players have now said yes, and making
   * them wait for a click that adds no information reads as a bug.
   *
   * @returns {'requested'|'friends'|'duplicate'|'already-friends'} as
   *          `{status}`, or null when the database could not answer.
   */
  async function requestFriend(from, to) {
    if (!isWalletId(from) || !isWalletId(to) || from === to) return { status: 'invalid' }
    const [lo, hi] = pair(from, to)
    return tx(async (c) => {
      const existing = await c.query(
        'SELECT 1 FROM friendships WHERE wallet_lo = $1 AND wallet_hi = $2',
        [lo, hi],
      )
      if (existing.rowCount) return { status: 'already-friends' }

      const reverse = await c.query(
        'DELETE FROM friend_requests WHERE from_wallet = $1 AND to_wallet = $2 RETURNING 1',
        [to, from],
      )
      if (reverse.rowCount) {
        await c.query(
          'INSERT INTO friendships (wallet_lo, wallet_hi) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [lo, hi],
        )
        await c.query('DELETE FROM friend_requests WHERE from_wallet = $1 AND to_wallet = $2', [from, to])
        return { status: 'friends' }
      }

      const made = await c.query(
        `INSERT INTO friend_requests (from_wallet, to_wallet) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING 1`,
        [from, to],
      )
      return { status: made.rowCount ? 'requested' : 'duplicate' }
    })
  }

  /** `me` accepts the request `other` sent. Deleting it and creating the
   *  friendship are one transaction — half of this is worse than neither. */
  async function acceptFriend(me, other) {
    if (!isWalletId(me) || !isWalletId(other) || me === other) return { ok: false, reason: 'invalid' }
    const [lo, hi] = pair(me, other)
    return tx(async (c) => {
      const taken = await c.query(
        'DELETE FROM friend_requests WHERE from_wallet = $1 AND to_wallet = $2 RETURNING 1',
        [other, me],
      )
      if (!taken.rowCount) {
        // No request. Either it was withdrawn, or the pair is already friends
        // (two accepts racing, or an accept after a mutual request) — which is
        // success, not an error the player should see.
        const already = await c.query(
          'SELECT 1 FROM friendships WHERE wallet_lo = $1 AND wallet_hi = $2',
          [lo, hi],
        )
        return already.rowCount ? { ok: true, already: true } : { ok: false, reason: 'no-request' }
      }
      await c.query(
        'INSERT INTO friendships (wallet_lo, wallet_hi) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [lo, hi],
      )
      // If we had also asked them, that ask is answered now.
      await c.query('DELETE FROM friend_requests WHERE from_wallet = $1 AND to_wallet = $2', [me, other])
      return { ok: true }
    })
  }

  /** Refuse a request sent to `me` (or withdraw one `me` sent). Same row. */
  async function dropRequest(from, to) {
    if (!isWalletId(from) || !isWalletId(to)) return { ok: false }
    const res = await run(
      'DELETE FROM friend_requests WHERE from_wallet = $1 AND to_wallet = $2 RETURNING 1',
      [from, to],
    )
    if (!res) return null
    return { ok: !!res.rowCount }
  }

  /** End a friendship. Undirected: either side removes the single row. */
  async function removeFriend(me, other) {
    if (!isWalletId(me) || !isWalletId(other)) return { ok: false }
    const [lo, hi] = pair(me, other)
    const res = await run(
      'DELETE FROM friendships WHERE wallet_lo = $1 AND wallet_hi = $2 RETURNING 1',
      [lo, hi],
    )
    if (!res) return null
    return { ok: !!res.rowCount }
  }

  /** Flush and drop the cache entry — call on disconnect. */
  async function release(walletId) {
    await flush(walletId)
    const e = cache.get(walletId)
    if (e?.timer) clearTimeout(e.timer)
    cache.delete(walletId)
  }

  async function flushAll() {
    await Promise.all([...cache.keys()].map((id) => flush(id)))
  }

  async function close() {
    await flushAll()
    for (const e of cache.values()) if (e.timer) clearTimeout(e.timer)
    cache.clear()
    if (pool) await pool.end().catch(() => {})
    pool = null
  }

  return {
    /** A DATABASE_URL was configured at all. */
    get enabled() {
      return !!pool
    },
    /** Configured AND believed reachable right now. */
    get healthy() {
      return !!pool && Date.now() >= downUntil
    },
    stats: () => ({ ...counters, cached: cache.size, enabled: !!pool, healthy: !!pool && Date.now() >= downUntil }),
    loadProfile,
    saveProfile,
    claimName,
    // Friends. src/modules/main/friends.ts treats the presence of these
    // methods as "this server can persist friendships" and falls back to a
    // session-only store — which it says on screen — when they are missing.
    findPlayerByName,
    friendState,
    requestFriend,
    acceptFriend,
    dropRequest,
    removeFriend,
    flush,
    flushAll,
    release,
    close,
  }
}
