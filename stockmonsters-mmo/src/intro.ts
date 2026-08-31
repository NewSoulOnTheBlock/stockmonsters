/*
 * intro.ts — Kelby's introduction, and the name asked inside it.
 *
 *   mountIntro(engine)
 *   playIntro()        // chat-ui calls this instead of its bare modal
 *
 * ## Why this exists
 *
 * A player arrived on the dock and the game said nothing to them: no idea
 * what a Stockmonster was, what the token did, or where to go. The original
 * PSDK build opened with Kelby explaining all of it and asking your name at
 * the end, and that is what this restores — the same script, adapted where
 * the MMO differs (254 species, not 194; the dock, not the Tower).
 *
 * The name is asked HERE, as the last beat of the conversation, rather than
 * by a modal that appears out of nowhere. It is the same `name:set` action
 * and the same server rules; only the framing changed. A refused name is
 * answered in Kelby's own voice and asked again, so a player never falls out
 * of the fiction into a bare error box.
 *
 * ## What it must never do
 *
 * Trap anybody. It plays once, for a player the server has no name for, and
 * every path leads out: skip, escape, a refused name, or a server that never
 * answers. The world is already loaded behind it.
 */
import { injectStyle, el, guardKeys } from './ui-kit'
import { play as sfx } from './sfx'
import { openCharacterDesigner } from './character-designer'

interface EngineLike { processAction?: (action: string, data: unknown) => void }

/**
 * The opening, in beats.
 *
 * This follows the ORIGINAL PSDK script (Data/Text/Dialogs/2.csv) rather than
 * a summary of it: Kelby talks, asks how you want to look, takes your name,
 * reads it back to check he wrote it down properly, and signs off. That shape
 * is the thing the user asked for — a conversation that asks you things —
 * and it is why the last beat is a confirmation rather than a form submitting
 * into silence.
 *
 * Adapted where the MMO differs: 254 species rather than 194, and the dock and
 * the tower are real places you can walk to. One line is cleaned up; the
 * original is saltier than a public front page wants to be.
 */
type Beat =
    | { say: string }
    /** A yes/no Kelby reacts to. `then` is played for whichever was picked. */
    | { say: string; choose: [string, string]; then: [string[], string[]] }
    /** Opens the character designer, and waits for it to close. */
    | { say: string; designer: true }
    /** The name field. */
    | { ask: true }

const SCRIPT: readonly Beat[] = [
    { say: "Yo. I'm Kelby, and this is Stockmonsters." },
    { say: 'I built the game I wanted to play, and then I put the whole thing on chain.' },
    { say: 'Every ticker out there is a creature in here. Two hundred and fifty-four of them, one per stock.' },
    { say: 'Capital is not a number on a screen. It is Flow — and every creature you meet runs on it.' },
    { say: 'Track them. Catch them. Train them. Fight other traders for their best one, if you fancy your odds.' },
    { say: 'You are about to land on the dock. Everything past it is the Marketlands, and it is open.' },
    {
        say: 'Start at the Tower — that is where a Hunter\'s run begins, and there is always somebody in there worth talking to.',
    },
    { say: 'Before I let you loose I need a few details for your Hunter licence.' },
    {
        say: 'Do you know your way around a keyboard, or are you on a phone?',
        choose: ['Keyboard', 'Phone'],
        then: [
            ['Arrow keys to walk, space to talk, escape for the menu. Good.'],
            ['Then the stick and the buttons at the bottom are yours. They work the same.'],
        ],
    },
    { say: 'Right. Which look defines you best?', designer: true },
    { say: 'Finally — what name do you trade under?' },
    { ask: true },
]

