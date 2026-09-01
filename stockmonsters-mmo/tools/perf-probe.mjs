/*
 * Frame-rate dependence and stutter probe.
 *
 *   RPG_TYPE=mmorpg npx vite build       # dist must exist
 *   node --env-file-if-exists=.env tools/perf-probe.mjs
 *
 * Two player reports drove this: "the game runs much too fast on my friend's
 * PC" (a 144Hz display, if the loop steps per-frame) and "it stutters".
 * Guessing from the engine source settles neither, so this drives the real
 * game three times in headless Chrome at very different rAF rates — software
 * rendering (slow), the real GPU (this Mac's 120Hz), and the GPU with
 * `--disable-frame-rate-limit` (as fast as the machine can, which is what a
 * high-refresh monitor does to the loop) — and measures:
 *
 *   1. rAF rate actually achieved (proves the second run really is faster)
 *   2. walk speed in px/s: hold a direction for exactly 2000ms via the same
 *      __controls handle the game's own input uses, read player x before/after
 *   3. frame-time histogram over a 30s walk: frames >50ms are the stutters a
 *      player feels, and PerformanceObserver longtasks name the culprits' bins
 *
 * If px/s scales with the rAF rate, the loop is frame-stepped and the
 * "too fast" report is real. If px/s holds across an ~8x fps span, it is
 * time-stepped and the report is about something else (animation, camera, or
 * not reproducible).
 *
 * PROBE_MAPLOAD — the other stutter, and the one the walk test cannot see
 *
 *   PROBE_MAPLOAD=exterior,cave,river,beach node tools/perf-probe.mjs
 *   PROBE_CPU=6 PROBE_MAPLOAD=exterior,cave node tools/perf-probe.mjs
 *
 * The long freezes are not in the walk, they are in the LOAD, and the walk
 * test never sees one because it stays on a single map. This mode teleports
 * the player around a list of maps (it needs the dev teleport, which
 * startServer() turns on for its own server) and reports, per map, the
 * wall-clock time until the world is on screen and the frame times across that
 * window. The longest single blocked frame is the freeze a player feels.
 *
 * PROBE_CPU=n throttles the CPU through CDP. The stutter is reported on phones
 * and old laptops; on the machine this runs on, a load costs ~1.1s of CPU
 * spread over ~1.4s of wall clock and barely registers. x6 is roughly a
 * mid-range phone and is where a change has to prove itself.
 *
 * WHAT THIS MODE HAS ALREADY RULED OUT
 *
 * The obvious suspect is layer count: @rpgjs/tiledmap's `rebuildParsedMap`
 * clones the whole map and allocates a width*height array for EVERY tile
 * layer, and it runs once per arriving chunk (~20 times per load). Folding the
 * PSDK maps from 73-79 tile layers down to 13-28 (tools/merge-tile-layers.mjs)
 * moved the numbers by about 5% of map-load CPU and nothing outside the noise
 * on wall clock, at x1 and at x6. Instrumented directly, all of
 * `rebuildParsedMap` costs 2-12ms per load — it was never the bill. The ~1.1s
 * is diffuse, mostly inside canvasengine's signal-to-render chain, with no
 * single frame owning it. Whatever the freeze is, it is not the layer count.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import { privateKeyToAccount } from 'viem/accounts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PROBE_PORT ?? 4172)
const BASE = `http://localhost:${PORT}`
const ROOT = resolve(process.cwd())
// anvil account #0 — a well-known test key, never used for anything real.
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

async function startServer() {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    // SM_DEV_TELEPORT lets PROBE_MAPLOAD put the player on a named map. It is
    // a local, throwaway server; production's .env does not carry it.
    env: { ...process.env, PORT: String(PORT), SM_DEV_TELEPORT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const capture = (c) => { if (process.env.VERBOSE) process.stdout.write(`[server] ${c}`) }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  await until('server', async () => {
    try { return (await fetch(`${BASE}/health`)).ok } catch { return false }
  })
  return child
}

async function signIn(account) {
  const nonce = (await (await fetch(`${BASE}/auth/nonce`)).json()).nonce
  const message = `Stockmonsters login\nAddress: ${account.address}\nNonce: ${nonce}`
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, message, signature }),
  })
  if (!res.ok) throw new Error(`auth/verify failed: ${res.status}`)
  return res.json()
}

/* --------------------------------------------------- in-page primitives --*/

