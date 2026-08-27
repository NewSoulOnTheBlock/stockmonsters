/*
 * wallet-ui.ts — the player's money, on screen and in their own wallet.
 *
 *   mountWalletUi()   // reads /token, fixes up the HUD, owns the panel
 *
 * Three jobs:
 *
 * 1. **REPLACE THE INVENTED NUMBERS.** The HUD shipped with `ETH 0.482` and
 *    `SMON 12,400` hardcoded in `demoHudModel()` and marked PLACEHOLDER. This
 *    reads the real balances and pushes them in. If no token is configured the
 *    chips are REMOVED rather than left showing fiction — a fake balance is
 *    worse than no balance.
 *
 * 2. **PAY OUT WHAT THE GAME OWES.** Playing earns tokens; the server signs a
 *    claim; the player sends it themselves. No key on this server ever moves a
 *    player's money, and the pool cannot pay more in a day than the on-chain
 *    budget for that day — which is the whole containment story for the
 *    signing key (see StockmonstersRewards.sol).
 *
 * 3. **SAY WHAT IS TRUE.** Testnet, no token, an empty pool, an already-used
 *    epoch: each has its own sentence. Nothing here ever renders a zero with
 *    no explanation.
 *
 * Calldata is hand-encoded for the same reason box-shop.ts and dm-ui.ts do it:
 * viem is a server dependency, and ~60KB of browser bundle for two function
 * calls is not a trade worth making. Every selector below is verified with
 * `cast sig`.
 */

import {
  ensureUiKit, injectStyle, el, guardKeys, pushLayer, makeDraggable,
  watchGameDialog, shortAddr, Z, THEME,
} from './ui-kit'
import { getHud } from './hud'
import { ensureChain } from './chain-guard'

/* ============================================================== CALLDATA ===*/

/** `claim(uint256,uint256,uint64,bytes)` — verified: cast sig -> 6e6adbde */
export const CLAIM_SELECTOR = '0x6e6adbde'
/** `approve(address,uint256)` — the ERC-20 standard selector. */
export const APPROVE_SELECTOR = '0x095ea7b3'
/** `allowance(address,address)` */
export const ALLOWANCE_SELECTOR = '0xdd62ed3e'
/** `transfer(address,uint256)` — plain ERC-20, for gifting SMON to a player. */
export const TRANSFER_SELECTOR = '0xa9059cbb'
/** `mintCaughtERC20(bytes32,bytes32,address,uint256,uint64,bytes)` -> c4d409d0 */
export const MINT_ERC20_SELECTOR = '0xc4d409d0'

/** One ABI word: 32 bytes, right-aligned, no 0x. */
export function word(v: bigint | number | string): string {
  if (typeof v === 'string' && v.startsWith('0x')) {
    const s = v.slice(2).toLowerCase()
    if (s.length > 64) throw new Error(`value too wide for one word: ${v}`)
    return s.padStart(64, '0')
  }
  const b = typeof v === 'bigint' ? v : BigInt(v)
  if (b < 0n) throw new Error('negative')
  return b.toString(16).padStart(64, '0')
}

/** A dynamic `bytes` argument: length word, then the data padded to 32. */
export function bytesTail(hex: string): string {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex
  const len = body.length / 2
  const padded = body.padEnd(Math.ceil(body.length / 64) * 64, '0')
  return word(len) + padded
}

/**
 * `claim(epoch, amount, deadline, signature)`.
 *
 * Three static words then an offset to the bytes — 4 head words means the tail
 * starts at 0x80. Getting that offset wrong is the classic hand-encoding bug:
 * the call does not revert, it reads garbage as the signature and fails with
 * BAD_SIGNATURE, which sends you looking in the wrong place entirely.
 */
export function encodeClaim(epoch: bigint | number, amount: string, deadline: number, signature: string): string {
  return (
    CLAIM_SELECTOR +
    word(BigInt(epoch)) +
    word(BigInt(amount)) +
    word(BigInt(deadline)) +
    word(4 * 32) +
    bytesTail(signature)
  )
}

export function encodeApprove(spender: string, amount: string): string {
  return APPROVE_SELECTOR + word(spender) + word(BigInt(amount))
}

export function encodeAllowance(owner: string, spender: string): string {
  return ALLOWANCE_SELECTOR + word(owner) + word(spender)
}

