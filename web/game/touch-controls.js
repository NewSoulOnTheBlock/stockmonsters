/*
 * Stockmonsters — on-screen controls for touch devices.
 *
 * The game is keyboard-only, and neko's own mobile affordance is a button that
 * opens the OS soft keyboard — useless for a game. This adds a real D-pad and
 * face buttons.
 *
 * It talks to neko through the client it exposes globally:
 *
 *     window.$client.sendData('keydown', { key: <X11 keysym> })
 *
 * which is the same call neko's own keyboard handler makes, so it bypasses
 * Guacamole's browser-key translation entirely and cannot disagree with it.
 *
 * Loaded from /var/www/index.html, so it runs in neko's own document — no
 * iframe, no cross-origin, nothing to keep in sync with neko's Vue internals.
 */
(function () {
  'use strict'

  // X11 keysyms. Arrows are in the 0xff00 function-key block; letters are
  // just their ASCII value.
  var KEY = {
    up: 0xff52,
    down: 0xff54,
    left: 0xff51,
    right: 0xff53,
    // Every PSDK virtual button has several bindings. We deliberately pick the
    // NON-LETTER one for each: the game asks the player to type a name, and
    // with the letter bindings (C, X, J, H) tapping A on that screen typed a
    // literal "c" instead of confirming.
    enter: 0xff0d, // PSDK "A"      — confirm   (also C, Space)
    escape: 0xff1b, // PSDK "B"      — cancel    (also X, Backspace)
    insert: 0xff63, // PSDK "START"  — menu      (also J)
    pause: 0xff13, // PSDK "SELECT"             (also H)
    backspace: 0xff08,
  }

  // Verified against PSDK's Input::Keys table (0_Dependencies.rb).
  var BUTTONS = [
    { id: 'a', label: 'A', key: KEY.enter, hint: 'Confirm' },
    { id: 'b', label: 'B', key: KEY.escape, hint: 'Cancel' },
    { id: 'start', label: 'START', key: KEY.insert, hint: 'Menu' },
    { id: 'select', label: 'SELECT', key: KEY.pause, hint: '' },
  ]

  var DIRS = ['up', 'down', 'left', 'right']

  function isTouchDevice() {
    return (
      ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
      window.matchMedia('(pointer: coarse)').matches
    )
  }

  // ---------------------------------------------------------------------
  // Key transport
  // ---------------------------------------------------------------------

  var pressed = Object.create(null) // keysym -> true

  function client() {
    return window.$client
  }

  function send(event, keysym) {
    var c = client()
    if (!c || typeof c.sendData !== 'function') return
    try {
      c.sendData(event, { key: keysym })
    } catch (err) {
      /* not connected yet, or we lost control — nothing useful to do */
    }
  }

  function keyDown(keysym) {
    if (pressed[keysym]) return
    pressed[keysym] = true
    send('keydown', keysym)
  }

  function keyUp(keysym) {
    if (!pressed[keysym]) return
    delete pressed[keysym]
    send('keyup', keysym)
  }

  // A key held when the page is backgrounded would otherwise stay down on the
  // server forever, and the character walks into a wall until someone
  // reconnects. Release everything whenever we lose the foreground.
  function releaseAll() {
    Object.keys(pressed).forEach(function (k) {
      keyUp(Number(k))
    })
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------

  var CSS = [
    '#sm-touch{position:fixed;inset:0;z-index:120;pointer-events:none;',
    '  touch-action:none;-webkit-user-select:none;user-select:none;',
    '  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}',
    '#sm-touch .sm-pad,#sm-touch .sm-btn{pointer-events:auto;',
    '  -webkit-tap-highlight-color:transparent;}',

    /* D-pad, bottom-left, clear of the iOS home indicator */
    '#sm-touch .sm-pad{position:absolute;left:calc(16px + env(safe-area-inset-left));',
    '  bottom:calc(20px + env(safe-area-inset-bottom));width:150px;height:150px;',
    '  border-radius:50%;background:rgba(20,22,28,.42);',
    '  border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(6px);}',
    '#sm-touch .sm-arrow{position:absolute;width:44px;height:44px;display:flex;',
    '  align-items:center;justify-content:center;color:rgba(255,255,255,.75);',
    '  font-size:19px;line-height:1;transition:color .1s,transform .1s;}',
    '#sm-touch .sm-arrow.on{color:#fff;transform:scale(1.22);}',
    '#sm-touch .sm-arrow.up{top:6px;left:53px}',
    '#sm-touch .sm-arrow.down{bottom:6px;left:53px}',
    '#sm-touch .sm-arrow.left{left:6px;top:53px}',
    '#sm-touch .sm-arrow.right{right:6px;top:53px}',
    '#sm-touch .sm-nub{position:absolute;left:50%;top:50%;width:52px;height:52px;',
    '  margin:-26px 0 0 -26px;border-radius:50%;background:rgba(255,255,255,.14);',
    '  border:1px solid rgba(255,255,255,.2);transition:transform .06s;}',

    /* Face buttons, bottom-right */
    '#sm-touch .sm-face{position:absolute;right:calc(20px + env(safe-area-inset-right));',
    '  bottom:calc(34px + env(safe-area-inset-bottom));width:150px;height:120px;}',
    '#sm-touch .sm-btn{position:absolute;display:flex;align-items:center;',
    '  justify-content:center;border-radius:50%;color:#fff;font-weight:700;',
    '  background:rgba(20,22,28,.42);border:1px solid rgba(255,255,255,.18);',
    '  backdrop-filter:blur(6px);transition:transform .08s,background .08s;}',
    '#sm-touch .sm-btn:active,#sm-touch .sm-btn.on{transform:scale(.9);',
    '  background:rgba(255,255,255,.28);}',
    '#sm-touch .sm-btn.a{right:0;bottom:34px;width:68px;height:68px;font-size:22px;',
    '  background:rgba(41,140,90,.55);}',
    '#sm-touch .sm-btn.b{right:70px;bottom:2px;width:60px;height:60px;font-size:20px;',
    '  background:rgba(150,54,54,.55);}',

    /* Menu buttons, top-centre — small, out of the way */
    '#sm-touch .sm-meta{position:absolute;top:calc(10px + env(safe-area-inset-top));',
    '  left:50%;transform:translateX(-50%);display:flex;gap:8px;}',
    '#sm-touch .sm-btn.meta{position:static;border-radius:14px;height:28px;',
    '  padding:0 12px;font-size:10px;letter-spacing:.09em;}',
    '#sm-touch .sm-btn.kbd{font-size:15px;padding:0 14px;}',
    '#sm-touch .sm-btn.kbd.open{background:rgba(41,140,90,.7);}',
    '#sm-kbd{position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;',
    '  border:0;padding:0;pointer-events:none;}',

    /* First-tap gate. Mobile browsers block both fullscreen and audio until
       the user gestures, so one tap buys us both plus orientation lock. */
    '#sm-start{position:fixed;inset:0;z-index:140;display:flex;align-items:center;',
    '  justify-content:center;flex-direction:column;gap:18px;cursor:pointer;',
    '  background:radial-gradient(ellipse at center,#12161f 0%,#07090d 100%);',
    '  color:#fff;font-family:system-ui,-apple-system,sans-serif;}',
    '#sm-start .sm-play{display:flex;align-items:center;justify-content:center;',
    '  width:84px;height:84px;border-radius:50%;background:rgba(41,140,90,.9);',
    '  box-shadow:0 0 0 0 rgba(41,140,90,.7);animation:sm-pulse 2s infinite;}',
    '#sm-start .sm-play:after{content:"";border-style:solid;border-width:15px 0 15px 24px;',
    '  border-color:transparent transparent transparent #fff;margin-left:6px;}',
    '@keyframes sm-pulse{70%{box-shadow:0 0 0 22px rgba(41,140,90,0)}',
    '  100%{box-shadow:0 0 0 0 rgba(41,140,90,0)}}',
    '#sm-start b{font-size:15px;letter-spacing:.14em;font-weight:700}',
    '#sm-start span{font-size:12px;opacity:.5}',

    /* Landscape is what this game wants; nudge people there once. */
    '#sm-rotate{position:fixed;inset:0;z-index:130;display:none;',
    '  align-items:center;justify-content:center;flex-direction:column;gap:10px;',
    '  background:rgba(10,11,15,.92);color:#fff;text-align:center;padding:24px;',
    '  font-family:system-ui,-apple-system,sans-serif;}',
    '@media (orientation:portrait){#sm-rotate.armed{display:flex}}',
    '#sm-rotate b{font-size:16px;font-weight:700}',
    '#sm-rotate span{font-size:13px;opacity:.65;max-width:260px;line-height:1.5}',
  ].join('')

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text) n.textContent = text
    return n
  }

  function build() {
    var root = el('div')
    root.id = 'sm-touch'

    // --- D-pad ---------------------------------------------------------
    var pad = el('div', 'sm-pad')
    var nub = el('div', 'sm-nub')
    pad.appendChild(nub)
    var arrows = {}
    var glyphs = { up: '▲', down: '▼', left: '◀', right: '▶' }
    DIRS.forEach(function (d) {
      var a = el('div', 'sm-arrow ' + d, glyphs[d])
      arrows[d] = a
      pad.appendChild(a)
    })
    root.appendChild(pad)

    // --- face buttons --------------------------------------------------
    var face = el('div', 'sm-face')
    var meta = el('div', 'sm-meta')
    BUTTONS.forEach(function (b) {
      var isMeta = b.id === 'start' || b.id === 'select'
      var node = el('div', 'sm-btn ' + (isMeta ? 'meta ' : '') + b.id, b.label)
      bindButton(node, b.key)
      ;(isMeta ? meta : face).appendChild(node)
    })

    var kbd = el('div', 'sm-btn meta kbd', '\u2328')
    meta.appendChild(kbd)

    root.appendChild(face)
    root.appendChild(meta)

    document.body.appendChild(root)

    var rotate = el('div')
    rotate.id = 'sm-rotate'
    rotate.className = 'armed'
    rotate.appendChild(el('b', null, 'Turn your phone sideways'))
    rotate.appendChild(el('span', null, 'Stockmonsters plays in landscape.'))
    document.body.appendChild(rotate)

    bindPad(pad, nub, arrows)
    bindKeyboard(kbd)
  }

  // ---------------------------------------------------------------------
  // Input binding
  // ---------------------------------------------------------------------

  function bindButton(node, keysym) {
    function down(e) {
      e.preventDefault()
      e.stopPropagation()
      node.classList.add('on')
      keyDown(keysym)
    }
    function up(e) {
      e.preventDefault()
      e.stopPropagation()
      node.classList.remove('on')
      keyUp(keysym)
    }
    node.addEventListener('touchstart', down, { passive: false })
    node.addEventListener('touchend', up, { passive: false })
    node.addEventListener('touchcancel', up, { passive: false })
  }

  // A tap of a key, for characters coming from the phone's soft keyboard.
  function tap(keysym) {
    send('keydown', keysym)
    send('keyup', keysym)
  }

  // The game's very first prompt asks the player to type a name, and a phone
  // has no keyboard. This borrows the OS one: an off-screen input takes the
  // focus, and every character it receives is forwarded as a keysym. For
  // printable ASCII the X11 keysym IS the character code, so no table needed.
  //
  // A zero-width sentinel sits in the field permanently so that Backspace
  // always has something to delete — on an empty input many soft keyboards
  // emit no event at all, and the player could never correct a typo.
  var SENTINEL = '\u200b'

  function bindKeyboard(button) {
    var input = document.createElement('input')
    input.id = 'sm-kbd'
    input.type = 'text'
    input.autocapitalize = 'none'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.setAttribute('autocorrect', 'off')
    input.setAttribute('enterkeyhint', 'done')
    document.body.appendChild(input)

    function reset() {
      input.value = SENTINEL
      try {
        input.setSelectionRange(SENTINEL.length, SENTINEL.length)
      } catch (err) {}
    }

    input.addEventListener('input', function () {
      var v = input.value
      if (v.length > SENTINEL.length) {
        var added = v.split(SENTINEL).join('')
        for (var i = 0; i < added.length; i++) {
          var code = added.charCodeAt(i)
          // Some keyboards deliver the return key as a newline character
          // rather than a keydown.
          tap(code === 10 || code === 13 ? KEY.enter : code)
        }
      } else if (v.length < SENTINEL.length) {
        tap(KEY.backspace)
      }
      reset()
    })

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        tap(KEY.enter)
      }
    })

    input.addEventListener('blur', function () {
      button.classList.remove('open')
    })

    function toggle(e) {
      e.preventDefault()
      e.stopPropagation()
      if (document.activeElement === input) {
        input.blur()
        button.classList.remove('open')
      } else {
        reset()
        input.focus()
        button.classList.add('open')
      }
    }
    button.addEventListener('touchend', toggle, { passive: false })
    button.addEventListener('click', toggle)
    reset()
  }

  // The pad is analogue-ish: the direction follows wherever the finger is
  // relative to the centre, and updates as it slides. Eight-way, so diagonals
  // work without needing to hit a specific quadrant.
  function bindPad(pad, nub, arrows) {
    var touchId = null
    var active = {}

    // Below this distance from centre we treat it as neutral, so resting a
    // thumb in the middle does not pick a random direction.
    var DEADZONE = 16

    function apply(next) {
      DIRS.forEach(function (d) {
        if (next[d] && !active[d]) {
          keyDown(KEY[d])
          arrows[d].classList.add('on')
        } else if (!next[d] && active[d]) {
          keyUp(KEY[d])
          arrows[d].classList.remove('on')
        }
      })
      active = next
    }

    function fromTouch(t) {
      var r = pad.getBoundingClientRect()
      var dx = t.clientX - (r.left + r.width / 2)
      var dy = t.clientY - (r.top + r.height / 2)
      var dist = Math.sqrt(dx * dx + dy * dy)

      var limit = r.width / 2 - 26
      var k = dist > limit ? limit / dist : 1
      nub.style.transform = 'translate(' + dx * k + 'px,' + dy * k + 'px)'

      if (dist < DEADZONE) return {}

      // Split the circle into 8 sectors of 45°, offset by 22.5° so that
      // "straight up" sits in the middle of a sector rather than on a border.
      var angle = Math.atan2(dy, dx) * (180 / Math.PI) // -180..180, 0 = right
      var sector = Math.round(((angle + 360) % 360) / 45) % 8
      return {
        right: sector === 0 || sector === 1 || sector === 7,
        down: sector >= 1 && sector <= 3,
        left: sector >= 3 && sector <= 5,
        up: sector >= 5 && sector <= 7,
      }
    }

    pad.addEventListener(
      'touchstart',
      function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (touchId !== null) return
        var t = e.changedTouches[0]
        touchId = t.identifier
        apply(fromTouch(t))
      },
      { passive: false },
    )

    pad.addEventListener(
      'touchmove',
      function (e) {
        e.preventDefault()
        e.stopPropagation()
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === touchId) {
            apply(fromTouch(e.changedTouches[i]))
            return
          }
        }
      },
      { passive: false },
    )

    function end(e) {
      e.preventDefault()
      e.stopPropagation()
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          touchId = null
          nub.style.transform = ''
          apply({})
          return
        }
      }
    }
    pad.addEventListener('touchend', end, { passive: false })
    pad.addEventListener('touchcancel', end, { passive: false })
  }

  // ---------------------------------------------------------------------
  // Fullscreen / first-tap gate
  // ---------------------------------------------------------------------

  function goFullscreen() {
    var d = document.documentElement
    var req = d.requestFullscreen || d.webkitRequestFullscreen || d.msRequestFullscreen
    // iOS Safari has no Fullscreen API on non-video elements at all, so this
    // is best-effort by design: the page still plays, just not fullscreen.
    if (req) {
      try {
        var r = req.call(d, { navigationUI: 'hide' })
        if (r && r.catch) r.catch(function () {})
      } catch (err) {}
    }
    if (screen.orientation && screen.orientation.lock) {
      try {
        var p = screen.orientation.lock('landscape')
        if (p && p.catch) p.catch(function () {})
      } catch (err) {}
    }
  }

  // The video starts muted so it can autoplay; a gesture is what lets us turn
  // the sound on. Without this the game is silent on every phone.
  function unmute() {
    var v = document.querySelector('video')
    if (!v) return
    v.muted = false
    v.volume = 1
    var p = v.play()
    if (p && p.catch) p.catch(function () {})
  }

  function startGate() {
    var gate = el('div')
    gate.id = 'sm-start'
    gate.appendChild(el('div', 'sm-play'))
    gate.appendChild(el('b', null, 'PLAY'))
    gate.appendChild(el('span', null, 'tap to start with sound'))

    function go(e) {
      if (e) e.preventDefault()
      goFullscreen()
      unmute()
      gate.remove()
    }
    gate.addEventListener('click', go)
    gate.addEventListener('touchend', go, { passive: false })
    document.body.appendChild(gate)
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function start() {
    var style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    startGate()

    if (!isTouchDevice()) return

    build()

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releaseAll()
    })
    window.addEventListener('blur', releaseAll)
    window.addEventListener('pagehide', releaseAll)

    // Stop the page itself from panning/zooming under the controls.
    document.addEventListener(
      'gesturestart',
      function (e) {
        e.preventDefault()
      },
      { passive: false },
    )
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
