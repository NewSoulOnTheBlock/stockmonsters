/*
 * Left-side chat panel + the mandatory name modal, both in the pixel theme.
 *
 * The name is required before chatting: a wallet connects, the player picks a
 * name, and it appears above their character for everyone. Validation is
 * server-side (names.ts); this only relays the rejection reason.
 *
 * Enter focuses the input; Escape leaves it — so typing "w" walks the player
 * unless the input has focus, and the game's own keys are released while it
 * does (the engine listens on window, so we stop propagation while typing).
 */

import { mountIntro, playIntro, introNameAccepted, introNameRejected, introIsAsking } from './intro'

const css = `
#chat-panel {
  position: fixed; left: 12px; bottom: 12px; z-index: 850;
  width: min(320px, 34vw);
  display: flex; flex-direction: column;
  font-family: "Courier New", ui-monospace, monospace;
  image-rendering: pixelated;
}
#chat-log {
  max-height: 30vh; overflow-y: auto;
  background: rgba(38,33,58,.86);
  border: 3px solid #f6c177; border-bottom: none;
  padding: 8px 10px; font-size: 12px; line-height: 1.5;
  color: #fff1c7; scrollbar-width: thin;
}
#chat-log:empty { display: none; }
#chat-log .who { color: #7ecf6b; font-weight: 700; }
#chat-log .sys { color: #f6c177; font-style: italic; }
#chat-row { display: flex; }
#chat-input {
  flex: 1; min-width: 0;
  background: #1b1730; color: #fff1c7;
  border: 3px solid #f6c177; border-radius: 0;
  padding: 8px 10px; font: inherit; font-size: 12px;
  outline: none;
}
#chat-input::placeholder { color: #6f6790; }
/* The sheet header and the unread pill only exist on a phone — the mobile
   stylesheet (touch-controls.ts, injected last) reveals them. */
#chat-head { display: none; }
#chat-badge { display: none; }
#chat-input:disabled { opacity: .55; }
/* --- name modal --- */
#name-screen {
  position: fixed; inset: 0; z-index: 1002;
  background: rgba(9,7,15,.88);
  display: none; align-items: center; justify-content: center;
}
#name-screen.open { display: flex; }
#name-screen .panel {
  width: min(420px, 92vw);
  background: #26213a; border: 4px solid #f6c177;
  box-shadow: 6px 6px 0 #09070f; padding: 20px;
  font-family: "Courier New", ui-monospace, monospace;
  color: #fff1c7; image-rendering: pixelated;
}
#name-screen h2 {
  margin: 0 0 6px; font-family: "Fredoka", "Trebuchet MS", sans-serif;
  font-weight: 600; letter-spacing: .12em; font-size: 18px;
  text-shadow: 2px 2px 0 #09070f;
}
#name-screen p { margin: 0 0 14px; font-size: 12px; color: #b9b2d6; }
#name-input {
  width: 100%; box-sizing: border-box;
  background: #1b1730; color: #fff1c7;
  border: 3px solid #f6c177; border-radius: 0;
  padding: 10px; font: inherit; font-size: 14px; outline: none;
}
#name-error { min-height: 18px; margin: 8px 0 0; font-size: 12px; color: #e06c75; }
#name-ok {
  margin-top: 12px; width: 100%;
  padding: 10px; font: inherit; font-weight: 700; font-size: 14px;
  letter-spacing: .08em; color: #09070f; background: #7ecf6b;
  border: 3px solid #f6c177; border-radius: 0;
  box-shadow: 3px 3px 0 #09070f; cursor: pointer;
}
#name-ok:disabled { opacity: .4; cursor: default; }
#name-ok:not(:disabled):active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #09070f; }
`

interface Engine {
  processAction?: (action: string, data: unknown) => void
}
interface Socket {
  on: (type: string, cb: (data: any) => void) => void
}

