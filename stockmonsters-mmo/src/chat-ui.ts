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

  const panel = document.createElement('div')
  panel.id = 'chat-panel'
  panel.innerHTML =
    '<div id="chat-log"></div>' +
    '<div id="chat-row"><input id="chat-input" maxlength="140" ' +
    'placeholder="Press Enter to chat" disabled></div>'
  document.body.appendChild(panel)

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
    nameErr.textContent = d.reason
    if (!confirmedName) {
      // Rejected before anything was confirmed means this player still has no
      // name — ask again. But never over the title screen: the modal covers the
      // whole viewport at a higher z-index, so opening it there hides PLAY GAME
      // and the player cannot even get into the world to answer.
      whenInWorld(openNameModal)
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
      whenInWorld(openNameModal)
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
