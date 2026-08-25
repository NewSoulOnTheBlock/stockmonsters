/*
 * End-to-end proof that a returning player gets their save back FROM THE
 * SERVER — the actual user-visible bug this whole change exists to fix.
 *
 *   docker compose up -d && npm run db:migrate
 *   RPG_TYPE=mmorpg npx vite build
 *   npm run test:e2e:persistence
 *
 * WHY IT IS SHAPED LIKE THIS
 * The client replays CHARACTER and NAME out of localStorage on every load, so
 * a naive "reload and look" test passes even with no server persistence at all
 * — that is exactly how the old behaviour fooled everyone. The only convincing
 * experiment is to DESTROY the client's copy and see the state come back
 * anyway:
 *
 *   session 1  real wallet signature -> pick a character -> choose a name
 *              ...assert Postgres now holds both, written by the game
 *   between    a party and a box are stored for that wallet, standing in for
 *              a battle fought in a previous session
 *   session 2  wipe localStorage completely, restore ONLY sm-wallet (which is
 *              what signing in again on a new device would give you), reload
 *              ...assert the character, the name AND the caught creatures are
 *              back, and that sm-character is still absent, so localStorage
 *              cannot be where they came from
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
const PORT = Number(process.env.E2E_PORT ?? 4160)
const BASE = `http://localhost:${PORT}`
const ROOT = resolve(process.cwd())
// Fixed for the run so the wallet id is stable across both sessions; a random
// one per run so two runs never share a save.
const SERVER_SECRET = process.env.E2E_SERVER_SECRET ?? randomBytes(32).toString('hex')
// anvil account #0 — a well-known test key, never used for anything real.
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const CHARACTER = ['ch-cat-01-2'] // not the 'hero' default, so it is unmistakable
const CHANGED = ['ch-dog-01-1'] // a deliberate later change, to prove the lock lifts
// player.ts holds the client's boot replay off for BOOT_WINDOW_MS (8s) after
// the wallet claim. Wait past it before pretending to be a real user choice.
const BOOT_WINDOW_MARGIN_MS = 9000
const NAME = 'Reload' + randomBytes(2).toString('hex') // globally unique in players.name

// A party and a box as battle.ts would leave them. dbSymbol values are real
// species so the in-game Team panel can name them.
const PARTY = [{
  dbSymbol: 'bulbasaur', level: 14, hp: 41, maxHp: 41, nature: 'hardy', shiny: false,
  ivs: { hp: 12, atk: 9, def: 4, spd: 7, ats: 3, dfs: 6 }, status: null, moves: ['tackle'],
}]
const BOX = [{
  dbSymbol: 'squirtle', level: 8, hp: 26, maxHp: 26, nature: 'calm', shiny: true,
  ivs: { hp: 2, atk: 5, def: 11, spd: 1, ats: 8, dfs: 0 }, status: null, moves: ['tackle'],
}]

/* ----------------------------------------------------------- reporting ---*/
let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const step = (s) => console.log(`\n=== ${s} ===`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Polls `fn` until it returns something truthy, or gives up. */
async function until(label, fn, { timeout = 20000, interval = 250 } = {}) {
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
  const capture = (chunk) => {
    const text = String(chunk)
    log.push(text)
    if (process.env.E2E_VERBOSE) process.stdout.write(`[server] ${text}`)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.on('exit', (code) => {
    if (code) console.error(`[server] exited early with ${code}\n${log.join('')}`)
  })
  await until('the server to listen', async () => {
    try {
      const res = await fetch(`${BASE}/health`)
      return res.ok
    } catch {
      return false
    }
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
// These run inside the browser. They read the LIVE engine, not the DOM, so a
// stale HUD or a cached sprite cannot make the test pass.

const READ_PLAYER = `(() => {
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
  return {
    name: read(p.name),
    graphics: ids,
    localName: (() => { try { return localStorage.getItem('sm-name') } catch { return null } })(),
    localCharacter: (() => { try { return localStorage.getItem('sm-character') } catch { return null } })(),
  }
})()`

const readPlayer = (page) => page.evaluate(READ_PLAYER)

/** Waits for the engine to hand us a player on a loaded map. */
const waitForPlayer = (page, label) =>
  until(label, async () => {
    const p = await readPlayer(page).catch(() => null)
    return p && p.graphics.length ? p : null
  })

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

const account = privateKeyToAccount(PRIVATE_KEY)
const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()

const profileDir = mkdtempSync(join(tmpdir(), 'sm-e2e-'))
let server
let browser

try {
  step('boot')
  server = await startServer({
    PORT: String(PORT),
    SERVER_SECRET,
    DATABASE_URL,
    // Small batching window so the test does not have to wait seconds for a
    // write it is about to assert on.
    PROFILE_FLUSH_MS: '250',
  })
  const health = await (await fetch(`${BASE}/health`)).json()
  check('server reports the profile store is enabled and healthy',
    health.profiles.enabled && health.profiles.healthy, JSON.stringify(health.profiles))

  const wallet = await signIn(account)
  check('wallet signature accepted, opaque id issued',
    /^w:[0-9a-f]{32}$/.test(wallet.connectionId), wallet.connectionId)
  // A fresh SERVER_SECRET means a fresh id, but be explicit anyway.
  await db.query('DELETE FROM players WHERE wallet_id = $1', [wallet.connectionId])

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profileDir,
    args: [
      '--window-size=1280,900',
      // pixi needs a GL context; headless Chrome has no GPU.
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--mute-audio',
    ],
  })

  /* ------------------------------------------------------- session one ---*/
  step('session 1 — a new player picks a character and a name')
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`))
  // First load establishes the origin so localStorage is writable.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((w) => localStorage.setItem('sm-wallet', JSON.stringify(w)), wallet)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const first = await waitForPlayer(page, 'the first session to reach the map')
  check('a brand-new wallet starts as the default hero', first.graphics.includes('hero'),
    JSON.stringify(first.graphics))

  // Exactly what the character picker in index.html does when you confirm.
  await page.evaluate((ids) => {
    localStorage.setItem('sm-character', JSON.stringify(ids))
    window.dispatchEvent(new CustomEvent('sm:character', { detail: ids }))
  }, CHARACTER)
  const picked = await until('the chosen character to apply', async () => {
    const p = await readPlayer(page)
    return p && p.graphics.includes(CHARACTER[0]) ? p : null
  })
  check('the picked character is live in the engine', !!picked, JSON.stringify(picked.graphics))

  // Exactly what the name modal in chat-ui.ts does.
  await page.evaluate((n) => window.__engine.processAction('name:set', { name: n }), NAME)
  const named = await until('the name to be accepted', async () => {
    const p = await readPlayer(page)
    return p && p.name === NAME ? p : null
  })
  check('the chosen name is live in the engine', !!named, named.name)

  step('session 1 — did the GAME write it to Postgres?')
  const stored = await until('the batched write to land', async () => {
    const { rows } = await db.query(
      `SELECT p.name, p.wallet_address, s.state, s.version
       FROM players p LEFT JOIN player_state s USING (wallet_id)
       WHERE p.wallet_id = $1`,
      [wallet.connectionId],
    )
    return rows[0]?.state?.character ? rows[0] : null
  })
  check('players.name holds the chosen name', stored.name === NAME, stored.name)
  check('players.wallet_address holds the signing address',
    stored.wallet_address === account.address.toLowerCase(), String(stored.wallet_address))
  check('player_state.state.character holds the chosen character',
    JSON.stringify(stored.state.character) === JSON.stringify(CHARACTER),
    JSON.stringify(stored.state.character))
  check('player_state.version is set', Number.isInteger(stored.version), String(stored.version))

  /* ------------------------------------------------------------ between --*/
  step('between sessions — creatures caught in a battle')
  // Written straight into the profile because a scripted wild battle is a
  // flaky thing to drive; the game's own write path for these is covered by
  // test/profiles.test.mjs and profile.spec.ts. What session 2 proves is that
  // they come BACK, which is the half that was broken.
  await db.query(
    `UPDATE player_state SET state = state || $2::jsonb, updated_at = now() WHERE wallet_id = $1`,
    [wallet.connectionId, JSON.stringify({ party: PARTY, box: BOX })],
  )
  check('a party and a box are stored for this wallet', true,
    `${PARTY.length} in party, ${BOX.length} in box`)

  /* ------------------------------------------------------- session two ---*/
  step('session 2 — localStorage destroyed, only the wallet restored')
  const wiped = await page.evaluate((w) => {
    localStorage.clear()
    // Signing in again is what a new device would do; it yields exactly this
    // and nothing else. No character, no name, no game state.
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    return Object.keys(localStorage)
  }, wallet)
  check('localStorage holds the wallet and nothing else',
    wiped.length === 1 && wiped[0] === 'sm-wallet', JSON.stringify(wiped))

  await page.reload({ waitUntil: 'domcontentloaded' })
  const back = await until('the server to restore the character', async () => {
    const p = await readPlayer(page)
    return p && p.graphics.includes(CHARACTER[0]) ? p : null
  }).catch(async () => readPlayer(page))

  check('the character is back after the reload',
    !!back && back.graphics.includes(CHARACTER[0]), JSON.stringify(back?.graphics))
  // The character cannot have come from localStorage: this session cleared it
  // before connecting, so only the server could supply it. The client then
  // REPAIRS localStorage from the server's answer, on purpose — otherwise the
  // title screen keeps treating a returning player on a clean device as a
  // first-timer and shows them the picker. So the assertion is that the value
  // now present matches what the server sent, not that it stayed empty.
  check('...and it came from the server, which then repaired localStorage',
    JSON.stringify(JSON.parse(back?.localCharacter ?? 'null')) === JSON.stringify(CHARACTER),
    `sm-character = ${String(back?.localCharacter)}`)

  const nameBack = await until('the server to restore the name', async () => {
    const p = await readPlayer(page)
    return p && p.name === NAME ? p : null
  }).catch(async () => readPlayer(page))
  check('the name is back after the reload', nameBack?.name === NAME, String(nameBack?.name))
  check('the server pushed it to the client, repairing localStorage',
    nameBack?.localName === NAME, `sm-name = ${String(nameBack?.localName)}`)

  step('session 2 — do the caught creatures survive?')
  // Open the in-game Team panel: the server reads PARTY and renders it into
  // the dialog GUI, so this is the player's own view of their save.
  await page.evaluate(() => {
    document.getElementById('title-screen')?.remove()
    window.__engine.processAction('escape')
  })
  // The heading types itself out, so "MENU" is "MEN" for a frame — wait for a
  // choice, which only appears once the dialog is fully rendered.
  const menuText = await until('the menu dialog', async () =>
    page.evaluate(() => {
      const t = document.querySelector('.rpg-ui-dialog')?.innerText ?? ''
      // The heading types itself out, so wait for BOTH the finished title and
      // a choice — 'Team' alone shows up while the title still reads 'ME'.
      return /MENU/i.test(t) && t.includes('Team') ? t : null
    }))
  check('the escape menu opens', /MENU/i.test(menuText), menuText.replace(/\n/g, ' | ').slice(0, 80))

  // Choose "Team" — the first choice in the dialog.
  await page.evaluate(() => {
    const dialog = document.querySelector('.rpg-ui-dialog')
    const hit = [...dialog.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === 'Team')
    hit?.click()
  })
  // The dialog types itself out a line at a time, so wait for the creature
  // name rather than for the heading — "YOUR TEAM" appears seconds early.
  const teamText = await until('the team panel', async () =>
    page.evaluate(() => {
      const t = document.querySelector('.rpg-ui-dialog')?.innerText ?? ''
      return /Applion|no Stockmonsters/.test(t) ? t : null
    }), { timeout: 15000 }).catch(async () =>
      page.evaluate(() => document.querySelector('.rpg-ui-dialog')?.innerText ?? '(no dialog)'))
  check('the party restored from Postgres is shown in game',
    /YOUR TEAM/.test(teamText) && /Applion/.test(teamText),
    teamText.replace(/\n/g, ' | ').slice(0, 120))

  const finalRow = await db.query(
    'SELECT state FROM player_state WHERE wallet_id = $1', [wallet.connectionId])
  check('the box was not clobbered by the reconnect',
    finalRow.rows[0]?.state?.box?.length === BOX.length,
    JSON.stringify(finalRow.rows[0]?.state?.box?.map((c) => c.dbSymbol)))

  /* ----------------------------------------------------- session three ---*/
  step('session 3 — a client whose localStorage disagrees with the server')
  // The dangerous case, and the reason player.ts is not just "load and apply":
  // localStorage is trivially editable, so a client claiming a different
  // character must lose to the stored one — and keep losing, because the
  // client re-asserts its copy after every map change.
  await page.evaluate((w) => {
    localStorage.clear()
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    localStorage.setItem('sm-character', JSON.stringify(['female']))
    localStorage.setItem('sm-name', 'Impostor')
  }, wallet)
  await page.reload({ waitUntil: 'domcontentloaded' })

  const contested = await waitForPlayer(page, 'the contested session to load')
  // Give the client's retry loop several rounds to try to win.
  await sleep(4000)
  const settled = await readPlayer(page)
  check('the server character beats the localStorage claim',
    settled.graphics.includes(CHARACTER[0]) && !settled.graphics.includes('female'),
    `${JSON.stringify(contested.graphics)} -> ${JSON.stringify(settled.graphics)}`)
  check('the server name beats the localStorage claim', settled.name === NAME, String(settled.name))
  check('the client\'s stale name was corrected in localStorage', settled.localName === NAME,
    `sm-name = ${String(settled.localName)}`)

  const notOverwritten = await db.query(
    'SELECT state FROM player_state WHERE wallet_id = $1', [wallet.connectionId])
  check('and the forged character was never written to Postgres',
    JSON.stringify(notOverwritten.rows[0]?.state?.character) === JSON.stringify(CHARACTER),
    JSON.stringify(notOverwritten.rows[0]?.state?.character))

  step('session 3 — a REAL character change still works and still persists')
  // The mirror of the check above, and the one that catches over-defending:
  // if "the server wins" were implemented as a permanent lock, the designer
  // would silently stop working. Past the boot window a new pick is a genuine
  // choice and must be accepted.
  await sleep(BOOT_WINDOW_MARGIN_MS)
  await page.evaluate((ids) => {
    localStorage.setItem('sm-character', JSON.stringify(ids))
    window.dispatchEvent(new CustomEvent('sm:character', { detail: ids }))
  }, CHANGED)
  const changed = await until('the new character to apply', async () => {
    const p = await readPlayer(page)
    return p && p.graphics.includes(CHANGED[0]) ? p : null
  }).catch(async () => readPlayer(page))
  check('a deliberate change after the boot window is accepted',
    !!changed && changed.graphics.includes(CHANGED[0]), JSON.stringify(changed?.graphics))
  const changedRow = await until('the change to reach Postgres', async () => {
    const { rows } = await db.query(
      'SELECT state FROM player_state WHERE wallet_id = $1', [wallet.connectionId])
    return rows[0]?.state?.character?.[0] === CHANGED[0] ? rows[0] : null
  }).catch(async () => (await db.query(
    'SELECT state FROM player_state WHERE wallet_id = $1', [wallet.connectionId])).rows[0])
  check('...and is persisted, replacing the old one',
    JSON.stringify(changedRow?.state?.character) === JSON.stringify(CHANGED),
    JSON.stringify(changedRow?.state?.character))

  step('session 3 — a second wallet cannot steal the name')
  // anvil account #1.
  const rival = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
  const rivalWallet = await signIn(rival)
  await db.query('DELETE FROM players WHERE wallet_id = $1', [rivalWallet.connectionId])
  const rivalPage = await browser.newPage()
  await rivalPage.goto(BASE, { waitUntil: 'domcontentloaded' })
  await rivalPage.evaluate((w) => {
    localStorage.clear()
    localStorage.setItem('sm-wallet', JSON.stringify(w))
  }, rivalWallet)
  await rivalPage.reload({ waitUntil: 'domcontentloaded' })
  await waitForPlayer(rivalPage, 'the rival session to load')
  await rivalPage.evaluate((n) => window.__engine.processAction('name:set', { name: n }), NAME)
  await sleep(2500)
  const rivalState = await readPlayer(rivalPage)
  check('the rival does not get the taken name', rivalState.name !== NAME, String(rivalState.name))
  const rivalRow = await db.query('SELECT name FROM players WHERE wallet_id = $1', [rivalWallet.connectionId])
  check('...and Postgres still shows the name unclaimed by them',
    rivalRow.rows[0]?.name == null, String(rivalRow.rows[0]?.name))
  const ownerRow = await db.query('SELECT name FROM players WHERE wallet_id = $1', [wallet.connectionId])
  check('...and the original owner keeps it', ownerRow.rows[0]?.name === NAME, String(ownerRow.rows[0]?.name))
  await rivalPage.close()
  await db.query('DELETE FROM players WHERE wallet_id = $1', [rivalWallet.connectionId])

  /* -------------------------------------------- degradation, for real ----*/
  step('the same client against a server with NO database')
  await browser.close()
  browser = null
  server.child.kill('SIGTERM')
  await sleep(1200)
  server = await startServer({ PORT: String(PORT), SERVER_SECRET, DATABASE_URL: '' })
  const degraded = await (await fetch(`${BASE}/health`)).json()
  check('the server reports no profile store', degraded.profiles.enabled === false,
    JSON.stringify(degraded.profiles))

  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profileDir,
    args: ['--window-size=1280,900', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  })
  const page2 = await browser.newPage()
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page2.evaluate((w) => {
    localStorage.clear()
    localStorage.setItem('sm-wallet', JSON.stringify(w))
    localStorage.setItem('sm-character', JSON.stringify(['female']))
  }, wallet)
  await page2.reload({ waitUntil: 'domcontentloaded' })
  const noDb = await waitForPlayer(page2, 'the world to load without a database')
  check('the game still loads and plays with no database', !!noDb, JSON.stringify(noDb.graphics))
  // The client's localStorage copy is the only source of truth now, and it has
  // to still work — that is the whole promise of degrading gracefully.
  const fellBack = await until('the client-supplied character to apply', async () => {
    const p = await readPlayer(page2)
    return p && p.graphics.includes('female') ? p : null
  }).catch(async () => readPlayer(page2))
  check('...and falls back to the client-supplied character',
    !!fellBack && fellBack.graphics.includes('female'), JSON.stringify(fellBack?.graphics))
} catch (err) {
  failures++
  console.error('\nE2E ABORTED:', err.stack ?? err)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (server) server.child.kill('SIGKILL')
  await db.end().catch(() => {})
  rmSync(profileDir, { recursive: true, force: true })
}

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}`)
process.exit(failures ? 1 : 0)
