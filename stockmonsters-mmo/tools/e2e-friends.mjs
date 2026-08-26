/*
 * End-to-end proof of the friends feature, driven the way a player drives it:
 * two real browsers, two real wallet signatures, real clicks on real buttons.
 *
 *   docker compose up -d && npm run db:migrate
 *   RPG_TYPE=mmorpg npx vite build
 *   npm run test:e2e:friends
 *
 * WHY IT IS SHAPED LIKE THIS
 * Unit tests can only prove the SERVER agrees with itself. Every bug this
 * project has actually shipped was a panel that never mounted, a button wired
 * to nothing, or an endpoint the running server did not have — none of which a
 * green test suite notices. So this walks the whole journey:
 *
 *   both players sign in and enter the world
 *   ALICE WALKS AWAY until the two are nowhere near each other
 *   a DM is refused, in words, because they are strangers standing apart
 *   Alice types Bob's name into the panel and presses ADD
 *   ...Bob's panel shows the request, and NOTHING has happened yet
 *   Bob presses ACCEPT
 *   ...the pair is one row in Postgres, and each sees the other as online
 *   Alice presses MESSAGE and sends a line from across the map
 *   ...it appears in Bob's window
 *   Alice's tab closes
 *   ...Bob's row goes offline
 *
 * Everything it asserts is printed, pass or fail. Exit code 0 means every line
 * said PASS.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount } from 'viem/accounts'
import pg from 'pg'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.E2E_PORT ?? 4161)
const BASE = `http://localhost:${PORT}`
const ROOT = resolve(process.cwd())
const SERVER_SECRET = process.env.E2E_SERVER_SECRET ?? randomBytes(32).toString('hex')

// anvil accounts #0 and #1 — well-known test keys, never used for anything real.
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
]
const NAMES = ['Alice' + randomBytes(2).toString('hex'), 'Bob' + randomBytes(2).toString('hex')]
const CHARACTERS = [['ch-cat-01-2'], ['ch-dog-01-1']]

/** Far enough apart that dm.ts refuses on distance (NEAR_PX is 64). */
/*
 * Past dm.ts's NEAR_PX (64) with room to spare, but not by much on purpose:
 * the spawn is a narrow dock and the walk runs out of open tiles long before
 * it runs out of presses. The proof that they are "apart" is not this number
 * anyway — it is the server refusing the message in the step below.
 */
const FAR_PX = 80

/* ----------------------------------------------------------- reporting ---*/
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const step = (s) => console.log(`\n=== ${s} ===`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(label, fn, { timeout = 25000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(interval)
  }
}

/* ------------------------------------------------------------- fixtures --*/

async function startServer(env) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  child.stdout.on('data', (c) => { log.push(String(c)); if (process.env.E2E_VERBOSE) process.stdout.write(`[server] ${c}`) })
  child.stderr.on('data', (c) => { log.push(String(c)); if (process.env.E2E_VERBOSE) process.stdout.write(`[server] ${c}`) })
  child.on('exit', (code) => { if (code) console.error(`[server] exited early with ${code}\n${log.join('')}`) })
  await until('the server to listen', async () => {
    try { return (await fetch(`${BASE}/health`)).ok } catch { return false }
  })
  return { child, log }
}

/** Real signature flow — the same one the title screen performs. */
async function signIn(account) {
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })
  if (!res.ok) throw new Error(`auth/verify failed: ${res.status} ${await res.text()}`)
  return res.json()
}

/* ---------------------------------------------------- in-page primitives --*/

const READ = `(() => {
  const engine = window.__engine
  if (!engine) return null
  const scene = typeof engine.sceneMap === 'function' ? engine.sceneMap() : engine.sceneMap
  const p = scene && scene.getCurrentPlayer && scene.getCurrentPlayer()
  if (!p) return null
  const read = (v) => { try { return typeof v === 'function' ? v() : v } catch { return undefined } }
  const graphics = read(p.graphics)
  const ids = (Array.isArray(graphics) ? graphics : [graphics])
    .map((g) => (typeof g === 'string' ? g : g && (g.id || g.graphic || g.name)))
    .filter(Boolean)
  return { name: read(p.name), graphics: ids, x: read(p.x), y: read(p.y) }
})()`

const readPlayer = (page) => page.evaluate(READ)

const waitForPlayer = (page, label) =>
  until(label, async () => {
    const p = await readPlayer(page).catch(() => null)
    return p && p.graphics.length ? p : null
  })

/** Text of the friends panel, as the player reads it. */
const panelText = (page) =>
  page.evaluate(() => document.querySelector('#sm-friends .fr-panel')?.textContent ?? '')

