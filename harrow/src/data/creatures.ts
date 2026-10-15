import roster from './roster.json';

export type Rarity = 'starter' | 'common' | 'uncommon' | 'rare';
export type MoveKind =
  | 'chain' | 'surge' | 'quake' | 'pounce' | 'snare' | 'ward'
  | 'flare' | 'phase' | 'freeze' | 'bolt' | 'bulwark' | 'hijack';
export type HarrowKind = 'mite' | 'watcher' | 'crusher' | 'crawler' | 'titan';

export interface Species {
  id: string;
  dexId: number;
  name: string;
  types: string[];
  rarity: Rarity;
  hp: number;
  atk: number;
  /** attacks per second */
  rate: number;
  /** <= 60 means melee */
  range: number;
  speed: number;
  move: MoveKind;
  moveName: string;
}

export const SPECIES = roster as Species[];
export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));
export const STARTERS = SPECIES.filter((s) => s.rarity === 'starter');

export const isMelee = (s: Species) => s.range <= 60;

/** Creature type -> damage multiplier against each Harrow unit (DESIGN.md). */
const VS_HARROW: Record<string, Record<HarrowKind, number>> = {
  Volt: { mite: 1.5, watcher: 2.0, crusher: 1.3, crawler: 1.3, titan: 1.3 },
  Tide: { mite: 1.0, watcher: 1.0, crusher: 1.5, crawler: 1.0, titan: 1.5 },
  Terra: { mite: 1.2, watcher: 0.5, crusher: 1.5, crawler: 1.2, titan: 1.5 },
  Blaze: { mite: 1.5, watcher: 1.0, crusher: 0.75, crawler: 1.3, titan: 0.75 },
  Frost: { mite: 1.0, watcher: 1.2, crusher: 1.25, crawler: 1.2, titan: 1.25 },
  Combat: { mite: 1.2, watcher: 0.6, crusher: 1.0, crawler: 1.3, titan: 1.0 },
  Spectre: { mite: 1.0, watcher: 1.3, crusher: 1.0, crawler: 1.0, titan: 1.0 },
  Alloy: { mite: 0.75, watcher: 0.75, crusher: 0.75, crawler: 0.75, titan: 0.75 },
};
const NEUTRAL = { mite: 1, watcher: 1, crusher: 1, crawler: 1, titan: 1 };

/** A dual type uses whichever of its types hits harder. */
export function typeMult(types: string[], kind: HarrowKind): number {
  return Math.max(...types.map((t) => (VS_HARROW[t] ?? NEUTRAL)[kind]));
}

/** Alloy creatures take half damage from the Harrow. */
export const harrowDamageTaken = (types: string[]) => (types.includes('Alloy') ? 0.5 : 1);

export const MOVE_COOLDOWN: Record<MoveKind, number> = {
  chain: 8, surge: 12, quake: 10, pounce: 7, snare: 11, ward: 14,
  flare: 9, phase: 8, freeze: 12, bolt: 8, bulwark: 14, hijack: 18,
};

export const MOVE_DESC: Record<MoveKind, string> = {
  chain: 'Lightning jumps between up to 4 machines.',
  surge: 'Heals you and the party, shoves machines back.',
  quake: 'Damages and slows ground machines nearby.',
  pounce: 'Leaps onto a machine for a heavy hit.',
  snare: 'Thorns slow and poison machines in an area.',
  ward: 'Gives you 35 shield.',
  flare: 'Burst of fire around itself.',
  phase: 'Blinks to a machine and strikes hard.',
  freeze: 'Freezes machines nearby in place.',
  bolt: 'A piercing shot that hits everything in a line.',
  bulwark: 'Taunts machines and halves damage taken.',
  hijack: 'Seizes a machine; it fights for you briefly.',
};

export interface Scar {
  id: string;
  name: string;
  desc: string;
  hp: number;
  atk: number;
  speed: number;
}

/** Earned by a creature won back after going feral. Upside and downside. */
export const SCARS: Scar[] = [
  { id: 'torn', name: 'Torn Hide', desc: '+25% HP, -10% speed', hp: 1.25, atk: 1, speed: 0.9 },
  { id: 'overclocked', name: 'Overclocked', desc: '+25% attack, -15% HP', hp: 0.85, atk: 1.25, speed: 1 },
  { id: 'grudge', name: 'Machine Grudge', desc: '+20% attack, -10% speed', hp: 1, atk: 1.2, speed: 0.9 },
  { id: 'skittish', name: 'Skittish', desc: '+20% speed, -10% attack', hp: 1, atk: 0.9, speed: 1.2 },
];
export const SCAR_BY_ID: Record<string, Scar> = Object.fromEntries(SCARS.map((s) => [s.id, s]));

export const TYPE_COLOR: Record<string, number> = {
  Volt: 0xf5d442, Tide: 0x3fa7e0, Terra: 0xb08850, Blaze: 0xf06a2b, Frost: 0x9fe3ff,
  Combat: 0xd84a4a, Spectre: 0x9a7bd8, Alloy: 0xb8c2cc, Psionic: 0xe05bd0, Fae: 0xf2a6d8,
  Shadow: 0x6b5b8a, Toxic: 0x8fd14f, Wyrm: 0x6a5cff, Neutral: 0xcfc6b0,
};
export const typeColor = (types: string[]) => TYPE_COLOR[types[0]] ?? 0xffffff;
export const cssColor = (n: number) => '#' + n.toString(16).padStart(6, '0');
