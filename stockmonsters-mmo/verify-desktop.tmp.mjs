import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 5201
const BASE = `http://localhost:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.mjs'],
  { cwd: resolve('.'), env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
const slog = []
child.stderr.on('data', (c) => slog.push(String(c)))
child.stdout.on('data', (c) => slog.push(String(c)))
const t0 = Date.now()
for (let i = 0; i < 300; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break } catch {} await sleep(300) }
console.log('  server ready in', ((Date.now() - t0) / 1000).toFixed(1), 's')

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: mkdtempSync(join(tmpdir(), 'sm-desk-')),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)) })
const failed = []
page.on('requestfailed', (r) => failed.push(r.url().split('/').pop() + ' ' + r.failure()?.errorText))
page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().split('/').pop()) })

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  localStorage.setItem('sm-wallet', JSON.stringify({ connectionId: 'w:' + 'e'.repeat(32), address: '0x' + '4'.repeat(40) }))
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
  localStorage.setItem('sm-name', 'Desk')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(6000)
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await sleep(14000)

const st = await page.evaluate(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.(); const r = (v) => (typeof v === 'function' ? v() : v)
  const c = document.querySelector('canvas')
  return { pos: p ? `${Math.round(r(p.x))},${Math.round(r(p.y))}` : null, canvas: c ? `${c.width}x${c.height}` : 'none' }
})
console.log('  state:', JSON.stringify(st))

// Is anything actually drawn? Sample the canvas centre.
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return 'no canvas'
  const gl = c.getContext('webgl2') || c.getContext('webgl')
  if (!gl) return 'no gl'
  const px = new Uint8Array(4)
  gl.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  return `centre pixel rgba(${px.join(',')})`
})
console.log(' ', painted)

// Frame rate over 3 seconds.
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t = performance.now()
  const tick = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(tick); else res(Math.round(n / 3)) }
  requestAnimationFrame(tick)
}))
console.log('  fps:', fps)
console.log('  page errors:', errs.length ? errs.slice(0, 4).join(' | ').slice(0, 300) : 'none')
console.log('  failed requests:', failed.length ? failed.slice(0, 6).join(', ') : 'none')
const bad = slog.join('').split('\n').filter((l) => /error|Error|ENOENT|tileset/i.test(l))
if (bad.length) { console.log('  server said:'); bad.slice(0, 6).forEach((l) => console.log('   ', l.trim().slice(0, 150))) }
await page.screenshot({ path: process.env.SHOT ?? 'desk.png' })
await browser.close(); child.kill('SIGTERM')