/** One row per friend/request, with its buttons — the real DOM, not a model. */
const panelRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#sm-friends .fr-row')].map((r) => ({
      text: r.querySelector('.nm')?.textContent ?? '',
      offline: r.classList.contains('is-off'),
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent ?? ''),
    })))

/** Click the button whose label matches, inside a row naming `who`. */
const clickRowButton = (page, who, label) =>
  page.evaluate((who, label) => {
    for (const row of document.querySelectorAll('#sm-friends .fr-row')) {
      if (!row.querySelector('.nm')?.textContent?.includes(who)) continue
      for (const btn of row.querySelectorAll('button')) {
        if (btn.textContent?.trim() === label) { btn.click(); return true }
      }
    }
    return false
  }, who, label)

const dmLog = (page) =>
  page.evaluate(() => document.querySelector('#sm-dm .dm-log')?.textContent ?? '')

const toastText = (page) =>
  page.evaluate(() => {
    const dm = document.querySelector('#sm-dm-toast')?.textContent ?? ''
    const fr = document.querySelector('#sm-friends-toast')?.textContent ?? ''
    return dm + ' | ' + fr
  })

/** Walk with the arrow keys until we are at least `distance` from where we began. */
async function walkAway(page, distance) {
  // The engine reads keys off the window, but only while the page believes it
  // is being used: click the canvas first so the game — not a panel button —
  // owns the keyboard.
  await page.evaluate(() => {
    document.activeElement?.blur?.()
    document.querySelector('canvas')?.focus?.()
  })
  await page.click('canvas').catch(() => {})
  const start = await readPlayer(page)
  const trail = []
  // Held down, not tapped: the engine samples input per frame, so a short tap
  // can land entirely between two samples and move nobody.
  //
  // ONE DIRECTION, THEN A PERPENDICULAR ONE. Walking left and then right ends
  // up back where it started — the first version of this walked all four
  // directions and finished 60px from the spawn, which is INSIDE dm.ts's
  // 64px "next to each other" and quietly made the refusal test meaningless.
  // Alternating two PERPENDICULAR directions: neither undoes the other, and
  // switching axis routes around the dock's walls, which block a single
  // direction after a few tiles.
  for (let i = 0; i < 20; i++) {
    const key = i % 2 ? 'ArrowDown' : 'ArrowLeft'
    await page.keyboard.down(key)
    await sleep(900)
    await page.keyboard.up(key)
    await sleep(120)
    const now = await readPlayer(page)
    const d = Math.hypot((now?.x ?? 0) - start.x, (now?.y ?? 0) - start.y)
    trail.push(`${key}:${Math.round(now?.x ?? -1)},${Math.round(now?.y ?? -1)}`)
    if (d >= distance) return { d, from: start, to: now, trail }
  }
  const end = await readPlayer(page)
  return { d: Math.hypot(end.x - start.x, end.y - start.y), from: start, to: end, trail }
}

