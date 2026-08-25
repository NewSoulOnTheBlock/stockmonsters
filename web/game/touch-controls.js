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
    c: 0x0063, // PSDK "A"      — confirm
    x: 0x0078, // PSDK "B"      — cancel / run
    j: 0x006a, // PSDK "START"  — menu
    h: 0x0068, // PSDK "SELECT"
  }

  // Verified against PSDK's Input::Keys table (0_Dependencies.rb).
  var BUTTONS = [
    { id: 'a', label: 'A', key: KEY.c, hint: 'Confirm' },
    { id: 'b', label: 'B', key: KEY.x, hint: 'Cancel' },
    { id: 'start', label: 'START', key: KEY.j, hint: 'Menu' },
    { id: 'select', label: 'SELECT', key: KEY.h, hint: '' },
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
    var style = el('style')
    style.textContent = CSS
    document.head.appendChild(style)

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
  // Boot
  // ---------------------------------------------------------------------

  function start() {
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
