import connectionsRaw from './data/rmxp-connections.json'
import { MAP_CATALOG } from './data/map-catalog'

/*
 * Exit hints: pixel arrows pinned to the edges of the screen showing which way
 * out of the current map leads somewhere, and where it goes.
 *
 * Why on the screen edge rather than on the tile: these maps join along a whole
 * border, sometimes hundreds of tiles wide, so marking every warp tile would
 * mean thousands of components synced to every client for no extra
 * information. One arrow per direction says the same thing and is readable the
 * moment the map loads.
 *
 * Drawn in the DOM, not the canvas — that keeps the arrows crisp at any zoom
 * and lets them animate for free.
 */

type Edge = 'north' | 'south' | 'east' | 'west'
interface Connection {
  from: string | null
  fromEdge: Edge
  to: string | null
  toEdge: Edge
}

const connections = (connectionsRaw as { connections: Connection[] }).connections
const NAME_BY_ID = new Map(MAP_CATALOG.map((m) => [m.id, m.name]))

/** Both directions of every declared link, indexed by the map you stand on. */
const exitsByMap = new Map<string, { edge: Edge; to: string }[]>()
for (const c of connections) {
  if (!c.from || !c.to) continue
  const add = (from: string, edge: Edge, to: string) => {
    const list = exitsByMap.get(from) ?? []
    if (!list.some((e) => e.edge === edge && e.to === to)) list.push({ edge, to })
    exitsByMap.set(from, list)
  }
  add(c.from, c.fromEdge, c.to)
  add(c.to, c.toEdge, c.from)
}

const css = `
#sm-exits {
  position: fixed; inset: 0; z-index: 690;
  pointer-events: none;
  font-family: "Courier New", ui-monospace, monospace;
  image-rendering: pixelated;
}
#sm-exits .ex {
  position: absolute;
  display: none;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  background: rgba(38,33,58,.9);
  border: 3px solid #f6c177;
  box-shadow: 3px 3px 0 #09070f;
  color: #fff1c7;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  white-space: nowrap;
}
#sm-exits .ex.on { display: flex; }
#sm-exits .ex .arrow { color: #7ecf6b; font-size: 14px; line-height: 1; }
/* Steps, not a smooth slide — a smooth tween looks wrong next to pixel art. */
@keyframes sm-ex-v { 0%,100% { transform: translate(-50%, 0); } 50% { transform: translate(-50%, 5px); } }
@keyframes sm-ex-h { 0%,100% { transform: translate(0, -50%); } 50% { transform: translate(5px, -50%); } }
#sm-exits .ex-north { top: 14px;  left: 50%; animation: sm-ex-v 1.1s steps(2, jump-none) infinite reverse; }
#sm-exits .ex-south { bottom: 14px; left: 50%; animation: sm-ex-v 1.1s steps(2, jump-none) infinite; }
#sm-exits .ex-west  { left: 14px;  top: 50%; animation: sm-ex-h 1.1s steps(2, jump-none) infinite reverse; }
#sm-exits .ex-east  { right: 14px; top: 50%; animation: sm-ex-h 1.1s steps(2, jump-none) infinite; }
/* The chat panel owns the bottom-left and the action bar the bottom-centre. */
#sm-exits .ex-south { bottom: 96px; }
#sm-exits .ex-west  { left: 14px; top: 42%; }
`

const GLYPH: Record<Edge, string> = { north: '▲', south: '▼', west: '◀', east: '▶' }

interface Engine {
  mapLoadCompleted$?: { subscribe?: (fn: (done: boolean) => void) => void }
  sceneMap?: { data?: () => { id?: string } | undefined; id?: string }
}

export function mountExitHints(engine: Engine) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'sm-exits'
  const nodes: Record<Edge, HTMLElement> = {} as Record<Edge, HTMLElement>
  for (const edge of ['north', 'south', 'west', 'east'] as Edge[]) {
    const box = document.createElement('div')
    box.className = `ex ex-${edge}`
    box.innerHTML = `<span class="arrow">${GLYPH[edge]}</span><span class="dest"></span>`
    nodes[edge] = box
    root.appendChild(box)
  }
  document.body.appendChild(root)

  const currentMap = () => {
    const s = engine.sceneMap
    return (typeof s?.data === 'function' ? s.data()?.id : undefined) ?? s?.id ?? ''
  }

  function refresh() {
    // Map ids arrive as 'map-<id>' in some code paths; normalise.
    const id = String(currentMap()).replace(/^map-/, '')
    const exits = exitsByMap.get(id) ?? []
    for (const edge of ['north', 'south', 'west', 'east'] as Edge[]) {
      const hit = exits.find((e) => e.edge === edge)
      const box = nodes[edge]
      box.classList.toggle('on', !!hit)
      if (hit) {
        const label = NAME_BY_ID.get(hit.to) ?? hit.to
        ;(box.querySelector('.dest') as HTMLElement).textContent = label.toUpperCase()
      }
    }
  }

  engine.mapLoadCompleted$?.subscribe?.((done: boolean) => {
    if (done) setTimeout(refresh, 120)
  })
  setTimeout(refresh, 1500)
  // Cheap safety net: a transfer that does not emit mapLoadCompleted still
  // updates within a second, and comparing ids keeps this from doing work.
  let last = ''
  setInterval(() => {
    const id = String(currentMap())
    if (id === last) return
    last = id
    refresh()
  }, 1000)
}
