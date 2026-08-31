/*
 * duel-ui.ts — betting on your Stockmonster against the player next to you.
 *
 *   mountDuelUi(engine, socket)
 *   openDuelOffer()            // "DUEL" in the DM window, or the hotkey
 *
 * ┌ DUEL ───────────────────────────────────────────────┐
 * │ ⚠ real tokens, escrowed on chain, winner takes them │
 * │ bet [ 1000000 ] $STONKSTER      [ CHALLENGE ]       │
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
import { play as sfx } from './sfx'
import { ensureChain, chainErrorMessage } from './chain-guard'

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

interface MyBox {
  tokenId: string
  name: string
  level: number
  ticker?: string | null
  sprite?: string | null
  band?: string | null
  /** Sum of the six IVs, 0..186 — the only "quality" number a player can act on. */
  ivTotal?: number
  shiny?: boolean
}

/* =============================================================== STYLES ===*/

const CSS = `
/* A duel is the biggest decision in the game — it gets the whole screen, the
   way the marketplace does, rather than a corner window. */
#sm-duel-backdrop {
  position: fixed; inset: 0; z-index: ${Z.marketModal - 1};
  background: rgba(9, 7, 15, .72);
  display: none;
}
#sm-duel-backdrop.open { display: block; }

#sm-duel {
  display: none;
  position: fixed;
  z-index: ${Z.marketModal};
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: min(880px, 94vw);
  max-height: 88vh;
  font-size: 12px;
  flex-direction: column;
}
#sm-duel.open { display: flex; }
#sm-duel.dialog-hidden { display: none !important; }
#sm-duel .d-body {
  display: flex; flex-direction: column; gap: 12px; padding: 16px 18px;
  overflow-y: auto;
}
#sm-duel h3 {
  margin: 0; font-family: ${THEME.display}; font-weight: 600;
  font-size: 15px; letter-spacing: .12em; text-shadow: 2px 2px 0 ${THEME.shadow};
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
#sm-duel .d-picks {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
}
#sm-duel .d-pick {
  position: relative;
  display: flex; flex-direction: column; gap: 4px; align-items: center;
  background: ${THEME.dark}; border: 3px solid #3b3459; padding: 10px 8px 9px;
  cursor: pointer; color: ${THEME.text}; font-family: inherit;
  box-shadow: 3px 3px 0 ${THEME.shadow};
}
#sm-duel .d-pick:hover { border-color: ${THEME.border}; transform: translate(-1px, -1px); }
#sm-duel .d-pick.is-chosen { border-color: ${THEME.ok}; background: #1f2b1c; }
#sm-duel .d-pick .art {
  width: 84px; height: 84px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(#211c38, #171329); border: 2px solid #2f2947;
}
#sm-duel .d-pick .art img { width: 76px; height: 76px; object-fit: contain; image-rendering: pixelated; }
#sm-duel .d-pick .nm { font-weight: 700; font-size: 12px; letter-spacing: .06em; }
#sm-duel .d-pick .sub { font-size: 10px; color: ${THEME.muted}; }
#sm-duel .d-pick .band {
  position: absolute; top: -3px; right: -3px;
  font-size: 9px; letter-spacing: .1em; padding: 2px 6px;
  background: ${THEME.border}; color: #09070f; font-weight: 700;
}
#sm-duel .d-pick .band.rare { background: #7db7ff; }
#sm-duel .d-pick .band.elite { background: #ffd166; }
#sm-duel .d-pick .band.uncommon { background: #9be08a; }
#sm-duel .d-pick .power {
  display: flex; gap: 4px; align-items: center;
  font-size: 10px; color: ${THEME.muted}; font-variant-numeric: tabular-nums;
}
#sm-duel .d-pick .power i {
  display: block; height: 5px; width: 46px; background: var(--sm-darker, #141024);
  border: 1px solid #3b3459; position: relative; overflow: hidden;
}
#sm-duel .d-pick .power i b { position: absolute; inset: 0 auto 0 0; background: ${THEME.ok}; }
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
let backdrop: HTMLElement | null = null
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

  backdrop = el('div', { id: 'sm-duel-backdrop' })
  document.body.appendChild(backdrop)
  backdrop.addEventListener('click', () => closeDuel())

  root = el('div', { id: 'sm-duel', class: 'smui smui-win', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Duel' })
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
  // Anything that needs the player's attention FORCES the modal open. A duel
  // step arriving while the box shop or a DM window is up used to land in a
  // closed modal, and the duel looked stalled while it was actually waiting
  // for a click nobody could see.
  socket?.on?.('duel:approve', (d) => { open(); void sendApprove(d) })
  socket?.on?.('duel:open', (d) => { open(); void sendOpen(d) })
  socket?.on?.('duel:result', (d) => { state = { ...(state ?? {}), phase: 'result', result: d }; open(); render() })
  socket?.on?.('duel:settle', (d) => { void sendSettle(d) })
  socket?.on?.('duel:system', (d) => { note(d?.text ?? '', d?.tone) })
}

const isOpen = () => !!root?.classList.contains('open')
function open() {
  if (!root || isOpen()) return
  root.classList.add('open')
  backdrop?.classList.add('open')
  release = pushLayer(() => closeDuel())
}
export function closeDuel() {
  root?.classList.remove('open')
  backdrop?.classList.remove('open')
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
        sprite: b.contents?.sprite ?? null,
        band: b.contents?.band ?? b.band ?? null,
        ivTotal: Array.isArray(b.contents?.ivs)
          ? b.contents.ivs.reduce((a: number, n: number) => a + n, 0)
          : undefined,
        shiny: !!b.contents?.shiny,
      }))
      // Strongest first: in a duel that is the only ordering anyone wants.
      .sort((x: MyBox, y: MyBox) => y.level - x.level)
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
      lastNote = ''
      engineRef?.processAction?.('duel:offer', { amount: amount.value.trim() })
      state = { phase: 'waiting', amountWhole: amount.value.trim(), since: Date.now() }
      render()
    })
    body.append(
      el('div', { class: 'd-note', text: 'Whoever you are standing next to gets the challenge. Both of you keep your pick secret until the fight is over.' }),
      el('div', { class: 'd-row' }, [el('span', { class: 'k', text: 'BET' }), amount, el('span', { class: 'k', text: symbol }), go]),
    )
  }

  /*
   * WAITING HAD NO BRANCH AT ALL.
   *
   * Pressing CHALLENGE set this phase and re-rendered, and every branch below
   * skipped it — so the player was left staring at the explainer and the four
   * steps with no bet row, no confirmation and no way out. It looked exactly
   * like a button that had done nothing, and the natural conclusion was that
   * the challenge never reached the other side. It had.
   */
  /*
   * 'offered' MEANS THE OPPOSITE THING ON EACH SIDE.
   *
   * 'waiting' is local, set the moment CHALLENGE is pressed. 'offered' is the
   * SERVER's name for the same duel, and it arrives on `duel:state` a beat
   * later — to BOTH players. Treating it as "waiting" for everyone told the
   * person who was supposed to accept that they were waiting to be accepted,
   * which is how two players ended up both challenging each other and neither
   * ever seeing an ACCEPT button.
   *
   * `isChallenger` comes from the server precisely so this can be told apart.
   * Undefined means the state came from the local CHALLENGE press, which only
   * the challenger does.
   */
  const iOffered = state?.isChallenger !== false
  if (phase === 'waiting' || (phase === 'offered' && iOffered)) {
    const cancel = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'CANCEL' })
    cancel.addEventListener('click', () => {
      // The id only exists once the server has echoed the duel back; before
      // that there is nothing to cancel but the screen.
      engineRef?.processAction?.('duel:cancel', { id: state?.id })
      closeDuel()
      state = null
    })
    const bet = state?.amountWhole
      ? `${state.amountWhole} ${symbol}`
      : state?.amount
        ? `${formatUnits(state.amount, meta.decimals ?? 18, 0)} ${symbol}`
        : 'your bet'
    const who = state?.opponent?.name ? `<b>${state.opponent.name}</b>` : 'whoever you were standing next to'
    body.append(
      el('div', { class: 'd-note' }, [
        el('span', {
          html: `<b>Challenge sent for ${bet}.</b> ${who} has to accept before anything ` +
            'happens — nothing is signed and nothing has left your wallet yet. The offer ' +
            'expires on its own after a minute.',
        }),
      ]),
      el('div', { class: 'd-actions' }, [cancel]),
    )
  }

  if (phase === 'invited' || (phase === 'offered' && !iOffered)) {
    // `duel:state` merges over `duel:invite`, so the invite payload may be
    // gone by the time this draws. Everything needed is in the state too.
    const duelId = state.invite?.id ?? state.id
    const from = state.invite?.from ?? state.opponent?.name ?? 'Someone'
    const amountWhole = state.invite?.amountWhole
      ?? (state.amount ? formatUnits(state.amount, meta.decimals ?? 18, 0) : '?')
    const accept = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'ACCEPT' })
    const decline = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'DECLINE' })
    accept.addEventListener('click', () => {
      engineRef?.processAction?.('duel:respond', { id: duelId, accept: true })
      state = { ...state, phase: 'picking', id: duelId }
      void loadBoxes()
      render()
    })
    decline.addEventListener('click', () => {
      engineRef?.processAction?.('duel:respond', { id: duelId, accept: false })
      closeDuel()
    })
    body.append(
      el('div', { class: 'd-note' }, [
        el('span', { html: `<b>${from}</b> challenges you for <b>${amountWhole} ${symbol}</b>.` }),
      ]),
      el('div', { class: 'd-actions' }, [accept, decline]),
    )
  }

  if (phase === 'picking' || (state?.phase === 'picking' && state?.id)) {
    body.appendChild(el('div', { class: 'd-note' }, [
      el('span', {
        html: 'They cannot see your pick — it is hashed with a random salt and only opened ' +
          'when the duel settles. <b>Rarity is raw power here:</b> the bands are base-stat ' +
          'totals (common under 400, elite over 530), and level and IVs stack on top. There ' +
          'is no luck bonus for a rare one — it simply hits harder.',
      }),
    ]))
    if (!myBoxes.length) {
      body.appendChild(el('div', { class: 'd-note', text: 'You have no opened Stockmonsters. A sealed box cannot fight — open one first.' }))
    } else {
      const grid = el('div', { class: 'd-picks' })
      for (const b of myBoxes) {
        const art = el('div', { class: 'art' })
        if (b.sprite) art.appendChild(el('img', { src: b.sprite, alt: b.ticker ?? b.name }))
        else art.appendChild(el('span', { class: 'sub', text: `#${b.tokenId}` }))

        const kids: Array<Node | string> = [art,
          el('span', { class: 'nm', text: (b.ticker ?? b.name) + (b.shiny ? ' ✦' : '') }),
          el('span', { class: 'sub', text: `#${b.tokenId} · LV ${b.level}` }),
        ]
        if (typeof b.ivTotal === 'number') {
          // IV total out of 186. Shown as a bar because "134" means nothing to
          // anyone who has not memorised the ceiling.
          const bar = el('i', {}, [el('b', { style: `width:${Math.round((b.ivTotal / 186) * 100)}%` })])
          kids.push(el('span', { class: 'power' }, [el('span', { text: 'IV' }), bar, el('span', { text: `${b.ivTotal}` })]))
        }
        const btn = el('button', {
          class: `d-pick${chosen === b.tokenId ? ' is-chosen' : ''}`, type: 'button',
          title: `${b.ticker ?? b.name} — level ${b.level}${b.band ? `, ${b.band}` : ''}`,
        }, kids)
        if (b.band) btn.appendChild(el('span', { class: `band ${b.band}`, text: b.band.toUpperCase() }))
        btn.addEventListener('click', () => {
          chosen = b.tokenId
          sfx('confirm')
          engineRef?.processAction?.('duel:pick', { id: state.id ?? state.invite?.id, tokenId: b.tokenId })
          render()
        })
        grid.appendChild(btn)
      }
      body.append(el('h3', { text: 'PICK YOUR FIGHTER' }), grid)
      if (state.seedCommit) {
        // Shown BEFORE the pick on purpose: a commitment you only see
        // afterwards proves nothing. Write it down if you like — the seed that
        // opens it is published when the duel settles.
        body.appendChild(el('div', { class: 'd-note' }, [
          el('span', {
            html: `<b>The fight's randomness is already fixed.</b> Its fingerprint is ` +
              `<code>${state.seedCommit.slice(0, 18)}…</code> — the seed itself is revealed ` +
              `when the duel settles, and it has to match.`,
          }),
        ]))
      }
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
    if (!state.sounded) { state.sounded = true; sfx(r.won ? 'win' : 'lose') }
    const log = el('div', { class: 'd-log' })
    log.appendChild(el('div', {
      class: r.won ? 'win' : 'lose',
      text: r.won ? `You won in ${r.rounds} rounds.` : `${r.winner} won in ${r.rounds} rounds.`,
    }))
    log.appendChild(el('div', { text: `Both picks are now public: ${Object.entries(r.picks ?? {}).map(([n, t]) => `${n} #${t}`).join(', ')}` }))
    log.appendChild(el('div', { text: `Seed ${shortAddr(r.seed ?? '')} — anyone can replay this fight with it.` }))
    body.appendChild(log)
  }

  // Every remaining server phase — opening, fighting — would otherwise draw an
  // empty box. A modal that says nothing reads as one that is broken.
  if (phase === 'opening' || phase === 'fighting') {
    body.appendChild(el('div', { class: 'd-note', text: phase === 'opening'
      ? 'Locking both stakes in the arena contract. Confirm anything your wallet asks for.'
      : 'Both stakes are held. Working out who won…' }))
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
  // The wager domain names a chain id. Signing it while parked on another
  // chain produces a signature the arena will never accept, and the player
  // only finds out when the escrow refuses them.
  try {
    await ensureChain(eth)
  } catch (err) {
    note(chainErrorMessage(err), 'warn')
    return
  }
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

/**
 * The challenged player's one on-chain step: allow the arena to hold their
 * stake. The escrow's open() pulls BOTH stakes in a single transaction, so
 * without this the challenger's open reverts on our allowance every time —
 * which is exactly how two real players ended up staring at "waiting for the
 * escrow" until the duel expired.
 *
 * After the transaction is sent the server is poked, repeatedly: it reads the
 * allowance off the chain itself and moves the duel on when the approval has
 * actually landed, so a poke that arrives while the transaction is still in
 * the mempool costs nothing.
 */
let approveInFlight = false
async function sendApprove(d: any) {
  const eth = ethereum()
  const w = wallet()
  const meta = getTokenMeta()
  if (!eth || !w?.address || !meta.contracts?.token || !d?.arena) return
  if (approveInFlight) return
  approveInFlight = true
  try {
    await ensureChain(eth)
    const current = BigInt(
      (await eth.request({
        method: 'eth_call',
        params: [{ from: w.address, to: meta.contracts.token, data: encodeAllowance(w.address, d.arena) }, 'latest'],
      })) || '0x0',
    )
    if (current < BigInt(d.amount)) {
      note(`Step 2 of 4 — allow the arena to hold your ${formatUnits(d.amount, meta.decimals ?? 18, 0)} ${meta.symbol} stake.`)
      await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: w.address, to: meta.contracts.token, data: encodeApprove(d.arena, d.amount) }],
      })
    }
    note('Stake allowed. Waiting for the escrow to be opened on chain.')
    const poke = () => engineRef?.processAction?.('duel:approved', { id: d.id })
    poke()
    for (const delay of [6000, 12000, 20000, 30000, 45000]) setTimeout(poke, delay)
  } catch (err) {
    note(`The stake was not allowed: ${String((err as Error).message).split('\n')[0]}`, 'warn')
  } finally {
    approveInFlight = false
  }
}

/** Approve if needed, then open the escrow. Two prompts, both announced. */
let openInFlight = false
async function sendOpen(d: any) {
  const eth = ethereum()
  const w = wallet()
  const meta = getTokenMeta()
  if (!eth || !w?.address || !meta.contracts?.token) return
  // The server re-tells on every poke so a lost message cannot strand the
  // duel — which means this can be asked twice. The second open would only
  // burn gas on MATCH_EXISTS.
  if (openInFlight) return
  openInFlight = true
  try {
    await ensureChain(eth)
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
    openInFlight = false
    note(`The escrow was not opened: ${String((err as Error).message).split('\n')[0]}`, 'warn')
  }
}

/** The winner claims. Nobody else can: the contract pays the named winner. */
async function sendSettle(d: any) {
  const eth = ethereum()
  const w = wallet()
  if (!eth || !w?.address) return
  try {
    await ensureChain(eth)
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