const CSS = `
#sm-intro {
  position: fixed; inset: 0; z-index: 1003;
  display: none; align-items: flex-end; justify-content: center;
  background: rgba(9,7,15,.82);
  font-family: "Courier New", ui-monospace, monospace;
  image-rendering: pixelated;
  padding: 0 16px 8vh;
}
#sm-intro.open { display: flex; }
#sm-intro .box {
  width: min(680px, 100%);
  background: #26213a; border: 4px solid #f6c177;
  box-shadow: 6px 6px 0 #09070f; color: #fff1c7;
}
#sm-intro .who {
  padding: 8px 16px; border-bottom: 3px solid #f6c177;
  font-weight: 700; letter-spacing: .16em; font-size: 13px; color: #f6c177;
  display: flex; align-items: center; justify-content: space-between;
}
#sm-intro .skip {
  font: inherit; font-size: 11px; letter-spacing: .1em;
  background: none; border: 0; color: #b9b2d6; cursor: pointer; padding: 2px 4px;
}
#sm-intro .skip:hover { color: #fff1c7; }
#sm-intro .line {
  padding: 18px 16px; min-height: 4.6em;
  font-size: 15px; line-height: 1.7;
}
#sm-intro .more {
  padding: 0 16px 10px; text-align: right;
  font-size: 11px; letter-spacing: .1em; color: #b9b2d6;
}
#sm-intro .ask { padding: 0 16px 16px; display: none; }
#sm-intro.asking .ask { display: block; }
#sm-intro.asking .more, #sm-intro.choosing .more { display: none; }
#sm-intro .choices { padding: 0 16px 16px; display: none; gap: 10px; }
#sm-intro.choosing .choices { display: flex; }
#sm-intro .choices button {
  flex: 1; padding: 11px; font: inherit; font-size: 13px; font-weight: 700;
  color: #09070f; background: #f6c177;
  border: 3px solid #fff1c7; border-radius: 0; box-shadow: 3px 3px 0 #09070f; cursor: pointer;
}
#sm-intro .choices button:hover { background: #fff1c7; }
#sm-intro input {
  width: 100%; box-sizing: border-box;
  background: #1b1730; color: #fff1c7;
  border: 3px solid #f6c177; border-radius: 0;
  padding: 10px; font: inherit; font-size: 16px; outline: none;
}
#sm-intro .err { min-height: 1.4em; margin: 8px 0 0; font-size: 12px; color: #e06c75; }
#sm-intro .go {
  margin-top: 10px; width: 100%; padding: 12px;
  font: inherit; font-weight: 700; font-size: 15px; letter-spacing: .08em;
  color: #09070f; background: #7ecf6b;
  border: 3px solid #f6c177; border-radius: 0; box-shadow: 3px 3px 0 #09070f;
  cursor: pointer;
}
#sm-intro .go:disabled { opacity: .45; cursor: default; }
@media (pointer: coarse) { #sm-intro { padding-bottom: 4vh; } #sm-intro .line { font-size: 14px; } }
@media (prefers-reduced-motion: reduce) { #sm-intro .line { transition: none; } }
`

let root: HTMLElement | null = null
let choicesEl: HTMLElement | null = null
let lineEl: HTMLElement | null = null
let errEl: HTMLElement | null = null
let input: HTMLInputElement | null = null
let goBtn: HTMLButtonElement | null = null
let engineRef: EngineLike | null = null
let step = 0
let typing: ReturnType<typeof setInterval> | null = null
let finished = false
/** Lines queued by a choice, played before the script continues. */
let queued: string[] = []
/** The name waiting to be confirmed — Kelby reads it back before it sticks. */
let pendingName: string | null = null

const isOpen = () => !!root?.classList.contains('open')

/** Type the line out. Clicking again while it types completes it at once. */
function say(text: string) {
    if (!lineEl) return
    if (typing) { clearInterval(typing); typing = null }
    let i = 0
    lineEl.textContent = ''
    typing = setInterval(() => {
        if (!lineEl) return
        i += 2
        lineEl.textContent = text.slice(0, i)
        if (i >= text.length) { clearInterval(typing!); typing = null }
    }, 16)
}

const stillTyping = () => typing !== null

/** Show the two buttons for a choice beat and stop until one is pressed. */
function offer(beat: Extract<Beat, { choose: [string, string] }>) {
    if (!root || !choicesEl) return
    // addEventListener, NOT an `onclick` attribute. ui-kit's el() sets every
    // attribute with setAttribute, so a function handed to it is stringified
    // and the button silently does nothing — which is exactly how the
    // conversation stalled on this beat with no error anywhere.
    const buttons = beat.choose.map((label, i) => {
        const b = el('button', { type: 'button', text: label }) as HTMLButtonElement
        b.addEventListener('click', () => {
            root!.classList.remove('choosing')
            // Kelby answers the choice, then the script carries on.
            queued = [...beat.then[i]]
            advance()
        })
        return b
    })
    choicesEl.replaceChildren(...buttons)
    root.classList.add('choosing')
}

/** The current line's text, whatever kind of beat produced it. */
let showing: string | null = null

function advance() {
    if (!root) return
    if (root.classList.contains('choosing')) return // waiting on a button
    if (stillTyping()) {
        // Impatience is a valid input: finish the line rather than skipping it.
        if (typing) { clearInterval(typing); typing = null }
        if (showing && lineEl) lineEl.textContent = showing
        return
    }
    // Anything a choice queued up is said before the script moves on.
    const held = queued.shift()
    if (held !== undefined) { sfx('cursor'); showing = held; say(held); return }

    const beat = SCRIPT[step]
    step++
    if (beat === undefined) { askName(); return }
    if ('ask' in beat) { askName(); return }

    sfx('cursor')
    showing = beat.say
    say(beat.say)

    if ('choose' in beat) {
        // Let the line finish typing before the buttons appear, or they land
        // under half a sentence.
        setTimeout(() => offer(beat), Math.min(1200, beat.say.length * 16 + 120))
        return
    }
    if ('designer' in beat) {
        // The designer is a full-screen panel of its own. Hand over to it and
        // pick the conversation back up when it closes.
        setTimeout(() => {
            if (!isOpen()) return
            root?.classList.remove('open')
            try { openCharacterDesigner() } catch { /* not mounted; skip it */ }
            const resume = setInterval(() => {
                const designer = document.getElementById('sm-character-designer')
                if (designer?.classList.contains('scd-open')) return
                clearInterval(resume)
                if (finished) return
                root?.classList.add('open')
                advance()
            }, 400)
        }, Math.min(1400, beat.say.length * 16 + 200))
    }
}

