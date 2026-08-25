/*
 * Migration runner. Plain .sql files, applied in filename order, recorded in
 * schema_migrations. No ORM, no DSL — the schema is the SQL you can read.
 *
 *   npm run db:migrate            apply everything pending
 *   npm run db:migrate -- --status  show applied / pending without writing
 *   npm run db:migrate -- --reset   DROP the app tables, then re-apply (dev)
 *
 * Rules the runner enforces:
 *   - one transaction per file, so a half-applied migration cannot exist;
 *   - a Postgres advisory lock, so two runners (or a runner and a booting
 *     server) cannot apply the same file twice;
 *   - a checksum per file, so editing an already-applied migration is an
 *     error instead of a silent divergence between machines.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
// Arbitrary but fixed: any int identifies this lock across processes. Nothing
// derives it — it just has to be the same number in every runner.
const LOCK_KEY = 728411953

const sha256 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16)

export function readMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
      return { name, sql, checksum: sha256(sql) }
    })
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

/**
 * Applies every pending migration. Returns the names applied this run.
 * Safe to call on a database that is already up to date (returns []).
 */
export async function migrate(databaseUrl, { log = console.log } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  const applied = []
  try {
    await ensureTable(client)
    // Serialise runners. Released automatically when the session ends, so a
    // crashed runner cannot wedge the lock.
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations')
    const seen = new Map(rows.map((r) => [r.name, r.checksum]))

    for (const m of readMigrations()) {
      const previous = seen.get(m.name)
      if (previous) {
        if (previous !== m.checksum) {
          throw new Error(
            `migration ${m.name} was edited after it was applied ` +
              `(recorded ${previous}, file ${m.checksum}). Write a NEW migration instead.`,
          )
        }
        continue
      }
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          m.name,
          m.checksum,
        ])
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${m.name} failed: ${err.message}`, { cause: err })
      }
      applied.push(m.name)
      log(`[migrate] applied ${m.name}`)
    }
    if (!applied.length) log('[migrate] up to date')
  } finally {
    await client.end()
  }
  return applied
}

export async function status(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await ensureTable(client)
    const { rows } = await client.query('SELECT name FROM schema_migrations')
    const seen = new Set(rows.map((r) => r.name))
    return readMigrations().map((m) => ({ name: m.name, applied: seen.has(m.name) }))
  } finally {
    await client.end()
  }
}

/** Dev only: drop everything this project owns so migrations re-run clean. */
export async function reset(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('DROP TABLE IF EXISTS player_state, players, schema_migrations CASCADE')
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[migrate] DATABASE_URL is not set. Copy .env.example to .env first.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  try {
    if (args.includes('--status')) {
      for (const m of await status(url)) console.log(`${m.applied ? 'applied' : 'PENDING'}  ${m.name}`)
    } else {
      if (args.includes('--reset')) {
        await reset(url)
        console.log('[migrate] dropped players, player_state, schema_migrations')
      }
      await migrate(url)
    }
  } catch (err) {
    console.error('[migrate]', err.message)
    process.exit(1)
  }
}
