/*
 * Drives the built landing site in a real Chrome at desktop and phone widths.
 * The point is the CA pill: it must show the DEPLOYED address, and the copy
 * button must put the WHOLE 42-character string on the clipboard even at 390px
 * where the visible text is elided. So we read the clipboard back.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE ?? 'http://localhost:4173'
const ADDR = '0xf30e4f2E1E715A77ceCade62F236c6d39dA0CE7a'
const OUT = process.env.OUT ?? '.'
let bad = 0
const check = (l, ok, d = '') => { if (!ok) bad++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? '  →  ' + d : ''}`) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'sm-landing-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
// Clipboard access is gated twice: by the permission, and by transient user
// activation. Grant the first here; the second comes from page.click(), which
// is a real input event — an .click() inside evaluate() is not.
const bcdp = await browser.target().createCDPSession()
await bcdp.send('Browser.grantPermissions', {
  origin: BASE,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
})

for (const [name, width, height, mobile] of [['DESKTOP', 1280, 900, false], ['PHONE', 390, 844, true]]) {
  console.log(`\n=== ${name} ${width}x${height} ===`)
  const page = await browser.newPage()
  page.on('pageerror', (e) => { bad++; console.log('  [pageerror]', e.message) })
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()) })
  await page.setViewport({ width, height, isMobile: mobile, deviceScaleFactor: 1 })
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 })

  // --- the pill ------------------------------------------------------
  const pill = await page.evaluate(() => {
    const code = document.querySelector('main code')
    const btn = [...document.querySelectorAll('button')].find((b) => /Copy the/.test(b.getAttribute('aria-label') || ''))
    const r = code.getBoundingClientRect()
    return {
      visible: code.innerText.trim(),
      title: code.getAttribute('title'),
      hasBtn: !!btn,
      btnText: btn ? btn.innerText.trim() : null,
      codeRight: r.right,
      docW: document.documentElement.clientWidth,
      scrollW: document.body.scrollWidth,
    }
  })
  console.log(`  pill shows: "${pill.visible}"   button: "${pill.btnText}"`)
  check('pill title carries the full address', pill.title === ADDR, pill.title)
  check('copy button present', pill.hasBtn)
  if (mobile) check('phone shows the elided form', pill.visible === '0xf30e…CE7a', pill.visible)
  else check('desktop shows the full address', pill.visible === ADDR, pill.visible)
  const pan = await page.evaluate(() => {
    window.scrollTo(9999, 0); const x = window.scrollX; window.scrollTo(0, 0)
    return { x, bodyW: document.body.scrollWidth, clientW: document.documentElement.clientWidth }
  })
  check('body is no wider than the viewport', pill.scrollW <= pill.docW + 1, `body ${pill.scrollW} vs ${pill.docW}`)
  check('the page cannot be panned sideways', pan.x === 0, `scrollX ${pan.x}`)

  // --- the copy button, read back off the clipboard --------------------
  await page.evaluate(() => navigator.clipboard.writeText('SENTINEL-NOT-COPIED'))
  const before = await page.evaluate(() => navigator.clipboard.readText())
  check('clipboard starts on the sentinel', before === 'SENTINEL-NOT-COPIED', before)
  const btnEl = await page.$('button[aria-label^="Copy the"]')
  await btnEl.click()
  await new Promise((r) => setTimeout(r, 400))
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  const label = await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => /Copy the/.test(b.getAttribute('aria-label') || '')).innerText.trim())
  console.log(`  clipboard now: "${clip}"   button now reads: "${label}"`)
  check('clipboard holds the FULL 42-char address', clip === ADDR, `${clip.length} chars`)
  check('button acknowledges the copy', /^copied$/i.test(label), label)

  // --- explorer + play links -------------------------------------------
  const links = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')]
    const ex = a.find((x) => /blockscout/.test(x.href))
    const play = a.filter((x) => /game\.stockmonsters/.test(x.href))
    return {
      explorerHref: ex ? ex.href : null,
      explorerText: ex ? ex.innerText.trim() : null,
      explorerVisible: ex ? ex.getBoundingClientRect().width > 0 : false,
      playCount: play.length,
      playHrefs: [...new Set(play.map((x) => x.href))],
      otherPlay: [...new Set(a.map((x) => x.href).filter((h) => /lordfishnu|stockmonsters\.com/.test(h)))],
    }
  })
  console.log('  links:', JSON.stringify(links))
  check('Blockscout token link present + visible', links.explorerHref === `https://robinhoodchain.blockscout.com/token/${ADDR}` && links.explorerVisible)
  check('play links all point at game.stockmonsters.xyz', links.playCount >= 3 && links.playHrefs.length === 1 && links.otherPlay.length === 0)

  // --- copy that the launch made false ---------------------------------
  const body = await page.evaluate(() => document.body.innerText)
  for (const s of ['$STONKSTER', 'Sepolia', 'NOT DEPLOYED', 'test network', 'Not yet', 'lordfishnu'])
    check(`no "${s}" in the rendered text`, !body.includes(s))
  // 75% only ever appears as decoration on the tape (a drift like ▲1.75%), so
  // look for it where an economy claim would live, not page-wide.
  const econ = await page.evaluate(() => ['#earn', '#faq'].map((id) =>
    document.querySelector(id).closest('section').innerText).join('\n'))
  check('no "75%" anywhere in the economy copy', !econ.includes('75%'))
  check('STONKSTERS is on the page', body.includes('STONKSTERS'))
  check('Robinhood Chain is on the page', body.includes('Robinhood Chain'))
  check("players' floor reads 25%", body.includes("cannot be set below 25%"), body.match(/cannot be set below[^\n]*/)?.[0])

  // --- every element that sticks out of the viewport --------------------
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.clientWidth
    return [...document.querySelectorAll('body *')]
      .filter((e) => !e.closest('.tape-window'))  // the marquee is clipped on purpose
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1) })
      .slice(0, 8)
      .map((e) => `${e.tagName}.${(e.className || '').toString().slice(0, 60)} [${Math.round(e.getBoundingClientRect().left)},${Math.round(e.getBoundingClientRect().right)}]`)
  })
  check('nothing sticks out of the viewport', overflow.length === 0, overflow.join(' | '))

  await page.screenshot({ path: `${OUT}/landing-${name.toLowerCase()}-hero.png` })
  await page.evaluate(() => document.querySelector('#earn').scrollIntoView())
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: `${OUT}/landing-${name.toLowerCase()}-earn.png` })
  await page.evaluate(() => document.querySelector('#faq').scrollIntoView())
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: `${OUT}/landing-${name.toLowerCase()}-faq.png` })
  await page.close()
}

await browser.close()
console.log(bad ? `\n${bad} FAILED` : '\nALL PASS')
process.exit(bad ? 1 : 0)