/** `transfer(to, amount)` on the game token. */
export function encodeTransfer(to: string, amount: string): string {
  return TRANSFER_SELECTOR + word(to) + word(BigInt(amount))
}

/**
 * A decimal string into a token's base units.
 *
 * `parseEth` in ui-kit hardcodes 18, which is right for ether and wrong for a
 * token that describes its own decimals — and being wrong here is a factor of
 * a million in somebody's gift. Returns null for anything that is not a
 * positive number, so the caller never has to guess whether "" meant zero.
 */
export function parseUnits(text: string, decimals: number): string | null {
  const t = text.trim()
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null
  const d = Number.isFinite(decimals) && decimals >= 0 ? Math.floor(decimals) : 18
  const [wholeRaw, fracRaw = ''] = t.split('.')
  const frac = (fracRaw + '0'.repeat(d)).slice(0, d)
  const total = BigInt(wholeRaw || '0') * 10n ** BigInt(d) + BigInt(frac || '0')
  return total > 0n ? total.toString() : null
}

/** `mintCaughtERC20(attrCommit, uid, currency, fee, deadline, signature)` */
export function encodeMintErc20(
  attrCommit: string,
  uid: string,
  currency: string,
  fee: string,
  deadline: number,
  signature: string,
): string {
  return (
    MINT_ERC20_SELECTOR +
    word(attrCommit) +
    word(uid) +
    word(currency) +
    word(BigInt(fee)) +
    word(BigInt(deadline)) +
    word(6 * 32) +
    bytesTail(signature)
  )
}

/* ================================================================ TYPES ===*/

export interface TokenMeta {
  configured: boolean
  chainId?: number
  address?: string
  name?: string
  symbol?: string
  decimals?: number
  logo?: string
  description?: string
  liquidityPool?: string | null
  contracts?: { token: string; rewards: string | null; treasury: string | null; market: string | null; nft: string | null }
}

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<any> }

/* =============================================================== FORMAT ===*/

/** Base units -> a human string, without pulling in a big-decimal library. */
export function formatUnits(raw: string, decimals: number, maxFraction = 4): string {
  const negative = raw.startsWith('-')
  const digits = (negative ? raw.slice(1) : raw).padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  let fraction = digits.slice(digits.length - decimals).slice(0, maxFraction).replace(/0+$/, '')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (negative ? '-' : '') + grouped + (fraction ? `.${fraction}` : '')
}

/* =============================================================== STYLES ===*/

const CSS = `
#sm-wallet {
  display: none;
  z-index: ${Z.marketWindow};
  /* Clear of the HUD's player card and currency chips, which own the top-left
     corner. It is draggable from there. */
  left: 24px; top: 232px;
  width: min(360px, 92vw);
  font-size: 12px;
}
#sm-wallet.open { display: flex; }
#sm-wallet.dialog-hidden { display: none !important; }

#sm-wallet .w-body { display: flex; flex-direction: column; gap: 10px; padding: 12px; }

#sm-wallet .w-token {
  display: flex; align-items: center; gap: 10px;
  background: ${THEME.dark}; border: 2px solid ${THEME.border};
  padding: 9px 10px;
}
#sm-wallet .w-token img { width: 28px; height: 28px; image-rendering: pixelated; }
#sm-wallet .w-token .sym { font-weight: 700; letter-spacing: .08em; color: ${THEME.border}; }
#sm-wallet .w-token .addr { margin-left: auto; color: ${THEME.muted}; font-size: 10px; }

#sm-wallet .w-rows { display: flex; flex-direction: column; gap: 6px; }
#sm-wallet .w-row {
  display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
  background: ${THEME.dark}; border: 2px solid #3b3459; padding: 8px 10px;
}
#sm-wallet .w-row .k { color: ${THEME.muted}; font-size: 10px; letter-spacing: .1em; }
#sm-wallet .w-row .v { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
#sm-wallet .w-row.is-claim .v { color: ${THEME.ok}; }

#sm-wallet .w-note {
  font-size: 10px; line-height: 1.5; color: ${THEME.muted};
  background: ${THEME.dark}; border-left: 4px solid ${THEME.border}; padding: 7px 9px;
}
#sm-wallet .w-note b { color: ${THEME.text}; }
#sm-wallet .w-err { color: ${THEME.danger}; font-size: 11px; min-height: 14px; }
#sm-wallet .w-actions { display: flex; gap: 8px; }
#sm-wallet .w-actions .smui-btn { flex: 1 1 auto; }
`

