import Phaser from 'phaser';
import './style.css';
import { Boot } from './scenes/Boot';
import { Raid } from './scenes/Raid';
import { Burrow } from './ui/burrow';
import type { RaidResult } from './game/types';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#050608',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [Boot, Raid],
});

const burrow = new Burrow(document.getElementById('ui')!, (cfg) => game.scene.start('Raid', cfg));
game.events.once('ready', () => burrow.show());
game.events.on('raid-end', (r: RaidResult) => burrow.onRaidEnd(r));

if (import.meta.env.DEV) Object.assign(window, { game });
