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
const STATE_KEYS = ['character', 'party', 'box', 'bag']

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
      const res = await pool.query(
        `INSERT INTO players (wallet_id, name)
         VALUES ($1, $2)
         ON CONFLICT (wallet_id) DO UPDATE
           SET name = EXCLUDED.name, updated_at = now(), last_seen_at = now()
         RETURNING name`,
        [walletId, name],
      )
      markUp()
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
    flush,
    flushAll,
    release,
    close,
  }
}