const READ_POS = `(() => {
  const e = window.__engine
  const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
  const p = s?.getCurrentPlayer?.()
  if (!p) return null
  const r = (v) => (typeof v === 'function' ? v() : v)
  return { x: r(p.x), y: r(p.y) }
})()`

/** rAF rate over `ms`, measured in the page. */
const measureFps = (page, ms = 2000) => page.evaluate((ms) => new Promise((done) => {
  let n = 0
  const t0 = performance.now()
  const loop = () => {
    n++
    if (performance.now() - t0 < ms) requestAnimationFrame(loop)
    else done(Math.round((n * 1000) / (performance.now() - t0)))
  }
  requestAnimationFrame(loop)
}), ms)

/**
 * Steady-state walk speed: hold a direction, skip the first 500ms (input
 * latency and acceleration), then measure distance over a real, in-page
 * measured window — nominal timer values lie under load.
 */
async function walkSpeed(page, dir, ms = 2000) {
  const r = await page.evaluate(async (dir, ms) => {
    const read = () => {
      const e = window.__engine
      const s = typeof e?.sceneMap === 'function' ? e.sceneMap() : e?.sceneMap
      const p = s?.getCurrentPlayer?.()
      const rd = (v) => { try { return typeof v === 'function' ? v() : v } catch { return undefined } }
      return {
        x: rd(p?.x), y: rd(p?.y),
        map: String(rd(s?.data)?.id ?? s?.id ?? '?'),
        canMove: rd(p?.canMove),
        dialog: !!document.querySelector('.rpg-ui-dialog'),
        transition: !!e?.mapTransitionInProgress,
      }
    }
    const c = window.__controls?.()
    await c.applyControl(dir, true)
    await new Promise((res) => setTimeout(res, 500))
    const t0 = performance.now()
    const p0 = read()
    await new Promise((res) => setTimeout(res, ms))
    const t1 = performance.now()
    const p1 = read()
    await c.applyControl(dir, false)
    return { dt: t1 - t0, dx: p1.x - p0.x, dy: p1.y - p0.y, p0, p1 }
  }, dir, ms)
  await sleep(300) // let the walk fully stop before the next run
  const d = Math.hypot(r.dx, r.dy)
  return { pxPerSec: (d / r.dt) * 1000, dist: d, dt: r.dt, p0: r.p0, p1: r.p1 }
}

/**
 * 30s of walking while recording every rAF delta and every longtask.
 * Returns a histogram of frame times and a stutter count.
 */
async function recordFrameTimes(page, seconds = 30) {
  await page.evaluate(() => {
    window.__ft = { deltas: [], long: [] }
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__ft.long.push(Math.round(e.duration))
      }).observe({ entryTypes: ['longtask'] })
    } catch {}
    let last = 0
    const loop = (t) => {
      if (!window.__ft) return // collection ended
      if (last) window.__ft.deltas.push(t - last)
      last = t
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  // Walk about while recording: 2s per direction, west/east so it round-trips.
  const t0 = Date.now()
  const dirs = ['left', 'right']
  let i = 0
  while (Date.now() - t0 < seconds * 1000) {
    const dir = dirs[i++ % dirs.length]
    await page.evaluate(async (dir) => {
      const c = window.__controls?.()
      await c.applyControl(dir, true)
      await new Promise((r) => setTimeout(r, 1800))
      await c.applyControl(dir, false)
    }, dir)
    await sleep(200)
  }
  const raw = await page.evaluate(() => { const v = window.__ft; window.__ft = null; return v })
  const { deltas, long } = raw
  const bins = { '<20ms': 0, '20-33ms': 0, '33-50ms': 0, '50-100ms': 0, '>100ms': 0 }
  for (const d of deltas) {
    if (d < 20) bins['<20ms']++
    else if (d < 33) bins['20-33ms']++
    else if (d < 50) bins['33-50ms']++
    else if (d < 100) bins['50-100ms']++
    else bins['>100ms']++
  }
  const sorted = [...deltas].sort((a, b) => a - b)
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
  return {
    frames: deltas.length,
    p50: +pct(50).toFixed(1),
    p95: +pct(95).toFixed(1),
    p99: +pct(99).toFixed(1),
    max: +Math.max(...deltas).toFixed(1),
    over50ms: bins['50-100ms'] + bins['>100ms'],
    bins,
    longtasks: long.length,
    longtaskTotalMs: long.reduce((a, b) => a + b, 0),
    worstLongtasks: long.sort((a, b) => b - a).slice(0, 5),
  }
}


