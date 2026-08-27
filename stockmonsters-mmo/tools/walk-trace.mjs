/*
 * Reproducer for the sustained-hold movement freeze (RPG-JS v5 beta.33).
 *
 * Holds a direction for seconds at a time while sampling, every 50ms, the
 * player position, the client physics tick, the engine's processInput call
 * count, and the identity of the registered controls instance. What it shows
 * on the exterior map, driving input through applyControl (the same path our
 * touch d-pad uses):
 *
 *   - a hold walks normally (~160 px/s) until movement first stops (a wall,
 *     or the state loss below), then the input stream DIES: processInput is
 *     never called again for the rest of the hold, and later holds produce
 *     only a burst of a few inputs before dying the same way;
 *   - each death coincides with the current player's <Character> element
 *     being rebuilt (a 170-250ms longtask, no change in the players
 *     collection or the player object identity), which re-runs the mount
 *     effect calling client.setKeyboardControls(element.directives.controls)
 *     with a FRESH directive whose KeyboardControls has an empty keyState —
 *     and by that moment the old instance's keyState is already empty too,
 *     so held-key state cannot be carried across (a transplant wrapper was
 *     tried from game-ui.ts and measurably restored nothing);
 *   - a real keyboard mostly recovers because OS auto-repeat keeps sending
 *     keydown events that re-arm whatever instance is currently listening;
 *     applyControl-driven input (touch, tests) has no auto-repeat and stays
 *     dead until the next fresh press.
 *
 * Companion to perf-probe.mjs (which measures speed/frame-rate dependence).
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount } from 'viem/accounts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PROBE_PORT ?? 4655)
const BASE = `http://localhost:${PORT}`
const ROOT = resolve(process.cwd())
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function until(label, fn, { timeout = 30000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(interval)
  }
}

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (c) => { const s = String(c); if (s.includes('input-diag') || process.env.VERBOSE) process.stdout.write(s) })
server.stderr.on('data', (c) => { if (process.env.VERBOSE) process.stderr.write(String(c)) })
await until('server', async () => { try { return (await fetch(`${BASE}/health`)).ok } catch { return false } })

const account = privateKeyToAccount(PRIVATE_KEY)
const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
const signature = await account.signMessage({ message })
const wallet = await (await fetch(`${BASE}/auth/verify`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address: account.address, message, signature }),
})).json()

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'sm-trace-')),
  args: ['--window-size=1280,900', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 900 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate((w) => {
  localStorage.setItem('sm-wallet', JSON.stringify(w))
  localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
}, wallet)
await page.reload({ waitUntil: 'domcontentloaded' })
await until('player', () => page.evaluate(`(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  return !!s?.getCurrentPlayer?.()
})()`))
await until('controls', () => page.evaluate('!!window.__controls?.()'))
// ENTER THE WORLD. The title screen is an overlay on the already-booted game;
// measuring underneath it is not the game players play.
await page.evaluate(() => document.getElementById('btn-primary')?.click())
await until('title gone', () => page.evaluate('!document.getElementById("title-screen")'), { timeout: 15000 })
  .catch(() => { throw new Error('still on the title screen — cannot measure') })
await sleep(2500)

// Runtime wrappers on OUR side of the engine handle: count move packets out
// and acks in. TS-private methods are plain properties at runtime.
await page.evaluate(() => {
  const e = window.__engine
  const proto = Object.getPrototypeOf(e)
  window.__net = { movesOut: 0, acksIn: 0, procIn: 0, rec: 0, pre: 0, applied: 0, keyDown: 0 }
  const origEmit = proto.emitMovePacket
  proto.emitMovePacket = function (...a) { window.__net.movesOut++; return origEmit.apply(this, a) }
  const origAck = proto.applyServerAck
  proto.applyServerAck = function (...a) { window.__net.acksIn++; return origAck.apply(this, a) }
  const origProc = proto.processInput
  proto.processInput = function (...a) { window.__net.procIn++; return origProc.apply(this, a) }
  window.__skc = []
  const prevSkc = e.setKeyboardControls.bind(e) // own-property wrapper included, if game-ui installed one
  e.setKeyboardControls = function (ctl) {
    const kb = ctl?.keyboardControls
    window.__skc.push({
      at: Math.round(performance.now()),
      hasKb: !!kb,
      keys: kb ? JSON.stringify(kb.keyState ?? null) : null,
      dirs: kb ? JSON.stringify(kb.directionState ?? null) : null,
      wrapper: String(Object.getPrototypeOf(e).setKeyboardControls !== e.setKeyboardControls),
    })
    const r = prevSkc(ctl)
    const kb2 = ctl?.keyboardControls
    window.__skc[window.__skc.length - 1].after = kb2 ? JSON.stringify(kb2.keyState ?? null) : null
    return r
  }
  // Longtask timeline, to correlate frame spikes with controls re-registration.
  window.__lt = []
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) window.__lt.push({ at: Math.round(en.startTime), ms: Math.round(en.duration) })
    }).observe({ entryTypes: ['longtask'] })
  } catch {}
  // Does the current-player OBJECT change identity (snapshot replacing it)?
  window.__pid = []
  {
    const s = typeof e.sceneMap === 'function' ? e.sceneMap() : e.sceneMap
    let last = null
    setInterval(() => {
      try {
        const p = s.getCurrentPlayer()
        if (p !== last) {
          window.__pid.push({ at: Math.round(performance.now()), changed: last !== null })
          last = p
        }
      } catch {}
    }, 100)
  }
  // What does the room sync do to the players collection, and when?
  window.__pev = []
  try {
    const s = typeof e.sceneMap === 'function' ? e.sceneMap() : e.sceneMap
    s.players.observable.subscribe((ev) => {
      window.__pev.push({ at: Math.round(performance.now()), type: ev?.type, key: ev?.key })
      if (window.__pev.length > 400) window.__pev.shift()
    })
  } catch (err) { window.__pevErr = err.message }
  if (e.prediction) {
    const pproto = Object.getPrototypeOf(e.prediction)
    const origRec = pproto.recordInput
    pproto.recordInput = function (...a) { window.__net.rec++; return origRec.apply(this, a) }
  }
  const c = window.__controls?.()
  window.__ctl0 = c
  if (c) {
    const cproto = Object.getPrototypeOf(c)
    const origPre = cproto.preStep ? cproto.preStep : null
    if (origPre) cproto.preStep = function (...a) { window.__net.pre++; return origPre.apply(this, a) }
    const origApply = cproto.applyInput
    if (origApply) cproto.applyInput = function (...a) { window.__net.applied++; return origApply.apply(this, a) }
    for (const key of Object.keys(c.boundKeys ?? {})) {
      const bk = c.boundKeys[key]
      if (bk?.options?.keyDown) {
        const orig = bk.options.keyDown
        bk.options.keyDown = function (...a) { window.__net.keyDown++; return orig.apply(this, a) }
      }
    }
  }
})

const trace = async (dir, holdMs) => {
  const rows = await page.evaluate(async (dir, holdMs) => {
    const e = window.__engine
    const s = typeof e.sceneMap === 'function' ? e.sceneMap() : e.sceneMap
    const p = s.getCurrentPlayer()
    const rows = []
    const c = window.__controls?.()
    const t0 = performance.now()
    const sample = () => rows.push({
      abs: Math.round(performance.now()),
      t: Math.round(performance.now() - t0),
      x: p.x(), y: p.y(),
      tick: s.getTick?.() ?? -1,
      // Server tick, as last reported by ping/pong. Comparing its rate with
      // the client tick rate tests whether the server's fixed-tick loop lags
      // the client's — the input pacing gate freezes movement if it does.
      srvTick: e.latestServerTick ?? -1,
      net: { ...window.__net },
      pend: e.prediction?.getPendingInputs?.().length ?? -1,
      canMove: (() => { try { const v = p._canMove ?? p.canMove; const r = typeof v === 'function' ? v() : v; return r !== false } catch { return 'ERR' } })(),
      ctl: (() => {
        try {
          const cc = window.__controls?.()
          if (!cc) return 'none'
          const ks = cc.keyState ?? {}
          const down = Object.keys(ks).filter((k) => ks[k]?.isDown)
          const ds = cc.directionState ?? {}
          const dirs = Object.keys(ds).filter((k) => ds[k])
          return `same=${cc === window.__ctl0} stop=${cc.stop} int=${!!cc.interval} down=[${down}] dir=[${dirs}]`
        } catch (err) { return 'ERR ' + err.message }
      })(),
    })
    const timer = setInterval(sample, 50)
    await c.applyControl(dir, true)
    await new Promise((r) => setTimeout(r, holdMs))
    await c.applyControl(dir, false)
    await new Promise((r) => setTimeout(r, 600))
    clearInterval(timer)
    return rows
  }, dir, holdMs)
  console.log(`\n--- hold ${dir} for ${holdMs}ms ---`)
  let lastX = null, lastY = null
  for (const r of rows) {
    const moving = lastX === null ? ' ' : (r.x !== lastX || r.y !== lastY ? '>' : '.')
    if (r.t % 200 < 50) {
      const n = r.net
      console.log(`  abs=${r.abs} t=${String(r.t).padStart(5)}  x=${r.x.toFixed(0).padStart(5)} y=${r.y.toFixed(0)}  cliTick=${r.tick}  ` +
        `proc=${n.procIn} pend=${r.pend} ${r.ctl}  ${moving}`)
    }
    lastX = r.x; lastY = r.y
  }
  const a = rows[0], b = rows[rows.length - 1]
  const secs = (b.t - a.t) / 1000
  console.log(`  rates over ${secs.toFixed(1)}s: client ${(b.tick - a.tick) / secs | 0} ticks/s, server ${(b.srvTick - a.srvTick) / secs | 0} ticks/s`)
}

await trace('right', 5000)
await sleep(1000)
await trace('left', 5000)
await sleep(1000)
await trace('right', 2000)

const skc = await page.evaluate('window.__skc')
console.log(`\nsetKeyboardControls calls: ${skc.length}`)
for (const s of skc.slice(-20)) console.log(`  at=${s.at} hasKb=${s.hasKb} keysBefore=${s.keys} keysAfter=${s.after} dirs=${s.dirs}`)
const pid = await page.evaluate('window.__pid')
console.log(`\ncurrent player object identity changes: ${JSON.stringify(pid)}`)
const lt = await page.evaluate('window.__lt')
console.log(`\nlongtasks: ${lt.length}`)
for (const x of lt.slice(-25)) console.log(`  at=${x.at}  ${x.ms}ms`)
const pev = await page.evaluate('window.__pev ?? window.__pevErr')
if (Array.isArray(pev)) {
  console.log(`\nplayers signal events: ${pev.length} (types: ${JSON.stringify(pev.reduce((m, x) => (m[x.type] = (m[x.type] ?? 0) + 1, m), {}))})`)
  for (const x of pev.filter((x) => x.type !== 'update').slice(-25)) console.log(`  at=${x.at} ${x.type} ${x.key ?? ''}`)
} else {
  console.log('players signal events: ERR', pev)
}

await browser.close()
server.kill('SIGTERM')
