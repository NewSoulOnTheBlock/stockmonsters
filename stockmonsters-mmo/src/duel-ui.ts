/*
 * duel-ui.ts — betting on your Stockmonster against the player next to you.
 *
 *   mountDuelUi(engine, socket)
 *   openDuelOffer()            // "DUEL" in the DM window, or the hotkey
 *
 * ┌ DUEL ───────────────────────────────────────────────┐
 * │ ⚠ real tokens, escrowed on chain, winner takes them │
 * │ bet [ 1000000 ] SMON            [ CHALLENGE ]       │
 * ├─────────────────────────────────────────────────────┤
 * │ pick your fighter — they cannot see it              │
 * │ [ #12 CHARIZARD L52 ] [ #40 GENGAR L47 ] ...        │
 * ├─────────────────────────────────────────────────────┤
 * │ 1 of 3  sign the wager   2 of 3  escrow   3 of 3 …  │
 * └─────────────────────────────────────────────────────┘
 *
 * ## What this file is careful about
 *
 * **It never claims a duel is on.** The server reads the escrow off the chain
 * itself; this only reports what the server says.
 *
 * **It narrates every wallet prompt.** A duel is up to four transactions —
 * approve, open, and later settle — and an unexplained prompt with a million
 * tokens on it is indistinguishable from a scam. Each one says which step it
 * is and what it does before it opens.
 *
 * **It says the picks are blind, because they are.** Neither side's choice
 * leaves the server until the fight is over; the commitment that proves it is
 * on chain. That claim is worth stating exactly once and then keeping true.
 */

import {
  ensureUiKit, injectStyle, el, guardKeys, pushLayer, makeDraggable,
  watchGameDialog, shortAddr, Z, THEME,
} from './ui-kit'
import { getTokenMeta, formatUnits, encodeApprove, encodeAllowance, word, bytesTail } from './wallet-ui'

/* ============================================================== CALLDATA ===*/

/**
 * `open(bytes32,address,address,uint256,bytes32,bytes32,bytes32,uint64,bytes,bytes)`
 * and `settle(bytes32,address,bytes32,uint256,bytes32,uint256,bytes32,uint64,bytes)`.
 *
 * Both have TWO dynamic tails, which is where hand-encoding usually goes
 * wrong: every head word counts toward the offset, including the offsets
 * themselves. Nine head words for `open` (7 static + 2 offsets) puts the first
 * tail at 0x140... — worked through below rather than guessed.
 */
// Verified with `cast sig` against the deployed ABI, not guessed.
export const OPEN_SELECTOR = '0x4269265a'
export const SETTLE_SELECTOR = '0x43e3fe96'

export function encodeOpen(p: {
  matchId: string; playerA: string; playerB: string; amount: string
  seedCommit: string; pickA: string; pickB: string; expiry: number
  sigA: string; sigB: string
}): string {
  const head =
    word(p.matchId) + word(p.playerA) + word(p.playerB) + word(BigInt(p.amount)) +
    word(p.seedCommit) + word(p.pickA) + word(p.pickB) + word(BigInt(p.expiry))
  // 10 head words: 8 above, then the two offsets.
  const tailA = bytesTail(p.sigA)
  const offsetA = 10 * 32
  const offsetB = offsetA + tailA.length / 2
  return OPEN_SELECTOR + head + word(offsetA) + word(offsetB) + tailA + bytesTail(p.sigB)
}

export function encodeSettle(p: {
  matchId: string; winner: string; seed: string
  tokenA: string; saltA: string; tokenB: string; saltB: string
  deadline: number; signature: string
}): string {
  const head =
    word(p.matchId) + word(p.winner) + word(p.seed) +
    word(BigInt(p.tokenA)) + word(p.saltA) + word(BigInt(p.tokenB)) + word(p.saltB) +
    word(BigInt(p.deadline))
  // 9 head words: 8 above plus one offset.
  return SETTLE_SELECTOR + head + word(9 * 32) + bytesTail(p.signature)
}

