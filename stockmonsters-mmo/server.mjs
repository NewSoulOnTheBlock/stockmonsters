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
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { createRpgServerTransport, createSqliteNodeRoomStorage } from '@rpgjs/server/node'
import serverModule from './dist/server/server.js'
import { handleAuth } from './auth.mjs'
import { createProfileStore } from './profiles.mjs'
import { createBoxStore, handleBoxRoutes } from './lootbox.mjs'
import { createTokenStore, handleTokenRoutes } from './token.mjs'
import { createMarketStore, handleMarketRoutes } from './market.mjs'
import { handleDiagRoutes } from './diag.mjs'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIR = resolve('./dist/client')
const DATA_DIR = resolve('./data')
mkdirSync(DATA_DIR, { recursive: true })

/*
 * START WITH EMPTY ROOMS.
 *
 * The room store keeps every player it has ever seen, keyed by the ephemeral
 * transport id. Nothing ever removes them, so a restarted server resurrects
 * the ghosts of old sessions: characters standing on the dock with names of
 * people who are not connected, walking into the live ones. Worse, a large
 * stale file has frozen movement outright (HANDOVER: an 18MB rooms.sqlite made
 * the player unable to move at all, and cost a whole debugging session).
 *
 * Nothing of value is in here: it is room runtime state keyed by an id that is
 * deliberately thrown away on every page load. Everything that must survive —
 * character, name, party, box, visited maps, friends — lives in Postgres.
 *
 * Set SM_KEEP_ROOMS=1 to keep it when debugging the transport itself.
 */
if (process.env.SM_KEEP_ROOMS !== '1') {
  for (const name of ['rooms.sqlite', 'rooms.sqlite-shm', 'rooms.sqlite-wal']) {
    rmSync(join(DATA_DIR, name), { force: true })
  }
}

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
// The duel flow needs to turn a token id into the creature it holds, and
// src/modules/** cannot import this file (it is bundled into the browser).
globalThis.__smBoxes = boxes
console.log(
  boxes.enabled
    ? `[boxes] selling sealed boxes on chain ${boxes.chainId} via ${boxes.contract} (signer ${boxes.signer})`
    : '[boxes] not configured — /box/quote answers, /box/voucher refuses',
)

/*
 * The game currency. One address in .env (SM_TOKEN_ADDRESS) switches it on;
 * everything else — name, symbol, decimals, logo — is read off the token,
 * which describes itself on chain. Unset means the game runs exactly as it did
 * before there was a token, and says so.
 */
const tokens = createTokenStore()
globalThis.__smTokens = tokens
// Prime the metadata cache before anyone plays: `decimalsSync()` is what the
// reward ledger multiplies by, and a wrong guess there is a 10^12 error in
// what a player is owed.
if (tokens.enabled) {
  tokens
    .metadata()
    .then((m) => console.log(`[token] ${m.name} (${m.symbol}), ${m.decimals} decimals`))
    .catch((err) => console.warn(`[token] could not read the token (${err.message}) — currency hidden`))
}

/*
 * The player-to-player marketplace (/market/*). An INDEX of signed orders,
 * nothing more: it holds no custody, holds no key that could move an NFT, and
 * signs nothing on a seller's behalf. Losing the whole table costs the index
 * and no assets — which is why, unlike the box store, it is allowed to degrade
 * quietly. Without SM_MARKET_ADDRESS the routes answer { configured: false }
 * and the game falls back to its demo catalogue, saying DEMO MODE on screen.
 *
 * The indexer is the part that must not be forgotten: a filled order left in
 * the book makes every subsequent buyer pay gas to revert, so it runs on a
 * timer rather than only when somebody opens the window.
 */
const marketplace = createMarketStore()
globalThis.__smMarket = marketplace
if (marketplace.enabled) {
  marketplace.startIndexer()
  console.log(`[market] indexing ${marketplace.market} on chain ${marketplace.chainId}`)
}

