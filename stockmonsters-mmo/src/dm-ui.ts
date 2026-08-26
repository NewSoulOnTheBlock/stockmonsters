/*
 * dm-ui.ts — the direct-message window.
 *
 *   mountDmUi(engine, socket)   // create it (hidden) at boot
 *   openDmWith(id)              // open it for a specific player id
 *
 * ┌ titlebar (draggable) · peer name · close ───────────────────────────────┐
 * │ ⚠ nothing here is stored — it lives only while you are both online      │
 * ├ conversation ──────────────────────────────────────────────────────────┤
 * │ input                                                       [ SEND ]   │
 * ├────────────────────────────────────────────────────────────────────────┤
 * │ [ BLOCK ]                              [ SEND TOKEN ]  [ SEND NFT ]    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Sibling of marketplace.ts and box-shop.ts by construction: the same ui-kit
 * (`ensureUiKit`, `injectStyle`, `el`, `guardKeys`, `pushLayer`,
 * `watchGameDialog`, `makeDraggable`), the same THEME and the same Z budget, so
 * it reads as another window in the game rather than a form on top of it.
 *
 * ── FOUR RULES THIS FILE KEEPS ──────────────────────────────────────────────
 *
 * 1. THE EPHEMERAL LINE IS NOT DECORATION. A window that looks like every other
 *    chat window will be assumed to have history. It says, on screen and every
 *    time, that nothing is saved. Never remove it to save space.
 *
 * 2. THE ACTION KEY IS READ HERE, IN THE DOM. An RPG-JS `onAction` only fires
 *    for EVENTS the player is facing, and players are not events, so the server
 *    cannot be told "I pressed space at Bob". We listen for the key ourselves
 *    and ask `dm:nearby`; the server decides who is close. And because
 *    `processAction` is dropped while the player cannot act, one send is not
 *    assumed to arrive — see `askNearby`, which retries.
 *
 * 3. THE KEY IS NEVER SWALLOWED. Space still talks to NPCs, still types a space
 *    into chat, still presses a focused button. We do not preventDefault and we
 *    stand down whenever a dialog, a text field or another window owns the
 *    moment.
 *
 * 4. THE PLAYER'S OWN WALLET MOVES THE VALUE. The server hands over an address
 *    and nothing else. Every gift is confirmed against the real recipient and
 *    the real amount BEFORE the wallet opens, and says plainly that a transfer
 *    on chain cannot be undone.
 */

import {
  ensureUiKit, injectStyle, el, guardKeys, pushLayer, layerDepth,
  makeDraggable, watchGameDialog, parseEth, formatEth, shortAddr, Z, THEME,
} from './ui-kit'

/* ================================================================ TYPES ===*/

export interface DmPeer { id: string; name: string; hasWallet: boolean }

interface EngineLike { processAction?: (action: string, data: unknown) => void }
interface SocketLike { on?: (type: string, cb: (data: any) => void) => void }
interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<any> }

export interface DmUiApi {
  openWith(id: string, name?: string): void
  close(): void
  isOpen(): boolean
  destroy(): void
  root: HTMLElement
}

/* ============================================================= CALLDATA ===*/

/**
 * `safeTransferFrom(address,address,uint256)` — ERC-721.
 *
 * VERIFIED against the compiled artifact:
 *   contracts/out/StockmonstersNFT.sol/StockmonstersNFT.json
 *   → methodIdentifiers["safeTransferFrom(address,address,uint256)"] = 42842e0e
 * Regenerate the same way box-shop.ts does (`node tools/lootbox-cli.mjs
 * selectors`). Hand-encoded for the same reason as box-shop's two calls: viem
 * is a server dependency and ~60 KB of browser bundle for one three-word call
 * is not a trade worth making.
 *
 * NOTE the overload: `safeTransferFrom(address,address,uint256,bytes)` is a
 * DIFFERENT selector (0xb88d4fde). This is the three-argument one.
 */
export const NFT_SAFE_TRANSFER_FROM = '0x42842e0e'