/**
 * Teleport onto each map in turn and measure the freeze.
 *
 * Frame deltas are collected by a rAF loop that keeps running across the
 * transition; a frame that takes 900ms means the main thread was blocked for
 * 900ms, which is exactly the reported "it freezes when a map loads". The
 * "settled" time is from asking for the map to the first 500ms window in which
 * no frame took longer than 40ms, so it counts the whole load, not just the
 * moment the id changes.
 */
async function mapLoadProbe(page, maps) {
  const rows = []
  for (const map of maps) {
    const r = await page.evaluate(async (map) => {
      const engine = window.__engine
      const scene = () => (typeof engine?.sceneMap === 'function' ? engine.sceneMap() : engine?.sceneMap)
      const readId = () => {
        const s = scene()
        const rd = (v) => { try { return typeof v === 'function' ? v() : v } catch { return undefined } }
        return String(rd(s?.id) ?? '').replace(/^map-/, '')
      }
      const deltas = []
      let last = 0
      let stop = false
      const loop = (t) => {
        if (stop) return
        if (last) deltas.push(t - last)
        last = t
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
      await new Promise((r) => setTimeout(r, 400)) // baseline frames
      const from = readId()
      const t0 = performance.now()
      engine?.processAction?.('dev:goto', { map, x: 12, y: 12 })
      let arrived = 0
      const deadline = performance.now() + 25000
      // quiet = 500ms with no frame over 40ms, measured AFTER the id changed
      let quietFrom = 0
      for (;;) {
        await new Promise((r) => setTimeout(r, 100))
        if (!arrived && readId() === map) arrived = performance.now()
        if (arrived) {
          const recent = deltas.slice(-8)
          if (performance.now() - arrived > 300 && recent.every((d) => d < 40)) {
            if (!quietFrom) quietFrom = performance.now()
            if (performance.now() - quietFrom > 500) break
          } else quietFrom = 0
        }
        if (performance.now() > deadline) break
      }
      const t1 = performance.now()
      stop = true
      const during = deltas.slice(Math.max(0, deltas.findIndex((_, i) => i > 20)))
      return {
        map, from,
        arrivedMs: arrived ? Math.round(arrived - t0) : null,
        settledMs: Math.round(t1 - t0),
        worstFrame: Math.round(Math.max(0, ...during)),
        blockedMs: Math.round(during.filter((d) => d > 50).reduce((a, b) => a + b, 0)),
        framesOver50: during.filter((d) => d > 50).length,
        framesOver200: during.filter((d) => d > 200).length,
      }
    }, map)
    rows.push(r)
    console.log(
      `  ${r.map.padEnd(14)} arrived ${String(r.arrivedMs).padStart(5)}ms  settled ${String(r.settledMs).padStart(5)}ms` +
        `  worst frame ${String(r.worstFrame).padStart(5)}ms  blocked ${String(r.blockedMs).padStart(5)}ms` +
        `  (${r.framesOver50} frames >50ms, ${r.framesOver200} >200ms)`,
    )
    await sleep(500)
  }
  return rows
}

/* ----------------------------------------------------------- a session ---*/

async function runSession(label, extraArgs, wallet, { stutter = false, hz = 0, mapload = null } = {}) {
  console.log(`\n=== ${label} ===`)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), 'sm-perf-')),
    args: ['--window-size=1280,900', '--mute-audio', ...extraArgs],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
    if (hz > 0) {
      // Emulate an exact display refresh rate: keep a native rAF loop running
      // and dispatch queued callbacks only on the emulated cadence. Everything
      // in the engine (Scheduler, tick$, pixi) runs off window.rAF, so this is
      // indistinguishable from a real hz-rate monitor to the game. Combine
      // with --disable-frame-rate-limit to emulate rates ABOVE the host's.
      await page.evaluateOnNewDocument((hz) => {
        const native = window.requestAnimationFrame.bind(window)
        const stepMs = 1000 / hz
        let queue = new Map()
        let nextId = 1
        let due = 0
        window.requestAnimationFrame = (cb) => {
          const id = nextId++
          queue.set(id, cb)
          return id
        }
        window.cancelAnimationFrame = (id) => { queue.delete(id) }
        const pump = (t) => {
          native(pump)
          if (t < due || queue.size === 0) return
          // Track the cadence, but never build up a backlog after a stall.
          due = t - due > stepMs * 3 ? t + stepMs : due + stepMs
          const cbs = queue
          queue = new Map()
          for (const cb of cbs.values()) { try { cb(t) } catch {} }
        }
        native(pump)
      }, hz)
    }
    if (process.env.PROBE_CPU) {
      // The stutter is reported on phones and old laptops, not on the machine
      // this runs on. CDP's CPU throttle is the only honest way to see whether
      // a change matters where it hurts: 1 is this machine, 6 is roughly a
      // mid-range phone.
      const cdp = await page.target().createCDPSession()
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PROBE_CPU) })
      console.log(`  CPU throttled x${process.env.PROBE_CPU}`)
    }
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.evaluate((w) => {
      localStorage.setItem('sm-wallet', JSON.stringify(w))
      // A ready-made character skips the designer overlay entirely.
      localStorage.setItem('sm-character', JSON.stringify(['ch-cat-01-2']))
    }, wallet)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await until('player in world', () => page.evaluate(READ_POS))
    await until('controls handle', () => page.evaluate('!!window.__controls?.()'))
    await sleep(2000) // let boot-time work (spritesheets, HUD) settle

    const fps = await measureFps(page)
    console.log(`  rAF rate: ${fps} fps`)

    const runs = []
    // Right first: the spawn is close to a west wall, and a walk into a wall
    // measures the wall, not the speed.
    const walkDirs = process.env.PROBE_QUICK
      ? ['right', 'left', 'right', 'left', 'down', 'up', 'right', 'left']
      : ['right', 'left', 'right', 'left']
    for (const dir of walkDirs) {
      const r = await walkSpeed(page, dir)
      runs.push(r.pxPerSec)
      const flags = [
        r.p1.map !== r.p0.map ? `MAP ${r.p0.map}->${r.p1.map}` : '',
        r.p1.canMove === false ? 'canMove=false' : '',
        r.p1.dialog ? 'DIALOG' : '',
        r.p1.transition ? 'TRANSITION' : '',
      ].filter(Boolean).join(' ')
      console.log(`  walk ${dir.padEnd(5)} ${r.pxPerSec.toFixed(1)} px/s  (${r.dist.toFixed(0)}px in ${r.dt.toFixed(0)}ms)` +
        `  at ${Math.round(r.p0.x)},${Math.round(r.p0.y)} -> ${Math.round(r.p1.x)},${Math.round(r.p1.y)}${flags ? '  [' + flags + ']' : ''}`)
    }
    const best = Math.max(...runs) // walls can only shorten a run, never lengthen it
    console.log(`  speed (best of ${runs.length}): ${best.toFixed(1)} px/s`)

    let mapLoadReport = null
    if (mapload) {
      console.log('  teleporting between maps and timing each load...')
      mapLoadReport = await mapLoadProbe(page, mapload)
    }

    let frameReport = null
    if (stutter) {
      console.log('  recording 30s of frame times while walking...')
      frameReport = await recordFrameTimes(page)
      console.log(`  frames: ${frameReport.frames}  p50 ${frameReport.p50}ms  p95 ${frameReport.p95}ms  p99 ${frameReport.p99}ms  max ${frameReport.max}ms`)
      console.log(`  frames >50ms: ${frameReport.over50ms}  bins: ${JSON.stringify(frameReport.bins)}`)
      console.log(`  longtasks: ${frameReport.longtasks} (${frameReport.longtaskTotalMs}ms total)  worst: ${JSON.stringify(frameReport.worstLongtasks)}`)
    }
    if (process.env.PROBE_SHOT) {
      await page.screenshot({ path: process.env.PROBE_SHOT })
      console.log(`  screenshot: ${process.env.PROBE_SHOT}`)
    }
    return { fps, speed: best, runs, frameReport, mapLoadReport }
  } finally {
    await browser.close()
  }
}

