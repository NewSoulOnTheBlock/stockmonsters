import Phaser from 'phaser';
import {
  SPECIES, SPECIES_BY_ID, SCAR_BY_ID, MOVE_COOLDOWN, isMelee, typeMult, harrowDamageTaken, typeColor,
  type HarrowKind, type Scar, type Species,
} from '../data/creatures';
import type { RaidConfig, RaidResult } from '../game/types';
import type { Stash, Supplies } from '../game/save';
import { Hud } from '../ui/hud';

const WORLD = 3000;
const RAID_SECONDS = 12 * 60;
const PARTY_MAX = 4;
const LIGHT_RADIUS = 270;
const RAIDER_SCALE = 0.64;

type V = { x: number; y: number };
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);

interface Creature {
  spec: Species;
  scar?: Scar;
  faction: 'party' | 'wild';
  /** Joined during this raid; the bond seals on extraction. */
  recruit: boolean;
  /** Set on a wild creature that used to be ours. */
  feralUid?: string;
  sprite: Phaser.Physics.Arcade.Sprite;
  shadow: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  downed: boolean;
  gone: boolean;
  atkCd: number;
  moveCd: number;
  target: Machine | null;
  trust: number;
  lastCredit: number;
  home: V;
  wanderTo: V;
  wanderT: number;
  bulwarkUntil: number;
  announced: boolean;
  /** Wild creatures are worn down from fighting alone. */
  dmgMul: number;
  reinforceT: number;
}

interface Machine {
  kind: HarrowKind;
  sprite: Phaser.Physics.Arcade.Sprite;
  eye: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  dead: boolean;
  target: Target | null;
  retargetT: number;
  atkCd: number;
  slamT: number;
  slamCd: number;
  sight: number;
  broadcastCd: number;
  orbit: number;
  hunting: boolean;
  patrolTo: V;
  patrolT: number;
  frozenUntil: number;
  slowUntil: number;
  dotUntil: number;
  dotDps: number;
  hijackedUntil: number;
  taunter: Creature | null;
  tauntUntil: number;
  /** Shardcrawler: spit cooldown, lunge timer, and an animation lock. */
  spitCd: number;
  lungeT: number;
  lungeHit: boolean;
  lockUntil: number;
  hurtCd: number;
  /** Titan: weapon charge timer and its locked aim point, footstep timer, patrol waypoint. */
  chargeT: number;
  aim: V;
  stepT: number;
  waypoint: number;
}

/** A Harrow projectile (Shardcrawler spit). */
interface Glob {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  /** Fired by a hijacked crawler: hits machines instead. */
  allied: boolean;
  size: number;
}

type Target = { t: 'trainer' } | { t: 'creature'; c: Creature } | { t: 'machine'; m: Machine };

interface Shot {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  src: Creature;
  pierce: boolean;
  hit: Set<Machine>;
}

interface Cache {
  img: Phaser.GameObjects.Image;
  searched: boolean;
}

interface Lift {
  x: number;
  y: number;
  img: Phaser.GameObjects.Image;
  beacon: Phaser.GameObjects.Image;
  state: 'idle' | 'calling' | 'here';
  timer: number;
  ring: Phaser.GameObjects.Graphics;
}

interface Pickup {
  img: Phaser.GameObjects.Image;
  scrap: number;
  key?: number;
}

export class Raid extends Phaser.Scene {
  private cfg!: RaidConfig;
  private rng!: Phaser.Math.RandomDataGenerator;
  private hud!: Hud;
  private t = 0;
  private ended = false;

  private trainer!: Phaser.Physics.Arcade.Sprite;
  private trainerShadow!: Phaser.GameObjects.Image;
  private hp = 100;
  private shield = 0;
  private stamina = 100;
  private staminaRest = 0;
  private facing = new Phaser.Math.Vector2(0, -1);
  private rollT = 0;
  private rollDir = new Phaser.Math.Vector2();
  private hurtFlash = 0;
  private itemCd = 0;

  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private treePts: V[] = [];
  private wallRects: Phaser.Geom.Rectangle[] = [];
  private party: Creature[] = [];
  private wild: Creature[] = [];
  private machines: Machine[] = [];
  private shots: Shot[] = [];
  private globs: Glob[] = [];
  private caches: Cache[] = [];
  private lifts: Lift[] = [];
  private hatch!: { x: number; y: number; img: Phaser.GameObjects.Image; beacon: Phaser.GameObjects.Image };
  private pickups: Pickup[] = [];
  private lure: { img: Phaser.GameObjects.Image; until: number } | null = null;

  private focus: Machine | null = null;
  private focusRing!: Phaser.GameObjects.Graphics;
  private regroupUntil = 0;
  private alarm = 0;
  private lastNoise = 0;
  private directorT = 0;
  private crusherCd = 60;
  private titan: Machine | null = null;
  private titanSpawned = false;
  private titanAt = 0;
  private kills = 0;
  private warned = false;

  private supplies!: Supplies;
  private loot: Stash = { scrap: 0, medkit: 0, cell: 0, lure: 0, key: 0 };
  private seen = new Set<string>();
  private searching: Cache | null = null;
  private searchT = 0;
  private prompt = '';
  private hudT = 0;

  private dark!: Phaser.GameObjects.RenderTexture;
  private lightImg!: Phaser.GameObjects.Image;
  private glowImg!: Phaser.GameObjects.Image;
  private fx!: Phaser.GameObjects.Graphics;
  private edge!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() {
    super('Raid');
  }

  init(cfg: RaidConfig) {
    this.cfg = cfg;
    // Scenes are reused between raids: reset every piece of per-raid state.
    Object.assign(this, {
      t: 0, ended: false, hp: 100, shield: 0, stamina: 100, staminaRest: 0, rollT: 0, hurtFlash: 0, itemCd: 0,
      treePts: [], wallRects: [], party: [], wild: [], machines: [], shots: [], globs: [], caches: [], lifts: [], pickups: [],
      lure: null, focus: null, regroupUntil: 0, alarm: 0, lastNoise: 0, directorT: 0, crusherCd: 60, kills: 0, titan: null, titanSpawned: false,
      warned: false, loot: { scrap: 0, medkit: 0, cell: 0, lure: 0, key: 0 }, seen: new Set<string>(),
      searching: null, searchT: 0, prompt: '', hudT: 0,
    });
    this.supplies = { ...cfg.supplies };
    this.facing = new Phaser.Math.Vector2(0, -1);
  }

  create() {
    this.rng = new Phaser.Math.RandomDataGenerator([String(this.cfg.seed)]);
    this.titanAt = this.rng.between(180, 360);
    this.physics.world.setBounds(0, 0, WORLD, WORLD);
    this.add.tileSprite(0, 0, WORLD, WORLD, 'ground').setOrigin(0).setDepth(-10);
    this.obstacles = this.physics.add.staticGroup();
    // telegraphs (slam rings, laser sights) draw above the darkness: warnings are always fair
    this.fx = this.add.graphics().setDepth(54);
    this.focusRing = this.add.graphics().setDepth(41);

    const spawn = { x: WORLD / 2, y: WORLD - 220 };
    this.buildExtracts();
    this.buildMap(spawn);

    this.trainerShadow = this.add.image(spawn.x, spawn.y, 'shadow').setScale(0.55, 0.45).setDepth(1);
    this.trainer = this.physics.add.sprite(spawn.x, spawn.y, 'raider').setScale(RAIDER_SCALE).setDepth(10);
    // Collide at the feet, not the whole figure, so the raider can slip between trees.
    this.trainer.setCircle(14, 38 - 14, 106 - 34).setCollideWorldBounds(true);
    this.trainer.play('r_idle');
    this.physics.add.collider(this.trainer, this.obstacles);

    this.cfg.party.forEach((b, i) => {
      const c = this.makeCreature(SPECIES_BY_ID[b.species], 'party', spawn.x + (i - 1.5) * 50, spawn.y + 50, b.scar);
      this.party.push(c);
      this.seen.add(b.species);
    });

    this.populate(spawn);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD, WORLD);
    cam.startFollow(this.trainer, true, 0.12, 0.12);
    cam.fadeIn(600, 0, 0, 0);

    this.dark = this.add.renderTexture(0, 0, this.scale.width, this.scale.height).setOrigin(0).setScrollFactor(0).setDepth(50);
    this.lightImg = this.make.image({ key: 'light', add: false });
    this.glowImg = this.make.image({ key: 'glow', add: false });
    this.edge = this.add.graphics().setScrollFactor(0).setDepth(80);
    this.scale.on('resize', this.onResize, this);

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SHIFT,SPACE,E,F,Q,R,G,ONE,TWO,THREE,FOUR') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointer(p));

