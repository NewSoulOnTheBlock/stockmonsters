import { SPECIES, SPECIES_BY_ID, STARTERS, SCARS, SCAR_BY_ID, MOVE_DESC, cssColor, typeColor, type Species } from '../data/creatures';
import { addUnique, emptySupplies, load, persist, uid, wipe, type Bonded, type Save, type Supplies } from '../game/save';
import type { RaidConfig, RaidResult } from '../game/types';

const SUPPLY_LABEL: Record<keyof Supplies, string> = { medkit: 'Med Kit', cell: 'Shield Cell', lure: 'Lure', key: 'Hatch Key' };
const RECIPES: { item: keyof Supplies; scrap: number }[] = [
  { item: 'medkit', scrap: 4 },
  { item: 'cell', scrap: 5 },
  { item: 'lure', scrap: 3 },
  { item: 'key', scrap: 12 },
];
const BRING_MAX = 3;

const typeChips = (s: Species) =>
  s.types.map((t) => `<span class="chip" style="--c:${cssColor(typeColor([t]))}">${t}</span>`).join('');

export class Burrow {
  private save: Save = load();
  private selected = new Set<string>();
  private bring: Supplies = emptySupplies();

  constructor(private root: HTMLElement, private onStart: (cfg: RaidConfig) => void) {
    root.addEventListener('click', (e) => this.onClick(e));
  }

  show() {
    this.root.classList.add('open');
    if (!this.save.partner) this.renderStart();
    else this.renderDen();
  }

  private hide() {
    this.root.classList.remove('open');
    this.root.innerHTML = '';
  }

  // ------------------------------------------------------------ screens

  private renderStart() {
    this.root.innerHTML = `
      <div class="screen start">
        <h1>HARROW</h1>
        <p class="lede">The machines came out of nowhere. The cities are rubble.
        The only things still fighting back are trainers, and the creatures
        who chose to stand with them.</p>
        <h2>Choose your partner</h2>
        <p class="sub">Your partner always comes home, no matter what happens topside.</p>
        <div class="starters">
          ${STARTERS.map(
            (s) => `<button class="starter" data-act="partner" data-id="${s.id}">
              <img src="assets/creatures/${s.id}.png" alt="" />
              <b style="color:${cssColor(typeColor(s.types))}">${s.name}</b>
              <div>${typeChips(s)}</div>
              <small>${s.moveName}: ${MOVE_DESC[s.move]}</small>
            </button>`,
          ).join('')}
        </div>
      </div>`;
  }