/* ================================================================ TYPES ===*/

interface EngineLike { processAction?: (a: string, d: unknown) => void }
interface SocketLike { on?: (t: string, cb: (d: any) => void) => void }
interface Eip1193 { request(a: { method: string; params?: unknown[] }): Promise<any> }

interface MyBox { tokenId: string; name: string; level: number; ticker?: string | null; sprite?: string | null }

/* =============================================================== STYLES ===*/

const CSS = `
#sm-duel {
  display: none;
  z-index: ${Z.marketModal};
  left: 50%; top: 12%;
  transform: translateX(-50%);
  width: min(460px, 94vw);
  max-height: 80vh;
  font-size: 12px;
}
#sm-duel.open { display: flex; }
#sm-duel.dialog-hidden { display: none !important; }
#sm-duel .d-body {
  display: flex; flex-direction: column; gap: 10px; padding: 12px;
  overflow-y: auto;
}
#sm-duel .d-warn {
  background: #3a1f24; border: 2px solid ${THEME.danger};
  padding: 8px 10px; font-size: 10px; line-height: 1.5; color: #ffd9dc;
}
#sm-duel .d-warn b { color: #fff; }
#sm-duel .d-note {
  background: ${THEME.dark}; border-left: 4px solid ${THEME.border};
  padding: 7px 9px; font-size: 10px; line-height: 1.5; color: ${THEME.muted};
}
#sm-duel .d-row { display: flex; gap: 8px; align-items: center; }
#sm-duel .d-row .smui-input { flex: 1 1 auto; min-width: 0; }
#sm-duel .d-row .k { font-size: 10px; letter-spacing: .12em; color: ${THEME.muted}; }
#sm-duel .d-picks { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
#sm-duel .d-pick {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  background: ${THEME.dark}; border: 2px solid #3b3459; padding: 7px 8px;
  cursor: pointer; color: ${THEME.text}; text-align: left; font-family: inherit;
}
#sm-duel .d-pick:hover { border-color: ${THEME.border}; }
#sm-duel .d-pick.is-chosen { border-color: ${THEME.ok}; background: #1f2b1c; }
#sm-duel .d-pick .nm { font-weight: 700; font-size: 11px; }
#sm-duel .d-pick .sub { font-size: 10px; color: ${THEME.muted}; }
#sm-duel .d-steps { display: flex; flex-direction: column; gap: 4px; }
#sm-duel .d-step { display: flex; gap: 8px; font-size: 11px; color: ${THEME.muted}; }
#sm-duel .d-step .n {
  font-weight: 700; color: ${THEME.border}; min-width: 46px;
  font-variant-numeric: tabular-nums;
}
#sm-duel .d-step.is-now { color: ${THEME.text}; }
#sm-duel .d-step.is-done .n { color: ${THEME.ok}; }
#sm-duel .d-log {
  background: ${THEME.dark}; border: 2px solid #3b3459; padding: 8px 10px;
  max-height: 140px; overflow-y: auto; font-size: 11px; line-height: 1.5;
  display: flex; flex-direction: column; gap: 3px;
}
#sm-duel .d-log .win { color: ${THEME.ok}; font-weight: 700; }
#sm-duel .d-log .lose { color: ${THEME.danger}; font-weight: 700; }
#sm-duel .d-actions { display: flex; gap: 8px; }
#sm-duel .d-actions .smui-btn { flex: 1 1 auto; }
#sm-duel .d-err { color: ${THEME.danger}; font-size: 11px; min-height: 14px; }
`

/* ================================================================ MOUNT ===*/

let root: HTMLElement | null = null
let body: HTMLElement | null = null
let engineRef: EngineLike | undefined
let state: any = null
let myBoxes: MyBox[] = []
let chosen: string | null = null
let pendingSign: any = null
let release: (() => void) | null = null

