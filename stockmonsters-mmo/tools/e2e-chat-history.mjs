/*
 * THE ROOM IS STILL THERE WHEN YOU WALK INTO IT.
 *
 *   RPG_TYPE=mmorpg npx vite build     # dist must exist
 *   npm run db:migrate
 *   npm run test:e2e:chat-history
 *
 * Chat used to be broadcast-only: a line reached whoever was connected at that
 * second and was gone. This drives the fix through real browsers.
 *
 * A talks to an empty world. B opens a browser AFTERWARDS and must be able to
 * read what A said — dimmed, under an "earlier" separator, and with NO SPEECH
 * BUBBLE anywhere on their screen, because a replayed backlog drawn as bubbles
 * would put twenty boxes over people who are standing silently.
 *
 * WHAT IT PROVES THAT A UNIT TEST CANNOT
 *   · that history reaches a client at all — it is emitted on a hook that
 *     fires while the client may still be mounting, which is the failure a
 *     mock cannot have
 *   · that it lands on `chat:history` and not on `chat:message`, observed from
 *     the OTHER side of the wire: the bubble layer is asked how many bubbles
 *     it is drawing, and the answer must be zero for history and one for a
 *     live line
 *   · that WALKING THROUGH A DOOR does not replay it. A player joins a room on
 *     every map change, so "send it on join" duplicates the whole backlog
 *   · that it is really in POSTGRES and not just in the process's memory: the
 *     server is killed and restarted, and a third player still reads it
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import pg from 'pg'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4277)
const BASE = process.env.BASE ?? `http://localhost:${PORT}`
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

// Two spots on the dock, three tiles apart — the same pair the bubble test
// uses, so both characters are on screen in each other's client.
const SPOT_A = { map: 'exterior', x: 31, y: 33 }
const SPOT_B = { map: 'exterior', x: 35, y: 33 }
// Somewhere else entirely, to make a real map change happen.
const INSIDE = { map: 'hub', x: 28, y: 47 }

/** A marker nothing else in the database has, so this run is identifiable. */
const RUN = randomBytes(3).toString('hex')
const LINE_1 = `is anyone actually here ${RUN}`
const LINE_2 = `i will be at the dock for a bit ${RUN}`
const LIVE = `right behind you ${RUN}`

let child = null
async function startServer() {
    if (process.env.BASE) return
    child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
    child.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) })
    for (let i = 0; i < 200; i++) {
        try { if ((await fetch(`${BASE}/health`)).ok) return } catch {}
        await sleep(300)
    }
    throw new Error('the server never became healthy')
}
async function stopServer() {
    if (!child) return
    const dead = new Promise((r) => child.once('exit', r))
    child.kill('SIGTERM')
    await Promise.race([dead, sleep(5000)])
    child = null
}

await startServer()