/* ================================================================ MOUNT ===*/

let meta: TokenMeta = { configured: false }
let panel: HTMLElement | null = null
let refreshTimer: any = null

const wallet = (): { address?: string; connectionId?: string } | null => {
  try { return JSON.parse(localStorage.getItem('sm-wallet') ?? 'null') } catch { return null }
}
const ethereum = (): Eip1193 | null => (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null

export function getTokenMeta(): TokenMeta { return meta }

export async function mountWalletUi(): Promise<void> {
  ensureUiKit()
  injectStyle('sm-wallet-css', CSS)

  try {
    meta = await (await fetch('/token')).json()
  } catch {
    meta = { configured: false }
  }

  const hud = getHud()
  if (!meta.configured) {
    // No token on this server. Remove the placeholder currency chips rather
    // than leave numbers nobody can act on.
    hud?.update({ chips: (hud.getModel().chips ?? []).filter((c: any) => c.id !== 'eth' && c.id !== 'smon') })
    return
  }

  build()
  await refresh()
  refreshTimer = setInterval(() => { void refresh() }, 30_000)
  window.addEventListener('beforeunload', () => clearInterval(refreshTimer))
  window.addEventListener('sm:wallet-refresh', () => { void refresh() })
  // A first-time player connects their wallet AFTER this mounted — the title
  // screen sits on top of an already-running game. Without this the HUD kept
  // the placeholder chips (the invented `SMON 12,400`) for the whole session,
  // which is the worst possible thing for a number to do.
  window.addEventListener('sm:wallet', () => { void refresh() })
}

function build() {
  const root = el('div', {
    id: 'sm-wallet', class: 'smui smui-win', role: 'dialog', 'aria-label': 'Wallet',
  })
  const titlebar = el('div', { class: 'smui-titlebar' })
  const close = el('button', {
    class: 'smui-btn smui-close is-danger', type: 'button', 'aria-label': 'Close wallet', text: '✕',
  })
  titlebar.append(el('span', { class: 'title', text: 'WALLET' }), el('span', { class: 'spacer' }), close)
  const body = el('div', { class: 'w-body' })
  root.append(titlebar, body)
  document.body.appendChild(root)
  makeDraggable(root, titlebar)
  watchGameDialog((open) => root.classList.toggle('dialog-hidden', open))
  close.addEventListener('click', () => closeWallet())
  panel = root

  // The HUD's currency chips open this.
  document.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement)?.closest?.('#sm-hud .smui-chip') as HTMLElement | null
    if (!chip) return
    const label = chip.getAttribute('title') ?? ''
    if (/^(ETH|BOXES|STREAK)/.test(label) || label.startsWith(meta.symbol ?? '§')) openWallet()
  })
}

let release: (() => void) | null = null
export function openWallet() {
  if (!panel) return
  panel.classList.add('open')
  release = pushLayer(() => closeWallet())
  void refresh()
}
export function closeWallet() {
  panel?.classList.remove('open')
  release?.()
  release = null
}

/* --------------------------------------------------------------- state ---*/

interface Balances { formatted: string; raw: string; eth: string; symbol: string; decimals: number }
interface Claimable {
  configured: boolean
  epoch: number
  earned: string
  claimable: string
  claimableRaw: string
  alreadyClaimed: boolean
  reason: string | null
  canSign: boolean
  symbol: string
}

let balances: Balances | null = null
let claim: Claimable | null = null

async function refresh() {
  const w = wallet()
  if (!w?.address || !meta.configured) return
  try {
    balances = await (await fetch(`/token/balance?address=${w.address}`)).json()
  } catch { /* keep the last known figure rather than blanking it */ }
  if (w.connectionId) {
    try {
      claim = await (
        await fetch(`/rewards/mine?address=${w.address}&connectionId=${w.connectionId}`)
      ).json()
    } catch { /* same */ }
  }
  pushChips()
  if (panel?.classList.contains('open')) render()
}