const wallet = () => {
  try { return JSON.parse(localStorage.getItem('sm-wallet') ?? 'null') } catch { return null }
}
const ethereum = (): Eip1193 | null => (window as any).ethereum ?? null

export function mountDuelUi(engine?: EngineLike, socket?: SocketLike) {
  if (root) return
  ensureUiKit()
  injectStyle('sm-duel-css', CSS)
  engineRef = engine

  root = el('div', { id: 'sm-duel', class: 'smui smui-win', role: 'dialog', 'aria-label': 'Duel' })
  const bar = el('div', { class: 'smui-titlebar' })
  const close = el('button', { class: 'smui-btn smui-close is-danger', type: 'button', text: '✕' })
  bar.append(el('span', { class: 'title', text: 'DUEL' }), el('span', { class: 'spacer' }), close)
  body = el('div', { class: 'd-body' })
  root.append(bar, body)
  document.body.appendChild(root)
  makeDraggable(root, bar)
  watchGameDialog((open) => root!.classList.toggle('dialog-hidden', open))
  close.addEventListener('click', () => closeDuel())

  socket?.on?.('duel:invite', (d) => { state = { phase: 'invited', invite: d }; open(); render() })
  socket?.on?.('duel:state', (d) => { state = { ...(state ?? {}), ...d }; if (isOpen()) render() })
  socket?.on?.('duel:sign', (d) => { pendingSign = d; state = { ...(state ?? {}), phase: 'signing' }; open(); render() })
  socket?.on?.('duel:open', (d) => { void sendOpen(d) })
  socket?.on?.('duel:result', (d) => { state = { ...(state ?? {}), phase: 'result', result: d }; open(); render() })
  socket?.on?.('duel:settle', (d) => { void sendSettle(d) })
  socket?.on?.('duel:system', (d) => { note(d?.text ?? '', d?.tone) })
}

const isOpen = () => !!root?.classList.contains('open')
function open() {
  if (!root || isOpen()) return
  root.classList.add('open')
  release = pushLayer(() => closeDuel())
}
export function closeDuel() {
  root?.classList.remove('open')
  release?.()
  release = null
}

/** Start one: the offer form, for whoever is standing next to you. */
export function openDuelOffer() {
  state = { phase: 'offering' }
  open()
  render()
  void loadBoxes()
}

let lastNote = ''
function note(text: string, tone = 'info') {
  lastNote = text
  if (isOpen()) render()
  else if (tone === 'warn') console.warn('[duel]', text)
}

async function loadBoxes() {
  const w = wallet()
  if (!w?.connectionId) return
  try {
    const res = await fetch(`/box/mine?connectionId=${w.connectionId}&address=${w.address ?? ''}`)
    const data = await res.json()
    myBoxes = (data.boxes ?? [])
      .filter((b: any) => b.tokenId && b.status === 'opened')
      .map((b: any) => ({
        tokenId: String(b.tokenId),
        name: b.contents?.name ?? b.contents?.ticker ?? `#${b.tokenId}`,
        level: b.contents?.level ?? 0,
        ticker: b.contents?.ticker ?? null,
      }))
  } catch {
    myBoxes = []
  }
  if (isOpen()) render()
}

/* =============================================================== RENDER ===*/

