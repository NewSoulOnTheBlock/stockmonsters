/*
 * Production MMO server.
 *
 *   RPG_TYPE=mmorpg npx vite build   # -> dist/client + dist/server/server.js
 *   node server.mjs                  # serves the client and hosts the rooms
 *
 * One Node process does everything: static client files, the RPGJS room
 * transport under /parties (same-origin, so the client needs no host config),
 * WebSocket upgrades, and SQLite persistence in data/rooms.sqlite.
 */
import http from 'node:http'
import { createRequire } from 'node:module'
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { createRpgServerTransport, createSqliteNodeRoomStorage } from '@rpgjs/server/node'
import serverModule from './dist/server/server.js'
import { handleAuth } from './auth.mjs'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIR = resolve('./dist/client')
const DATA_DIR = resolve('./data')
mkdirSync(DATA_DIR, { recursive: true })

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
    if (await handleAuth(req, res)) return
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