    this.hud = new Hud(document.getElementById('ui')!);
    this.hud.toast('Bear Hollow. Find the lifts. Win them over. Get out.', 'info');
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResize, this);
      this.hud.destroy();
    });
  }

  private onResize(size: Phaser.Structs.Size) {
    this.dark?.resize(size.width, size.height);
  }

  // ------------------------------------------------------------------ map

  private buildExtracts() {
    for (const [x, y] of [[380, 420], [WORLD - 380, 520]]) {
      const img = this.add.image(x, y, 'lift').setDepth(0);
      const beacon = this.add.image(x, y, 'glow').setScale(1.4).setTint(0xffb347).setBlendMode(Phaser.BlendModes.ADD).setDepth(55).setAlpha(0.5);
      this.tweens.add({ targets: beacon, alpha: 0.15, duration: 1400, yoyo: true, repeat: -1 });
      this.lifts.push({ x, y, img, beacon, state: 'idle', timer: 0, ring: this.add.graphics().setDepth(2) });
    }
    const hx = WORLD / 2;
    const hy = 1300;
    const himg = this.add.image(hx, hy, 'hatch').setDepth(0);
    const hb = this.add.image(hx, hy, 'glow').setScale(0.9).setTint(0x4fd1c5).setBlendMode(Phaser.BlendModes.ADD).setDepth(55).setAlpha(0.35);
    this.hatch = { x: hx, y: hy, img: himg, beacon: hb };
  }

  private reserved(x: number, y: number, spawn: V) {
    if (dist({ x, y }, spawn) < 260) return true;
    if (this.lifts.some((l) => dist(l, { x, y }) < 170)) return true;
    return dist(this.hatch, { x, y }) < 130;
  }

  private blocked(x: number, y: number, r: number) {
    if (x < 40 || y < 40 || x > WORLD - 40 || y > WORLD - 40) return true;
    if (this.treePts.some((p) => dist(p, { x, y }) < r + 16)) return true;
    return this.wallRects.some((w) => Phaser.Geom.Rectangle.Contains(Phaser.Geom.Rectangle.Inflate(Phaser.Geom.Rectangle.Clone(w), r, r), x, y));
  }

  private freeSpot(r: number, spawn: V, area?: Phaser.Geom.Rectangle): V {
    for (let i = 0; i < 200; i++) {
      const x = area ? this.rng.between(area.left, area.right) : this.rng.between(80, WORLD - 80);
      const y = area ? this.rng.between(area.top, area.bottom) : this.rng.between(80, WORLD - 80);
      if (!this.blocked(x, y, r) && !this.reserved(x, y, spawn)) return { x, y };
    }
    return { x: WORLD / 2, y: WORLD / 2 };
  }

  private buildMap(spawn: V) {
    // Ruins: broken wall runs with gaps, the only hard cover in the forest.
    const ruinCenters: V[] = [];
    for (let i = 0; i < 9; i++) {
      const c = { x: this.rng.between(300, WORLD - 300), y: this.rng.between(300, WORLD - 400) };
      if (this.reserved(c.x, c.y, spawn) || ruinCenters.some((r) => dist(r, c) < 420)) continue;
      ruinCenters.push(c);
      const w = this.rng.between(5, 9) * 32;
      const h = this.rng.between(4, 7) * 32;
      const sides: [number, number, number, number][] = [
        [c.x - w / 2, c.y - h / 2, w, 32],
        [c.x - w / 2, c.y + h / 2, w, 32],
        [c.x - w / 2, c.y - h / 2, 32, h],
        [c.x + w / 2, c.y - h / 2, 32, h + 32],
      ];
      for (const [x, y, sw, sh] of sides) {
        if (this.rng.frac() < 0.25) continue; // whole side collapsed
        // knock a doorway-sized gap out of each surviving side
        const horiz = sw > sh;
        const len = horiz ? sw : sh;
        const gapAt = this.rng.between(1, Math.max(1, Math.floor(len / 32) - 3)) * 32;
        const gap = 64;
        const pieces: [number, number][] = [[0, gapAt], [gapAt + gap, len - gapAt - gap]];
        for (const [o, l] of pieces) {
          if (l < 32) continue;
          const rx = horiz ? x + o : x;
          const ry = horiz ? y : y + o;
          const rw = horiz ? l : 32;
          const rh = horiz ? 32 : l;
          const ts = this.add.tileSprite(rx, ry, rw, rh, 'wall').setOrigin(0).setDepth(3);
          this.physics.add.existing(ts, true);
          this.obstacles.add(ts);
          this.wallRects.push(new Phaser.Geom.Rectangle(rx, ry, rw, rh));
        }
      }
    }

    // Dead trees: dense, but never closer than a creature can squeeze through.
    for (let i = 0; i < 1400 && this.treePts.length < 380; i++) {
      const x = this.rng.between(40, WORLD - 40);
      const y = this.rng.between(40, WORLD - 40);
      if (this.reserved(x, y, spawn) || this.blocked(x, y, 50)) continue;
      this.treePts.push({ x, y });
      const tree = this.obstacles.create(x, y, 'tree') as Phaser.Physics.Arcade.Sprite;
      tree.setDepth(20 + y / WORLD).setAngle(this.rng.between(0, 359)).setScale(this.rng.realInRange(0.9, 1.35));
      tree.setCircle(11, 21, 21).refreshBody();
      tree.setAlpha(0.92);
    }
    for (let i = 0; i < 70; i++) {
      const p = this.freeSpot(26, spawn);
      const rock = this.obstacles.create(p.x, p.y, 'rock') as Phaser.Physics.Arcade.Sprite;
      rock.setDepth(4).setFlipX(this.rng.frac() < 0.5);
      rock.setCircle(16, 8, 4).refreshBody();
      this.treePts.push(p);
    }

    // Caches cluster in ruins, with a scatter in the open.
    for (let i = 0; i < 28; i++) {
      let p: V;
      if (i < 16 && ruinCenters.length) {
        const r = ruinCenters[i % ruinCenters.length];
        p = this.freeSpot(22, spawn, new Phaser.Geom.Rectangle(r.x - 110, r.y - 90, 220, 180));
      } else p = this.freeSpot(22, spawn);
      this.caches.push({ img: this.add.image(p.x, p.y, 'cache').setDepth(5), searched: false });
    }
  }

  private populate(spawn: V) {
    const pool = SPECIES.filter((s) => s.rarity !== 'starter');
    const pick = (r: Species['rarity']) => this.rng.pick(pool.filter((s) => s.rarity === r));
    const plan: [Species, Phaser.Geom.Rectangle | undefined, string?][] = [];
    for (let i = 0; i < 5; i++) plan.push([pick('common'), undefined]);
    for (let i = 0; i < 3; i++) plan.push([pick('uncommon'), new Phaser.Geom.Rectangle(100, 100, WORLD - 200, 1800)]);
    for (let i = 0; i < 2; i++) plan.push([pick('rare'), new Phaser.Geom.Rectangle(100, 100, WORLD - 200, 900)]);
    for (const f of this.cfg.feral) plan.push([SPECIES_BY_ID[f.species], undefined, f.uid]);

    for (const [spec, area, feralUid] of plan) {
      let p = this.freeSpot(30, spawn, area);
      const tooClose = (q: V) => dist(q, spawn) < 600 || this.lifts.some((l) => dist(l, q) < 450);
      for (let k = 0; k < 30 && tooClose(p); k++) p = this.freeSpot(30, spawn, area);
      const feral = feralUid ? this.cfg.feral.find((f) => f.uid === feralUid) : undefined;
      const c = this.makeCreature(spec, 'wild', p.x, p.y, feral?.scar);
      c.feralUid = feralUid;
      if (feralUid) {
        c.trust = 50;
        c.sprite.setTint(0xffd27a);
      }
      this.wild.push(c);
      // Every wild creature is found mid-fight.
      const heavy = spec.rarity === 'rare';
      const n = heavy ? 4 : this.rng.between(2, 3);
      for (let i = 0; i < n; i++) {
        const a = this.rng.realInRange(0, Math.PI * 2);
        this.spawnMachine('mite', p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120, false);
      }
      if (heavy) this.spawnMachine('crusher', p.x + 160, p.y - 60, false);
    }
    for (let i = 0; i < 4; i++) {
      const p = this.freeSpot(20, spawn, new Phaser.Geom.Rectangle(100, 100, WORLD - 200, WORLD - 800));
      this.spawnMachine('watcher', p.x, p.y, false);
    }
    for (let i = 0; i < 4; i++) {
      const p = this.freeSpot(20, spawn, new Phaser.Geom.Rectangle(100, 100, WORLD - 200, WORLD - 900));
      for (let k = 0; k < 3; k++) this.spawnMachine('mite', p.x + k * 20, p.y, false);
    }
    // Shardcrawler packs roam the middle of the map, near the ruins.
    for (let i = 0; i < 4; i++) {
      const p = this.freeSpot(30, spawn, new Phaser.Geom.Rectangle(150, 500, WORLD - 300, WORLD - 1300));
      const n = this.rng.between(2, 3);
      for (let k = 0; k < n; k++) this.spawnMachine('crawler', p.x + k * 34, p.y + (k % 2) * 30, false);
    }
    const p = this.freeSpot(40, spawn, new Phaser.Geom.Rectangle(300, 300, WORLD - 600, 1200));
    this.spawnMachine('crusher', p.x, p.y, false);
  }

  // ------------------------------------------------------------------ factories

  private makeCreature(spec: Species, faction: 'party' | 'wild', x: number, y: number, scarId?: string): Creature {
    const scar = scarId ? SCAR_BY_ID[scarId] : undefined;
    const big = spec.rarity === 'rare';
    const shadow = this.add.image(x, y, 'shadow').setScale(big ? 1.1 : 0.85).setDepth(1);
    const sprite = this.physics.add.sprite(x, y, `c_${spec.id}`).setScale(big ? 0.68 : 0.56).setDepth(11);
    sprite.setCircle(20, 28, 46).setCollideWorldBounds(true);
    this.physics.add.collider(sprite, this.obstacles);
    const hp = Math.round(spec.hp * (scar?.hp ?? 1));
    const c: Creature = {
      spec, scar, faction, recruit: false, sprite, shadow, bar: this.add.graphics().setDepth(45),
      hp, maxHp: hp, atk: spec.atk * (scar?.atk ?? 1), speed: spec.speed * (scar?.speed ?? 1),
      downed: false, gone: false, atkCd: 0, moveCd: 0, target: null, trust: 0, lastCredit: -99,
      home: { x, y }, wanderTo: { x, y }, wanderT: 0, bulwarkUntil: 0, announced: false,
      dmgMul: faction === 'wild' ? 0.4 : 1, reinforceT: 3,
    };
    if (faction === 'wild') c.hp = Math.round(hp * 0.7);
    return c;
  }

  private spawnMachine(kind: HarrowKind, x: number, y: number, hunting: boolean, force = false): Machine | null {
    if (!force && this.machines.filter((m) => !m.dead).length >= 70) return null;
    x = Phaser.Math.Clamp(x, 40, WORLD - 40);
    y = Phaser.Math.Clamp(y, 40, WORLD - 40);
    const stats = {
      mite: { hp: 22, speed: 150, radius: 9, eye: 0.3 },
      watcher: { hp: 55, speed: 120, radius: 15, eye: 0.55 },
      crusher: { hp: 420, speed: 62, radius: 30, eye: 0.8 },
      crawler: { hp: 70, speed: 140, radius: 16, eye: 0.3 },
      titan: { hp: 2600, speed: 52, radius: 60, eye: 1.3 },
    }[kind];
    const crawler = kind === 'crawler';
    const sprite = this.physics.add.sprite(x, y, crawler ? 'shardcrawler' : kind).setDepth(kind === 'watcher' ? 30 : 9);
    if (kind === 'titan') {
      // 170x118 frames at 2x; it steps over trees and walls, so no obstacle collider
      sprite.setScale(2).setCircle(30, 85 - 30, 100 - 30).play('ti_idle');
    } else if (crawler) {
      // 130x88 frames drawn facing right; collide at the body, not the legs' full span
      sprite.setScale(0.5).setCircle(28, 65 - 28, 54 - 28);
      sprite.play({ key: 'sc_idle', startFrame: this.rng.between(0, 5) });
    } else if (kind === 'crusher') sprite.setCircle(28, 8, 8);
    else if (kind === 'mite') sprite.setCircle(8, 4, 4);
    else sprite.setCircle(14, 6, 6);
    sprite.setCollideWorldBounds(true);
    if (kind !== 'watcher' && kind !== 'titan') this.physics.add.collider(sprite, this.obstacles);
    const eye = this.add.image(x, y, 'glow').setTint(0xff2a1a).setScale(stats.eye).setBlendMode(Phaser.BlendModes.ADD).setDepth(55);
    const m: Machine = {
      kind, sprite, eye, bar: this.add.graphics().setDepth(45), hp: stats.hp, maxHp: stats.hp, speed: stats.speed,
      radius: stats.radius, dead: false, target: null, retargetT: 0, atkCd: 0, slamT: -1, slamCd: 0, sight: 0,
      broadcastCd: 0, orbit: this.rng.realInRange(0, Math.PI * 2), hunting, patrolTo: { x, y }, patrolT: 0,
      frozenUntil: 0, slowUntil: 0, dotUntil: 0, dotDps: 0, hijackedUntil: 0, taunter: null, tauntUntil: 0,
      spitCd: this.rng.realInRange(0.5, 2), lungeT: 0, lungeHit: false, lockUntil: 0, hurtCd: 0,
      chargeT: -1, aim: { x, y }, stepT: 0, waypoint: this.rng.between(0, 3),
    };
    this.machines.push(m);
    return m;
  }

  // ------------------------------------------------------------------ input

  private onPointer(p: Phaser.Input.Pointer) {
    if (this.ended) return;
    const w = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    if (p.rightButtonDown()) return this.regroup();
    const m = this.hostile().find((m) => dist(m.sprite, w) < m.radius + 18);
    if (m) {
      this.focus = m;
      for (const c of this.party) c.target = m;
    }
  }

  private regroup() {
    this.focus = null;
    this.regroupUntil = this.t + 3;
    for (const c of this.party) c.target = null;
  }

  // ------------------------------------------------------------------ loop

  update(_: number, deltaMs: number) {
    if (this.ended) return;
    const dt = Math.min(deltaMs, 50) / 1000;
    this.t += dt;
    this.prompt = '';

    this.updateTrainer(dt);
    this.party.forEach((c, i) => this.updateParty(c, i, dt));
    for (const c of this.wild) this.updateWild(c, dt);
    for (const m of this.machines) this.updateMachine(m, dt);
    this.updateShots(dt);
    this.updateGlobs(dt);
    this.updateInteract(dt);
    this.updateLifts(dt);
    this.updateDirector(dt);
    this.machines = this.machines.filter((m) => !m.dead);
    this.wild = this.wild.filter((c) => !c.gone);
    this.drawWorldOverlay();
    this.drawDarkness();

    const left = RAID_SECONDS - this.t;
    if (!this.warned && left < 120) {
      this.warned = true;
      this.hud.toast('Two minutes. The Harrow sweep is coming.', 'bad');
    }
    if (left <= 0) return this.endRaid('swept');
    if (this.hp <= 0) return this.endRaid('died');

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.pushHud();
    }
  }

  private updateTrainer(dt: number) {
    const k = this.keys;
    const dir = new Phaser.Math.Vector2((k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0), (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0));
    if (dir.lengthSq() > 0) this.facing.copy(dir.normalize());
    this.itemCd -= dt;

    if (this.rollT > 0) {
      this.rollT -= dt;
      this.trainer.setVelocity(this.rollDir.x * 470, this.rollDir.y * 470);
    } else {
      const sprinting = k.SHIFT.isDown && dir.lengthSq() > 0 && this.stamina > 2;
      const speed = sprinting ? 235 : 150;
      this.trainer.setVelocity(dir.x * speed, dir.y * speed);
      if (sprinting) {
        this.stamina -= 24 * dt;
        this.staminaRest = 0.7;
      }
      if (Phaser.Input.Keyboard.JustDown(k.SPACE) && this.stamina >= 28) {
        this.stamina -= 28;
        this.staminaRest = 0.7;
        this.rollT = 0.32;
        this.rollDir.copy(dir.lengthSq() > 0 ? dir : this.facing);
      }
    }
    this.staminaRest -= dt;
    if (this.staminaRest <= 0) this.stamina = Math.min(100, this.stamina + 20 * dt);
    if (dir.x !== 0) this.trainer.setFlipX(dir.x < 0);
    this.animateTrainer(dir);
    this.trainerShadow.setPosition(this.trainer.x, this.trainer.y + 31);
    this.trainer.setDepth(11 + this.trainer.y / WORLD);
    if (this.hurtFlash > 0) {
      this.hurtFlash -= dt;
      this.trainer.setTint(0xff6b6b);
    } else this.trainer.clearTint();

    if (Phaser.Input.Keyboard.JustDown(k.F)) this.regroup();
    const moveKeys = [k.ONE, k.TWO, k.THREE, k.FOUR];
    moveKeys.forEach((key, i) => Phaser.Input.Keyboard.JustDown(key) && this.useMove(i));
    if (Phaser.Input.Keyboard.JustDown(k.Q)) this.useMedkit();
    if (Phaser.Input.Keyboard.JustDown(k.R)) this.useCell();
    if (Phaser.Input.Keyboard.JustDown(k.G)) this.throwLure();

    for (const p of this.pickups) {
      if (dist(p.img, this.trainer) < 40) {
        this.loot.scrap += p.scrap;
        this.loot.key += p.key ?? 0;
        if (p.key) this.hud.toast(`Titan core: ${p.scrap} scrap and a Hatch Key.`, 'good');
        p.img.destroy();
        p.scrap = 0;
      }
    }
    this.pickups = this.pickups.filter((p) => p.scrap > 0);
  }

  private animateTrainer(dir: Phaser.Math.Vector2) {
    const moving = dir.lengthSq() > 0;
    const sprinting = moving && this.keys.SHIFT.isDown && this.stamina > 2;
    const anim =
      this.rollT > 0 ? 'r_jump'
      : this.searching ? 'r_crouch'
      : sprinting ? 'r_run'
      : moving ? 'r_walk'
      : this.hurtFlash > 0 ? 'r_hurt'
      : 'r_idle';
    const cur = this.trainer.anims.currentAnim?.key;
    // let a one-shot hurt finish instead of snapping back to idle
    if (cur === 'r_hurt' && this.trainer.anims.isPlaying && anim === 'r_idle') return;
    if (cur !== anim) this.trainer.play(anim);
  }

  // ------------------------------------------------------------------ creatures

  private hostile() {
    return this.machines.filter((m) => !m.dead && m.hijackedUntil <= this.t);
  }

  private nearestMachine(from: V, r: number, list = this.hostile()) {
    let best: Machine | null = null;
    let bd = r;
    for (const m of list) {
      const d = dist(m.sprite, from);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  private moveTo(s: Phaser.Physics.Arcade.Sprite, to: V, speed: number) {
    const dx = to.x - s.x;
    const dy = to.y - s.y;
    const d = Math.hypot(dx, dy) || 1;
    s.setVelocity((dx / d) * speed, (dy / d) * speed);
    // creature fronts face left; the sheet-based sprites face right
    const facesRight = s.texture.key === 'shardcrawler';
    if (Math.abs(dx) > 4) s.setFlipX(facesRight ? dx < 0 : dx > 0);
  }

  private animateCreature(c: Creature) {
    const s = c.sprite;
    const moving = (s.body as Phaser.Physics.Arcade.Body).velocity.lengthSq() > 100;
    const base = c.spec.rarity === 'rare' ? 0.68 : 0.56;
    const bob = moving ? Math.sin(this.t * 14 + c.home.x) * 0.035 : Math.sin(this.t * 3 + c.home.y) * 0.012;
    s.setScale(base * (1 - bob * 0.5), base * (1 + bob));
    c.shadow.setPosition(s.x, s.y + 24);
    s.setDepth(11 + s.y / WORLD);
    if (c.downed) s.setAlpha(0.35).setTint(0x777777);
  }

  private updateParty(c: Creature, i: number, dt: number) {
    c.atkCd -= dt;
    c.moveCd = Math.max(0, c.moveCd - dt);
    this.animateCreature(c);
    if (c.downed) {
      c.sprite.setVelocity(0, 0);
      return;
    }
    let tgt: Machine | null = null;
    if (this.focus && !this.focus.dead && this.focus.hijackedUntil <= this.t) tgt = this.focus;
    else if (this.t > this.regroupUntil) {
      if (c.target && !c.target.dead && c.target.hijackedUntil <= this.t && dist(c.target.sprite, this.trainer) < 460) tgt = c.target;
      else tgt = this.nearestMachine(this.trainer, 300) ?? this.nearestMachine(c.sprite, 200);
    }
    c.target = tgt;
    if (tgt && dist(c.sprite, this.trainer) < 650) this.engage(c, tgt);
    else this.follow(c, i);
  }

  private follow(c: Creature, slot: number) {
    const back = this.facing.clone().negate();
    const off = back.rotate((slot - (this.party.length - 1) / 2) * 0.7).scale(62);
    const to = { x: this.trainer.x + off.x, y: this.trainer.y + off.y };
    const d = dist(c.sprite, to);
    if (d > 900) {
      c.sprite.setPosition(to.x, to.y);
      return;
    }
    if (d > 18) this.moveTo(c.sprite, to, c.speed * (d > 200 ? 1.5 : 1.1));
    else c.sprite.setVelocity(0, 0);
  }

  private engage(c: Creature, m: Machine) {
    const d = dist(c.sprite, m.sprite);
    const reach = isMelee(c.spec) ? 30 + m.radius : c.spec.range;
    if (m.kind === 'watcher' && isMelee(c.spec) && d < 120) {
      // fliers hover out of easy reach; melee creatures leap at them
      this.moveTo(c.sprite, m.sprite, c.speed * 1.2);
    } else if (d > reach) {
      this.moveTo(c.sprite, m.sprite, c.speed);
      return;
    } else c.sprite.setVelocity(0, 0);
    if (c.atkCd > 0 || d > reach + 10) return;
    c.atkCd = 1 / c.spec.rate;
    if (isMelee(c.spec)) {
      this.tweens.add({ targets: c.sprite, x: c.sprite.x + (m.sprite.x - c.sprite.x) * 0.3, y: c.sprite.y + (m.sprite.y - c.sprite.y) * 0.3, duration: 70, yoyo: true });
      this.hitMachine(m, c.atk * c.dmgMul, c);
    } else this.fire(c, m, c.atk * c.dmgMul, false);
  }

  private fire(c: Creature, m: Machine, dmg: number, pierce: boolean) {
    const a = Math.atan2(m.sprite.y - c.sprite.y, m.sprite.x - c.sprite.x);
    const sp = pierce ? 640 : 430;
    const img = this.add.image(c.sprite.x, c.sprite.y, 'dot').setTint(typeColor(c.spec.types)).setScale(pierce ? 0.9 : 0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(42);
    this.shots.push({ img, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: pierce ? 0.9 : 0.7, dmg, src: c, pierce, hit: new Set() });
  }

  private updateShots(dt: number) {
    const hostile = this.hostile();
    for (const s of this.shots) {
      s.life -= dt;
      s.img.x += s.vx * dt;
      s.img.y += s.vy * dt;
      for (const m of hostile) {
        if (s.hit.has(m) || m.dead) continue;
        if (dist(m.sprite, s.img) < m.radius + 8) {
          s.hit.add(m);
          this.hitMachine(m, s.dmg, s.src);
          if (!s.pierce) s.life = 0;
          break;
        }
      }
      if (s.life <= 0) s.img.destroy();
    }
    this.shots = this.shots.filter((s) => s.life > 0);
  }

  private updateWild(c: Creature, dt: number) {
    c.atkCd -= dt;
    this.animateCreature(c);
    if (c.trust < 100 && this.t - c.lastCredit > 6) c.trust = Math.max(c.feralUid ? 50 : 0, c.trust - 1.2 * dt);

    const inLight = dist(c.sprite, this.trainer) < LIGHT_RADIUS;
    if (inLight && !this.seen.has(c.spec.id)) {
      this.seen.add(c.spec.id);
      this.hud.toast(`${c.feralUid ? 'Found your' : 'Spotted'} ${c.spec.name}${c.feralUid ? ' — gone feral' : ''}`, c.feralUid ? 'bad' : 'info');
    }

    // The Harrow keep coming for a creature on its own, so there is always a
    // fight to step into when you find one.
    c.reinforceT -= dt;
    if (c.reinforceT <= 0) {
      c.reinforceT = 9;
      const near = this.hostile().filter((m) => dist(m.sprite, c.sprite) < 320).length;
      if (dist(c.sprite, this.trainer) < 1000 && near < 3 && c.trust < 100) {
        const a = this.rng.realInRange(0, Math.PI * 2);
        for (let i = 0; i < 2; i++) this.spawnMachine('mite', c.sprite.x + Math.cos(a) * 240 + i * 16, c.sprite.y + Math.sin(a) * 240, false);
      }
    }

    const m = this.nearestMachine(c.sprite, 280);
    if (m && dist(m.sprite, c.home) < 600) {
      this.engage(c, m);
      return;
    }
    if (c.trust >= 100 && dist(c.sprite, this.trainer) < 520) {
      const d = dist(c.sprite, this.trainer);
      if (d > 70) this.moveTo(c.sprite, this.trainer, c.speed * 0.9);
      else c.sprite.setVelocity(0, 0);
      return;
    }
    c.wanderT -= dt;
    if (c.wanderT <= 0) {
      c.wanderT = this.rng.realInRange(2, 5);
      c.wanderTo = { x: c.home.x + this.rng.between(-140, 140), y: c.home.y + this.rng.between(-140, 140) };
    }
    if (dist(c.sprite, c.wanderTo) > 12) this.moveTo(c.sprite, c.wanderTo, c.speed * 0.3);
    else c.sprite.setVelocity(0, 0);
  }

  private creditTrust(at: V, amount: number) {
    for (const c of this.wild) {
      if (c.gone || c.trust >= 100 || dist(c.sprite, at) > 300) continue;
      // Rarer creatures are slower to trust.
      const wary = { starter: 1, common: 1, uncommon: 0.6, rare: 0.3 }[c.spec.rarity];
      c.trust = Math.min(100, c.trust + amount * wary);
      c.lastCredit = this.t;
      if (c.trust >= 100 && !c.announced) {
        c.announced = true;
        this.hud.toast(`${c.spec.name} trusts you. Get close and press E.`, 'good');
      }
    }
  }

  private recruit(c: Creature) {
    if (this.party.length >= PARTY_MAX) {
      this.hud.toast('Your party is full (4).', 'bad');
      return;
    }
    c.faction = 'party';
    c.recruit = true;
    c.dmgMul = 1;
    c.sprite.clearTint();
    this.wild = this.wild.filter((w) => w !== c);
    this.party.push(c);
    this.hud.toast(`${c.spec.name} joins you. The bond seals when you get out.`, 'good');
  }

  private hurtCreature(c: Creature, amount: number) {
    if (c.downed || c.gone) return;
    let dmg = amount * harrowDamageTaken(c.spec.types);
    if (c.bulwarkUntil > this.t) dmg *= 0.5;
    c.hp -= dmg;
    c.sprite.setTintFill(0xffffff);
    this.time.delayedCall(60, () => (c.downed || c.gone ? null : c.feralUid && c.faction === 'wild' ? c.sprite.setTint(0xffd27a) : c.sprite.clearTint()));
    if (c.hp > 0) return;
    if (c.faction === 'party') {
      c.downed = true;
      c.hp = 0;
      c.sprite.setVelocity(0, 0);
      this.hud.toast(`${c.spec.name} is down. A Med Kit can bring it back.`, 'bad');
    } else {
      c.gone = true;
      c.sprite.setVelocity(0, 0);
      c.bar.clear();
      this.tweens.add({ targets: [c.sprite, c.shadow], alpha: 0, duration: 700, onComplete: () => { c.sprite.destroy(); c.shadow.destroy(); c.bar.destroy(); } });
      if (dist(c.sprite, this.trainer) < 500) this.hud.toast(`${c.spec.name} was driven off by the Harrow.`, 'bad');
    }
  }

  private hurtTrainer(amount: number) {
    if (this.rollT > 0 || this.ended) return;
    const absorbed = Math.min(this.shield, amount * 0.6);
    this.shield -= absorbed;
    this.hp -= amount - absorbed;
    this.hurtFlash = 0.12;
    this.cameras.main.shake(90, 0.004);
  }

  // ------------------------------------------------------------------ machines

  private hitMachine(m: Machine, base: number, src: Creature | null) {
    if (m.dead) return;
    const mult = src ? typeMult(src.spec.types, m.kind) : 1;
    const frozen = m.frozenUntil > this.t ? 1.25 : 1;
    const dmg = Math.round(base * mult * frozen);
    m.hp -= dmg;
    const ours = !src || src.faction === 'party';
    this.noise(0.35, m.sprite, ours);
    this.floatText(m.sprite.x, m.sprite.y - m.radius, String(dmg), mult >= 1.3 ? '#ffd84a' : mult < 1 ? '#8a8f96' : '#ffffff');
    m.sprite.setTintFill(0xffffff);
    this.time.delayedCall(50, () => !m.dead && m.sprite.clearTint());
    if (m.kind === 'crawler' && m.hp > 0 && m.hurtCd <= 0 && m.lungeT <= 0 && this.t >= m.lockUntil) {
      m.hurtCd = 0.9;
      this.playMachine(m, 'sc_hurt', 0.15);
    }
    if (m.kind === 'titan' && dmg >= 40 && m.hp > 0 && m.hurtCd <= 0 && m.slamT < 0 && m.chargeT < 0) {
      m.hurtCd = 2.5;
      this.playMachine(m, 'ti_hurt', 0.4);
    }
    if (ours) this.creditTrust(m.sprite, dmg * 0.6);
    if (m.hp <= 0) this.killMachine(m, ours);
  }

  private killMachine(m: Machine, ours: boolean) {
    m.dead = true;
    this.kills += ours ? 1 : 0;
    this.noise(2, m.sprite, ours);
    if (ours) this.creditTrust(m.sprite, { titan: 100, crusher: 40 }[m.kind as string] ?? 15);
    if (this.focus === m) this.focus = null;
    const { x, y } = m.sprite;
    const boom = this.add.image(x, y, 'glow').setTint(0xff8a3d).setBlendMode(Phaser.BlendModes.ADD).setDepth(56).setScale(m.radius / 12);
    this.tweens.add({ targets: boom, scale: m.radius / 5, alpha: 0, duration: 380, onComplete: () => boom.destroy() });
    m.eye.destroy();
    m.bar.destroy();
    if (m.kind === 'titan') {
      this.titan = null;
      const wreck = m.sprite;
      (wreck.body as Phaser.Physics.Arcade.Body).enable = false;
      wreck.clearTint().setDepth(4).play('ti_death');
      this.cameras.main.shake(700, 0.012);
      this.hud.toast('The Titan is down.', 'good');
      this.time.delayedCall(250, () => this.burst(m.sprite, 260, 0xff6a1a));
      if (ours) {
        const img = this.add.image(x, y + 40, 'shard').setScale(1.1).setDepth(6);
        this.tweens.add({ targets: img, scale: 1.3, duration: 500, yoyo: true, repeat: -1 });
        this.pickups.push({ img, scrap: 20, key: 1 });
      }
      return;
    }
    if (m.kind === 'crawler') {
      // leave the wreck burning for a while instead of vanishing
      const wreck = m.sprite;
      (wreck.body as Phaser.Physics.Arcade.Body).enable = false;
      wreck.clearTint().setDepth(4).play('sc_death');
      this.tweens.add({ targets: wreck, alpha: 0, delay: 6000, duration: 1500, onComplete: () => wreck.destroy() });
    } else m.sprite.destroy();
    const scrap = { mite: this.rng.frac() < 0.4 ? 1 : 0, watcher: 2, crusher: 6, crawler: 2, titan: 0 }[m.kind];
    if (scrap && ours) {
      const img = m.kind === 'crawler'
        ? this.add.image(x + 14, y + 10, 'shard').setScale(0.5).setDepth(6)
        : this.add.image(x, y, 'dot').setTint(0xd4a24a).setScale(0.6).setDepth(6);
      this.tweens.add({ targets: img, scale: 0.8, duration: 500, yoyo: true, repeat: -1 });
      this.pickups.push({ img, scrap });
    }
  }

  private targetPos(t: Target): V | null {
    if (t.t === 'trainer') return this.hp > 0 ? this.trainer : null;
    if (t.t === 'creature') return t.c.downed || t.c.gone ? null : t.c.sprite;
    return t.m.dead ? null : t.m.sprite;
  }

  private damageTarget(t: Target, amount: number) {
    if (t.t === 'trainer') this.hurtTrainer(amount);
    else if (t.t === 'creature') this.hurtCreature(t.c, amount);
    else this.hitMachine(t.m, amount, null);
  }

  private pickTarget(m: Machine): Target | null {
    const allied = m.hijackedUntil > this.t;
    if (allied) {
      const other = this.nearestMachine(m.sprite, 500);
      return other ? { t: 'machine', m: other } : null;
    }
    if (m.taunter && m.tauntUntil > this.t && !m.taunter.downed) return { t: 'creature', c: m.taunter };
    const range = m.hunting ? 2400 : { mite: 360, watcher: 380, crusher: 420, crawler: 420, titan: 520 }[m.kind];
    let best: Target | null = null;
    let bd = range;
    const dT = dist(m.sprite, this.trainer);
    if (dT < bd) {
      best = { t: 'trainer' };
      bd = dT * 0.9; // the trainer is the Harrow's first choice
    }
    if (m.kind !== 'watcher') {
      for (const c of [...this.party, ...this.wild]) {
        if (c.downed || c.gone) continue;
        const d = dist(m.sprite, c.sprite);
        if (d < bd) {
          bd = d;
          best = { t: 'creature', c };
        }
      }
    }
    return best;
  }

  private updateMachine(m: Machine, dt: number) {
    if (m.dead) return;
    const s = m.sprite;
    if (m.kind === 'crawler') m.eye.setPosition(s.x + (s.flipX ? -15 : 15), s.y - 6);
    else m.eye.setPosition(s.x, s.y - (m.kind === 'crusher' ? 12 : 1));
    m.atkCd -= dt;
    m.hurtCd -= dt;
    m.spitCd -= dt;
    m.slamCd -= dt;
    m.broadcastCd -= dt;
    if (m.dotUntil > this.t) {
      m.hp -= m.dotDps * dt;
      if (m.hp <= 0) return this.killMachine(m, true);
    }
    if (m.kind === 'titan') return this.updateTitan(m, dt);
    const allied = m.hijackedUntil > this.t;
    m.eye.setTint(allied ? 0xe05bd0 : 0xff2a1a);
    s.setTint(allied ? 0xf0a0ff : 0xffffff);
    if (m.frozenUntil > this.t) {
      s.setVelocity(0, 0).setTint(0x9fe3ff);
      m.lungeT = 0;
      if (s.anims.isPlaying) s.anims.pause();
      return;
    }
    if (s.anims.isPaused) s.anims.resume();
    if (m.kind === 'crawler') this.animateCrawler(m);
    const speed = m.speed * (m.slowUntil > this.t ? 0.5 : 1);

    if (this.lure && this.lure.until > this.t && !allied && dist(s, this.lure.img) < 460) {
      if (dist(s, this.lure.img) > 30) this.moveTo(s, this.lure.img, speed * 1.1);
      else s.setVelocity(0, 0);
      return;
    }

    m.retargetT -= dt;
    if (m.retargetT <= 0 || !m.target || !this.targetPos(m.target)) {
      m.retargetT = 0.5;
      m.target = this.pickTarget(m);
    }
    const tp = m.target ? this.targetPos(m.target) : null;
    if (m.kind === 'watcher') return this.updateWatcher(m, tp, speed, dt);
    if (!m.target || !tp) return this.patrol(m, speed, dt);

    const d = dist(s, tp);
    if (m.kind === 'crawler') return this.updateCrawler(m, m.target, tp, d, speed, dt);
    if (m.kind === 'mite') {
      if (d > 22) this.moveTo(s, tp, speed);
      else {
        s.setVelocity(0, 0);
        if (m.atkCd <= 0) {
          m.atkCd = 0.5;
          this.damageTarget(m.target, 3);
        }
      }
      return;
    }
    // Crusher: wind up a telegraphed slam, then hit everything in the ring.
    if (m.slamT >= 0) {
      s.setVelocity(0, 0);
      m.slamT += dt;
      if (m.slamT >= 1) {
        m.slamT = -1;
        m.slamCd = 2.8;
        this.slam(m);
      }
      return;
    }
    if (d < 95 && m.slamCd <= 0) {
      m.slamT = 0;
      return;
    }
    this.moveTo(s, tp, speed);
  }

  private playMachine(m: Machine, key: string, lock: number) {
    m.sprite.play(key, true);
    m.lockUntil = this.t + lock;
  }

  private animateCrawler(m: Machine) {
    if (this.t < m.lockUntil || m.lungeT > 0) return;
    const v = (m.sprite.body as Phaser.Physics.Arcade.Body).velocity.length();
    const key = v > 150 ? 'sc_run' : v > 8 ? 'sc_walk' : 'sc_idle';
    if (m.sprite.anims.currentAnim?.key !== key) m.sprite.play(key);
  }

  /**
   * Shardcrawler: a pack skirmisher. Holds at spitting distance and circles,
   * lobbing glowing globs; lunges if you get close.
   */
  private updateCrawler(m: Machine, target: Target, tp: V, d: number, speed: number, dt: number) {
    const s = m.sprite;
    if (m.lungeT > 0) {
      m.lungeT -= dt;
      if (!m.lungeHit && d < m.radius + 24) {
        m.lungeHit = true;
        this.damageTarget(target, 12);
      }
      if (m.lungeT <= 0) s.setVelocity(0, 0);
      return;
    }
    if (this.t < m.lockUntil) {
      s.setVelocity(0, 0);
      return;
    }
    const face = () => s.setFlipX(tp.x < s.x);
    if (d < 95 && m.atkCd <= 0) {
      m.atkCd = 1.6;
      m.lungeT = 0.28;
      m.lungeHit = false;
      const a = Math.atan2(tp.y - s.y, tp.x - s.x);
      s.setVelocity(Math.cos(a) * 420, Math.sin(a) * 420);
      face();
      this.playMachine(m, 'sc_lunge', 0.28);
      return;
    }
    if (d > 110 && d < 330 && m.spitCd <= 0) {
      m.spitCd = this.rng.realInRange(2.2, 3.2);
      s.setVelocity(0, 0);
      face();
      this.playMachine(m, 'sc_spit', 0.45);
      this.time.delayedCall(280, () => !m.dead && m.frozenUntil <= this.t && this.spit(m));
      return;
    }
    if (d > 190) {
      this.moveTo(s, tp, speed);
      return;
    }
    // inside spitting range: circle the target rather than closing in
    const a = Math.atan2(s.y - tp.y, s.x - tp.x) + (m.orbit > Math.PI ? 1 : -1) * (Math.PI / 2);
    s.setVelocity(Math.cos(a) * speed * 0.55, Math.sin(a) * speed * 0.55);
    face();
  }

  private spit(m: Machine) {
    const tp = m.target ? this.targetPos(m.target) : null;
    if (!tp) return;
    const s = m.sprite;
    const ox = s.x + (s.flipX ? -20 : 20);
    const oy = s.y - 4;
    const a = Math.atan2(tp.y - oy, tp.x - ox);
    const img = this.add.image(ox, oy, 'glow').setTint(0xff6a1a).setScale(0.32).setBlendMode(Phaser.BlendModes.ADD).setDepth(56);
    this.globs.push({ img, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, life: 1.3, dmg: 9, allied: m.hijackedUntil > this.t, size: 0.32 });
    this.noise(0.5, s, false);
  }

  private updateGlobs(dt: number) {
    for (const g of this.globs) {
      g.life -= dt;
      g.img.x += g.vx * dt;
      g.img.y += g.vy * dt;
      g.img.setScale(g.size + Math.sin(this.t * 30) * 0.04);
      if (g.allied) {
        const m = this.hostile().find((m) => dist(m.sprite, g.img) < m.radius + 8);
        if (m) {
          this.hitMachine(m, g.dmg, null);
          g.life = 0;
        }
      } else if (this.rollT <= 0 && dist(this.trainer, g.img) < 18) {
        this.hurtTrainer(g.dmg);
        g.life = 0;
      } else {
        const c = [...this.party, ...this.wild].find((c) => !c.downed && !c.gone && dist(c.sprite, g.img) < 22);
        if (c) {
          this.hurtCreature(c, g.dmg);
          g.life = 0;
        }
      }
      if (g.life <= 0) {
        const pop = this.add.image(g.img.x, g.img.y, 'glow').setTint(0xff6a1a).setBlendMode(Phaser.BlendModes.ADD).setDepth(56).setScale(0.4);
        this.tweens.add({ targets: pop, scale: 1.1, alpha: 0, duration: 200, onComplete: () => pop.destroy() });
        g.img.destroy();
      }
    }
    this.globs = this.globs.filter((g) => g.life > 0);
  }

  private spawnTitan() {
    this.titanSpawned = true;
    // It walks in from the north, where the Harrow landed.
    const m = this.spawnMachine('titan', this.rng.between(400, WORLD - 400), 140, false, true);
    if (!m) return;
    this.titan = m;
    this.cameras.main.shake(900, 0.006);
    this.hud.toast('The ground is shaking. A Titan is crossing Bear Hollow.', 'bad');
    this.hud.toast('It patrols the exits. Avoid. Observe. Escape.', 'bad');
  }

  /**
   * Titan: boss event. Patrols between the exits (so it guards your way out),
   * pursues anything it spots, charges a laser-sighted burst at range and
   * slams the ground up close. Immune to freeze, hijack and knockback.
   */
  private updateTitan(m: Machine, dt: number) {
    const s = m.sprite;
    m.frozenUntil = 0;
    m.hijackedUntil = 0;
    m.eye.setPosition(s.x + (s.flipX ? 6 : -6), s.y - 50);
    // fade it out of the dark: dim when far from the lantern, never invisible
    const near = Phaser.Math.Clamp(1 - (dist(s, this.trainer) - LIGHT_RADIUS) / 700, 0.28, 1);
    const v = Math.round(255 * near);
    if (m.hurtCd < 1.9) s.setTint(Phaser.Display.Color.GetColor(v, v, v));
    s.setDepth(52);

    const speed = m.speed * (m.slowUntil > this.t ? 0.6 : 1);
    m.retargetT -= dt;
    if (m.retargetT <= 0 || !m.target || !this.targetPos(m.target)) {
      m.retargetT = 0.5;
      m.target = this.pickTarget(m);
    }
    const tp = m.target ? this.targetPos(m.target) : null;

    // footsteps you can feel
    const moving = (s.body as Phaser.Physics.Arcade.Body).velocity.lengthSq() > 25;
    m.stepT -= dt;
    if (moving && m.stepT <= 0) {
      m.stepT = 0.75;
      const d = dist(s, this.trainer);
      if (d < 1000) this.cameras.main.shake(110, 0.0035 * (1 - d / 1000));
    }

    if (m.slamT >= 0) {
      s.setVelocity(0, 0);
      m.slamT += dt;
      if (m.slamT >= 1.1) {
        m.slamT = -1;
        m.slamCd = 4;
        this.titanSlam(m);
      }
      return;
    }
    if (m.chargeT >= 0) {
      s.setVelocity(0, 0);
      m.chargeT += dt;
      // the sight tracks the target, then locks just before it fires
      if (tp && m.chargeT < 0.8) m.aim = { x: tp.x, y: tp.y };
      s.setFlipX(m.aim.x < s.x);
      if (m.chargeT >= 1.05) {
        m.chargeT = -1;
        m.atkCd = 3.4;
        this.playMachine(m, 'ti_fire', 0.6);
        for (let i = 0; i < 5; i++) this.time.delayedCall(i * 90, () => !m.dead && this.titanBolt(m));
      }
      return;
    }
    if (this.t < m.lockUntil) {
      s.setVelocity(0, 0);
      return;
    }
    if (tp) {
      const d = dist(s, tp);
      if (d < 180 && m.slamCd <= 0) {
        m.slamT = 0;
        this.playMachine(m, 'ti_slam', 1.3);
        return;
      }
      if (d > 200 && d < 580 && m.atkCd <= 0) {
        m.chargeT = 0;
        m.aim = { x: tp.x, y: tp.y };
        this.playMachine(m, 'ti_charge', 1.1);
        return;
      }
      if (d > 140) this.moveTo(s, tp, speed);
      else s.setVelocity(0, 0);
    } else {
      // defend: walk a loop between the exits
      const route: V[] = [this.lifts[0], this.hatch, this.lifts[1], this.hatch];
      const wp = route[m.waypoint % route.length];
      if (dist(s, wp) < 120) m.waypoint++;
      this.moveTo(s, wp, speed * 0.75);
    }
    const key = moving ? 'ti_run' : 'ti_idle';
    if (s.anims.currentAnim?.key !== key) s.play(key);
  }

  private titanBolt(m: Machine) {
    const s = m.sprite;
    const ox = s.x + (s.flipX ? -40 : 40);
    const oy = s.y - 50;
    const a = Math.atan2(m.aim.y - oy, m.aim.x - ox) + this.rng.realInRange(-0.06, 0.06);
    const img = this.add.image(ox, oy, 'glow').setTint(0xff2a1a).setBlendMode(Phaser.BlendModes.ADD).setDepth(57);
    this.globs.push({ img, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, life: 1.2, dmg: 14, allied: false, size: 0.42 });
    this.noise(1, s, false);
  }

  private titanSlam(m: Machine) {
    const R = 190;
    const { x, y } = m.sprite;
    const d = dist(m.sprite, this.trainer);
    if (d < 900) this.cameras.main.shake(350, 0.014 * (1 - d / 900) + 0.004);
    const ring = this.add.image(x, y, 'glow').setTint(0xff5a22).setBlendMode(Phaser.BlendModes.ADD).setDepth(57);
    this.tweens.add({ targets: ring, scale: R / 13, alpha: 0, duration: 420, onComplete: () => ring.destroy() });
    this.noise(4, m.sprite, false);
    if (d < R) this.hurtTrainer(40);
    for (const c of [...this.party, ...this.wild]) if (dist(c.sprite, m.sprite) < R) this.hurtCreature(c, 40);
  }

  private slam(m: Machine) {
    const R = 115;
    const allied = m.hijackedUntil > this.t;
    this.noise(1, m.sprite, false);
    if (dist(m.sprite, this.trainer) < 500) this.cameras.main.shake(160, 0.008);
    const ring = this.add.image(m.sprite.x, m.sprite.y, 'glow').setTint(allied ? 0xe05bd0 : 0xff4422).setBlendMode(Phaser.BlendModes.ADD).setDepth(39).setScale(1);
    this.tweens.add({ targets: ring, scale: R / 14, alpha: 0, duration: 300, onComplete: () => ring.destroy() });
    if (allied) {
      for (const o of this.hostile()) if (o !== m && dist(o.sprite, m.sprite) < R) this.hitMachine(o, 30, null);
      return;
    }
    if (dist(this.trainer, m.sprite) < R) this.hurtTrainer(28);
    for (const c of [...this.party, ...this.wild]) if (dist(c.sprite, m.sprite) < R) this.hurtCreature(c, 28);
  }

  private updateWatcher(m: Machine, _tp: V | null, speed: number, dt: number) {
    const s = m.sprite;
    const allied = m.hijackedUntil > this.t;
    const dT = dist(s, this.trainer);
    if (allied) {
      this.moveTo(s, { x: this.trainer.x, y: this.trainer.y - 80 }, speed);
      return;
    }
    if (dT < 340 && this.hp > 0) {
      m.orbit += dt * 0.6;
      const to = { x: this.trainer.x + Math.cos(m.orbit) * 210, y: this.trainer.y + Math.sin(m.orbit) * 210 };
      this.moveTo(s, to, speed);
      m.sight += dt;
      if (m.sight >= 1.8 && m.broadcastCd <= 0) this.broadcast(m);
      return;
    }
    m.sight = Math.max(0, m.sight - dt);
    this.patrol(m, speed, dt);
  }

  private broadcast(m: Machine) {
    m.sight = 0;
    m.broadcastCd = 14;
    this.alarm = Math.min(100, this.alarm + 25);
    this.lastNoise = this.t;
    this.hud.toast('A Watcher broadcast your position.', 'bad');
    const pulse = this.add.image(m.sprite.x, m.sprite.y, 'glow').setTint(0xff2020).setBlendMode(Phaser.BlendModes.ADD).setDepth(56);
    this.tweens.add({ targets: pulse, scale: 14, alpha: 0, duration: 900, onComplete: () => pulse.destroy() });
    for (let i = 0; i < 4; i++) {
      const a = this.rng.realInRange(0, Math.PI * 2);
      this.spawnMachine('mite', m.sprite.x + Math.cos(a) * 160, m.sprite.y + Math.sin(a) * 160, true);
    }
  }

  private patrol(m: Machine, speed: number, dt: number) {
    if (m.hunting) {
      this.moveTo(m.sprite, this.trainer, speed * 0.8);
      return;
    }
    m.patrolT -= dt;
    if (m.patrolT <= 0) {
      m.patrolT = this.rng.realInRange(3, 6);
      m.patrolTo = {
        x: Phaser.Math.Clamp(m.sprite.x + this.rng.between(-300, 300), 60, WORLD - 60),
        y: Phaser.Math.Clamp(m.sprite.y + this.rng.between(-300, 300), 60, WORLD - 60),
      };
    }
    if (dist(m.sprite, m.patrolTo) > 10) this.moveTo(m.sprite, m.patrolTo, speed * 0.4);
    else m.sprite.setVelocity(0, 0);
  }

  // ------------------------------------------------------------------ moves & items

  private useMove(i: number) {
    const c = this.party[i];
    if (!c || c.downed || c.moveCd > 0) return;
    const at = c.sprite;
    const near = (r: number, from: V = at) => this.hostile().filter((m) => dist(m.sprite, from) < r);
    const target = (this.focus && !this.focus.dead ? this.focus : null) ?? c.target ?? this.nearestMachine(at, 320);
    const color = typeColor(c.spec.types);
    let used = true;

    switch (c.spec.move) {
      case 'chain': {
        let from: V = at;
        const hit = new Set<Machine>();
        for (let k = 0; k < 4; k++) {
          const next = this.nearestMachine(from, k === 0 ? 280 : 170, this.hostile().filter((m) => !hit.has(m)));
          if (!next) break;
          hit.add(next);
          this.zap(from, next.sprite, color);
          this.hitMachine(next, 28, c);
          from = next.sprite;
        }
        used = hit.size > 0;
        break;
      }
      case 'surge':
        this.hp = Math.min(100, this.hp + 25);
        for (const p of this.party) if (!p.downed) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.2);
        for (const m of near(150)) {
          if (m.kind === 'titan') continue;
          const a = Math.atan2(m.sprite.y - at.y, m.sprite.x - at.x);
          this.tweens.add({ targets: m.sprite, x: m.sprite.x + Math.cos(a) * 120, y: m.sprite.y + Math.sin(a) * 120, duration: 220 });
        }
        this.burst(at, 150, color);
        break;
      case 'quake':
        for (const m of near(135)) {
          if (m.kind === 'watcher') continue;
          this.hitMachine(m, 34, c);
          m.slowUntil = this.t + 3;
        }
        this.burst(at, 135, color);
        this.cameras.main.shake(120, 0.005);
        break;
      case 'pounce':
      case 'phase': {
        const m = target && dist(target.sprite, at) < 420 ? target : null;
        if (!m) {
          used = false;
          break;
        }
        if (c.spec.move === 'phase') {
          c.sprite.setPosition(m.sprite.x - 30, m.sprite.y);
          this.hitMachine(m, c.atk * 3.5, c);
        } else {
          this.tweens.add({ targets: c.sprite, x: m.sprite.x, y: m.sprite.y, duration: 160 });
          this.hitMachine(m, c.atk * 3, c);
        }
        this.burst(m.sprite, 50, color);
        break;
      }
      case 'snare': {
        const center = target?.sprite ?? at;
        for (const m of near(140, center)) {
          m.slowUntil = this.t + 4;
          m.dotUntil = this.t + 4;
          m.dotDps = 6;
        }
        this.burst(center, 140, color);
        break;
      }
      case 'ward':
        this.shield = Math.min(100, this.shield + 35);
        this.burst(this.trainer, 60, color);
        break;
      case 'flare':
        for (const m of near(125)) this.hitMachine(m, 40, c);
        this.burst(at, 125, color);
        break;
      case 'freeze':
        for (const m of near(155)) if (m.kind !== 'titan') m.frozenUntil = this.t + 2.5;
        this.burst(at, 155, color);
        break;
      case 'bolt':
        if (!target) {
          used = false;
          break;
        }
        this.fire(c, target, 55, true);
        break;
      case 'bulwark':
        c.bulwarkUntil = this.t + 5;
        for (const m of near(260)) {
          m.taunter = c;
          m.tauntUntil = this.t + 5;
          m.target = { t: 'creature', c };
        }
        this.burst(at, 260, color);
        break;
      case 'hijack': {
        const pool = this.hostile().filter((m) => m.kind !== 'titan' && dist(m.sprite, at) < 320);
        const m = pool.find((m) => m.kind === 'crusher') ?? (target && pool.includes(target) ? target : pool[0]);
        if (!m) {
          used = false;
          break;
        }
        m.hijackedUntil = this.t + (m.kind === 'crusher' ? 6 : 8);
        m.target = null;
        if (this.focus === m) this.focus = null;
        this.zap(at, m.sprite, color);
        this.hud.toast(`${c.spec.name} seized a ${m.kind}.`, 'good');
        break;
      }
    }
    if (used) {
      c.moveCd = MOVE_COOLDOWN[c.spec.move];
      this.noise(2);
    }
  }

  private useMedkit() {
    if (this.itemCd > 0 || this.supplies.medkit <= 0) return;
    this.supplies.medkit--;
    this.itemCd = 1;
    this.hp = Math.min(100, this.hp + 40);
    let revived = 0;
    for (const c of this.party) {
      if (c.downed && dist(c.sprite, this.trainer) < 180) {
        c.downed = false;
        c.hp = c.maxHp * 0.4;
        c.sprite.setAlpha(1).clearTint();
        revived++;
      } else if (!c.downed) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.3);
    }
    this.burst(this.trainer, 180, 0x7dff9a);
    if (revived) this.hud.toast(`Revived ${revived}.`, 'good');
  }

  private useCell() {
    if (this.itemCd > 0 || this.supplies.cell <= 0 || this.shield >= 100) return;
    this.supplies.cell--;
    this.itemCd = 1;
    this.shield = Math.min(100, this.shield + 50);
    this.burst(this.trainer, 50, 0x6fb7ff);
  }

  private throwLure() {
    if (this.itemCd > 0 || this.supplies.lure <= 0) return;
    this.supplies.lure--;
    this.itemCd = 1;
    const p = this.input.activePointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const a = Math.atan2(p.y - this.trainer.y, p.x - this.trainer.x);
    const r = Math.min(320, dist(p, this.trainer));
    const x = this.trainer.x + Math.cos(a) * r;
    const y = this.trainer.y + Math.sin(a) * r;
    this.lure?.img.destroy();
    const img = this.add.image(this.trainer.x, this.trainer.y, 'lure').setDepth(8);
    this.tweens.add({ targets: img, x, y, duration: 350, ease: 'Quad.easeOut' });
    this.lure = { img, until: this.t + 7 };
    this.noise(4);
    this.time.delayedCall(7000, () => {
      if (this.lure?.img === img) {
        img.destroy();
        this.lure = null;
      }
    });
  }

  // ------------------------------------------------------------------ interact & extract

  private updateInteract(dt: number) {
    const E = this.keys.E;
    const T = this.trainer;

    const ready = this.wild.find((c) => c.trust >= 100 && dist(c.sprite, T) < 90);
    if (ready) {
      this.prompt = `E — bond with ${ready.spec.name}`;
      if (Phaser.Input.Keyboard.JustDown(E)) this.recruit(ready);
      return;
    }

    const lift = this.lifts.find((l) => dist(l, T) < 80);
    if (lift) {
      if (lift.state === 'idle') {
        this.prompt = 'E — call the lift (loud)';
        if (Phaser.Input.Keyboard.JustDown(E)) {
          lift.state = 'calling';
          lift.timer = 15;
          this.noise(20);
          this.hud.toast('Lift called. Hold the ring for 15 seconds.', 'info');
        }
      } else this.prompt = lift.state === 'calling' ? `Lift arriving: ${Math.ceil(lift.timer)}s — stay in the ring` : '';
      return;
    }

    if (dist(this.hatch, T) < 60) {
      this.prompt = this.supplies.key > 0 ? 'E — open the hatch (uses a Hatch Key)' : 'Sealed hatch. Needs a Hatch Key.';
      if (this.supplies.key > 0 && Phaser.Input.Keyboard.JustDown(E)) {
        this.supplies.key--;
        this.endRaid('extracted');
      }
      return;
    }

    const cache = this.caches.find((c) => !c.searched && dist(c.img, T) < 46);
    if (cache && E.isDown) {
      if (this.searching !== cache) {
        this.searching = cache;
        this.searchT = 0;
      }
      this.searchT += dt;
      this.prompt = 'Searching…';
      if (this.searchT >= 1.4) this.openCache(cache);
      return;
    }
    this.searching = null;
    this.searchT = 0;
    if (cache) this.prompt = 'Hold E — search cache';
  }

  private openCache(c: Cache) {
    c.searched = true;
    c.img.setTexture('cache_open');
    this.searching = null;
    this.noise(3);
    const got: string[] = [];
    const scrap = this.rng.between(2, 5);
    this.loot.scrap += scrap;
    got.push(`${scrap} scrap`);
    const roll = (p: number, k: keyof Stash, label: string) => {
      if (this.rng.frac() < p) {
        this.loot[k]++;
        got.push(label);
      }
    };
    roll(0.3, 'medkit', 'Med Kit');
    roll(0.25, 'cell', 'Shield Cell');
    roll(0.22, 'lure', 'Lure');
    roll(0.07, 'key', 'Hatch Key');
    this.hud.toast(`Found ${got.join(', ')}`, 'info');
  }

  private updateLifts(dt: number) {
    for (const l of this.lifts) {
      l.ring.clear();
      if (l.state === 'idle') continue;
      l.timer -= dt;
      const inside = dist(l, this.trainer) < 95;
      l.ring.lineStyle(3, l.state === 'here' ? 0x7dff9a : 0xffb347, inside ? 0.9 : 0.5).strokeCircle(l.x, l.y, 95);
      if (l.state === 'calling') {
        const frac = Math.max(0, l.timer / 15);
        l.ring.lineStyle(6, 0xffb347, 0.9).beginPath().arc(l.x, l.y, 105, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2).strokePath();
        if (l.timer <= 0) {
          l.state = 'here';
          l.timer = 10;
          this.hud.toast('The lift is here. Get in the ring.', 'good');
        }
      } else if (l.state === 'here') {
        if (inside) return this.endRaid('extracted');
        if (l.timer <= 0) {
          l.state = 'idle';
          this.hud.toast('The lift left without you.', 'bad');
        }
      }
    }
  }

  // ------------------------------------------------------------------ director

  /** Raise the Alarm. Noise somewhere else on the map only counts if it is ours. */
  private noise(n: number, at?: V, ours = true) {
    if (at && !ours && dist(at, this.trainer) > 650) return;
    this.alarm = Math.min(100, this.alarm + n);
    this.lastNoise = this.t;
  }

  private updateDirector(dt: number) {
    if (!this.titanSpawned && this.t >= this.titanAt) this.spawnTitan();
    if (this.t - this.lastNoise > 5) this.alarm = Math.max(0, this.alarm - 1.4 * dt);
    this.crusherCd -= dt;
    this.directorT -= dt;
    if (this.directorT > 0) return;
    this.directorT = 8;
    const a = this.alarm;
    const edgeSpot = () => {
      const ang = this.rng.realInRange(0, Math.PI * 2);
      const r = this.rng.between(620, 780);
      return { x: this.trainer.x + Math.cos(ang) * r, y: this.trainer.y + Math.sin(ang) * r };
    };
    const hunters = this.machines.filter((m) => m.hunting && !m.dead).length;
    if (a > 30 && hunters < 18) {
      const p = edgeSpot();
      const n = 3 + Math.floor(a / 25);
      for (let i = 0; i < n; i++) this.spawnMachine('mite', p.x + i * 18, p.y + (i % 2) * 18, true);
    }
    // Shardcrawlers are drawn to movement and sound: they arrive in pairs once things get loud.
    const crawlers = this.machines.filter((m) => m.kind === 'crawler' && m.hunting && !m.dead).length;
    if (a > 45 && crawlers < 4 && this.rng.frac() < 0.5) {
      const p = edgeSpot();
      this.spawnMachine('crawler', p.x, p.y, true);
      this.spawnMachine('crawler', p.x + 40, p.y + 20, true);
    }
    if (a > 60 && this.machines.filter((m) => m.kind === 'watcher' && !m.dead).length < 5 && this.rng.frac() < 0.5) {
      const p = edgeSpot();
      this.spawnMachine('watcher', p.x, p.y, true);
    }
    if (a > 85 && this.crusherCd <= 0) {
      this.crusherCd = 75;
      const p = edgeSpot();
      this.spawnMachine('crusher', p.x, p.y, true);
      this.hud.toast('Something heavy is coming.', 'bad');
    }
  }

  // ------------------------------------------------------------------ drawing

  private floatText(x: number, y: number, s: string, color: string) {
    if (this.children.list.length > 1800) return;
    const t = this.add.text(x, y, s, { fontFamily: 'Silkscreen, monospace', fontSize: '12px', color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(60);
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, duration: 650, onComplete: () => t.destroy() });
  }

  private burst(at: V, r: number, color: number) {
    const img = this.add.image(at.x, at.y, 'glow').setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(56).setAlpha(0.8);
    this.tweens.add({ targets: img, scale: r / 16, alpha: 0, duration: 420, onComplete: () => img.destroy() });
  }

  private zap(a: V, b: V, color: number) {
    const g = this.add.graphics().setDepth(57);
    g.lineStyle(3, color, 1);
    g.beginPath().moveTo(a.x, a.y);
    for (let i = 1; i < 6; i++) {
      const f = i / 6;
      g.lineTo(a.x + (b.x - a.x) * f + this.rng.between(-10, 10), a.y + (b.y - a.y) * f + this.rng.between(-10, 10));
    }
    g.lineTo(b.x, b.y).strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private drawBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, frac: number, color: number) {
    g.fillStyle(0x000000, 0.6).fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
    g.fillStyle(color).fillRect(x - w / 2, y, w * Phaser.Math.Clamp(frac, 0, 1), 3);
  }

  private drawWorldOverlay() {
    this.fx.clear();
    this.focusRing.clear();
    for (const m of this.machines) {
      if (m.dead) continue;
      m.bar.clear();
      if (m.hp < m.maxHp) this.drawBar(m.bar, m.sprite.x, m.sprite.y - m.radius - 10, m.radius * 2 + 8, m.hp / m.maxHp, 0xff5a4a);
      const R = m.kind === 'titan' ? 190 : 115;
      if (m.slamT >= 0) {
        this.fx.fillStyle(0xff2a1a, 0.12 + m.slamT * 0.22).fillCircle(m.sprite.x, m.sprite.y, R);
        this.fx.lineStyle(2, 0xff2a1a, 0.8).strokeCircle(m.sprite.x, m.sprite.y, R * Math.min(1, m.slamT + 0.2));
      }
      if (m.kind === 'titan' && m.chargeT >= 0) {
        const locked = m.chargeT >= 0.8;
        this.fx.lineStyle(locked ? 3 : 1.5, 0xff2a1a, locked ? 0.95 : 0.55)
          .lineBetween(m.sprite.x + (m.sprite.flipX ? -40 : 40), m.sprite.y - 50, m.aim.x, m.aim.y);
      }
      if (m.kind === 'watcher' && m.sight > 0 && m.hijackedUntil <= this.t) {
        this.fx.lineStyle(1 + m.sight * 2, 0xff2a1a, 0.25 + m.sight * 0.35).lineBetween(m.sprite.x, m.sprite.y, this.trainer.x, this.trainer.y);
      }
    }
    if (this.focus && !this.focus.dead) {
      const f = this.focus.sprite;
      this.focusRing.lineStyle(2, 0xffffff, 0.8).strokeCircle(f.x, f.y, this.focus.radius + 10 + Math.sin(this.t * 8) * 2);
    }
    for (const c of this.party) {
      c.bar.clear();
      if (!c.downed && c.hp < c.maxHp) this.drawBar(c.bar, c.sprite.x, c.sprite.y - 40, 40, c.hp / c.maxHp, 0x7dff9a);
    }
    for (const c of this.wild) {
      c.bar.clear();
      if (c.gone) continue;
      if (c.hp < c.maxHp) this.drawBar(c.bar, c.sprite.x, c.sprite.y - 46, 40, c.hp / c.maxHp, 0xcfc6b0);
      if (c.trust > 0) this.drawBar(c.bar, c.sprite.x, c.sprite.y - 40, 40, c.trust / 100, c.trust >= 100 ? 0xffd84a : 0x58b6ff);
    }
  }

  private drawDarkness() {
    const cam = this.cameras.main;
    const sx = this.trainer.x - cam.worldView.x;
    const sy = this.trainer.y - cam.worldView.y;
    this.dark.clear();
    this.dark.fill(0x020306, 0.88);
    const flicker = 1 + Math.sin(this.t * 9) * 0.015 + Math.sin(this.t * 23) * 0.01;
    this.lightImg.setScale((LIGHT_RADIUS / 256) * flicker);
    this.dark.erase(this.lightImg, sx, sy);
    this.glowImg.setScale(3);
    for (const l of this.lifts) if (l.state !== 'idle') this.dark.erase(this.glowImg, l.x - cam.worldView.x, l.y - cam.worldView.y);
    if (this.lure) this.dark.erase(this.glowImg, this.lure.img.x - cam.worldView.x, this.lure.img.y - cam.worldView.y);

    // Edge arrows toward the exits.
    this.edge.clear();
    const w = this.scale.width;
    const h = this.scale.height;
    const exits: [V, number][] = [...this.lifts.map((l): [V, number] => [l, l.state === 'idle' ? 0xffb347 : 0x7dff9a]), [this.hatch, this.supplies.key > 0 ? 0x4fd1c5 : 0x4a5560]];
    if (this.titan && !this.titan.dead) exits.push([this.titan.sprite, 0xff2a1a]);
    for (const [p, color] of exits) {
      const px = p.x - cam.worldView.x;
      const py = p.y - cam.worldView.y;
      if (px > 0 && px < w && py > 0 && py < h) continue;
      const a = Math.atan2(py - h / 2, px - w / 2);
      const m = 26;
      const k = Math.min((w / 2 - m) / Math.abs(Math.cos(a) || 1e-6), (h / 2 - m) / Math.abs(Math.sin(a) || 1e-6));
      const ex = w / 2 + Math.cos(a) * k;
      const ey = h / 2 + Math.sin(a) * k;
      this.edge.fillStyle(color, 0.85).fillTriangle(
        ex + Math.cos(a) * 12, ey + Math.sin(a) * 12,
        ex + Math.cos(a + 2.4) * 10, ey + Math.sin(a + 2.4) * 10,
        ex + Math.cos(a - 2.4) * 10, ey + Math.sin(a - 2.4) * 10,
      );
    }
  }

  private pushHud() {
    this.hud.update({
      hp: this.hp,
      shield: this.shield,
      stamina: this.stamina,
      timeLeft: RAID_SECONDS - this.t,
      alarm: this.alarm,
      party: this.party.map((c) => ({
        species: c.spec.id, hp: c.hp, maxHp: c.maxHp, downed: c.downed, moveCd: c.moveCd,
        moveMax: MOVE_COOLDOWN[c.spec.move], recruit: c.recruit, scar: c.scar?.id,
      })),
      supplies: this.supplies,
      loot: this.loot,
      prompt: this.prompt,
      progress: this.searching ? this.searchT / 1.4 : 0,
      boss: this.titan && !this.titan.dead && dist(this.titan.sprite, this.trainer) < 1100
        ? { name: 'TITAN', frac: this.titan.hp / this.titan.maxHp }
        : null,
    });
  }

  // ------------------------------------------------------------------ end

  private endRaid(outcome: RaidResult['outcome']) {
    if (this.ended) return;
    this.ended = true;
    this.pushHud();
    this.physics.pause();
    const result: RaidResult = {
      outcome,
      recruits: this.party.filter((c) => c.recruit).map((c) => ({ species: c.spec.id, feralUid: c.feralUid })),
      loot: this.loot,
      leftover: this.supplies,
      seen: [...this.seen],
      kills: this.kills,
      seconds: Math.round(this.t),
    };
    const cam = this.cameras.main;
    if (outcome === 'extracted') cam.flash(300, 255, 230, 180);
    else {
      cam.shake(300, 0.01);
      this.trainer.setVelocity(0, 0).clearTint().play('r_death');
    }
    cam.fadeOut(outcome === 'extracted' ? 1100 : 1800, 0, 0, 0);
    cam.once('camerafadeoutcomplete', () => {
      this.scene.stop();
      this.game.events.emit('raid-end', result);
    });
  }
}
