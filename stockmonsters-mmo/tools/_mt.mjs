/* How long is the black screen when you walk through a door? */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = `http://localhost:${process.env.PORT_OVERRIDE ?? 4240}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const account = privateKeyToAccount(generatePrivateKey())
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'sm-mt-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })
page.on('pageerror', (e) => { if (!/tilesets is not iterable/.test(e.message)) console.log('  [page]', e.message.slice(0,90)) })
await page.evaluateOnNewDocument((addr) => {
  window.__addr = addr
  window.ethereum = { isMetaMask: true, on(){}, removeListener(){},
    async request({ method, params }) {
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__addr]
      if (method === 'personal_sign') return await window.__sign(params[0])
      if (method === 'wallet_switchEthereumChain') return null
      throw new Error('unexpected ' + method) } }
}, account.address)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.exposeFunction('__sign', async (m) =>
  account.signMessage({ message: m.startsWith('0x') ? Buffer.from(m.slice(2),'hex').toString('utf8') : m }))
await page.evaluate(() => {
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
  localStorage.setItem('sm-name', 'Mt' + Math.random().toString(16).slice(2,8))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(4000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(5000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(16000)

// Instrument the curtain itself: mountMapTransition owns an element, so watch
// every element that covers the viewport and note when it stops covering.
async function go(map, x, y) {
  const r = await page.evaluate(async (m, mx, my) => {
    const t0 = performance.now()
    const e = window.__engine
    const covering = () => [...document.querySelectorAll('body > div')].some((n) => {
      const s = getComputedStyle(n)
      if (s.position !== 'fixed' || s.display === 'none' || +s.opacity === 0) return false
      const b = n.getBoundingClientRect()
      return b.width >= innerWidth * 0.9 && b.height >= innerHeight * 0.9 && +s.opacity > 0.5
    })
    let covered = null, uncovered = null, arrived = null
    e?.processAction?.('dev:goto', { map: m, x: mx, y: my })
    for (let i = 0; i < 600; i++) {
      const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
      const id = String((typeof s?.id === 'function' ? s.id() : s?.id) ?? '').replace(/^map-/, '')
      const cov = covering()
      if (cov && covered === null) covered = performance.now() - t0
      if (id === m && arrived === null) arrived = performance.now() - t0
      if (covered !== null && !cov && arrived !== null) { uncovered = performance.now() - t0; break }
      await new Promise((res) => setTimeout(res, 50))
    }
    return { covered, arrived, uncovered }
  }, map, x, y)
  console.log(`  ${map.padEnd(18)} curtain at ${String(Math.round(r.covered ?? -1)).padStart(5)}ms   map ready ${String(Math.round(r.arrived ?? -1)).padStart(5)}ms   curtain lifts ${String(Math.round(r.uncovered ?? -1)).padStart(5)}ms`)
  await sleep(1500)
}
console.log('cold (never visited):')
await go('goldenrod-city', 30, 30)
await go('cave', 30, 40)
await go('new-bark-town', 12, 12)
console.log('warm (second visit):')
await go('goldenrod-city', 30, 30)
await browser.close()