/** One ABI word: 32 bytes, right-aligned, no 0x. */
function word(v: bigint | number | string): string {
  if (typeof v === 'string' && v.startsWith('0x')) {
    const s = v.slice(2).toLowerCase()
    if (s.length > 64) throw new Error(`value too wide for one word: ${v}`)
    return s.padStart(64, '0')
  }
  const b = typeof v === 'bigint' ? v : BigInt(v)
  if (b < 0n) throw new Error('negative')
  return b.toString(16).padStart(64, '0')
}

/** `safeTransferFrom(address,address,uint256)` — three static words. */
export function encodeSafeTransferFrom(from: string, to: string, tokenId: string): string {
  return NFT_SAFE_TRANSFER_FROM + word(from) + word(to) + word(BigInt(tokenId))
}

/* =============================================================== STYLES ===*/

const CSS = `
#sm-dm {
  display: none;
  z-index: ${Z.marketWindow};
  right: 20px; bottom: 20px;
  width: min(400px, 94vw);
  max-height: min(560px, 82vh);
  font-size: 12px;
}
#sm-dm.open { display: flex; }
#sm-dm.dialog-hidden { display: none !important; }

#sm-dm .dm-peer {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: .06em;
  color: ${THEME.ok};
  max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#sm-dm .dm-peer .dot {
  width: 8px; height: 8px; flex: 0 0 8px;
  background: ${THEME.ok}; box-shadow: 0 0 0 2px ${THEME.shadow};
}
#sm-dm .dm-peer.is-blocked { color: ${THEME.danger}; }
#sm-dm .dm-peer.is-blocked .dot { background: ${THEME.danger}; }

#sm-dm .dm-body { display: flex; flex-direction: column; min-height: 0; padding: 10px; gap: 8px; }

/* RULE 1 — this line is load-bearing, not chrome. */
#sm-dm .dm-ephemeral {
  display: flex; align-items: flex-start; gap: 7px;
  background: ${THEME.dark};
  border: 2px solid ${THEME.border};
  border-left-width: 6px;
  padding: 7px 9px;
  font-size: 10px; line-height: 1.45; letter-spacing: .02em;
  color: ${THEME.muted};
}
#sm-dm .dm-ephemeral b { color: ${THEME.text}; font-weight: 700; }
#sm-dm .dm-ephemeral .mark { color: ${THEME.border}; font-size: 12px; line-height: 1.2; }

#sm-dm .dm-log {
  flex: 1 1 auto; min-height: 130px;
  padding: 9px 10px;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 6px;
  line-height: 1.5;
}
#sm-dm .dm-log .line { word-break: break-word; }
#sm-dm .dm-log .who { font-weight: 700; }
#sm-dm .dm-log .line.mine .who { color: ${THEME.border}; }
#sm-dm .dm-log .line.theirs .who { color: ${THEME.ok}; }
#sm-dm .dm-log .line.sys { color: ${THEME.border}; font-style: italic; font-size: 11px; }
#sm-dm .dm-log .line.warn { color: ${THEME.danger}; font-style: italic; font-size: 11px; }
#sm-dm .dm-log .line.tx { color: ${THEME.muted}; font-size: 11px; }
#sm-dm .dm-log .empty { color: #6f6790; font-size: 11px; font-style: italic; }

#sm-dm .dm-row { display: flex; gap: 8px; }
#sm-dm .dm-row .smui-input { flex: 1 1 auto; min-width: 0; }
#sm-dm .dm-row .smui-btn { flex: 0 0 auto; }

#sm-dm .dm-actions { display: flex; gap: 8px; }
#sm-dm .dm-actions .spacer { flex: 1 1 auto; }
#sm-dm .dm-actions .smui-btn { font-size: 11px; padding: 7px 10px; }

/* --- gift sheet ---------------------------------------------------------- */
#sm-dm .dm-sheet { display: none; flex-direction: column; gap: 8px; padding: 10px; }
#sm-dm .dm-sheet.open { display: flex; }
#sm-dm .dm-sheet h3 {
  margin: 0; font-family: ${THEME.display};
  font-weight: 600; font-size: 13px; letter-spacing: .12em;
  text-shadow: 2px 2px 0 ${THEME.shadow};
}
#sm-dm .dm-sheet label { display: block; font-size: 10px; letter-spacing: .08em; color: ${THEME.muted}; margin-bottom: 4px; }
#sm-dm .dm-to {
  display: flex; justify-content: space-between; gap: 8px;
  background: ${THEME.dark}; border: 2px solid ${THEME.border};
  padding: 7px 9px; font-size: 11px;
}
#sm-dm .dm-to .addr { color: ${THEME.muted}; }
#sm-dm .dm-warn {
  background: #3a1f24; border: 2px solid ${THEME.danger};
  padding: 8px 9px; font-size: 10px; line-height: 1.5; color: #ffd9dc;
}
#sm-dm .dm-warn b { color: #fff; }
#sm-dm .dm-sheet .dm-err { color: ${THEME.danger}; font-size: 11px; min-height: 14px; }
#sm-dm .dm-sheet .row { display: flex; gap: 8px; }
#sm-dm .dm-sheet .row .smui-btn { flex: 1 1 auto; }

/* --- blocked banner ------------------------------------------------------ */
#sm-dm .dm-banner {
  display: none;
  background: #3a1f24; border: 2px solid ${THEME.danger};
  padding: 7px 9px; font-size: 11px; color: #ffd9dc;
}
#sm-dm.is-blocked .dm-banner { display: block; }
#sm-dm.is-blocked .dm-row { opacity: .45; }

/* --- "nobody is there" toast --------------------------------------------- */
#sm-dm-toast {
  position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
  z-index: ${Z.marketToast};
  padding: 9px 14px;
  background: ${THEME.surface}; border: 3px solid ${THEME.border};
  box-shadow: 3px 3px 0 ${THEME.shadow};
  font-family: ${THEME.mono}; font-size: 12px; color: ${THEME.text};
  opacity: 0; pointer-events: none; transition: opacity .16s linear;
}
#sm-dm-toast.on { opacity: 1; }
`