/** The real numbers, into the HUD that used to invent them. */
function pushChips() {
  const hud = getHud()
  if (!hud || !balances) return
  const chips = (hud.getModel().chips ?? []).map((c: any) => {
    if (c.id === 'eth') return { ...c, value: Number(balances!.eth).toFixed(4) }
    if (c.id === 'smon') return { ...c, label: balances!.symbol, value: formatUnits(balances!.raw, balances!.decimals, 2) }
    return c
  })
  // A claimable balance is worth seeing without opening anything.
  const pending = claim && Number(claim.claimable) > 0
    ? [{ id: 'claim', icon: 'star', label: 'TO CLAIM', value: claim.claimable, tone: 'ok' }]
    : []
  hud.update({ chips: [...chips.filter((c: any) => c.id !== 'claim'), ...pending] })
}

function render() {
  if (!panel) return
  const body = panel.querySelector('.w-body') as HTMLElement
  body.textContent = ''
  const w = wallet()

  const head = el('div', { class: 'w-token' })
  if (meta.logo) head.appendChild(el('img', { src: meta.logo, alt: '' }))
  head.append(
    el('span', { class: 'sym', text: meta.symbol ?? '' }),
    el('span', { text: meta.name ?? '' }),
    el('span', { class: 'addr', text: shortAddr(meta.address ?? '') }),
  )
  body.appendChild(head)

  const rows = el('div', { class: 'w-rows' })
  const row = (k: string, v: string, cls = '') =>
    el('div', { class: `w-row ${cls}` }, [el('span', { class: 'k', text: k }), el('span', { class: 'v', text: v })])

  rows.append(
    row('IN YOUR WALLET', balances ? `${formatUnits(balances.raw, balances.decimals, 2)} ${balances.symbol}` : '—'),
    row('ETH FOR GAS', balances ? Number(balances.eth).toFixed(4) : '—'),
  )
  if (claim?.configured) {
    rows.append(
      row(`EARNED THIS EPOCH (#${claim.epoch})`, `${claim.earned} ${claim.symbol}`),
      row('READY TO CLAIM', `${claim.claimable} ${claim.symbol}`, 'is-claim'),
    )
  }
  body.appendChild(rows)

  const err = el('div', { class: 'w-err', text: '' })
  const claimBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'CLAIM REWARDS' })
  const canClaim = !!claim?.configured && Number(claim.claimable) > 0 && claim.canSign
  claimBtn.disabled = !canClaim

  body.appendChild(el('div', { class: 'w-note' }, [
    el('span', {
      html: claim?.reason
        ? claim.reason
        : '<b>Playing pays.</b> Battles, new species and new places earn tokens from the ' +
          'rewards pool — which is filled by trading tax and by the treasury buying back ' +
          'with real revenue. The game never mints new supply.',
    }),
  ]))
  body.append(err, el('div', { class: 'w-actions' }, [claimBtn]))

  claimBtn.addEventListener('click', async () => {
    err.textContent = ''
    const eth = ethereum()
    if (!eth || !w?.address) { err.textContent = 'No browser wallet found.'; return }
    claimBtn.disabled = true
    claimBtn.textContent = 'CHECKING YOUR NETWORK…'
    try {
      await ensureChain(eth)
      claimBtn.textContent = 'ASKING THE SERVER…'
      const res = await fetch('/rewards/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: w.address, connectionId: w.connectionId }),
      })
      const signed = await res.json()
      if (!res.ok) throw new Error(signed.message ?? signed.error ?? 'The server refused.')

      claimBtn.textContent = 'CONFIRM IN YOUR WALLET…'
      const data = encodeClaim(signed.epoch, signed.amount, signed.deadline, signed.signature)
      const hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from: w.address, to: signed.contract, data }],
      })
      claimBtn.textContent = 'SENT'
      err.textContent = ''
      body.appendChild(el('div', { class: 'w-note' }, [
        el('span', { html: `Claim sent — <b>${signed.formatted} ${signed.symbol}</b>. ${shortAddr(String(hash))}` }),
      ]))
      setTimeout(() => { void refresh() }, 6000)
    } catch (e) {
      claimBtn.disabled = false
      claimBtn.textContent = 'CLAIM REWARDS'
      err.textContent = String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200)
    }
  })
}
