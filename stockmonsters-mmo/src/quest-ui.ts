/*
 * quest-ui.ts — the daily quest board.
 *
 *   mountQuestUi(engine, socket)
 *   openQuests()                  // the HUD's QUESTS button
 *
 * The board is drawn from `quests:state`, which the server sends in reply to
 * `quests:list` and after every claim. Nothing here computes progress or
 * eligibility — the server has already decided both, and the panel's whole
 * job is to say it plainly: locked (and why), in progress (how far), done
 * (claim it), claimed (see you tomorrow).
 */
import {
  ensureUiKit, injectStyle, el, pushLayer, makeDraggable, watchGameDialog, Z, THEME,
} from './ui-kit'
import { play as sfx } from './sfx'
import { TOKEN_SYMBOL } from './modules/main/pricing'

interface EngineLike { processAction?: (action: string, data: unknown) => void }
interface SocketLike { on?: (type: string, cb: (data: any) => void) => void }

interface QuestRow {
  id: string; title: string; goal: number; reward: number; usd?: number
  have: number; claimed: boolean; claimable: boolean
}
interface QuestView {
  epoch: number
  unlocked: boolean
  reason: string | null
  tokenId: string | null
  quests: QuestRow[]
}

const CSS = `
#sm-quests {
  display: none; z-index: ${Z.marketWindow};
  left: 50%; top: 90px; transform: translateX(-50%);
  width: min(460px, 94vw);
  font-size: 12px;
}
#sm-quests.open { display: flex; }
#sm-quests.dialog-hidden { display: none !important; }
#sm-quests .q-body { display: flex; flex-direction: column; gap: 10px; padding: 12px; }

#sm-quests .q-gate {
  background: ${THEME.dark}; border: 2px solid ${THEME.border};
  padding: 10px 12px; line-height: 1.6;
}
#sm-quests .q-gate b { color: ${THEME.border}; }

#sm-quests .q-row {
  display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center;
  background: ${THEME.dark}; border: 2px solid rgba(246,193,119,.4);
  padding: 9px 10px;
}
#sm-quests .q-row.is-done { border-color: ${THEME.ok}; }
#sm-quests .q-row.is-claimed { opacity: .55; }
#sm-quests .q-title { font-weight: 700; color: ${THEME.text}; }
#sm-quests .q-reward { color: ${THEME.border}; font-weight: 700; white-space: nowrap; }
#sm-quests .q-bar {
  grid-column: 1 / -1; height: 10px;
  background: rgba(9,7,15,.8); border: 2px solid rgba(246,193,119,.35);
}
#sm-quests .q-bar i { display: block; height: 100%; background: ${THEME.ok}; transition: width .3s ease; }
#sm-quests .q-count { color: ${THEME.muted}; font-size: 11px; }
#sm-quests .q-claim { justify-self: end; }
#sm-quests .q-note { color: ${THEME.muted}; line-height: 1.5; }

/* The mobile sheet treatment comes from touch-controls.ts, injected last. */
`

let root: HTMLElement | null = null
let body: HTMLElement | null = null
let engineRef: EngineLike | null = null
let state: QuestView | null = null
let release: (() => void) | null = null

const isOpen = () => !!root?.classList.contains('open')

function render() {
  if (!body) return
  body.textContent = ''

  if (!state) {
    body.appendChild(el('div', { class: 'q-note', text: 'Asking the server for today’s board…' }))
    return
  }

  if (!state.unlocked) {
    body.appendChild(el('div', { class: 'q-gate' }, [
      el('span', {
        html: `<b>QUESTS ARE FOR OWNERS.</b> ${state.reason ?? ''} ` +
          'One opened Stockmonster unlocks the daily board for one trader — ' +
          'the same creature cannot open it for anyone else that day.',
      }),
    ]))
    return
  }

  body.appendChild(el('div', { class: 'q-gate' }, [
    el('span', {
      html: `<b>THE DAILY BOARD.</b> Unlocked by Stockmonster <b>#${state.tokenId}</b>. ` +
        'Rewards land in your claimable earnings — the same pot battles pay into, ' +
        'under the same daily cap. A new board every day.',
    }),
  ]))

  for (const q of state.quests) {
    const row = el('div', {
      class: `q-row${q.claimable ? ' is-done' : ''}${q.claimed ? ' is-claimed' : ''}`,
    })
    row.append(
      el('span', { class: 'q-title', text: q.title }),
      // The dollar figure is what the quest is actually WORTH — the token
      // amount is derived from it and moves with the price, so showing only
      // the tokens would be showing the half that means less over time.
      el('span', {
        class: 'q-reward',
        text: q.claimed
          ? 'CLAIMED'
          : typeof q.usd === 'number'
            ? `+$${q.usd.toFixed(2).replace(/\.00$/, '')}`
            : `+${q.reward} ${TOKEN_SYMBOL}`,
        title: `${q.reward.toLocaleString()} ${TOKEN_SYMBOL} at today's price`,
      }),
      el('div', { class: 'q-bar' }, [el('i', { style: `width:${Math.round((q.have / q.goal) * 100)}%` })]),
      el('span', { class: 'q-count', text: `${q.have} / ${q.goal}` }),
    )
    if (q.claimable) {
      const btn = el('button', { class: 'smui-btn is-primary q-claim', type: 'button', text: 'CLAIM' })
      btn.addEventListener('click', () => {
        btn.disabled = true
        engineRef?.processAction?.('quests:claim', { id: q.id })
      })
      row.appendChild(btn)
    }
    body.appendChild(row)
  }
}

export function openQuests(): void {
  if (!root) return
  root.classList.add('open')
  release?.()
  release = pushLayer(() => closeQuests())
  // Ask fresh every open: the board may have rolled to a new epoch, and the
  // gate may have newly opened (they just bought a box).
  engineRef?.processAction?.('quests:list', {})
  render()
}

export function closeQuests(): void {
  root?.classList.remove('open')
  release?.()
  release = null
}

export function mountQuestUi(engine: EngineLike, socket: SocketLike): void {
  if (root) return
  ensureUiKit()
  injectStyle('sm-quests-css', CSS)
  engineRef = engine

  root = el('div', { id: 'sm-quests', class: 'smui smui-win', role: 'dialog', 'aria-label': 'Quests' })
  const bar = el('div', { class: 'smui-titlebar' })
  const close = el('button', { class: 'smui-btn smui-close is-danger', type: 'button', text: '✕' })
  bar.append(el('span', { class: 'title', text: 'DAILY QUESTS' }), el('span', { class: 'spacer' }), close)
  body = el('div', { class: 'q-body' })
  root.append(bar, body)
  document.body.appendChild(root)
  makeDraggable(root, bar)
  watchGameDialog((open) => root!.classList.toggle('dialog-hidden', open))
  close.addEventListener('click', () => closeQuests())

  socket.on?.('quests:state', (d: QuestView) => {
    state = d
    if (isOpen()) render()
  })
  socket.on?.('quests:claimed', (d: { title?: string; paid?: number }) => {
    sfx('confirm')
  })
  // A quest crossing its goal mid-play: one nudge, not a parade.
  socket.on?.('quests:done', (d: { title?: string; reward?: number }) => {
    sfx('caught')
  })
}
