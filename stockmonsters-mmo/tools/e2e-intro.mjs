/*
 * A brand new trader's first minute.
 *
 *   npm run test:e2e:intro
 *
 * The game used to drop a player on the dock and say nothing — no idea what a
 * Stockmonster was, what the token did, or where to go — and then ask for a
 * name through a modal that appeared out of nowhere. This drives the opening
 * that replaced it: Kelby's introduction, ending in the question, in his
 * voice, with the answer going through the same server rules as before.
 *
 * The trap this test fell into first, and now guards: seeding `sm-name` in
 * localStorage sends the client down the "already named" path and the intro
 * never plays. A NEW trader has no cached name; that is the whole point.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PORT_OVERRIDE ?? 4240)
const BASE = `http://localhost:${PORT}`
// The repo root, from this file's own location — APP_ROOT was never set
// by anything, so `npm run test:e2e:intro` threw before it opened a browser.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  ' + d : ''}`) }

const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
child.stderr.on('data', () => {})
for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-q-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1100, height: 800 })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  // A BRAND NEW trader: a wallet the server has never seen and, crucially, no
  // cached name. Seeding one sends the client down the "already named" path
  // and the intro never plays — which is what this test is for.
  const hex = '0123456789abcdef'
  const rnd = (n) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('')
  localStorage.setItem('sm-wallet', JSON.stringify({ connectionId: 'w:' + rnd(32), address: '0x' + rnd(40) }))
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(6000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(11000)
await sleep(8000) // the client waits 6s for a stored name before asking

// A brand new trader should meet Kelby, not a bare modal.
const intro = await page.evaluate(() => ({
  open: !!document.querySelector('#sm-intro.open'),
  who: document.querySelector('#sm-intro .who span')?.textContent?.trim(),
  line: document.querySelector('#sm-intro .line')?.textContent?.trim(),
  modal: !!document.getElementById('name-screen')?.classList.contains('open'),
}))
console.log('  intro:', JSON.stringify(intro))
check('the story intro plays for a new trader', intro.open)
check('and it is Kelby speaking', intro.who === 'KELBY', intro.who)
check('the bare name modal does NOT appear instead', intro.modal === false)

// Click through to the question. Generous, because two of the beats hand over
// to something else — the choice buttons and the character designer — and
// each of those takes a moment to appear and to close again.
for (let i = 0; i < 80; i++) {
  // The conversation is not one long monologue any more: it asks how you play
  // and hands you to the character designer, exactly as the original did. So
  // clicking the box is not always what advances it.
  await page.evaluate(() => {
    const root = document.getElementById('sm-intro')
    if (root?.classList.contains('choosing')) {
      root.querySelector('.choices button')?.click()
      return
    }
    // The designer takes the screen; confirm a preset and Kelby resumes.
    const designer = document.getElementById('sm-character-designer')
    if (designer?.classList.contains('scd-open')) {
      designer.querySelector('[data-grid="preset"] > *')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      designer.querySelector('[data-act="confirm"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return
    }
    document.querySelector('#sm-intro .box')?.click()
  })
  await sleep(320)
  const asking = await page.evaluate(() => !!document.querySelector('#sm-intro.asking'))
  if (asking) break
  await sleep(400) // choices and the designer need a beat to appear
}
const asking = await page.evaluate(() => ({
  asking: !!document.querySelector('#sm-intro.asking'),
  field: !!document.querySelector('#sm-intro input'),
  classes: document.getElementById('sm-intro')?.className ?? '(gone)',
  line: (document.querySelector('#sm-intro .line')?.textContent ?? '').slice(0, 60),
  designerOpen: !!document.querySelector('#sm-character-designer.scd-open'),
}))
check('the conversation ends by asking for a name', asking.asking && asking.field, JSON.stringify(asking))

const NAME = 'K' + Math.random().toString(36).slice(2, 8)
const done = await page.evaluate(async (n) => {
  const i = document.querySelector('#sm-intro input')
  i.value = n
  i.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('#sm-intro .go').click()
  await new Promise((r) => setTimeout(r, 3000))
  // Kelby reads the name back before he lets go of it, exactly as the
  // original does — "did I write that down properly?" — so there is one more
  // button between typing it and being registered.
  const readBack = document.querySelector('#sm-intro .line')?.textContent ?? ''
  document.querySelector('#sm-intro.choosing .choices button')?.click()
  await new Promise((r) => setTimeout(r, 2500))
  return {
    readBack,
    line: document.querySelector('#sm-intro .line')?.textContent ?? '',
    stored: localStorage.getItem('sm-name'),
    hud: document.querySelector('#sm-hud .hud-name')?.textContent?.trim(),
  }
}, NAME)
console.log('  after registering:', JSON.stringify(done))
check('the name is accepted and stored', done.stored === NAME, done.stored)
check('Kelby reads the name back to check it', done.readBack.includes(NAME), done.readBack.slice(0, 70))
check('and signs off by name once confirmed', done.line.includes(NAME), done.line.slice(0, 80))
check('and it reaches the HUD', done.hud === NAME, done.hud)

await sleep(3500)
check('the intro closes itself afterwards',
  !(await page.evaluate(() => !!document.querySelector('#sm-intro.open'))))

await page.screenshot({ path: process.env.SHOT ?? 'intro.png' })
await browser.close(); child.kill('SIGTERM')
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed')
