/*
 * friends-ui.ts — the friends panel, on the left edge of the screen.
 *
 *   mountFriendsUi(engine, socket)   // create it (collapsed) at boot
 *   openFriends() / closeFriends()   // from the HUD or a hotkey
 *
 *  ┌──┐┌ FRIENDS ─────────────── 2/5 online ─┐
 *  │  ││ [ name…            ]      [ ADD ]   │
 *  │FR││ ── REQUESTS ────────────────────────│
 *  │IE││ Satoshi        [ ACCEPT ] [ DECLINE]│
 *  │ND││ ── FRIENDS ─────────────────────────│
 *  │S ││ ● Vitalik            [ MESSAGE ] [✕]│
 *  │ 2││ ○ Hodler                         [✕]│
 *  └──┘└─────────────────────────────────────┘
 *
 * THE TAB IS ALWAYS VISIBLE. It carries the count of requests waiting for an
 * answer, because a friend request that only appears once, in a panel you
 * happened to have open, is a request that never arrives.
 *
 * NOTHING HERE DECIDES ANYTHING. Every button sends an action and re-renders
 * from the state the server sends back; the client never assumes a request was
 * accepted, and never claims two players are friends. friends.ts owns that,
 * and dm.ts asks IT — not this file — before letting a message travel.
 *
 * The panel is deliberately NOT a modal: it sits beside the game, you can walk
 * with it open, and it does not join the ui-kit escape stack (which would
 * disable the space-to-talk key while it was up). Escape closes it, and is
 * consumed so it does not also open the game menu.
 */

import {
  ensureUiKit, injectStyle, el, guardKeys, layerDepth, THEME, Z,
} from './ui-kit'
import { openDmWithPeer } from './dm-ui'

/* ================================================================ TYPES ===*/

export interface FriendRef { key: string; name: string }
export interface FriendEntry extends FriendRef {
  online: boolean
  id: string | null
  hasWallet: boolean
}
export interface FriendState {
  persistent: boolean
  identified: boolean
  friends: FriendEntry[]
  incoming: FriendRef[]
  outgoing: FriendRef[]
}

interface EngineLike { processAction?: (action: string, data: unknown) => void }
interface SocketLike { on?: (type: string, cb: (data: any) => void) => void }

export interface FriendsUiApi {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  destroy(): void
  root: HTMLElement
}

/* =============================================================== STYLES ===*/