/* ------------------------------------------------------------------ main --*/

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set — copy .env.example to .env and run docker compose up -d')
  process.exit(1)
}
if (!existsSync(join(ROOT, 'dist/client/index.html'))) {
  console.error('dist/client is missing — run: RPG_TYPE=mmorpg npx vite build')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}`)
  process.exit(1)
}

const accounts = KEYS.map((k) => privateKeyToAccount(k))
const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()

const profileDirs = [mkdtempSync(join(tmpdir(), 'sm-e2e-a-')), mkdtempSync(join(tmpdir(), 'sm-e2e-b-'))]
let server
const browsers = []

try {
  step('boot')
  server = await startServer({
    PORT: String(PORT),
    SERVER_SECRET,
    DATABASE_URL,
    PROFILE_FLUSH_MS: '250',
  })
  const health = await (await fetch(`${BASE}/health`)).json()
  check('the server has a healthy profile store', health.profiles.enabled && health.profiles.healthy,
    JSON.stringify(health.profiles))

  const wallets = []
  for (const account of accounts) {
    const w = await signIn(account)
    wallets.push(w)
    await db.query('DELETE FROM players WHERE wallet_id = $1', [w.connectionId])
  }
  // Every database assertion below is scoped to THESE two wallets: the tables
  // are shared with the unit tests, and an unscoped count would be measuring
  // whatever else has ever run against this database.
  const ids = wallets.map((w) => w.connectionId)
  check('both wallets signed in and hold opaque ids',
    wallets.every((w) => /^w:[0-9a-f]{32}$/.test(w.connectionId)),
    wallets.map((w) => w.connectionId).join(' '))

  /* --- two independent browsers, so nothing is shared between them ------ */
  const pages = []
  for (let i = 0; i < 2; i++) {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      userDataDir: profileDirs[i],
      args: ['--window-size=1280,900', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
    })
    browsers.push(browser)
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log(`  [page ${i} error] ${e.message}`))
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.evaluate((w, c, n) => {
      localStorage.setItem('sm-wallet', JSON.stringify(w))
      localStorage.setItem('sm-character', JSON.stringify(c))
      localStorage.setItem('sm-name', n)
    }, wallets[i], CHARACTERS[i], NAMES[i])
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForPlayer(page, `player ${i} to reach the map`)
    // The title screen sits on top until PLAY GAME; the world is already
    // running behind it, which is what this test is about.
    await page.evaluate(() => document.getElementById('title-screen')?.remove())
    await page.evaluate((n) => window.__engine.processAction('name:set', { name: n }), NAMES[i])
    await until(`player ${i} to be named`, async () => (await readPlayer(page))?.name === NAMES[i])
    pages.push(page)
  }
  const [alice, bob] = pages
  check('both players are in the world with their own names and characters', true, NAMES.join(' & '))

  step('the panel is actually there')
  const tabPresent = await alice.evaluate(() => !!document.querySelector('#sm-friends .fr-tab'))
  check('the friends tab is mounted on the left edge', tabPresent)
  await alice.click('#sm-friends .fr-tab')
  await bob.click('#sm-friends .fr-tab')
  const emptyText = await panelText(alice)
  check('an empty list says what to do rather than showing nothing',
    /Nobody yet/i.test(emptyText))
  check('the panel does NOT claim to be session-only against a real database',
    !/no database/i.test(emptyText))

  step('Alice walks away, so nothing that follows can be explained by proximity')
  const walked = await walkAway(alice, FAR_PX)
  check(`Alice is more than ${FAR_PX}px away — past the 64px the DM rule allows`,
    walked.d >= FAR_PX, `moved ${Math.round(walked.d)}px  [${walked.trail.join(' ')}]`)

  step('before any friendship: a DM across that distance is refused')
  const bobId = await bob.evaluate(() => {
    const engine = window.__engine
    const scene = typeof engine.sceneMap === 'function' ? engine.sceneMap() : engine.sceneMap
    const p = scene.getCurrentPlayer()
    return String(typeof p.id === 'function' ? p.id() : p.id)
  })
  await alice.evaluate((id) => window.__engine.processAction('dm:send', { to: id, text: 'strangers cannot talk' }), bobId)
  await sleep(1200)
  check('Bob received nothing', !/strangers cannot talk/.test(await dmLog(bob)))
  const refusal = (await toastText(alice)) + (await dmLog(alice))
  check('Alice is told to stand next to him or add him as a friend',
    /add them as a friend/i.test(refusal), refusal.trim().slice(0, 120))

  step('Alice adds Bob by name')
  await alice.type('#sm-friends .fr-add input', NAMES[1])
  const typed = await alice.evaluate(() => document.querySelector('#sm-friends .fr-add input')?.value ?? '')
  check('the typed name survives whatever the server pushed meanwhile',
    typed === NAMES[1], `field held "${typed}"`)
  await alice.click('#sm-friends .fr-add .smui-btn')

  const bobRows = await until('the request to reach Bob', async () => {
    const rows = await panelRows(bob)
    return rows.some((r) => r.text.includes(NAMES[0]) && r.buttons.includes('ACCEPT')) ? rows : null
  })
  check('Bob sees the request, with ACCEPT and DECLINE',
    bobRows.some((r) => r.text.includes(NAMES[0]) && r.buttons.includes('ACCEPT') && r.buttons.includes('DECLINE')))
  const pending = await db.query(
    'SELECT 1 FROM friend_requests WHERE from_wallet = $1 AND to_wallet = $2',
    [wallets[0].connectionId, wallets[1].connectionId])
  check('Postgres holds the pending request', pending.rowCount === 1)
  const noFriendYet = await db.query(
    'SELECT 1 FROM friendships WHERE wallet_lo = ANY($1) AND wallet_hi = ANY($1)', [ids])
  check('and NOBODY is friends yet — the ask alone changes nothing',
    noFriendYet.rowCount === 0, `${noFriendYet.rowCount} rows`)
  const aliceWaiting = await panelRows(alice)
  check('Alice sees her request as waiting, not as a friend',
    aliceWaiting.some((r) => r.text.includes(NAMES[1]) && r.buttons.includes('CANCEL')))

  step('Bob accepts')
  check('the ACCEPT button was clickable', await clickRowButton(bob, NAMES[0], 'ACCEPT'))

  const pair = await until('the friendship to be written', async () => {
    const { rows } = await db.query(
      'SELECT wallet_lo, wallet_hi FROM friendships WHERE wallet_lo = ANY($1) AND wallet_hi = ANY($1)', [ids])
    return rows.length ? rows : null
  })
  check('Postgres holds exactly one row for the pair', pair.length === 1, JSON.stringify(pair[0]))
  check('...in canonical order, which is what makes a duplicate impossible',
    pair[0].wallet_lo < pair[0].wallet_hi)
  const gone = await db.query(
    'SELECT 1 FROM friend_requests WHERE from_wallet = ANY($1) OR to_wallet = ANY($1)', [ids])
  check('the request was consumed, not left behind', gone.rowCount === 0)

  const aliceFriendRow = await until('Alice to see Bob as a friend', async () => {
    const rows = await panelRows(alice)
    return rows.find((r) => r.text.includes(NAMES[1]) && r.buttons.includes('MESSAGE')) ?? null
  })
  check('Alice sees Bob online, with a MESSAGE button', !aliceFriendRow.offline)
  const bobFriendRow = (await panelRows(bob)).find((r) => r.text.includes(NAMES[0]))
  check('Bob sees Alice in his list too', !!bobFriendRow && !bobFriendRow.offline)

  step('the point of all this: a message from across the map')
  await clickRowButton(alice, NAMES[1], 'MESSAGE')
  await alice.waitForSelector('#sm-dm.open', { timeout: 5000 })
  check('the DM window opened on Bob', true)
  const noted = await dmLog(alice)
  check('it says why distance no longer applies', /friends, so you can talk from anywhere/i.test(noted),
    noted.trim().slice(0, 100))

  const LINE = 'meet me at the dock ' + randomBytes(2).toString('hex')
  await alice.type('#sm-dm .dm-row input', LINE)
  await alice.click('#sm-dm .dm-row .smui-btn')

  const delivered = await until('Bob to receive it', async () => {
    const log = await dmLog(bob)
    return log.includes(LINE) ? log : null
  }, { timeout: 12000 }).catch(async () => {
    // Print what each side actually saw — a bare timeout says nothing about
    // whether the send was refused, dropped, or delivered somewhere else.
    console.log(`  [alice's window] ${(await dmLog(alice)).trim().slice(0, 300)}`)
    console.log(`  [bob's window]   ${(await dmLog(bob)).trim().slice(0, 300)}`)
    return ''
  })
  check('Bob got the message while standing far away', !!delivered)
  check('and it is attributed to Alice', delivered.includes(NAMES[0]))
  const dmWindow = await bob.evaluate(() => document.querySelector('#sm-dm')?.textContent ?? '')
  check('the window still says nothing is saved', /Nothing here is saved/i.test(dmWindow))

  const stillApart = await Promise.all(pages.map(readPlayer))
  const gap = Math.hypot(stillApart[0].x - stillApart[1].x, stillApart[0].y - stillApart[1].y)
  check('the two were further apart than the 64px proximity rule allows',
    gap > 64, `${Math.round(gap)}px apart`)

  step('Alice leaves')
  // Closing the browser, not navigating away: Chrome keeps a navigated-away
  // page (and its websocket) alive in the back/forward cache, so about:blank
  // does not actually end the session — the server sees the socket close only
  // when the browser goes. Closing the tab is what a player does anyway.
  await browsers[0].close()
  browsers[0] = null
  const offline = await until('Bob to see her go offline', async () => {
    const rows = await panelRows(bob)
    const row = rows.find((r) => r.text.includes(NAMES[0]))
    return row?.offline ? row : null
  }, { timeout: 30000 })
  check('Bob sees Alice offline, with no MESSAGE button', !offline.buttons.includes('MESSAGE'))
  check('and she is still his friend — leaving is not un-friending',
    (await db.query(
      'SELECT 1 FROM friendships WHERE wallet_lo = ANY($1) AND wallet_hi = ANY($1)', [ids])).rowCount === 1)

  step('the friendship outlives the session')
  await bob.reload({ waitUntil: 'domcontentloaded' })
  await waitForPlayer(bob, 'Bob to come back')
  await bob.evaluate(() => document.getElementById('title-screen')?.remove())
  await bob.click('#sm-friends .fr-tab')
  const afterReload = await until('the list to come back from the database', async () => {
    const rows = await panelRows(bob)
    return rows.find((r) => r.text.includes(NAMES[0])) ?? null
  })
  check('Bob still has Alice after a full reload', !!afterReload)
} catch (err) {
  failures++
  console.error('\n  FAIL  the run threw:', err?.stack ?? err)
} finally {
  for (const b of browsers) { try { await b?.close() } catch { /* already gone */ } }
  try { server?.child.kill('SIGTERM') } catch { /* not running */ }
  await db.end().catch(() => {})
  for (const d of profileDirs) rmSync(d, { recursive: true, force: true })
}

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`)
process.exit(failures ? 1 : 0)
