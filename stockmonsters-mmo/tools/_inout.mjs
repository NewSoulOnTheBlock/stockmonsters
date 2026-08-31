/* Walk in, walk out, and immediately try to walk back in. */
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
  userDataDir: mkdtempSync(join(tmpdir(), 'sm-io-')),
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
  account.signMessage({ message: m.startsWith('0x') ? Buffer.from(m.slice(2), 'hex').toString('utf8') : m }))
await page.evaluate(() => {
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
  localStorage.setItem('sm-name', 'Io' + Math.random().toString(16).slice(2, 8))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(4000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(5000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(16000)

const at = () => page.evaluate(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.()
  const r = (v) => (typeof v === 'function' ? v() : v)
  return { map: String(r(s?.id) ?? '').replace(/^map-/, ''), x: p ? Math.round(r(p.x)) : null, y: p ? Math.round(r(p.y)) : null }
})
const hold = async (dir, t) => {
  await page.evaluate(async (d, ms) => {
    const c = window.__controls?.()
    await c.applyControl(d, true)
    await new Promise((r) => setTimeout(r, ms))
    await c.applyControl(d, false)
  }, dir, t)
  await sleep(3500)
}

await page.evaluate((a) => window.__engine?.processAction?.('dev:goto', a), { map: 'exterior', x: 31, y: 33 })
await sleep(7000)
console.log('  start            ', JSON.stringify(await at()))
await hold('up', 1600);   console.log('  walked in        ', JSON.stringify(await at()))
await hold('down', 1600); console.log('  walked out       ', JSON.stringify(await at()))
await hold('up', 1600);   console.log('  straight back in ', JSON.stringify(await at()))
await hold('down', 2600); console.log('  away and         ', JSON.stringify(await at()))
await hold('up', 2600);   console.log('  in again         ', JSON.stringify(await at()))
await browser.close()