/* ------------------------------------------------------------------ main --*/

const account = privateKeyToAccount(PRIVATE_KEY)
const server = await startServer()
try {
  const wallet = await signIn(account)
  console.log('signed in as', wallet.connectionId)

  const sessions = []
  const UNCAP = ['--disable-frame-rate-limit', '--disable-gpu-vsync']
  if (process.env.PROBE_MAPLOAD) {
    const maps = process.env.PROBE_MAPLOAD.split(',').map((m) => m.trim()).filter(Boolean)
    const r = await runSession('map loads (GPU)', [], wallet, { mapload: maps })
    const rows = r.mapLoadReport ?? []
    console.log('\n=== map-load verdict ===')
    console.log(`  total settle ${rows.reduce((a, b) => a + b.settledMs, 0)}ms across ${rows.length} maps`)
    console.log(`  total blocked (frames >50ms) ${rows.reduce((a, b) => a + b.blockedMs, 0)}ms`)
    console.log(`  worst single frame ${Math.max(0, ...rows.map((b) => b.worstFrame))}ms`)
    console.log(JSON.stringify(rows))
    server.kill('SIGTERM')
    process.exit(0)
  }
  if (process.env.PROBE_QUICK) {
    // One GPU session, walks only — for iterating on the harness itself.
    await runSession('GPU quick', [], wallet)
    server.kill('SIGTERM')
    process.exit(0)
  }
  if (process.env.PROBE_SOFTWARE) {
    sessions.push(['software', await runSession(
      'software rendering (CPU-bound, low fps)',
      ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
      wallet,
    )])
  }
  sessions.push(['60Hz', await runSession('emulated 60Hz display (GPU)', [], wallet, { hz: 60 })])
  sessions.push(['native', await runSession('GPU (host display rate)', [], wallet, { stutter: true })])
  sessions.push(['144Hz', await runSession('emulated 144Hz display (GPU, uncapped)', UNCAP, wallet, { hz: 144 })])
  sessions.push(['uncapped', await runSession('GPU uncapped (as fast as it can)', UNCAP, wallet)])

  console.log('\n=== verdict ===')
  for (const [label, r] of sessions) {
    console.log(`  ${label.padEnd(9)} ${String(r.fps).padStart(4)} fps   ${r.speed.toFixed(1)} px/s`)
  }
  const base = sessions.find(([l]) => l === '60Hz')[1]
  const high = sessions.find(([l]) => l === '144Hz')[1]
  const ratioSpeed = high.speed / base.speed
  console.log(`  60Hz -> 144Hz: speed x${ratioSpeed.toFixed(2)}`)
  if (ratioSpeed > 1.5) {
    console.log('  FRAME-STEPPED: movement scales with display rate — the "too fast" report is real.')
  } else {
    console.log('  TIME-STEPPED: a 144Hz display does not make the game meaningfully faster.')
  }
} finally {
  server.kill('SIGTERM')
}