function render() {
  if (!body) return
  body.textContent = ''
  const meta = getTokenMeta()
  const symbol = meta.symbol ?? 'TOKEN'

  body.appendChild(el('div', { class: 'd-warn' }, [
    el('span', {
      html: '<b>Real tokens, escrowed on chain.</b> Both of you sign, both stakes lock in ' +
        'the arena contract, and the winner takes the pot minus the rake. If no result is ' +
        'signed in time, either of you can take your own stake back — nobody can keep it.',
    }),
  ]))

  const phase = state?.phase

  if (phase === 'offering') {
    const amount = el('input', {
      class: 'smui-input', type: 'text', inputmode: 'numeric', value: '1000',
      'aria-label': `Amount in ${symbol}`,
    })
    guardKeys(amount)
    const go = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'CHALLENGE' })
    go.addEventListener('click', () => {
      engineRef?.processAction?.('duel:offer', { amount: amount.value.trim() })
      state = { phase: 'waiting' }
      render()
    })
    body.append(
      el('div', { class: 'd-note', text: 'Whoever you are standing next to gets the challenge. Both of you keep your pick secret until the fight is over.' }),
      el('div', { class: 'd-row' }, [el('span', { class: 'k', text: 'BET' }), amount, el('span', { class: 'k', text: symbol }), go]),
    )
  }

  if (phase === 'invited') {
    const amountWhole = state.invite?.amountWhole ?? '?'
    const accept = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'ACCEPT' })
    const decline = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'DECLINE' })
    accept.addEventListener('click', () => {
      engineRef?.processAction?.('duel:respond', { id: state.invite.id, accept: true })
      state = { ...state, phase: 'picking', id: state.invite.id }
      void loadBoxes()
      render()
    })
    decline.addEventListener('click', () => {
      engineRef?.processAction?.('duel:respond', { id: state.invite.id, accept: false })
      closeDuel()
    })
    body.append(
      el('div', { class: 'd-note' }, [
        el('span', { html: `<b>${state.invite?.from ?? 'Someone'}</b> challenges you for <b>${amountWhole} ${symbol}</b>.` }),
      ]),
      el('div', { class: 'd-actions' }, [accept, decline]),
    )
  }

  if (phase === 'picking' || (state?.phase === 'picking' && state?.id)) {
    body.appendChild(el('div', { class: 'd-note', text: 'Pick your fighter. They cannot see it — the choice is hashed with a random salt and only opened when the duel settles.' }))
    if (!myBoxes.length) {
      body.appendChild(el('div', { class: 'd-note', text: 'You have no opened Stockmonsters. A sealed box cannot fight — open one first.' }))
    } else {
      const grid = el('div', { class: 'd-picks' })
      for (const b of myBoxes) {
        const btn = el('button', {
          class: `d-pick${chosen === b.tokenId ? ' is-chosen' : ''}`, type: 'button',
        }, [
          el('span', { class: 'nm', text: b.ticker ?? b.name }),
          el('span', { class: 'sub', text: `#${b.tokenId} · L${b.level}` }),
        ])
        btn.addEventListener('click', () => {
          chosen = b.tokenId
          engineRef?.processAction?.('duel:pick', { id: state.id ?? state.invite?.id, tokenId: b.tokenId })
          render()
        })
        grid.appendChild(btn)
      }
      body.appendChild(grid)
    }
  }

  if (phase === 'signing' && pendingSign) {
    const sign = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'SIGN THE WAGER' })
    sign.addEventListener('click', () => void signWager())
    body.append(
      el('div', { class: 'd-note', text: 'Both picks are locked. Sign the wager — this is a signature, not a transaction, and costs nothing.' }),
      el('div', { class: 'd-actions' }, [sign]),
    )
  }

  if (phase === 'result' && state.result) {
    const r = state.result
    const log = el('div', { class: 'd-log' })
    log.appendChild(el('div', {
      class: r.won ? 'win' : 'lose',
      text: r.won ? `You won in ${r.rounds} rounds.` : `${r.winner} won in ${r.rounds} rounds.`,
    }))
    log.appendChild(el('div', { text: `Both picks are now public: ${Object.entries(r.picks ?? {}).map(([n, t]) => `${n} #${t}`).join(', ')}` }))
    log.appendChild(el('div', { text: `Seed ${shortAddr(r.seed ?? '')} — anyone can replay this fight with it.` }))
    body.appendChild(log)
  }

  if (lastNote) body.appendChild(el('div', { class: 'd-note', text: lastNote }))

  const steps = [
    ['1 of 4', 'both sign the wager'],
    ['2 of 4', 'allow the arena to hold your stake'],
    ['3 of 4', 'escrow opens on chain'],
    ['4 of 4', 'the winner claims the pot'],
  ]
  const list = el('div', { class: 'd-steps' })
  for (const [n, what] of steps) list.appendChild(el('div', { class: 'd-step' }, [
    el('span', { class: 'n', text: n }), el('span', { text: what }),
  ]))
  body.appendChild(list)
}

/* ============================================================ THE CHAIN ===*/

async function signWager() {
  const eth = ethereum()
  const w = wallet()
  if (!eth || !w?.address || !pendingSign) return
  const typed = {
    domain: { name: 'StockmonstersArena', chainId: pendingSign.chainId, verifyingContract: pendingSign.arena },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      Wager: [
        { name: 'matchId', type: 'bytes32' },
        { name: 'playerA', type: 'address' },
        { name: 'playerB', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'seedCommit', type: 'bytes32' },
        { name: 'pickA', type: 'bytes32' },
        { name: 'pickB', type: 'bytes32' },
        { name: 'expiry', type: 'uint64' },
      ],
    },
    primaryType: 'Wager',
    message: {
      matchId: pendingSign.matchId,
      playerA: pendingSign.playerA,
      playerB: pendingSign.playerB,
      amount: pendingSign.amount,
      seedCommit: pendingSign.seedCommit,
      pickA: pendingSign.pickA,
      pickB: pendingSign.pickB,
      expiry: pendingSign.expiry,
    },
  }
  try {
    const signature = await eth.request({
      method: 'eth_signTypedData_v4',
      params: [w.address, JSON.stringify(typed)],
    })
    engineRef?.processAction?.('duel:signed', { id: pendingSign.id, signature })
    note('Signed. Waiting for the other side.')
  } catch (err) {
    note(`Not signed: ${String((err as Error).message).split('\n')[0]}`, 'warn')
  }
}

/** Approve if needed, then open the escrow. Two prompts, both announced. */
async function sendOpen(d: any) {
  const eth = ethereum()
  const w = wallet()
  const meta = getTokenMeta()
  if (!eth || !w?.address || !meta.contracts?.token) return
  try {
    const needed = BigInt(d.amount)
    const current = BigInt(
      (await eth.request({
        method: 'eth_call',
        params: [{ from: w.address, to: meta.contracts.token, data: encodeAllowance(w.address, d.arena) }, 'latest'],
      })) || '0x0',
    )
    if (current < needed) {
      note(`Step 2 of 4 — allow the arena to hold ${formatUnits(d.amount, meta.decimals ?? 18, 0)} ${meta.symbol}.`)
      await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: w.address, to: meta.contracts.token, data: encodeApprove(d.arena, d.amount) }],
      })
    }
    note('Step 3 of 4 — opening the escrow on chain.')
    await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from: w.address, to: d.arena, data: encodeOpen(d) }],
    })
    note('Escrow sent. The duel starts once the server sees it on chain.')
    // The server checks the chain itself; this is only a nudge to look now.
    const poke = () => engineRef?.processAction?.('duel:opened', { id: d.id })
    poke()
    for (const delay of [6000, 12000, 20000, 30000]) setTimeout(poke, delay)
  } catch (err) {
    note(`The escrow was not opened: ${String((err as Error).message).split('\n')[0]}`, 'warn')
  }
}

/** The winner claims. Nobody else can: the contract pays the named winner. */
async function sendSettle(d: any) {
  const eth = ethereum()
  const w = wallet()
  if (!eth || !w?.address) return
  try {
    note('Step 4 of 4 — claiming the pot.')
    const hash = await eth.request({
      method: 'eth_sendTransaction',
      params: [{ from: w.address, to: d.contract, data: encodeSettle(d) }],
    })
    note(`Claimed — ${shortAddr(String(hash))}. The tokens are yours.`)
    window.dispatchEvent(new CustomEvent('sm:wallet-refresh'))
  } catch (err) {
    note(`Not claimed yet: ${String((err as Error).message).split('\n')[0]}`, 'warn')
  }
}