function askName() {
    if (!root) return
    root.classList.add('asking')
    setTimeout(() => input?.focus(), 60)
}

function submit() {
    if (!input || !engineRef) return
    const name = input.value.trim()
    if (name.length < 3) { if (errEl) errEl.textContent = 'Three characters at least.'; return }
    if (errEl) errEl.textContent = ''
    if (goBtn) goBtn.disabled = true
    engineRef.processAction?.('name:set', { name })
    // The server answers with name:accepted or name:rejected; mountIntro
    // listens for both. Nothing closes on hope alone.
}

/** Kelby reacts to a refused name, in his own voice, and asks again. */
export function introNameRejected(reason: string): void {
    if (!isOpen()) return
    if (errEl) errEl.textContent = reason
    if (goBtn) goBtn.disabled = false
    if (input) { input.focus(); input.select() }
}

/**
 * The name stuck. Kelby reads it back before he lets go of it — the original
 * asks "did I write it properly?", and a form that vanishes the instant you
 * press a button is exactly the thing that made this feel like a browser
 * dialog rather than a conversation.
 */
export function introNameAccepted(name: string): void {
    if (!isOpen() || finished) return
    pendingName = name
    root?.classList.remove('asking')
    showing = `${name}. Did I write that down properly?`
    say(showing)
    setTimeout(() => {
        if (!isOpen() || finished) return
        offer({
            say: showing!,
            choose: ['That is me', 'Let me fix it'],
            then: [[], []],
        } as Extract<Beat, { choose: [string, string] }>)
        // Rewire the two buttons: this beat is not part of the script.
        const [yes, no] = Array.from(choicesEl?.children ?? []) as HTMLButtonElement[]
        if (yes) yes.onclick = () => { root?.classList.remove('choosing'); signOff() }
        if (no) no.onclick = () => {
            root?.classList.remove('choosing')
            pendingName = null
            showing = 'Say it again, then.'
            say(showing)
            if (input) { input.value = ''; }
            if (goBtn) goBtn.disabled = false
            setTimeout(askName, 700)
        }
    }, Math.min(1400, showing.length * 16 + 200))
}

/** Registered. Sign off and get out of the way. */
function signOff() {
    finished = true
    showing = `You are registered, ${pendingName ?? 'Hunter'}. The Marketlands are open — go build a portfolio worth talking about. Good hunting.`
    say(showing)
    setTimeout(closeIntro, 3400)
}

export function closeIntro(): void {
    if (typing) { clearInterval(typing); typing = null }
    root?.classList.remove('open', 'asking')
}

/**
 * Play it. Safe to call twice — the second call is ignored while it is up,
 * and once a name is confirmed it never plays again.
 */
export function playIntro(): void {
    if (!root || isOpen() || finished) return
    step = 0
    queued = []
    pendingName = null
    showing = null
    root.classList.remove('asking', 'choosing')
    root.classList.add('open')
    advance()
}

export function mountIntro(engine: EngineLike): void {
    if (root) return
    injectStyle('sm-intro-css', CSS)
    engineRef = engine

    root = el('div', { id: 'sm-intro', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Introduction' })
    const skip = el('button', { class: 'skip', type: 'button', text: 'SKIP ▸' })
    const who = el('div', { class: 'who' }, [el('span', { text: 'KELBY' }), skip])
    lineEl = el('div', { class: 'line' })
    const more = el('div', { class: 'more', text: '▼ click to continue' })

    input = el('input', {
        maxlength: '16', autocomplete: 'off', spellcheck: 'false',
        'aria-label': 'Your trader name', placeholder: 'your trader name',
    }) as HTMLInputElement
    guardKeys(input)
    errEl = el('div', { class: 'err' })
    goBtn = el('button', { class: 'go', type: 'button', text: 'REGISTER' }) as HTMLButtonElement
    const ask = el('div', { class: 'ask' }, [input, errEl, goBtn])
    choicesEl = el('div', { class: 'choices' })

    const box = el('div', { class: 'box' }, [who, lineEl, more, choicesEl, ask])
    root.appendChild(box)
    document.body.appendChild(root)

    // Clicking the box advances; clicking a control inside it must not.
    box.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('input, button')) return
        if (!root?.classList.contains('asking')) advance()
    })
    skip.addEventListener('click', (e) => {
        e.stopPropagation()
        // Skipping the story still has to reach the question — the name is not
        // optional, it is what everyone sees above your head.
        if (typing) { clearInterval(typing); typing = null }
        step = SCRIPT.length
        queued = []
        root?.classList.remove('choosing')
        askName()
    })
    goBtn.addEventListener('click', submit)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } })
    input.addEventListener('input', () => { if (errEl) errEl.textContent = '' })

    // Enter and Space advance the story too, but never while typing a name.
    window.addEventListener('keydown', (e) => {
        if (!isOpen() || root?.classList.contains('asking')) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance() }
    }, true)
}