const CSS = `
#sm-friends {
  position: fixed; left: 0; top: 50%; transform: translateY(-50%);
  z-index: ${Z.hudPopover + 10};
  display: flex; align-items: stretch;
  font-family: ${THEME.mono}; font-size: 12px; color: ${THEME.text};
  pointer-events: none;
}
#sm-friends > * { pointer-events: auto; }

/* --- the tab ------------------------------------------------------------- */
#sm-friends .fr-tab {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 5px;
  background: ${THEME.surface};
  border: 3px solid ${THEME.border}; border-left: none;
  box-shadow: 3px 3px 0 ${THEME.shadow};
  color: ${THEME.text}; cursor: pointer;
  font-family: ${THEME.mono}; font-size: 11px; font-weight: 700; letter-spacing: .18em;
  writing-mode: vertical-rl; text-orientation: upright;
}
#sm-friends .fr-tab:hover { background: ${THEME.surfaceAlt}; }
#sm-friends .fr-tab .badge {
  writing-mode: horizontal-tb;
  min-width: 18px; padding: 1px 4px;
  background: ${THEME.danger}; color: #fff;
  font-size: 10px; letter-spacing: 0; text-align: center;
  box-shadow: 2px 2px 0 ${THEME.shadow};
}
#sm-friends .fr-tab .badge[hidden] { display: none; }
#sm-friends .fr-tab .dot { writing-mode: horizontal-tb; font-size: 9px; color: ${THEME.ok}; letter-spacing: 0; }

/* --- the panel ----------------------------------------------------------- */
#sm-friends .fr-panel {
  display: none;
  width: min(310px, 78vw);
  max-height: min(62vh, 520px);
  flex-direction: column;
  background: ${THEME.surface};
  border: 3px solid ${THEME.border}; border-left: none;
  box-shadow: 4px 4px 0 ${THEME.shadow};
}
#sm-friends.open .fr-panel { display: flex; }
#sm-friends.dialog-hidden { display: none; }

#sm-friends .fr-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  background: ${THEME.dark};
  border-bottom: 3px solid ${THEME.border};
}
#sm-friends .fr-head .title {
  font-family: ${THEME.display}; font-size: 13px; letter-spacing: .12em;
  text-shadow: 2px 2px 0 ${THEME.shadow};
}
#sm-friends .fr-head .spacer { flex: 1 1 auto; }
#sm-friends .fr-head .count { font-size: 10px; color: ${THEME.muted}; letter-spacing: .06em; }

#sm-friends .fr-body {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: 9px 10px; display: flex; flex-direction: column; gap: 9px;
}

#sm-friends .fr-note {
  background: ${THEME.dark}; border: 2px solid ${THEME.border}; border-left-width: 6px;
  padding: 7px 9px; font-size: 10px; line-height: 1.45; color: ${THEME.muted};
}
#sm-friends .fr-note b { color: ${THEME.text}; }

#sm-friends .fr-add { display: flex; gap: 6px; }
#sm-friends .fr-add .smui-input { flex: 1 1 auto; min-width: 0; }

#sm-friends h4 {
  margin: 2px 0 0; font-size: 10px; letter-spacing: .16em;
  color: ${THEME.border}; font-weight: 700;
}
#sm-friends .fr-list { display: flex; flex-direction: column; gap: 5px; }
#sm-friends .fr-row {
  display: flex; align-items: center; gap: 7px;
  background: ${THEME.dark}; border: 2px solid #3b3459;
  padding: 6px 8px;
}
#sm-friends .fr-row .nm {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#sm-friends .fr-row.is-off .nm { color: ${THEME.muted}; }
#sm-friends .fr-row .pip {
  width: 8px; height: 8px; flex: 0 0 8px;
  background: ${THEME.ok}; box-shadow: 0 0 0 2px ${THEME.shadow};
}
#sm-friends .fr-row.is-off .pip { background: #5a5379; }
#sm-friends .fr-row .smui-btn { flex: 0 0 auto; font-size: 10px; padding: 4px 7px; }
#sm-friends .fr-empty { font-size: 11px; font-style: italic; color: #6f6790; }

#sm-friends .fr-status {
  border-top: 3px solid ${THEME.border};
  padding: 7px 10px; font-size: 10px; line-height: 1.4; min-height: 14px;
  background: ${THEME.dark}; color: ${THEME.muted};
}
#sm-friends .fr-status.tone-warn { color: #ffc4c8; }
#sm-friends .fr-status.tone-ok { color: ${THEME.ok}; }

#sm-friends-toast {
  position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
  z-index: ${Z.marketToast};
  padding: 9px 14px;
  background: ${THEME.surface}; border: 3px solid ${THEME.border};
  box-shadow: 3px 3px 0 ${THEME.shadow};
  font-family: ${THEME.mono}; font-size: 12px; color: ${THEME.text};
  max-width: 78vw;
  opacity: 0; pointer-events: none; transition: opacity .16s linear;
}
#sm-friends-toast.on { opacity: 1; }
`

/* ================================================================ MOUNT ===*/

let instance: FriendsUiApi | null = null