/* ================================================================ MOUNT ===*/

let instance: DmUiApi | null = null

export function mountDmUi(engine?: EngineLike, socket?: SocketLike): DmUiApi {
  if (instance) return instance
  ensureUiKit()
  injectStyle('sm-dm-css', CSS)

  /* --- state ------------------------------------------------------------- */
  let peer: DmPeer | null = null
  /** Player ids this client has blocked, so BLOCK can flip to UNBLOCK. */
  const blocked = new Set<string>()
  /** Names learned from nearby results and messages, for openDmWith(id). */
  const names = new Map<string, string>()
  /** 'token' | 'nft' while a gift sheet is waiting for the peer's address. */
  let giftKind: 'token' | 'nft' | null = null
  let nftContract: string | null | undefined // undefined = not fetched yet
  let nearbyTimer: any = null
  let nearbyTries = 0
  let giftTimer: any = null
  let giftTries = 0

  const myWallet = (): { address?: string; connectionId?: string } | null => {
    try { return JSON.parse(localStorage.getItem('sm-wallet') ?? 'null') } catch { return null }
  }
  const ethereum = (): Eip1193 | null =>
    (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null

  /* --- chrome ------------------------------------------------------------ */
  const root = el('div', {
    id: 'sm-dm', class: 'smui smui-win',
    role: 'dialog', 'aria-label': 'Direct message', 'aria-modal': 'false',
  })

  const titlebar = el('div', { class: 'smui-titlebar' })
  const peerChip = el('span', { class: 'dm-peer' }, [
    el('span', { class: 'dot' }), el('span', { class: 'nm', text: '—' }),
  ])
  const closeBtn = el('button', {
    class: 'smui-btn smui-close is-danger', type: 'button',
    'aria-label': 'Close direct message', text: '✕',
  })
  titlebar.append(
    el('span', { class: 'title', text: 'DIRECT MESSAGE' }),
    el('span', { class: 'spacer' }),
    peerChip,
    closeBtn,
  )

  /* --- body -------------------------------------------------------------- */
  // RULE 1. Wording is deliberately concrete — "not saved" invites the reader
  // to imagine a cache somewhere; "gone when either of you leaves" does not.
  const ephemeral = el('div', { class: 'dm-ephemeral' }, [
    el('span', { class: 'mark', text: '✦' }),
    el('span', {
      html: '<b>Nothing here is saved.</b> These messages are never written to a ' +
        'database, a log or your browser. They exist only while you are both ' +
        'standing here — close this window, walk away or reload, and they are gone.',
    }),
  ])

  const banner = el('div', { class: 'dm-banner', text: '' })

  const log = el('div', { class: 'dm-log smui-inset smui-scroll' })
  const emptyLine = el('div', {
    class: 'empty',
    text: 'Say something. They will see it the moment you press SEND.',
  })
  log.appendChild(emptyLine)

  const input = el('input', {
    class: 'smui-input', type: 'text', maxlength: 140,
    placeholder: 'Message…', autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Message',
  })
  const sendBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'SEND' })
  const row = el('div', { class: 'dm-row' }, [input, sendBtn])

  const blockBtn = el('button', { class: 'smui-btn is-danger', type: 'button', text: 'BLOCK' })
  const tokenBtn = el('button', { class: 'smui-btn', type: 'button', text: '◈ SEND TOKEN' })
  const nftBtn = el('button', { class: 'smui-btn', type: 'button', text: '▣ SEND NFT' })
  const actions = el('div', { class: 'dm-actions' }, [
    blockBtn, el('span', { class: 'spacer' }), tokenBtn, nftBtn,
  ])

  const body = el('div', { class: 'dm-body' }, [ephemeral, banner, log, row, actions])

  /* --- gift sheet -------------------------------------------------------- */
  const sheet = el('div', { class: 'dm-sheet smui-inset' })
  root.append(titlebar, body, sheet)
  document.body.appendChild(root)
  makeDraggable(root, titlebar)

  const toast = el('div', { id: 'sm-dm-toast', class: 'smui' })
  document.body.appendChild(toast)
  let toastTimer: any = null
  function showToast(text: string) {
    toast.textContent = text
    toast.classList.add('on')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('on'), 2600)
  }

  guardKeys(input, () => input.blur())

  /* --- log --------------------------------------------------------------- */
  function append(node: HTMLElement) {
    emptyLine.remove()
    log.appendChild(node)
    while (log.childElementCount > 80) log.removeChild(log.firstChild as Node)
    log.scrollTop = log.scrollHeight
  }
  const say = (who: string, text: string, mine: boolean) =>
    append(el('div', { class: `line ${mine ? 'mine' : 'theirs'}` }, [
      el('span', { class: 'who', text: who + ': ' }),
      document.createTextNode(text),
    ]))
  const system = (text: string, cls: 'sys' | 'warn' | 'tx' = 'sys') =>
    append(el('div', { class: `line ${cls}`, text }))

  function clearLog() {
    log.textContent = ''
    log.appendChild(emptyLine)
  }

  /* --- peer / block state ------------------------------------------------ */
  function renderPeer() {
    const nm = peerChip.querySelector('.nm') as HTMLElement
    nm.textContent = peer?.name ?? '—'
    const isBlocked = !!peer && blocked.has(peer.id)
    peerChip.classList.toggle('is-blocked', isBlocked)
    root.classList.toggle('is-blocked', isBlocked)
    banner.textContent = isBlocked
      ? `You blocked ${peer?.name}. They cannot message you and you cannot message them.`
      : ''
    blockBtn.textContent = isBlocked ? 'UNBLOCK' : 'BLOCK'
    blockBtn.classList.toggle('is-danger', !isBlocked)
    blockBtn.classList.toggle('is-ghost', isBlocked)
    input.disabled = isBlocked
    sendBtn.disabled = isBlocked
    // Gifting a blocked player is refused server-side anyway; do not offer it.
    tokenBtn.disabled = isBlocked
    nftBtn.disabled = isBlocked
    input.placeholder = isBlocked ? 'Unblock them to talk again' : 'Message…'
  }

  function setPeer(next: DmPeer, keepLog = false) {
    const changed = peer?.id !== next.id
    peer = next
    names.set(next.id, next.name)
    if (changed && !keepLog) clearLog()
    renderPeer()
  }

  /* --- open / close ------------------------------------------------------ */
  let releaseWindow: (() => void) | null = null
  function open() {
    if (root.classList.contains('open')) return
    root.classList.add('open')
    releaseWindow = pushLayer(() => close())
    setTimeout(() => { if (!input.disabled) input.focus() }, 0)
  }
  function close() {
    closeSheet()
    root.classList.remove('open')
    releaseWindow?.()
    releaseWindow = null
  }
  const isOpen = () => root.classList.contains('open')
  closeBtn.addEventListener('click', () => close())

  // Never fight the RPG-JS dialog layer: step aside while a dialog is up.
  const stopWatch = watchGameDialog((dialogOpen) => {
    root.classList.toggle('dialog-hidden', dialogOpen)
  })

  /* --- the action key ---------------------------------------------------- */
  /**
   * RULE 2. Ask the server who is close, and do not assume one ask arrives:
   * `processAction` is dropped while the player cannot act (mid-transfer, in a
   * dialog, during a battle handoff), with no error and no reply. Three tries
   * half a second apart cost nothing and turn a silent no-op into a working
   * key press.
   */
  function askNearby() {
    nearbyTries = 0
    pingNearby()
  }
  function pingNearby() {
    clearTimeout(nearbyTimer)
    nearbyTries++
    engine?.processAction?.('dm:nearby', {})
    if (nearbyTries < 5) { nearbyTimer = setTimeout(pingNearby, 600); return }
    // Five silent tries over three seconds is not a slow server, it is a
    // player who cannot act — mid map-transfer, most often. Say that instead
    // of leaving the key looking dead.
    showToast('The world is still catching up — press it again in a moment.')
  }
  const stopAsking = () => clearTimeout(nearbyTimer)

  /**
   * RULE 3. Stand down whenever something else owns the keyboard. We never
   * preventDefault: space must still reach the engine so it can talk to NPCs,
   * and must still type a space wherever a space belongs.
   */
  function keyIsOurs(e: KeyboardEvent): boolean {
    if (e.key !== ' ' && e.code !== 'Space') return false
    if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false
    const a = document.activeElement as HTMLElement | null
    if (a && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(a.tagName) || a.isContentEditable)) return false
    if (document.querySelector('.rpg-ui-dialog')) return false          // engine dialog
    if (document.getElementById('title-screen')) return false           // not in the world yet
    if (document.querySelector('#name-screen.open')) return false       // name modal
    if (document.querySelector('#char-screen.open')) return false       // fallback picker
    if (document.querySelector('#sm-character-designer.scd-open')) return false
    if (isOpen()) return false        // already talking to someone
    if (layerDepth() > 0) return false // marketplace / box shop / map browser
    return true
  }
  const onKey = (e: KeyboardEvent) => { if (keyIsOurs(e)) askNearby() }
  window.addEventListener('keydown', onKey)

  /* --- sending ----------------------------------------------------------- */
  function submit() {
    const text = input.value.trim()
    if (!text || !peer) return
    input.value = ''
    engine?.processAction?.('dm:send', { to: peer.id, text })
  }
  sendBtn.addEventListener('click', submit)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
  })

  blockBtn.addEventListener('click', () => {
    if (!peer) return
    const isBlocked = blocked.has(peer.id)
    engine?.processAction?.(isBlocked ? 'dm:unblock' : 'dm:block', { id: peer.id })
  })

  /* --- gifts ------------------------------------------------------------- */
  function closeSheet() {
    sheet.classList.remove('open')
    sheet.textContent = ''
    giftKind = null
    body.style.display = ''
  }

  function askGift(kind: 'token' | 'nft') {
    if (!peer) return
    const w = myWallet()
    if (!w?.address) {
      system('Connect your wallet on the title screen before sending a gift.', 'warn')
      return
    }
    if (!ethereum()) {
      system('No browser wallet found, so nothing can be sent from this page.', 'warn')
      return
    }
    if (!peer.hasWallet) {
      system(`${peer.name} has no wallet connected, so there is nowhere to send it.`, 'warn')
      return
    }
    giftKind = kind
    giftTries = 0
    pingGift(peer.id)
  }
  /**
   * The address comes from the server, on demand, and only when a gift is
   * actually being made — the client never holds a roster of addresses.
   *
   * Retried for the same reason `askNearby` is: `processAction` is dropped
   * with no error while the player cannot act (a map is streaming in, a dialog
   * is up), and a dead SEND TOKEN button reads as a broken feature. Asking for
   * an address is a read, so asking twice costs nothing — unlike `dm:send`,
   * which is deliberately single-shot so a retry can never double-post.
   */
  function pingGift(id: string) {
    clearTimeout(giftTimer)
    if (!giftKind) return
    giftTries++
    engine?.processAction?.('dm:gift-info', { id })
    if (giftTries < 4) giftTimer = setTimeout(() => pingGift(id), 700)
    else if (giftKind) {
      giftKind = null
      system('The server did not answer. Try again in a moment.', 'warn')
    }
  }
  tokenBtn.addEventListener('click', () => askGift('token'))
  nftBtn.addEventListener('click', () => askGift('nft'))

  /** The NFT address is the game's, not the player's — same source as the shop. */
  async function loadNftContract(): Promise<string | null> {
    if (nftContract !== undefined) return nftContract
    try {
      const res = await fetch('/box/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const q = await res.json()
      nftContract = (q?.contract as string | null) ?? null
    } catch {
      nftContract = null
    }
    return nftContract
  }

  function giftHeader(kind: 'token' | 'nft', to: { name: string; address: string }) {
    const w = myWallet()
    return [
      el('h3', { text: kind === 'token' ? 'SEND TOKEN' : 'SEND NFT' }),
      el('div', { class: 'dm-to' }, [
        el('span', { text: `TO  ${to.name}` }),
        el('span', { class: 'addr', text: shortAddr(to.address) }),
      ]),
      el('div', { class: 'dm-to' }, [
        el('span', { text: 'FROM  you' }),
        el('span', { class: 'addr', text: w?.address ? shortAddr(w.address) : 'no wallet' }),
      ]),
    ]
  }

  /**
   * RULE 4. Amount and recipient are restated in full, the irreversibility is
   * stated in words rather than implied, and only then does the wallet open.
   */
  function openGiftSheet(kind: 'token' | 'nft', to: { name: string; address: string }) {
    sheet.textContent = ''
    sheet.classList.add('open')
    body.style.display = 'none'

    const err = el('div', { class: 'dm-err', text: '' })
    const field = el('input', {
      class: 'smui-input', type: 'text', autocomplete: 'off', spellcheck: 'false',
      placeholder: kind === 'token' ? '0.01' : '1234',
      'aria-label': kind === 'token' ? 'Amount in ETH' : 'Token id',
    })
    guardKeys(field)
    const label = el('label', {
      text: kind === 'token' ? 'HOW MUCH (ETH)' : 'WHICH TOKEN ID',
    })

    const cancel = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'CANCEL' })
    const confirm = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'REVIEW' })
    const buttons = el('div', { class: 'row' }, [cancel, confirm])

    const warn = el('div', { class: 'dm-warn' })
    sheet.append(
      ...giftHeader(kind, to),
      el('div', {}, [label, field]),
      warn,
      err,
      buttons,
    )
    cancel.addEventListener('click', () => closeSheet())
    setTimeout(() => field.focus(), 0)

    if (kind === 'nft') {
      warn.innerHTML =
        '<b>Checking which NFT contract this server uses…</b>'
      confirm.disabled = true
      void loadNftContract().then((contract) => {
        if (!sheet.classList.contains('open')) return
        if (!contract) {
          // "say so instead of failing obscurely"
          field.disabled = true
          warn.innerHTML =
            '<b>This server has no NFT contract configured</b>, so there are no ' +
            'Stockmonster NFTs to gift yet. Nothing was sent and your wallet was ' +
            'not opened.'
          confirm.remove()
          cancel.textContent = 'CLOSE'
          return
        }
        confirm.disabled = false
        warn.innerHTML =
          `Transfers <b>${shortAddr(contract)}</b> token ` +
          `#<span class="tid">…</span> out of your wallet. <b>This happens on chain ` +
          `and cannot be undone</b> — there is no refund and no take-backs. ` +
          `Check the id before you confirm.`
        const tid = warn.querySelector('.tid') as HTMLElement
        const sync = () => { tid.textContent = field.value.trim() || '…' }
        field.addEventListener('input', sync)
        sync()
      })
    } else {
      const render = () => {
        const wei = parseEth(field.value)
        warn.innerHTML = wei
          ? `Sends <b>${formatEth(wei)} ETH</b> to ${to.name} at ` +
            `<b>${shortAddr(to.address)}</b>. <b>This happens on chain and cannot ` +
            `be undone</b> — there is no refund and no take-backs.`
          : 'Enter an amount. Whatever you send goes on chain and <b>cannot be ' +
            'undone</b> — there is no refund and no take-backs.'
      }
      field.addEventListener('input', render)
      render()
    }

    /* --- the two-step: REVIEW, then the wallet --------------------------- */
    let armed = false
    confirm.addEventListener('click', async () => {
      err.textContent = ''
      const value = field.value.trim()

      if (kind === 'token') {
        const wei = parseEth(value)
        if (!wei) { err.textContent = 'Enter an amount greater than zero.'; return }
        if (!armed) {
          armed = true
          confirm.textContent = `YES — SEND ${formatEth(wei)} ETH`
          confirm.classList.remove('is-primary')
          confirm.classList.add('is-danger')
          field.disabled = true
          return
        }
        await sendToken(to, wei, { confirm, err })
        return
      }

      if (!/^\d+$/.test(value)) { err.textContent = 'A token id is a whole number.'; return }
      const contract = await loadNftContract()
      if (!contract) { err.textContent = 'No NFT contract is configured on this server.'; return }
      if (!armed) {
        armed = true
        confirm.textContent = `YES — GIFT #${value}`
        confirm.classList.remove('is-primary')
        confirm.classList.add('is-danger')
        field.disabled = true
        return
      }
      await sendNft(to, value, contract, { confirm, err })
    })
  }

  async function sendToken(
    to: { name: string; address: string },
    wei: string,
    ui: { confirm: HTMLButtonElement; err: HTMLElement },
  ) {
    const eth = ethereum()
    const from = myWallet()?.address
    if (!eth || !from) { ui.err.textContent = 'No wallet available.'; return }
    ui.confirm.disabled = true
    ui.confirm.textContent = 'WAITING FOR YOUR WALLET…'
    try {
      const hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: to.address, value: '0x' + BigInt(wei).toString(16) }],
      })
      closeSheet()
      system(`Sent ${formatEth(wei)} ETH to ${to.name} — ${shortAddr(String(hash))}`, 'tx')
      system('Tell them yourself: the game never watches the chain for you.', 'sys')
    } catch (e) {
      ui.confirm.disabled = false
      ui.confirm.textContent = `YES — SEND ${formatEth(wei)} ETH`
      ui.err.textContent = trimError(e)
    }
  }

  async function sendNft(
    to: { name: string; address: string },
    tokenId: string,
    contract: string,
    ui: { confirm: HTMLButtonElement; err: HTMLElement },
  ) {
    const eth = ethereum()
    const from = myWallet()?.address
    if (!eth || !from) { ui.err.textContent = 'No wallet available.'; return }
    ui.confirm.disabled = true
    ui.confirm.textContent = 'WAITING FOR YOUR WALLET…'
    try {
      const data = encodeSafeTransferFrom(from, to.address, tokenId)
      const hash = await eth.request({
        method: 'eth_sendTransaction',
        params: [{ from, to: contract, data }],
      })
      closeSheet()
      system(`Gifted NFT #${tokenId} to ${to.name} — ${shortAddr(String(hash))}`, 'tx')
      system('Tell them yourself: the game never watches the chain for you.', 'sys')
    } catch (e) {
      ui.confirm.disabled = false
      ui.confirm.textContent = `YES — GIFT #${tokenId}`
      ui.err.textContent = trimError(e)
    }
  }

  const trimError = (e: unknown) =>
    String((e as Error)?.message ?? e ?? 'unknown error').split('\n')[0].slice(0, 200)

  /* --- server -> client -------------------------------------------------- */
  socket?.on?.('dm:nearby-result', (d: { peer?: DmPeer | null; reason?: string }) => {
    stopAsking()
    if (!d?.peer) { showToast(d?.reason ?? 'Nobody is standing close enough to talk to.'); return }
    setPeer(d.peer)
    open()
  })

  socket?.on?.('dm:message', (d: {
    peer?: { id: string; name: string }; from?: string; text?: string; mine?: boolean
  }) => {
    if (!d?.peer || typeof d.text !== 'string') return
    names.set(d.peer.id, d.peer.name)
    // An incoming message must be visible immediately — that is the whole
    // point. If the window is closed, or open on someone else, switch to the
    // conversation this line belongs to.
    if (!peer || peer.id !== d.peer.id) {
      if (d.mine) return // our own echo for a window we have since left
      setPeer({ id: d.peer.id, name: d.peer.name, hasWallet: false })
    }
    say(d.from ?? d.peer.name, d.text, !!d.mine)
    if (!isOpen()) open()
  })

  socket?.on?.('dm:system', (d: { text?: string; peer?: { id: string; name: string } | null }) => {
    if (typeof d?.text !== 'string') return
    if (d.peer && (!peer || peer.id !== d.peer.id)) {
      // A refusal about a conversation we are not looking at is still ours.
      showToast(d.text)
      if (!isOpen()) return
    }
    system(d.text, 'warn')
  })

  socket?.on?.('dm:blocked', (d: { id?: string; name?: string; blocked?: boolean }) => {
    if (typeof d?.id !== 'string') return
    if (d.blocked) blocked.add(d.id)
    else blocked.delete(d.id)
    if (peer?.id === d.id) {
      renderPeer()
      system(d.blocked
        ? `You blocked ${d.name}. Nothing more will get through in either direction.`
        : `You unblocked ${d.name}.`)
    }
  })

  socket?.on?.('dm:gift-result', (d: { id?: string; name?: string; address?: string; error?: string }) => {
    clearTimeout(giftTimer)
    const kind = giftKind
    giftKind = null
    if (!kind) return
    if (d?.error || !d?.address || !d?.name) {
      system(d?.error ?? 'That gift could not be set up.', 'warn')
      return
    }
    openGiftSheet(kind, { name: d.name, address: d.address })
  })

  /* --- api --------------------------------------------------------------- */
  const api: DmUiApi = {
    root,
    isOpen,
    close,
    openWith(id: string, name?: string) {
      setPeer({ id, name: name ?? names.get(id) ?? 'Trader', hasWallet: true }, peer?.id === id)
      open()
      // We may have been handed only an id: let the server correct the name and
      // tell us whether a gift is even possible.
      askNearby()
    },
    destroy() {
      stopAsking()
      clearTimeout(giftTimer)
      stopWatch()
      window.removeEventListener('keydown', onKey)
      close()
      root.remove()
      toast.remove()
      instance = null
    },
  }
  instance = api
  return api
}

/** Open the DM window for a specific player id, mounting it on first use. */
export function openDmWith(id: string, name?: string): DmUiApi {
  const api = instance ?? mountDmUi()
  api.openWith(id, name)
  return api
}

export function closeDmUi(): void { instance?.close() }
export function getDmUi(): DmUiApi | null { return instance }