/** A real signed login, so the player has a wallet and may chat. */
async function signIn() {
    const account = privateKeyToAccount(generatePrivateKey())
    const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
    const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
    const signature = await account.signMessage({ message })
    return await (await fetch(`${BASE}/auth/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: account.address, message, signature }),
    })).json()
}

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-chathist-')),
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})

/** One player, in their own browser profile — separate storage, like a separate machine. */
async function player(label, name, character, spot) {
    const wallet = await signIn()
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(120_000)
    await page.setViewport({ width: 1100, height: 800 })
    page.on('pageerror', (e) => console.log(`  [${label} pageerror]`, e.message.slice(0, 160)))
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.evaluate((w, n, c) => {
        localStorage.setItem('sm-wallet', JSON.stringify(w))
        localStorage.setItem('sm-character', JSON.stringify(c))
        localStorage.setItem('sm-name', n)
    }, wallet, name, character)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await sleep(6000)
    await page.evaluate(() => document.getElementById('btn-primary')?.click())
    await sleep(13000)
    if (spot) {
        await page.evaluate((s) => window.__engine?.processAction?.('dev:goto', s), spot)
        await sleep(2500)
    }
    const id = await page.evaluate(() => window.__engine?.playerIdSignal?.() ?? null)
    return { label, name, page, context, id }
}

/** Everything one client can say about its own chat panel and bubbles. */
const panel = (page) => page.evaluate(() => {
    const log = document.getElementById('chat-log')
    const lines = [...(log?.children ?? [])].map((el) => ({
        cls: el.className,
        text: el.textContent ?? '',
        // Asked of the browser, not of the stylesheet: a class that dims
        // nothing is exactly the way this gets shipped broken.
        opacity: Number(getComputedStyle(el).opacity),
    }))
    return {
        lines,
        text: log?.innerText ?? '',
        bubbles: document.querySelectorAll('#sm-bubbles .bub').length,
        // The bubble layer's own count, including any it is holding but not
        // drawing this frame.
        held: window.__bubbles?.count?.() ?? -1,
    }
})

/** Type into the real chat box, exactly as a player does. */
const say = (page, text) => page.evaluate((t) => {
    const input = document.getElementById('chat-input')
    if (!input || input.disabled) return false
    input.focus()
    input.value = t
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
}, text)

/** Wait until the backlog has been rendered, or give up. */
async function waitForHistory(page, ms = 40_000) {
    const until = Date.now() + ms
    while (Date.now() < until) {
        const seen = await page.evaluate(() => !!document.querySelector('#chat-log .hist'))
        if (seen) return true
        await sleep(500)
    }
    return false
}

const NAME_A = 'Early' + randomBytes(2).toString('hex')
const NAME_B = 'Later' + randomBytes(2).toString('hex')
const NAME_C = 'Rest' + randomBytes(2).toString('hex')

/* ------------------------------------------------ 1. somebody talks -------*/
console.log('A is alone in the world and says two things:')
const A = await player('A', NAME_A, ['ch-cat-01-2'], SPOT_A)
check('A is in the world with a player id', !!A.id, String(A.id))
check('the chat box accepted the first line', await say(A.page, LINE_1))
await sleep(1500)
check('and the second', await say(A.page, LINE_2))
await sleep(1500)
const alone = await panel(A.page)
check('A can see their own two lines', alone.text.includes(LINE_1) && alone.text.includes(LINE_2))
// A may legitimately be handed OLDER history from the database — that is the
// whole feature, and on a dev box the previous run's chat is still there. What
// must never happen is this run's own lines coming back as history to the
// person who has just said them live.
check("A's own live lines were not echoed back as history",
    !alone.lines.some((l) => l.cls.includes('hist') && l.text.includes(RUN)))

/* --------------------------------------- 2. somebody arrives afterwards ---*/
console.log('\nB opens the game AFTER all of that was said:')
const B = await player('B', NAME_B, ['hero'], SPOT_B)
check('B is in the world', !!B.id, String(B.id))
const rendered = await waitForHistory(B.page)
check('B was given the backlog', rendered)

const onB = await panel(B.page)
if (process.env.VERBOSE) console.log('  [B panel]', JSON.stringify(onB.lines, null, 1))
const hist = onB.lines.filter((l) => l.cls.includes('hist'))
const seps = onB.lines.filter((l) => l.cls.includes('sep'))
// The dev database may hold chat from other runs and other people, and that is
// the point of the feature — so this run's own lines are picked out by their
// marker rather than assuming the world was empty.
const ours = hist.filter((l) => l.text.includes(RUN))
check('B can read what A said before they arrived',
    onB.text.includes(LINE_1) && onB.text.includes(LINE_2))
check('...as history, not as live chat', ours.length === 2,
    `${ours.length} of this run's lines, ${hist.length} history lines in all`)
check('...attributed to A by the name they said it under',
    ours.every((l) => l.text.startsWith(NAME_A + ':')), JSON.stringify(ours.map((l) => l.text)))
check('...between an "earlier" and a "now" separator',
    seps.length === 2 && /earlier/i.test(seps[0].text) && /now/i.test(seps[1].text),
    JSON.stringify(seps.map((s) => s.text)))
check('...and visibly dimmer than a live line',
    hist.length > 0 && hist.every((l) => l.opacity > 0 && l.opacity < 0.8),
    JSON.stringify(hist.map((l) => l.opacity)))
check('the backlog is above the live lines, in the order it was said',
    onB.text.indexOf(LINE_1) < onB.text.indexOf(LINE_2))

/* ------------------------------------- 3. NO SPEECH BUBBLES FOR HISTORY ---*/
check('NO speech bubble was drawn for any of it', onB.bubbles === 0, `${onB.bubbles} on screen`)
check('...and the bubble layer is holding none either', onB.held === 0, `${onB.held} held`)
const SHOT = process.env.SHOT ?? 'chat-history.png'
await B.page.screenshot({ path: SHOT })
console.log(`  screenshot: ${SHOT} — B's screen: A's backlog in the panel, no bubble over A`)

/* ------------------------------- 4. a LIVE line still behaves like one ----*/
console.log('\nA says something now that B is here:')
check('the chat box accepted it', await say(A.page, LIVE))
await sleep(1500)
const live = await panel(B.page)
const liveLine = live.lines.find((l) => l.text.includes(LIVE))
check('B sees it', !!liveLine)
check('...as a live line, not as history', !!liveLine && !liveLine.cls.includes('hist'),
    liveLine ? `class="${liveLine.cls}"` : 'missing')
check('...and it DOES draw a speech bubble', live.bubbles === 1, `${live.bubbles} bubbles`)

/* ------------------------------ 5. a door must not replay the backlog -----*/
console.log('\nB walks into another map and back:')
const count = (haystack, needle) => haystack.split(needle).length - 1
const beforeDoor = await panel(B.page)
await B.page.evaluate((s) => window.__engine?.processAction?.('dev:goto', s), INSIDE)
await sleep(6000)
await B.page.evaluate((s) => window.__engine?.processAction?.('dev:goto', s), SPOT_B)
await sleep(6000)
const afterDoor = await panel(B.page)
check('B is still holding exactly one copy of the backlog',
    count(afterDoor.text, LINE_1) === 1 && count(afterDoor.text, LINE_2) === 1,
    `${count(afterDoor.text, LINE_1)} / ${count(afterDoor.text, LINE_2)} copies`)
check('...and no second separator block appeared',
    afterDoor.lines.filter((l) => l.cls.includes('sep')).length === 2,
    `${afterDoor.lines.filter((l) => l.cls.includes('sep')).length} separators`)
check('the panel did not grow from a map change',
    afterDoor.lines.length === beforeDoor.lines.length,
    `${beforeDoor.lines.length} -> ${afterDoor.lines.length}`)
check('and still no bubble from any of it', afterDoor.bubbles === 0, `${afterDoor.bubbles}`)

/* ------------------------------- 6. it is in Postgres, not just in RAM ----*/
console.log('\nthe server is killed and restarted, then C logs in:')
await A.context.close()
await B.context.close()
await stopServer()
await startServer()
const C = await player('C', NAME_C, ['hero'], null)
const restored = await waitForHistory(C.page)
check('C was given the backlog by a server that had just booted', restored)
const onC = await panel(C.page)
check('...and it survived the restart, so it is really persisted',
    onC.text.includes(LINE_1) && onC.text.includes(LINE_2) && onC.text.includes(LIVE),
    JSON.stringify(onC.text.slice(0, 200)))
check('still no speech bubbles', onC.bubbles === 0 && onC.held === 0, `${onC.bubbles}/${onC.held}`)

await browser.close()
await stopServer()

/* --------------------------------------------------------- tidy up --------*/
if (process.env.DATABASE_URL) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    try {
        await client.connect()
        const { rowCount } = await client.query('DELETE FROM chat_messages WHERE body LIKE $1', [`%${RUN}`])
        console.log(`\ncleaned up ${rowCount} rows this run wrote`)
    } catch (err) {
        console.log(`\n[cleanup] ${err.message}`)
    } finally {
        await client.end().catch(() => {})
    }
}

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)
