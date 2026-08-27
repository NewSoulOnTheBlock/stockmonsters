/*
 * diag.mjs — POST /client-error, so a failure on a player's phone reaches the
 * journal instead of dying in their browser.
 *
 *   journalctl -u stockmonsters-mmo -f | grep client
 *
 * Mounted in BOTH server.mjs and vite.config.ts. Vite knows nothing about
 * server.mjs, and a route added to only one of them works in exactly one
 * environment.
 *
 * ## The rules this follows
 *
 * It stores nothing and identifies nobody: a message, a source line, a user
 * agent, a viewport. No address, no wallet, no name — a debugging aid must not
 * quietly become a tracking endpoint.
 *
 * It is also a PUBLIC, unauthenticated write path, which is a thing to be
 * careful with. The body is capped before it is read, the rate is capped per
 * address, and everything is truncated on the way to the log. Nothing here can
 * grow without bound.
 */

const MAX_BODY = 4 * 1024
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
/** Bounded so a stream of unique addresses cannot grow this map forever. */
const MAX_TRACKED = 500

const hits = new Map()

function allowed(key) {
  const now = Date.now()
  if (hits.size > MAX_TRACKED) {
    for (const [k, v] of hits) if (now - v.first > WINDOW_MS) hits.delete(k)
    if (hits.size > MAX_TRACKED) return false
  }
  const entry = hits.get(key)
  if (!entry || now - entry.first > WINDOW_MS) {
    hits.set(key, { first: now, count: 1 })
    return true
  }
  entry.count++
  return entry.count <= MAX_PER_WINDOW
}

const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, n) : '')

/**
 * @returns true when the request was handled, so the caller stops.
 */
export async function handleDiagRoutes(req, res, log = console) {
  if (!req.url || !req.url.startsWith('/client-error')) return false
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' }).end('{"error":"method"}')
    return true
  }

  // Behind Caddy every request comes from the loopback, so the forwarded
  // header is the only thing that distinguishes one phone from another. It is
  // spoofable, which is fine: this is a rate limit, not an access control.
  const who = clip(req.headers['x-forwarded-for'], 45) || req.socket?.remoteAddress || 'unknown'
  if (!allowed(who)) {
    res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"error":"slow-down"}')
    return true
  }

  let size = 0
  const chunks = []
  try {
    for await (const chunk of req) {
      size += chunk.length
      // Stop READING rather than buffering and rejecting afterwards: a client
      // that streams megabytes should not get to allocate them here first.
      if (size > MAX_BODY) {
        res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"too-big"}')
        req.destroy()
        return true
      }
      chunks.push(chunk)
    }
  } catch {
    res.writeHead(400).end()
    return true
  }

  let body = {}
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    /* an unparseable report is still worth one line */
  }

  log.warn?.(
    `[client] ${clip(body.kind, 24) || 'unknown'} — ${clip(body.message, 300)}` +
    ` | at ${clip(body.at, 80)} | ${clip(body.screen, 16)} | up ${Number(body.up) || 0}s` +
    ` | ${clip(body.ua, 160)}`,
  )

  res.writeHead(204).end()
  return true
}