  private renderDen() {
    const s = this.save;
    const others = s.bonded.filter((b) => b.uid !== s.partner);
    for (const id of [...this.selected]) if (!others.some((b) => b.uid === id)) this.selected.delete(id);
    if (this.selected.size === 0) others.slice(0, 3).forEach((b) => this.selected.add(b.uid));
    for (const k of Object.keys(this.bring) as (keyof Supplies)[]) this.bring[k] = Math.min(this.bring[k], s.stash[k], BRING_MAX);
    if (s.raids === 0 && this.bring.medkit === 0) this.bring.medkit = Math.min(2, s.stash.medkit);

    const partner = s.bonded.find((b) => b.uid === s.partner)!;
    const card = (b: Bonded, opts: { partner?: boolean; pick?: boolean }) => {
      const sp = SPECIES_BY_ID[b.species];
      const scar = b.scar ? SCAR_BY_ID[b.scar] : undefined;
      const on = opts.partner || this.selected.has(b.uid);
      return `<div class="ccard${on ? ' on' : ''}${opts.partner ? ' partner' : ''}" ${opts.pick ? `data-act="pick" data-uid="${b.uid}"` : ''}>
        <img src="assets/creatures/${sp.id}.png" alt="" />
        <div>
          <b style="color:${cssColor(typeColor(sp.types))}">${sp.name}</b> ${opts.partner ? '<em>PARTNER</em>' : ''}
          <div>${typeChips(sp)}</div>
          <small>${sp.moveName}: ${MOVE_DESC[sp.move]}</small>
          ${scar ? `<small class="scar">Scar: ${scar.name} (${scar.desc})</small>` : ''}
        </div>
      </div>`;
    };
    const total = SPECIES.length;
    this.root.innerHTML = `
      <div class="screen den">
        <header>
          <h1>THE BURROW</h1>
          <div class="stats">Raids ${s.raids} · Extracted ${s.extracts} · Lost ${s.deaths}</div>
        </header>
        <div class="cols">
          <section>
            <h2>Den <small>partner + up to 3</small></h2>
            ${card(partner, { partner: true })}
            ${others.map((b) => card(b, { pick: true })).join('') || '<p class="empty">No other bonded creatures yet. Earn trust topside: protect wild creatures from the Harrow.</p>'}
            ${s.feral.length ? `<h3>Gone feral</h3><p class="sub">Lost when you fell. They are still out there in Bear Hollow, half-remembering you.</p>
              <div class="ferals">${s.feral.map((f) => `<span><img src="assets/creatures/${f.species}.png" alt="" />${SPECIES_BY_ID[f.species].name}</span>`).join('')}</div>` : ''}
          </section>
          <section>
            <h2>Supplies <small>bring up to ${BRING_MAX} each</small></h2>
            <p class="sub">Anything you bring is lost if you fall.</p>
            ${(Object.keys(SUPPLY_LABEL) as (keyof Supplies)[]).map((k) => `
              <div class="row">
                <span>${SUPPLY_LABEL[k]} <small>stash ${s.stash[k]}</small></span>
                <span class="step">
                  <button data-act="dec" data-k="${k}">−</button><b>${this.bring[k]}</b><button data-act="inc" data-k="${k}">+</button>
                </span>
              </div>`).join('')}
            <h2>Workshop <small>scrap ${s.stash.scrap}</small></h2>
            ${RECIPES.map((r) => `
              <div class="row">
                <span>${SUPPLY_LABEL[r.item]} <small>${r.scrap} scrap</small></span>
                <button data-act="craft" data-k="${r.item}" ${s.stash.scrap < r.scrap ? 'disabled' : ''}>Craft</button>
              </div>`).join('')}
          </section>
          <section>
            <h2>Log <small>${s.seen.length}/${total} seen · ${s.log.length} bonded</small></h2>
            <div class="log">
              ${SPECIES.map((sp) => {
                const seen = s.seen.includes(sp.id);
                const bonded = s.log.includes(sp.id);
                return `<div class="lg${seen ? '' : ' unseen'}${bonded ? ' bonded' : ''}" title="${seen ? sp.name : '???'}">
                  <img src="assets/creatures/${sp.id}.png" alt="" /><small>${seen ? sp.name : '???'}</small></div>`;
              }).join('')}
            </div>
            <h2>Topside</h2>
            <p class="sub"><b>Bear Hollow</b>: a dead forest, close quarters. Rare creatures nest in the north,
            where the Harrow are thickest. Lifts in the far corners; a sealed hatch in the middle.</p>
            <button class="go" data-act="go">Go topside</button>
            <button class="link" data-act="wipe">Wipe save</button>
          </section>
        </div>
      </div>`;
  }

  private renderResult(r: RaidResult, notes: string[]) {
    const title = { extracted: 'EXTRACTED', died: 'YOU FELL', swept: 'SWEPT' }[r.outcome];
    const sub = {
      extracted: 'You made it down. Bonds sealed, loot banked.',
      died: 'The Harrow took the field. Everything you carried is gone.',
      swept: 'Time ran out. The Harrow swept Bear Hollow with you still in it.',
    }[r.outcome];
    this.root.innerHTML = `
      <div class="screen result ${r.outcome}">
        <h1>${title}</h1>
        <p class="lede">${sub}</p>
        <ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
        <p class="sub">${Math.floor(r.seconds / 60)}m ${r.seconds % 60}s topside · ${r.kills} machines destroyed</p>
        <button class="go" data-act="den">Back to the Burrow</button>
      </div>`;
  }

