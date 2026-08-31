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
  userDataDir: mkdtempSync(join(tmpdir(), 'sm-wd-')),
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
  localStorage.setItem('sm-name', 'Wd' + Math.random().toString(16).slice(2,8))
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
const [x, y, hold] = [+process.argv[2], +process.argv[3], +(process.argv[4] ?? 1600)]
await page.evaluate((a) => window.__engine?.processAction?.('dev:goto', a), { map: 'exterior', x, y })
await sleep(7000)
console.log('  start ', JSON.stringify(await at()))
await page.evaluate(async (t) => {
  const c = window.__controls?.()
  await c.applyControl('up', true)
  await new Promise((r) => setTimeout(r, t))
  await c.applyControl('up', false)
}, hold)
await sleep(4000)
console.log('  after ', JSON.stringify(await at()))
await browser.close()