export function mountFriendsUi(engine?: EngineLike, socket?: SocketLike): FriendsUiApi {
  if (instance) return instance
  ensureUiKit()
  injectStyle('sm-friends-css', CSS)

  let state: FriendState = {
    persistent: false, identified: false, friends: [], incoming: [], outgoing: [],
  }

  /* --- chrome ------------------------------------------------------------ */
  const root = el('div', { id: 'sm-friends', class: 'smui' })

  const badge = el('span', { class: 'badge', hidden: true, text: '0' })
  const onlineDot = el('span', { class: 'dot', text: '0' })
  const tab = el('button', {
    class: 'fr-tab', type: 'button',
    'aria-label': 'Friends', title: 'Friends',
  }, [badge, document.createTextNode('FRIENDS'), onlineDot])

  const head = el('div', { class: 'fr-head' }, [
    el('span', { class: 'title', text: 'FRIENDS' }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'count', text: '' }),
  ])
  const body = el('div', { class: 'fr-body smui-scroll' })
  const status = el('div', { class: 'fr-status', text: '' })
  const panel = el('div', { class: 'fr-panel' }, [head, body, status])

  root.append(tab, panel)
  document.body.appendChild(root)

  const toast = el('div', { id: 'sm-friends-toast', class: 'smui' })
  document.body.appendChild(toast)
  let toastTimer: any = null
  function showToast(text: string) {
    toast.textContent = text
    toast.classList.add('on')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('on'), 3200)
  }

  const send = (action: string, data: unknown = {}) => engine?.processAction?.(action, data)

  /* --- add-by-name: built ONCE ------------------------------------------- */
  /*
   * This row is created at mount and MOVED into place by render(), never
   * rebuilt. render() runs whenever the server pushes anything — a friend
   * logging in, a request arriving — and rebuilding the field would wipe the
   * half-typed name and drop the caret, so pressing ADD would send nothing.
   * Found by driving it in a real browser: a presence update landed between
   * the typing and the click.
   */
  const addInput = el('input', {
    class: 'smui-input', type: 'text', maxlength: 16,
    placeholder: 'Add by name…', autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Player name',
  })
  const addBtn = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'ADD' })
  const addRow = el('div', { class: 'fr-add' }, [addInput, addBtn])
  guardKeys(addInput, () => addInput.blur())
  const submitAdd = () => {
    const name = addInput.value.trim()
    if (!name) { setStatus('Type the name of the player you want to add.', 'warn'); return }
    addInput.value = ''
    send('friends:add', { name })
    setStatus(`Asking ${name}…`)
  }
  addBtn.addEventListener('click', submitAdd)
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitAdd() }
  })

  /* --- rendering --------------------------------------------------------- */

  function row(children: Array<Node | string>, off = false) {
    return el('div', { class: `fr-row${off ? ' is-off' : ''}` }, children)
  }

  function render() {
    body.textContent = ''
    const onlineCount = state.friends.filter((f) => f.online).length
    ;(head.querySelector('.count') as HTMLElement).textContent =
      state.friends.length ? `${onlineCount}/${state.friends.length} ONLINE` : ''
    onlineDot.textContent = String(onlineCount)
    badge.textContent = String(state.incoming.length)
    badge.hidden = state.incoming.length === 0

    // Not identified: there is nothing to show and nothing to do, so say why
    // rather than presenting an empty list that looks broken.
    if (!state.identified) {
      body.append(el('div', { class: 'fr-note' }, [
        el('span', {
          html: '<b>Connect your wallet to use friends.</b> A friendship is keyed to ' +
            'your wallet, not to this browser tab — that is what lets it survive a ' +
            'reload and follow you to another device.',
        }),
      ]))
      return
    }

    if (!state.persistent) {
      body.append(el('div', { class: 'fr-note' }, [
        el('span', {
          html: '<b>This server has no database.</b> Friends work, but they are kept ' +
            'in memory and are gone when the server restarts.',
        }),
      ]))
    }

    /* add someone — the same element every time, so typing survives a push */
    body.append(addRow)

    /* requests waiting for me — first, because they need an answer */
    if (state.incoming.length) {
      body.append(el('h4', { text: `REQUESTS · ${state.incoming.length}` }))
      const list = el('div', { class: 'fr-list' })
      for (const r of state.incoming) {
        const accept = el('button', { class: 'smui-btn is-primary', type: 'button', text: 'ACCEPT' })
        const decline = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'DECLINE' })
        accept.addEventListener('click', () => send('friends:accept', { key: r.key }))
        decline.addEventListener('click', () => send('friends:decline', { key: r.key }))
        list.append(row([el('span', { class: 'nm', text: r.name }), accept, decline]))
      }
      body.append(list)
    }

    /* asks I am waiting on */
    if (state.outgoing.length) {
      body.append(el('h4', { text: `WAITING · ${state.outgoing.length}` }))
      const list = el('div', { class: 'fr-list' })
      for (const r of state.outgoing) {
        const cancel = el('button', { class: 'smui-btn is-ghost', type: 'button', text: 'CANCEL' })
        cancel.addEventListener('click', () => send('friends:cancel', { key: r.key }))
        list.append(row([
          el('span', { class: 'nm', text: r.name }),
          el('span', { class: 'count', text: 'ASKED' }),
          cancel,
        ], true))
      }
      body.append(list)
    }

    /* the list itself, online first */
    body.append(el('h4', { text: 'FRIENDS' }))
    if (!state.friends.length) {
      body.append(el('div', {
        class: 'fr-empty',
        text: 'Nobody yet. Type a player’s name above — they have to accept before anything happens.',
      }))
      return
    }
    const list = el('div', { class: 'fr-list' })
    const sorted = [...state.friends].sort((a, b) =>
      a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1)
    for (const f of sorted) {
      const kids: Array<Node | string> = [
        el('span', { class: 'pip' }),
        el('span', { class: 'nm', text: f.name }),
      ]
      if (f.online && f.id) {
        const msg = el('button', { class: 'smui-btn', type: 'button', text: 'MESSAGE' })
        msg.addEventListener('click', () => {
          // Remote: friends.ts has already decided distance does not apply, so
          // the window must not go looking for somebody standing next to us.
          openDmWithPeer({ id: f.id as string, name: f.name, hasWallet: f.hasWallet }, { remote: true })
        })
        kids.push(msg)
      }
      const remove = el('button', {
        class: 'smui-btn is-danger', type: 'button',
        title: `Remove ${f.name}`, 'aria-label': `Remove ${f.name}`, text: '✕',
      })
      let armed = false
      remove.addEventListener('click', () => {
        // One click away from undoing something the other player agreed to;
        // ask once rather than making it a slip.
        if (!armed) { armed = true; remove.textContent = 'SURE?'; setTimeout(() => {
          armed = false; remove.textContent = '✕'
        }, 4000); return }
        send('friends:remove', { key: f.key })
      })
      kids.push(remove)
      list.append(row(kids, !f.online))
    }
    body.append(list)
  }

  let statusTimer: any = null
  function setStatus(text: string, tone: 'info' | 'warn' | 'ok' = 'info') {
    status.textContent = text
    status.className = `fr-status tone-${tone}`
    clearTimeout(statusTimer)
    statusTimer = setTimeout(() => { status.textContent = '' }, 8000)
  }

  /* --- open / close ------------------------------------------------------ */
  const isOpen = () => root.classList.contains('open')
  function open() {
    root.classList.add('open')
    send('friends:list', {})
  }
  function close() { root.classList.remove('open') }
  function toggle() { isOpen() ? close() : open() }
  tab.addEventListener('click', toggle)

  // Escape closes the panel — and is consumed, so it does not ALSO open the
  // game menu behind it. Capture phase, because game-ui.ts binds the same key
  // on window and checks defaultPrevented.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen()) return
    if (layerDepth() > 0) return // a real window is on top; it owns Escape
    const a = document.activeElement as HTMLElement | null
    if (a && root.contains(a) && /^(INPUT)$/.test(a.tagName)) return // let the field blur
    e.preventDefault()
    e.stopPropagation()
    close()
  }
  window.addEventListener('keydown', onKey, true)

  /* --- server -> client -------------------------------------------------- */
  socket?.on?.('friends:state', (d: FriendState) => {
    if (!d || !Array.isArray(d.friends)) return
    state = {
      persistent: !!d.persistent,
      identified: !!d.identified,
      friends: d.friends,
      incoming: Array.isArray(d.incoming) ? d.incoming : [],
      outgoing: Array.isArray(d.outgoing) ? d.outgoing : [],
    }
    render()
  })

  // A presence patch, so one friend arriving does not cost a database read for
  // every other friend they have.
  socket?.on?.('friends:presence', (d: FriendEntry) => {
    if (!d || typeof d.key !== 'string') return
    const found = state.friends.find((f) => f.key === d.key)
    if (!found) return
    Object.assign(found, d)
    render()
  })

  socket?.on?.('friends:system', (d: { text?: string; tone?: 'info' | 'warn' | 'ok' }) => {
    if (typeof d?.text !== 'string') return
    setStatus(d.text, d.tone ?? 'info')
    // A message about friends while the panel is shut would otherwise be
    // written to a box nobody can see.
    if (!isOpen()) showToast(d.text)
  })

  render()

  /* --- api --------------------------------------------------------------- */
  const api: FriendsUiApi = {
    root, open, close, toggle, isOpen,
    destroy() {
      window.removeEventListener('keydown', onKey, true)
      clearTimeout(statusTimer)
      clearTimeout(toastTimer)
      root.remove()
      toast.remove()
      instance = null
    },
  }
  instance = api
  return api
}

export function openFriends(): void { instance?.open() }
export function closeFriends(): void { instance?.close() }
export function getFriendsUi(): FriendsUiApi | null { return instance }