  // ------------------------------------------------------------ actions

  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const s = this.save;
    const k = el.dataset.k as keyof Supplies;
    switch (el.dataset.act) {
      case 'partner': {
        const b = { uid: uid(), species: el.dataset.id! };
        s.bonded.push(b);
        s.partner = b.uid;
        addUnique(s.log, b.species);
        addUnique(s.seen, b.species);
        persist(s);
        this.renderDen();
        break;
      }
      case 'pick': {
        const id = el.dataset.uid!;
        if (this.selected.has(id)) this.selected.delete(id);
        else if (this.selected.size < 3) this.selected.add(id);
        this.renderDen();
        break;
      }
      case 'inc':
        if (this.bring[k] < Math.min(BRING_MAX, s.stash[k])) this.bring[k]++;
        this.renderDen();
        break;
      case 'dec':
        if (this.bring[k] > 0) this.bring[k]--;
        this.renderDen();
        break;
      case 'craft': {
        const r = RECIPES.find((r) => r.item === k)!;
        if (s.stash.scrap >= r.scrap) {
          s.stash.scrap -= r.scrap;
          s.stash[k]++;
          persist(s);
        }
        this.renderDen();
        break;
      }
      case 'go':
        this.start();
        break;
      case 'den':
        this.renderDen();
        break;
      case 'wipe':
        if (el.dataset.confirm) {
          wipe();
          this.save = load();
          this.selected.clear();
          this.bring = emptySupplies();
          this.renderStart();
        } else {
          el.dataset.confirm = '1';
          el.textContent = 'Click again to wipe everything';
        }
        break;
    }
  }

  private start() {
    const s = this.save;
    const partner = s.bonded.find((b) => b.uid === s.partner)!;
    const party = [partner, ...s.bonded.filter((b) => this.selected.has(b.uid))];
    for (const k of Object.keys(this.bring) as (keyof Supplies)[]) s.stash[k] -= this.bring[k];
    s.raids++;
    persist(s);
    const cfg: RaidConfig = { party, supplies: { ...this.bring }, feral: [...s.feral], seed: Date.now() % 1e9 };
    this.hide();
    this.onStart(cfg);
  }

  onRaidEnd(r: RaidResult) {
    const s = this.save;
    const notes: string[] = [];
    for (const id of r.seen) addUnique(s.seen, id);

    if (r.outcome === 'extracted') {
      s.extracts++;
      for (const rec of r.recruits) {
        const name = SPECIES_BY_ID[rec.species].name;
        const feral = rec.feralUid ? s.feral.find((f) => f.uid === rec.feralUid) : undefined;
        if (feral) {
          s.feral = s.feral.filter((f) => f !== feral);
          const scar = feral.scar ?? SCARS[Math.floor(Math.random() * SCARS.length)].id;
          s.bonded.push({ ...feral, scar });
          notes.push(`${name} came home. It carries a scar: ${SCAR_BY_ID[scar].name} (${SCAR_BY_ID[scar].desc}).`);
        } else {
          s.bonded.push({ uid: uid(), species: rec.species });
          notes.push(`Bond sealed with ${name}.`);
        }
        addUnique(s.log, rec.species);
      }
      const banked: string[] = [];
      for (const k of ['scrap', 'medkit', 'cell', 'lure', 'key'] as const) {
        const n = r.loot[k] + (k === 'scrap' ? 0 : r.leftover[k]);
        s.stash[k] += n;
        if (r.loot[k]) banked.push(`${r.loot[k]} ${k === 'scrap' ? 'scrap' : SUPPLY_LABEL[k]}`);
      }
      notes.push(banked.length ? `Banked ${banked.join(', ')}.` : 'Came back empty-handed.');
    } else {
      s.deaths++;
      const lost = this.lastParty().filter((b) => b.uid !== s.partner);
      for (const b of lost) {
        s.bonded = s.bonded.filter((x) => x.uid !== b.uid);
        s.feral.push(b);
        notes.push(`${SPECIES_BY_ID[b.species].name} went feral in Bear Hollow. Win it back.`);
      }
      if (r.recruits.length) notes.push(`${r.recruits.length} unsealed recruit${r.recruits.length > 1 ? 's' : ''} returned to the wild.`);
      const partner = s.bonded.find((b) => b.uid === s.partner)!;
      notes.push(`${SPECIES_BY_ID[partner.species].name} dragged you back to the Burrow.`);
    }
    persist(s);
    this.root.classList.add('open');
    this.renderResult(r, notes);
  }

  private lastParty(): Bonded[] {
    return this.save.bonded.filter((b) => this.selected.has(b.uid) || b.uid === this.save.partner);
  }
}
