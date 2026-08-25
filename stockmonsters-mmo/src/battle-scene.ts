// Battle visual scene — a DOM overlay driven by `player.emit()` events from
// the server (battle.ts). The dialog GUI keeps driving the flow (choices,
// text); this layer only paints the classic battle picture under it: enemy
// front sprite top-right, your creature bottom-left, pixel HP panels.
//
// z-index 800 puts it above the map but under the dialog layer (1000) and
// the transfer cover (900) stays irrelevant during battles.

interface BattlerView {
    name: string
    level: number
    hp: number
    maxHp: number
    sprite: string
    status?: string
}

interface BattleStatePayload {
    wild: BattlerView
    mine: BattlerView
}

const html = `
<div class="bs-bg"></div>
<div class="bs-panel bs-panel-wild">
  <div class="bs-name"></div>
  <div class="bs-hpbar"><i></i></div>
</div>
<img class="bs-sprite bs-sprite-wild" alt="">
<div class="bs-panel bs-panel-mine">
  <div class="bs-name"></div>
  <div class="bs-hpbar"><i></i></div>
  <div class="bs-hptext"></div>
</div>
<img class="bs-sprite bs-sprite-mine" alt="">
`

const css = `
#battle-scene {
  position: fixed; inset: 0; z-index: 800;
  display: none; overflow: hidden;
  image-rendering: pixelated;
  font-family: "Courier New", ui-monospace, monospace;
}
#battle-scene.open { display: block; }
#battle-scene .bs-bg {
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse 70% 45% at 78% 62%, rgba(246,193,119,.22), transparent 60%),
    radial-gradient(ellipse 70% 45% at 22% 92%, rgba(126,207,107,.16), transparent 60%),
    linear-gradient(#1b1730 0%, #26213a 55%, #1b1730 100%);
}
#battle-scene .bs-sprite {
  position: absolute;
  width: min(34vmin, 240px); height: auto;
  image-rendering: pixelated;
  filter: drop-shadow(0 6px 0 rgba(9,7,15,.55));
}
#battle-scene .bs-sprite-wild {
  right: 12%; top: 16%;
  animation: bs-idle-wild 2.6s ease-in-out infinite;
}
#battle-scene .bs-sprite-mine {
  left: 12%; bottom: 22%;
  transform: scaleX(-1);
  animation: bs-idle-mine 2.2s ease-in-out infinite;
}
@keyframes bs-idle-wild { 50% { transform: translateY(-6px); } }
@keyframes bs-idle-mine { 50% { transform: scaleX(-1) translateY(-4px); } }
#battle-scene .bs-sprite.bs-hit { animation: bs-hit .35s steps(2, jump-none) 2; }
@keyframes bs-hit { 50% { opacity: .15; } }
#battle-scene .bs-panel {
  position: absolute;
  min-width: min(280px, 44vw);
  padding: 10px 14px;
  background: #26213a;
  border: 3px solid #f6c177;
  box-shadow: 4px 4px 0 #09070f;
  color: #fff1c7;
}
#battle-scene .bs-panel-wild { left: 6%; top: 10%; }
#battle-scene .bs-panel-mine { right: 6%; bottom: 24%; }
#battle-scene .bs-name { font-weight: 700; font-size: 14px; letter-spacing: .06em; margin-bottom: 8px; }
#battle-scene .bs-name .bs-status {
  margin-left: 8px; padding: 1px 6px; font-size: 11px;
  background: #b48ead; color: #09070f; border: 2px solid #09070f;
  text-transform: uppercase;
}
#battle-scene .bs-hpbar {
  height: 10px; background: #09070f; border: 2px solid #4a4368;
}
#battle-scene .bs-hpbar > i {
  display: block; height: 100%; width: 100%;
  background: #7ecf6b;
  transition: width .45s steps(12);
}
#battle-scene .bs-hpbar > i.low { background: #f6c177; }
#battle-scene .bs-hpbar > i.critical { background: #e06c75; }
#battle-scene .bs-hptext { margin-top: 6px; font-size: 12px; text-align: right; }
`

export function mountBattleScene(socket: { on: (type: string, cb: (data: any) => void) => void }) {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)

    const root = document.createElement('div')
    root.id = 'battle-scene'
    root.innerHTML = html
    document.body.appendChild(root)

    const el = (sel: string) => root.querySelector(sel) as HTMLElement
    const lastHp: Record<'wild' | 'mine', number | null> = { wild: null, mine: null }

    function paint(side: 'wild' | 'mine', b: BattlerView) {
        const panel = el(`.bs-panel-${side}`)
        const name = panel.querySelector('.bs-name') as HTMLElement
        name.textContent = `${b.name}  L${b.level}`
        if (b.status) {
            const tag = document.createElement('span')
            tag.className = 'bs-status'
            tag.textContent = b.status
            name.appendChild(tag)
        }
        const bar = panel.querySelector('.bs-hpbar > i') as HTMLElement
        const ratio = Math.max(0, b.hp) / b.maxHp
        bar.style.width = `${ratio * 100}%`
        bar.className = ratio <= 0.2 ? 'critical' : ratio <= 0.5 ? 'low' : ''
        const hptext = panel.querySelector('.bs-hptext') as HTMLElement | null
        if (hptext) hptext.textContent = `${Math.max(0, b.hp)}/${b.maxHp}`

        const sprite = el(`.bs-sprite-${side}`) as HTMLImageElement
        if (!sprite.src.endsWith(b.sprite)) sprite.src = b.sprite
        // flash on damage
        if (lastHp[side] != null && b.hp < (lastHp[side] as number)) {
            sprite.classList.remove('bs-hit')
            void sprite.offsetWidth // restart the animation
            sprite.classList.add('bs-hit')
        }
        lastHp[side] = b.hp
    }

    socket.on('battle:state', (data: BattleStatePayload) => {
        if (!data?.wild || !data?.mine) return
        paint('wild', data.wild)
        paint('mine', data.mine)
        root.classList.add('open')
    })
    socket.on('battle:end', () => {
        root.classList.remove('open')
        lastHp.wild = null
        lastHp.mine = null
    })
}
