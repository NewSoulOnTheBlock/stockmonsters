import { cssColor, typeColor, SPECIES_BY_ID } from '../data/creatures';
import type { Stash, Supplies } from '../game/save';

export interface HudParty {
  species: string;
  hp: number;
  maxHp: number;
  downed: boolean;
  moveCd: number;
  moveMax: number;
  recruit: boolean;
  scar?: string;
}

export interface HudState {
  hp: number;
  shield: number;
  stamina: number;
  timeLeft: number;
  alarm: number;
  party: HudParty[];
  supplies: Supplies;
  loot: Stash;
  prompt: string;
  progress: number;
  /** Boss health while one is close enough to matter. */
  boss: { name: string; frac: number } | null;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  private root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private partyKey = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-vitals">
        <div class="bar hp"><i data-el="hp"></i><span>HEALTH</span></div>
        <div class="bar shield"><i data-el="shield"></i><span>SHIELD</span></div>
        <div class="bar stam"><i data-el="stam"></i></div>
      </div>
      <div class="hud-top">
        <div class="timer" data-el="timer">12:00</div>
        <div class="alarm"><span>ALARM</span><div class="alarm-track"><i data-el="alarm"></i></div></div>
        <div class="boss" data-el="boss"><span data-el="bossName"></span><div class="boss-track"><i data-el="bossHp"></i></div></div>
      </div>
      <div class="hud-kit" data-el="kit"></div>
      <div class="hud-party" data-el="party"></div>
      <div class="hud-prompt" data-el="prompt"></div>
      <div class="hud-toasts" data-el="toasts"></div>
      <div class="hud-help">WASD move · Shift sprint · Space roll · Click machine: focus · F/right-click: regroup · 1-4 moves · E interact · Q med · R shield · G lure</div>
    `;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((el) => (this.els[el.dataset.el!] = el));
  }

  update(s: HudState) {
    this.els.hp.style.width = `${Math.max(0, s.hp)}%`;
    this.els.shield.style.width = `${s.shield}%`;
    this.els.stam.style.width = `${s.stamina}%`;
    this.els.timer.textContent = fmt(Math.max(0, s.timeLeft));
    this.els.timer.classList.toggle('late', s.timeLeft < 120);
    this.els.alarm.style.width = `${s.alarm}%`;
    this.els.alarm.parentElement!.parentElement!.classList.toggle('hot', s.alarm > 60);

    const k = s.supplies;
    this.els.kit.innerHTML = `
      <div><b>Q</b> Med Kit <em>${k.medkit}</em></div>
      <div><b>R</b> Shield Cell <em>${k.cell}</em></div>
      <div><b>G</b> Lure <em>${k.lure}</em></div>
      <div><b>·</b> Hatch Key <em>${k.key}</em></div>
      <div class="loot">Found: ${s.loot.scrap} scrap${s.loot.medkit ? `, ${s.loot.medkit} med` : ''}${s.loot.cell ? `, ${s.loot.cell} cell` : ''}${s.loot.lure ? `, ${s.loot.lure} lure` : ''}${s.loot.key ? `, ${s.loot.key} key` : ''}</div>`;

    const key = s.party.map((p) => p.species + p.recruit + p.scar).join('|');
    if (key !== this.partyKey) {
      this.partyKey = key;
      this.els.party.innerHTML = s.party
        .map((p, i) => {
          const sp = SPECIES_BY_ID[p.species];
          return `<div class="pcard${p.recruit ? ' recruit' : ''}" data-i="${i}">
            <div class="pkey">${i + 1}</div>
            <img src="assets/creatures/${sp.id}.png" alt="" />
            <div class="pinfo">
              <div class="pname" style="color:${cssColor(typeColor(sp.types))}">${sp.name}${p.recruit ? ' <small>UNSEALED</small>' : ''}</div>
              <div class="php"><i></i></div>
              <div class="pmove">${sp.moveName}<i></i></div>
            </div>
          </div>`;
        })
        .join('');
    }
    s.party.forEach((p, i) => {
      const card = this.els.party.children[i] as HTMLElement | undefined;
      if (!card) return;
      card.classList.toggle('downed', p.downed);
      (card.querySelector('.php i') as HTMLElement).style.width = `${(100 * Math.max(0, p.hp)) / p.maxHp}%`;
      const mv = card.querySelector('.pmove') as HTMLElement;
      (mv.querySelector('i') as HTMLElement).style.width = `${(100 * p.moveCd) / p.moveMax}%`;
      mv.classList.toggle('ready', p.moveCd <= 0 && !p.downed);
    });

    this.els.boss.classList.toggle('show', !!s.boss);
    if (s.boss) {
      this.els.bossName.textContent = s.boss.name;
      this.els.bossHp.style.width = `${Math.max(0, s.boss.frac) * 100}%`;
    }

    this.els.prompt.textContent = s.prompt;
    this.els.prompt.style.setProperty('--p', `${Math.round(s.progress * 100)}%`);
    this.els.prompt.classList.toggle('show', !!s.prompt);
  }

  toast(msg: string, tone: 'info' | 'good' | 'bad' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${tone}`;
    t.textContent = msg;
    this.els.toasts.prepend(t);
    while (this.els.toasts.children.length > 5) this.els.toasts.lastChild!.remove();
    setTimeout(() => t.classList.add('fade'), 3600);
    setTimeout(() => t.remove(), 4400);
  }

  destroy() {
    this.root.remove();
  }
}
