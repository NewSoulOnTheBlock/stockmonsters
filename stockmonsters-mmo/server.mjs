/*
 * Production MMO server.
 *
 *   RPG_TYPE=mmorpg npx vite build   # -> dist/client + dist/server/server.js
 *   node server.mjs                  # serves the client and hosts the rooms
 *
 * One Node process does everything: static client files, the RPGJS room
 * transport under /parties (same-origin, so the client needs no host config),
 * WebSocket upgrades, room persistence in data/rooms.sqlite, and player
 * profiles in Postgres.
 *
 * Two DIFFERENT kinds of persistence live here, and confusing them wastes an
 * afternoon:
 *   - data/rooms.sqlite is the ROOM's storage, keyed by the ephemeral
 *     transport connection id. It survives a restart but not a page reload,
 *     because the id is thrown away on purpose (see HANDOVER).
 *   - Postgres holds the PLAYER's profile, keyed by the wallet id from
 *     auth.mjs. That is the one that follows a person across reloads and
 *     devices. profiles.mjs owns it.
 */
import http from 'node:http'
import { createRequire } from 'node:module'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { createRpgServerTransport, createSqliteNodeRoomStorage } from '@rpgjs/server/node'
import serverModule from './dist/server/server.js'
import { handleAuth } from './auth.mjs'
import { createProfileStore } from './profiles.mjs'
import { createBoxStore, handleBoxRoutes } from './lootbox.mjs'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIR = resolve('./dist/client')
const DATA_DIR = resolve('./data')
mkdirSync(DATA_DIR, { recursive: true })

/*
 * The bridge to the game code.
 *
 * src/modules/main/** is compiled into the CLIENT bundle as well as the server
 * one, so it cannot import `pg` — a `node:fs` import in player.ts once broke
 * the whole browser build. Instead the Node process hangs the store on a
 * global and src/modules/main/profile.ts picks it up if it is there, falling
 * back to a no-op otherwise. Nothing about the database crosses the boundary:
 * the client bundle contains neither the driver nor the connection string.
 */
const profiles = createProfileStore()
globalThis.__smProfiles = profiles
console.log(
  profiles.enabled
    ? '[profiles] Postgres profile store active'
    : '[profiles] no DATABASE_URL — player state is session-only',
)

/*
 * Sealed loot boxes (/box/*). Separate store from `profiles` on purpose: a
 * profile write that fails costs a few seconds of play, a box write that fails
 * costs an NFT, so lootbox.mjs aborts rather than degrading. It sells nothing
 * unless BOX_SIGNER_PK and BOX_NFT_ADDRESS are set — /box/quote still answers.
 */
const boxes = createBoxStore()
console.log(
  boxes.enabled
    ? `[boxes] selling sealed boxes on chain ${boxes.chainId} via ${boxes.contract} (signer ${boxes.signer})`
    : '[boxes] not configured — /box/quote answers, /box/voucher refuses',
)

const { WebSocketServer } = createRequire(import.meta.url)('ws')

const transport = createRpgServerTransport(serverModule.default ?? serverModule, {
  initializeMaps: true,
  tiledBasePaths: [resolve('./src/tiled')],
  storage: createSqliteNodeRoomStorage({ databasePath: join(DATA_DIR, 'rooms.sqlite') }),
})
const wss = new WebSocketServer({ noServer: true })

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.tmx': 'application/xml',
  '.tsx': 'application/xml', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x')
  let file = normalize(join(CLIENT_DIR, decodeURIComponent(url.pathname)))
  if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403).end(); return }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIR, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  try {
    // Deliberately says nothing a client could use: no connection string, no
    // wallet ids. Enough to answer "is the database wired up?" from a deploy.
    if (req.url === '/health') {
      const { enabled, healthy, loads, writes, writeErrors, nameConflicts, cached } = profiles.stats()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        profiles: { enabled, healthy, loads, writes, writeErrors, nameConflicts, cached },
      }))
      return
    }
    if (await handleAuth(req, res)) return
    if (await handleBoxRoutes(req, res, boxes)) return
    const handled = await transport.handleNodeRequest(req, res, undefined, { mountedPath: '/parties' })
    if (handled) return
    serveStatic(req, res)
  } catch (err) {
    console.error('[server]', err)
    if (!res.headersSent) res.writeHead(500)
    res.end('server error')
  }
})
server.on('upgrade', (request, socket, head) => {
  transport.handleUpgrade(wss, request, socket, head).catch((err) => {
    console.error('[upgrade]', err)
    socket.destroy()
  })
})
server.listen(PORT, () => console.log(`Stockmonsters MMO on http://localhost:${PORT}`))

// Writes are batched, so a kill between flushes would drop the last second or
// two of play. Drain first, then exit.
let closing = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) process.exit(1) // second Ctrl-C means "now"
    closing = true
    console.log(`\n[server] ${signal} — flushing player profiles`)
    Promise.allSettled([profiles.close(), boxes.close()]).finally(() => {
      server.close(() => process.exit(0))
      // Open websockets keep server.close() pending forever.
      setTimeout(() => process.exit(0), 1500).unref()
    })
  })
}