export function mountChatUi(engine: Engine, socket: Socket) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  mountIntro(engine)

  const panel = document.createElement('div')
  panel.id = 'chat-panel'
  panel.innerHTML =
    '<div id="chat-head"><span>CHAT</span><button id="chat-close" type="button" ' +
    'aria-label="Close chat">\u2715</button></div>' +
    '<div id="chat-log"></div>' +
    '<div id="chat-row"><input id="chat-input" maxlength="140" ' +
    'placeholder="Press Enter to chat" disabled></div>'
  document.body.appendChild(panel)

  /*
   * ON A PHONE, CHAT IS A SHEET BEHIND A BADGE.
   *
   * A permanently visible log on a 390px screen sits in the middle of the
   * world and covers the person you are talking to — seen on a real handset,
   * with the other player hidden behind "Tap to chat". So on touch devices the
   * panel is hidden until asked for, and this pill is what asks: it shows how
   * much has been said since you last looked, and opening it clears the count.
   *
   * The badge is created unconditionally and CSS decides whether it exists —
   * `touchDevice()` at mount would be wrong for a tablet that gets rotated or
   * a laptop with a touchscreen, and a media query re-evaluates itself.
   */
  const badge = document.createElement('button')
  badge.id = 'chat-badge'
  badge.type = 'button'
  badge.innerHTML = '<span class="ic">\u{1F4AC}</span><span class="n"></span>'
  badge.setAttribute('aria-label', 'Open chat')
  document.body.appendChild(badge)

  const badgeCount = badge.querySelector('.n') as HTMLElement
  let unread = 0
  const isChatOpen = () => panel.classList.contains('open')
  /**
   * Is the log actually on screen? Asked of the CSS rather than of a device
   * check, so the desktop layout — where the panel is always visible — never
   * accumulates an unread count nobody asked for.
   */
  const chatVisible = () => {
    try { return getComputedStyle(panel).display !== 'none' } catch { return true }
  }
  function showUnread() {
    // Past a hundred the exact number stops meaning anything and the pill
    // starts changing width every message.
    badgeCount.textContent = unread > 99 ? '99+' : unread ? String(unread) : ''
    badge.classList.toggle('has-unread', unread > 0)
  }
  function openChat() {
    panel.classList.add('open')
    unread = 0
    showUnread()
    if (!input.disabled) setTimeout(() => input.focus(), 50)
  }
  function closeChat() {
    panel.classList.remove('open')
    input.blur()
  }
  badge.addEventListener('click', () => (isChatOpen() ? closeChat() : openChat()))
  panel.querySelector('#chat-close')?.addEventListener('click', () => closeChat())
  showUnread()

  const modal = document.createElement('div')
  modal.id = 'name-screen'
  modal.innerHTML =
    '<div class="panel"><h2>CHOOSE YOUR NAME</h2>' +
    '<p>This is what other traders see above your character. ' +
    '3-16 characters, letters, numbers and _ . Names are unique, and you can ' +
    'change yours once a day.</p>' +
    '<input id="name-input" maxlength="16" autocomplete="off" spellcheck="false">' +
    '<p id="name-error"></p>' +
    '<button id="name-ok" disabled>CONFIRM</button></div>'
  document.body.appendChild(modal)

  const log = panel.querySelector('#chat-log') as HTMLElement
  const input = panel.querySelector('#chat-input') as HTMLInputElement
  const nameInput = modal.querySelector('#name-input') as HTMLInputElement
  const nameErr = modal.querySelector('#name-error') as HTMLElement
  const nameOk = modal.querySelector('#name-ok') as HTMLButtonElement

  const append = (html: string, cls = '') => {
    const line = document.createElement('div')
    if (cls) line.className = cls
    line.innerHTML = html
    log.appendChild(line)
    while (log.childElementCount > 60) log.removeChild(log.firstChild as Node)
    log.scrollTop = log.scrollHeight
    // Anything that arrives while the log is hidden is something the player has
    // not seen. On desktop the panel is always displayed, so this never fires.
    if (!chatVisible()) { unread++; showUnread() }
  }
  const escape = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

  // The title screen owns the whole viewport until the player enters the
  // world; opening the name modal before that darkens the title art and
  // hijacks the flow. Wait for the curtain to be gone.
  function whenInWorld(fn: () => void) {
    const tick = () => {
      if (!document.getElementById('title-screen')) setTimeout(fn, 600)
      else setTimeout(tick, 300)
    }
    tick()
  }

  /** No keyboard means no "press Enter", so the copy has to change. */
  const touchDevice = () => {
    try {
      return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
    } catch {
      return false
    }
  }

  // --- name ---------------------------------------------------------------
  let named = localStorage.getItem('sm-name')
  /** Set only when the SERVER accepts a name; a stored one does not count. */
  let confirmedName: string | null = null
  const openNameModal = () => {
    modal.classList.add('open')
    nameInput.value = named ?? ''
    nameOk.disabled = nameInput.value.trim().length < 3
    setTimeout(() => nameInput.focus(), 50)
  }
  nameInput.addEventListener('input', () => {
    nameOk.disabled = nameInput.value.trim().length < 3
    nameErr.textContent = ''
  })
  const submitName = () => {
    if (nameOk.disabled) return
    engine.processAction?.('name:set', { name: nameInput.value })
  }
  nameOk.addEventListener('click', submitName)
  nameInput.addEventListener('keydown', (e) => {
    e.stopPropagation() // don't let the game read these keys
    if (e.key === 'Enter') submitName()
  })

  socket.on('name:accepted', (d: { name: string }) => {
    introNameAccepted(d.name)
    // The server confirms on every reconnect and after every retry, so greet
    // only when this is actually news — otherwise chat opens with the same
    // welcome line two or three times.
    const isNews = confirmedName !== d.name
    named = d.name
    confirmedName = d.name
    stopClaiming()
    localStorage.setItem('sm-name', d.name)
    modal.classList.remove('open')
    input.disabled = false
    input.placeholder = touchDevice() ? 'Tap to chat' : 'Press Enter to chat'
    if (isNews) append(`Welcome, <span class="who">${escape(d.name)}</span>.`, 'sys')
  })
  socket.on('name:rejected', (d: { reason: string }) => {
    stopClaiming() // a refused name must not be re-sent every second
    // Kelby answers it himself when he is the one who asked.
    introNameRejected(d.reason)
    nameErr.textContent = d.reason
    if (!confirmedName) {
      // Rejected before anything was confirmed means this player still has no
      // name — ask again. But never over the title screen: the modal covers the
      // whole viewport at a higher z-index, so opening it there hides PLAY GAME
      // and the player cannot even get into the world to answer.
      //
      // And never over KELBY. When the intro asked the question, it has
      // already handled the refusal a line above — `introNameRejected` puts
      // the reason in his box and re-enables the field. Opening the modal too
      // gave the player both at once: Kelby explaining what went wrong, and a
      // bare "choose your name" panel on top of him asking the same thing.
      if (!introIsAsking()) whenInWorld(openNameModal)
      return
    }
    // A refused CHANGE must still be visible: the modal may already be closed,
    // and a silent refusal reads as the button being broken.
    if (!modal.classList.contains('open')) append(escape(d.reason), 'sys')
  })
  socket.on('chat:message', (d: { from?: string; text: string; system?: boolean }) => {
    if (d.system) append(escape(d.text), 'sys')
    else append(`<span class="who">${escape(d.from ?? '?')}</span>: ${escape(d.text)}`)
  })

  /*
   * CLAIMING A STORED NAME IS NOT FIRE-AND-FORGET.
   *
   * `processAction` is dropped, silently and with no error, while the player
   * cannot act — which at boot means "until the room is joined". A single
   * `name:set` at mount therefore reached nobody on a cold load, the server
   * never learned the name, and the player was left as the engine's default
   * "Trader" with their real name still sitting in localStorage. Exactly the
   * bug the character had, fixed the same way: keep asking until the server
   * says it stuck.
   *
   * The retry stops on the first acceptance, and on a rejection — a refused
   * name must not be re-sent every second.
   */
  /**
   * How long to let the server answer with a stored name before asking.
   *
   * It has to cover a cold profile load on a slow connection. Too short and a
   * returning player is asked to rename themselves; too long and a genuinely
   * new player stares at nothing. The hydrate is one indexed row, so this is
   * generous.
   */
  const NAME_GRACE_MS = 6000

  let claimTimer: ReturnType<typeof setInterval> | null = null
  function stopClaiming() {
    if (!claimTimer) return
    clearInterval(claimTimer)
    claimTimer = null
  }
  function claimName(name: string) {
    engine.processAction?.('name:set', { name })
    stopClaiming()
    let tries = 0
    claimTimer = setInterval(() => {
      if (confirmedName || ++tries > 20) { stopClaiming(); return }
      engine.processAction?.('name:set', { name })
    }, 700)
  }
  window.addEventListener('beforeunload', stopClaiming)

  // A wallet-connected player must have a name; without a wallet they can look
  // around but not chat.
  const hasWallet = () => {
    try { return !!JSON.parse(localStorage.getItem('sm-wallet') ?? 'null')?.connectionId } catch { return false }
  }

  /*
   * THE WALLET USUALLY ARRIVES AFTER THIS MOUNTS.
   *
   * The title screen is an overlay on an already-running game, so a first-time
   * player connects their wallet long after chat mounted. Reading the wallet
   * once, here, left them locked out of chat and never asked for a name — they
   * stayed "Trader" for the whole session. Returning players were unaffected,
   * because their wallet was in localStorage before the page loaded, which is
   * exactly why nobody noticed.
   *
   * So this runs on mount if there is a wallet, and otherwise the moment one
   * shows up. It must never run twice: the name modal is modal.
   */
  let walletHandled = false
  function onWalletReady() {
    if (walletHandled || !hasWallet()) return
    walletHandled = true
    input.placeholder = touchDevice() ? 'Tap to chat' : 'Say something…'
    input.disabled = false
    // Re-read rather than trusting the value captured at mount: a name may
    // have been written between then and the wallet arriving.
    named = localStorage.getItem('sm-name')
    if (named) {
      // A stored name is only a claim: another wallet may have taken it since,
      // or it may predate a rule change. If the server refuses it we have no
      // name at all, so the modal has to open — see the 'name:rejected'
      // handler, which reopens it when nothing has been confirmed yet.
      // A stored name is re-sent and that is the end of it. We do NOT open the
      // modal just because the confirmation is slow: asking a returning player
      // for their name on every single login is worse than briefly showing the
      // old one, and the modal swallows every key while it is up. The only
      // thing that reopens it is an explicit refusal from the server — see the
      // 'name:rejected' handler.
      claimName(named)
      // ...and if the server never confirms anything, this player effectively
      // has no name: the stored one is a browser claim, and the game shows
      // them as "Trader" to everyone else. Ask, once, well after the retries
      // have had their chance — never for a slow confirmation, only for none.
      whenInWorld(() => {
        setTimeout(() => {
          if (confirmedName || modal.classList.contains('open')) return
          nameErr.textContent = ''
          openNameModal()
        }, 16_000)
      })
    } else {
      /*
       * NO NAME IN THIS BROWSER DOES NOT MEAN NO NAME.
       *
       * The name belongs to the WALLET and lives in Postgres; localStorage is
       * only a cache of it. On a second computer that cache is empty, and
       * asking immediately meant a player who named themselves months ago got
       * the "choose your name" modal again on every new device — and, worse,
       * could not use the name they already own, because it is taken by them.
       *
       * The server sends the stored name as `name:accepted` while it hydrates
       * the profile. So wait for it. Only if nothing arrives — a genuinely new
       * wallet, or a server with no database — is there a question to ask.
       */
      whenInWorld(() => {
        setTimeout(() => {
          if (confirmedName || modal.classList.contains('open')) return
          // A brand-new trader meets Kelby, who explains the game and asks
          // their name at the end of it — the original opening, restored.
          //
          // AND IF HE CANNOT COME, ASK ANYWAY. `playIntro` declines when the
          // conversation never mounted, and this was the only thing that ever
          // asked a nameless player for a name — so on a client where it
          // failed, nobody asked, ever, and the player kept the placeholder
          // for good. The fallback the comment used to promise is now actually
          // wired up.
          if (!playIntro()) openNameModal()
        }, NAME_GRACE_MS)

        /*
         * THE BACKSTOP.
         *
         * Measured on the live server: of 34 players, 7 had no name, and one
         * of them played for nine minutes as a placeholder. Every path above
         * is conditional on something — a timer, a mount, a socket reply — and
         * a question that is only sometimes asked is one that is sometimes
         * never answered.
         *
         * So: long after every other path has had its chance, if there is
         * still no confirmed name and nothing on screen asking for one, ask.
         * This costs a named player nothing (the first condition is false for
         * them) and it is the only check here that cannot itself be skipped.
         */
        setTimeout(function insist() {
          if (confirmedName) return
          const asking = modal.classList.contains('open') || introIsAsking()
          if (!asking && !playIntro()) openNameModal()
          setTimeout(insist, 30_000)
        }, 45_000)
      })
    }
  }

  if (hasWallet()) {
    onWalletReady()
  } else {
    input.placeholder = 'Connect a wallet to chat'
    input.disabled = true
    // index.html fires this the instant /auth/verify comes back.
    window.addEventListener('sm:wallet', () => onWalletReady())
  }

  // Choosing a name is mandatory, so while the modal is up the world must not
  // be playable behind it: without this the player just walks away from the
  // question and stays "Trader" forever.
  window.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('open')) return
    const inModal = modal.contains(e.target as Node)
    if (!inModal) { e.preventDefault(); e.stopPropagation() }
  }, true)

  // Changing a name later: the modal is the same one, so the rules and the
  // server's refusals are stated in one place.
  window.addEventListener('sm:change-name', () => {
    if (!hasWallet) { append('Connect a wallet first.', 'sys'); return }
    nameErr.textContent = ''
    openNameModal()
  })

  // --- chat input ---------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (modal.classList.contains('open')) return
    if (e.key === 'Enter' && document.activeElement !== input && !input.disabled) {
      e.preventDefault()
      input.focus()
    }
  })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation() // the engine listens on window; release the game keys
    if (e.key === 'Escape') { input.blur(); return }
    if (e.key !== 'Enter') return
    const text = input.value.trim()
    input.value = ''
    if (!text) { input.blur(); return }
    engine.processAction?.('chat:send', { text })
  })
}
