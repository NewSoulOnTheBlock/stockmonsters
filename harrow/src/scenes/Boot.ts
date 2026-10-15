import Phaser from 'phaser';
import { SPECIES } from '../data/creatures';
import raider from '../data/raider.json';
import shardcrawler from '../data/shardcrawler.json';
import titan from '../data/titan.json';

/**
 * Loads creature art and draws every other texture in code: the Harrow,
 * terrain and props are all procedural so the slice ships without any
 * third-party tilesets.
 */
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    for (const s of SPECIES) this.load.image(`c_${s.id}`, `assets/creatures/${s.id}.png`);
    this.load.spritesheet('raider', 'assets/raider.png', { frameWidth: raider.frameWidth, frameHeight: raider.frameHeight });
    this.load.spritesheet('shardcrawler', 'assets/shardcrawler.png', { frameWidth: shardcrawler.frameWidth, frameHeight: shardcrawler.frameHeight });
    this.load.image('shard', 'assets/shardcrawler-shard.png');
    this.load.spritesheet('titan', 'assets/titan.png', { frameWidth: titan.frameWidth, frameHeight: titan.frameHeight });
  }

  create() {
    this.makeGround();
    this.makeLight();
    this.makeShadow();
    this.makeRaiderAnims();
    this.makeMite();
    this.makeWatcher();
    this.makeCrusher();
    this.makeProps();
    this.game.events.emit('ready');
  }

  private g() {
    return this.make.graphics({}, false);
  }

  private makeGround() {
    const size = 256;
    const tex = this.textures.createCanvas('ground', size, size)!;
    const ctx = tex.getContext();
    ctx.fillStyle = '#2b2820';
    ctx.fillRect(0, 0, size, size);
    const rnd = new Phaser.Math.RandomDataGenerator(['ground']);
    const dirt = ['#322e24', '#25221a', '#383327', '#211e17', '#2f2b21'];
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = rnd.pick(dirt);
      const s = rnd.between(1, 3);
      ctx.fillRect(rnd.between(0, size), rnd.between(0, size), s, s);
    }
    // dead leaf litter and ash
    const litter = ['#4a3c22', '#5a4628', '#3a3d26', '#4b4436'];
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = rnd.pick(litter);
      ctx.fillRect(rnd.between(0, size), rnd.between(0, size), rnd.between(2, 4), rnd.between(1, 2));
    }
    tex.refresh();
  }

  private makeLight() {
    const r = 256;
    const tex = this.textures.createCanvas('light', r * 2, r * 2)!;
    const ctx = tex.getContext();
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, r * 2, r * 2);
    tex.refresh();

    const glow = this.textures.createCanvas('glow', 64, 64)!;
    const gc = glow.getContext();
    const gg = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
    gg.addColorStop(0, 'rgba(255,255,255,1)');
    gg.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    gc.fillStyle = gg;
    gc.fillRect(0, 0, 64, 64);
    glow.refresh();
  }

  private makeShadow() {
    const s = this.g();
    s.fillStyle(0x000000, 0.45).fillEllipse(32, 12, 60, 20);
    s.generateTexture('shadow', 64, 24);
    s.destroy();
  }

  /** Frame ranges come from scripts/slice-sheets.py via each sheet's json. */
  private makeRaiderAnims() {
    this.sheetAnims('raider', 'r', raider.anims, {
      idle: [6, -1], walk: [11, -1], run: [13, -1], crouch: [7, -1], jump: [16, 0], hurt: [10, 0], death: [6, 0],
    });
    this.sheetAnims('shardcrawler', 'sc', shardcrawler.anims, {
      idle: [7, -1], walk: [10, -1], run: [14, -1], lunge: [18, 0], spit: [10, 0], hurt: [16, 0], death: [9, 0],
    });
    // the Titan's slam is timed so the impact frame lands as the ring fires (~1.1s)
    this.sheetAnims('titan', 'ti', titan.anims, {
      idle: [5, -1], run: [6, -1], charge: [4, 0], fire: [10, 0], slam: [4, 0], hurt: [10, 0], death: [4, 0],
    });
  }

  private sheetAnims(
    texture: string,
    prefix: string,
    anims: Record<string, { start: number; count: number }>,
    rate: Record<string, [frameRate: number, repeat: number]>,
  ) {
    for (const [name, a] of Object.entries(anims)) {
      const [frameRate, repeat] = rate[name];
      this.anims.create({
        key: `${prefix}_${name}`,
        frames: this.anims.generateFrameNumbers(texture, { start: a.start, end: a.start + a.count - 1 }),
        frameRate,
        repeat,
      });
    }
  }

  private makeMite() {
    const g = this.g();
    g.lineStyle(2, 0x3a3d42);
    for (const [x1, y1, x2, y2] of [[3, 4, 9, 9], [21, 4, 15, 9], [2, 14, 9, 12], [22, 14, 15, 12], [4, 21, 9, 15], [20, 21, 15, 15]]) {
      g.lineBetween(x1, y1, x2, y2);
    }
    g.fillStyle(0x4a4f57).fillCircle(12, 12, 6);
    g.fillStyle(0x24272c).fillCircle(12, 12, 4);
    g.fillStyle(0xff3b30).fillCircle(12, 11, 1.8);
    g.generateTexture('mite', 24, 24);
    g.destroy();
  }

  private makeWatcher() {
    const g = this.g();
    g.fillStyle(0x30343b).fillCircle(20, 20, 13);
    g.lineStyle(2, 0x5a616b).strokeCircle(20, 20, 13);
    g.fillStyle(0x15171a).fillCircle(20, 20, 8);
    g.fillStyle(0xff2d20).fillCircle(20, 20, 4);
    g.fillStyle(0xffd0c8).fillCircle(19, 19, 1.5);
    g.fillStyle(0x5a616b).fillRect(2, 18, 6, 4).fillRect(32, 18, 6, 4);
    g.generateTexture('watcher', 40, 40);
    g.destroy();
  }

  private makeCrusher() {
    const g = this.g();
    // treads
    g.fillStyle(0x1e2024).fillRect(4, 8, 14, 56).fillRect(54, 8, 14, 56);
    g.fillStyle(0x34373d);
    for (let y = 10; y < 62; y += 6) g.fillRect(5, y, 12, 3).fillRect(55, y, 12, 3);
    // hull
    g.fillStyle(0x4b4f55).fillRoundedRect(14, 12, 44, 48, 6);
    g.fillStyle(0x5d6268).fillRoundedRect(20, 18, 32, 30, 4);
    g.lineStyle(2, 0x2a2c30).strokeRoundedRect(14, 12, 44, 48, 6);
    // rivets and the sensor slit
    g.fillStyle(0x2a2c30);
    for (const [x, y] of [[18, 16], [54, 16], [18, 56], [54, 56]]) g.fillCircle(x, y, 1.5);
    g.fillStyle(0x110f0f).fillRect(26, 22, 20, 6);
    g.fillStyle(0xff3b30).fillRect(28, 23, 16, 3);
    g.generateTexture('crusher', 72, 72);
    g.destroy();
  }

  private makeProps() {
    // dead tree, seen from above: a dark trunk with bare branches
    const t = this.g();
    t.lineStyle(3, 0x5a4630);
    const branches = [[32, 32, 8, 12], [32, 32, 56, 10], [32, 32, 6, 46], [32, 32, 58, 50], [32, 32, 30, 4], [32, 32, 36, 60]];
    for (const [x1, y1, x2, y2] of branches) t.lineBetween(x1, y1, x2, y2);
    t.lineStyle(1.5, 0x6e573a);
    for (const [, , x2, y2] of branches) t.lineBetween(x2, y2, x2 + 6, y2 - 4).lineBetween(x2, y2, x2 - 5, y2 + 3);
    t.fillStyle(0x3d2f1f).fillCircle(32, 32, 9);
    t.fillStyle(0x5a4630).fillCircle(31, 31, 6);
    t.generateTexture('tree', 64, 64);
    t.destroy();

    const r = this.g();
    r.fillStyle(0x4a4a46).fillEllipse(24, 20, 44, 32);
    r.fillStyle(0x5e5e58).fillEllipse(21, 17, 30, 20);
    r.fillStyle(0x74746c).fillEllipse(18, 14, 12, 7);
    r.generateTexture('rock', 48, 40);
    r.destroy();

    const w = this.g();
    w.fillStyle(0x4d463b).fillRect(0, 0, 32, 32);
    w.fillStyle(0x6a6152).fillRect(1, 1, 14, 6).fillRect(17, 1, 14, 6).fillRect(1, 9, 8, 6).fillRect(11, 9, 14, 6);
    w.fillRect(27, 9, 4, 6).fillRect(1, 17, 14, 6).fillRect(17, 17, 14, 6).fillRect(1, 25, 8, 6).fillRect(11, 25, 14, 6);
    w.generateTexture('wall', 32, 32);
    w.destroy();

    const c = this.g();
    c.fillStyle(0x3d3020).fillRect(2, 4, 28, 22);
    c.fillStyle(0x5a4628).fillRect(4, 6, 24, 8);
    c.lineStyle(2, 0x241b10).strokeRect(2, 4, 28, 22);
    c.fillStyle(0x9a8a5a).fillRect(14, 12, 4, 5);
    c.generateTexture('cache', 32, 30);
    c.destroy();

    const o = this.g();
    o.fillStyle(0x221f19).fillRect(2, 4, 28, 22);
    o.lineStyle(2, 0x15130f).strokeRect(2, 4, 28, 22);
    o.generateTexture('cache_open', 32, 30);
    o.destroy();

    const l = this.g();
    l.fillStyle(0x23272b).fillRect(0, 0, 80, 80);
    l.lineStyle(3, 0x5a6168).strokeRect(2, 2, 76, 76);
    l.lineStyle(2, 0xc9a227);
    for (let i = 0; i < 80; i += 10) l.lineBetween(i, 0, i + 8, 8).lineBetween(i, 72, i + 8, 80);
    l.fillStyle(0x15181b).fillRect(16, 16, 48, 48);
    l.lineStyle(1, 0x3a4047);
    for (let i = 20; i < 64; i += 8) l.lineBetween(16, i, 64, i);
    l.generateTexture('lift', 80, 80);
    l.destroy();

    const h = this.g();
    h.fillStyle(0x2a2d31).fillCircle(24, 24, 22);
    h.lineStyle(3, 0x6c737a).strokeCircle(24, 24, 22);
    h.fillStyle(0x1a1c1f).fillCircle(24, 24, 15);
    h.lineStyle(3, 0x8a6f2a).lineBetween(12, 24, 36, 24).lineBetween(24, 12, 24, 36);
    h.generateTexture('hatch', 48, 48);
    h.destroy();

    const lure = this.g();
    lure.fillStyle(0x5b5f66).fillRect(6, 4, 12, 16);
    lure.fillStyle(0x7fffd4).fillCircle(12, 8, 3);
    lure.generateTexture('lure', 24, 24);
    lure.destroy();

    const dot = this.g();
    dot.fillStyle(0xffffff).fillCircle(6, 6, 6);
    dot.generateTexture('dot', 12, 12);
    dot.destroy();
  }
}