/*
 * Two chain ids are configured independently — BOX_CHAIN_ID signs NFT
 * vouchers, SM_CHAIN_ID signs wagers and reward claims — and nothing forced
 * them to agree. They must: the wallet can only be on one chain, and the
 * client is now told to switch to SM_CHAIN_ID. If they disagree, every box
 * voucher is signed for a chain the player was just moved off, and the mint
 * reverts with a signature error that blames the signature.
 *
 * A warning rather than a refusal: a server that will not boot is worse than
 * one that says exactly what is wrong, and the box store may legitimately be
 * unconfigured.
 */
if (boxes.enabled && tokens.chainInfo().chainId && boxes.chainId !== tokens.chainInfo().chainId) {
  console.warn(
    `[chain] BOX_CHAIN_ID=${boxes.chainId} but SM_CHAIN_ID=${tokens.chainInfo().chainId}. `
    + 'The client switches wallets to SM_CHAIN_ID, so box vouchers will be signed for a chain '
    + 'nobody is on. Set them to the same value.',
  )
} else if (boxes.enabled) {
  console.log(`[chain] everything signs for ${tokens.chainInfo().name} (${boxes.chainId})`)
}

const { WebSocketServer } = createRequire(import.meta.url)('ws')

/*
 * The server parses the TMX itself (it streams map chunks rather than serving
 * raw TMX), so it has to read the SAME maps the client's atlases came from.
 * src/tiled/compact is tools/compact-atlases.mjs's output — per-map atlases
 * holding only the tiles that map draws, which is what keeps an iPhone tab
 * alive. The first path that has the file wins, so an absent compact/ falls
 * back to the source art exactly as vite.config.ts does.
 */
const transport = createRpgServerTransport(serverModule.default ?? serverModule, {
  initializeMaps: true,
  tiledBasePaths: [resolve('./src/tiled/compact'), resolve('./src/tiled')],
  storage: createSqliteNodeRoomStorage({ databasePath: join(DATA_DIR, 'rooms.sqlite') }),
})
const wss = new WebSocketServer({ noServer: true })

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json', '.tmx': 'application/xml',
  '.tsx': 'application/xml', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
}

/*
 * A MISSING ASSET MUST 404, NOT BECOME THE HOME PAGE.
 *
 * This used to answer every unknown path with index.html and a 200 — the
 * single-page-app fallback, applied to everything. So when a build left the map
 * directory holding one set of files while the served maps referenced another,
 * `/map/TECH-Buildings.png` came back as `<!DOCTYPE html>` with a 200, the
 * browser could not decode it as an image, and the world rendered as a black
 * rectangle with nothing in the console to say why. A 404 would have named the
 * problem in one glance.
 *
 * The fallback is still right for NAVIGATION — a player deep-linking to a route
 * the client owns must get the app — so it is kept for requests that ask for
 * HTML, and only those.
 */
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x')
  const file = normalize(join(CLIENT_DIR, decodeURIComponent(url.pathname)))
  if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403).end(); return }

  const missing = !existsSync(file) || statSync(file).isDirectory()
  if (missing) {
    /*
     * AN EXTENSION DECIDES THIS, NOT A HEADER.
     *
     * A path ending in .png/.js/.tsx names a FILE, and a missing one must 404
     * so a broken build is loud instead of handing back HTML that a browser
     * then fails to decode as an image. Anything else — `/`, a deep link into
     * a client route — is navigation and gets the app.
     *
     * The first version of this asked the Accept header instead, which is
     * true of browsers and false of everything else: curl, uptime checks and
     * link previews all got a 404 on the front page. Whether a request is for
     * an asset is a property of the URL, not of who is asking.
     */
    const looksLikeAFile = /\.[a-z0-9]{2,5}$/i.test(url.pathname)
    if (looksLikeAFile) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found\n')
      return
    }
    const index = join(CLIENT_DIR, 'index.html')
    res.writeHead(200, { 'Content-Type': 'text/html' })
    createReadStream(index).pipe(res)
    return
  }

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
    if (await handleTokenRoutes(req, res, tokens, profiles)) return
    if (await handleMarketRoutes(req, res, marketplace)) return
    if (await handleDiagRoutes(req, res)) return
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
    Promise.allSettled([profiles.close(), boxes.close(), marketplace.close()]).finally(() => {
      server.close(() => process.exit(0))
      // Open websockets keep server.close() pending forever.
      setTimeout(() => process.exit(0), 1500).unref()
    })
  })
}
