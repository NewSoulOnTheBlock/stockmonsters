export interface Supplies {
  medkit: number;
  cell: number;
  lure: number;
  key: number;
}

export interface Stash extends Supplies {
  scrap: number;
}

export interface Bonded {
  uid: string;
  species: string;
  scar?: string;
}

export interface Save {
  v: 1;
  partner: string | null;
  bonded: Bonded[];
  /** Bonded creatures lost on a death; they wait in the wild to be won back. */
  feral: Bonded[];
  stash: Stash;
  seen: string[];
  log: string[];
  raids: number;
  extracts: number;
  deaths: number;
}

const KEY = 'harrow.save.v1';

export const emptySupplies = (): Supplies => ({ medkit: 0, cell: 0, lure: 0, key: 0 });

export function fresh(): Save {
  return {
    v: 1,
    partner: null,
    bonded: [],
    feral: [],
    stash: { scrap: 0, medkit: 2, cell: 1, lure: 1, key: 0 },
    seen: [],
    log: [],
    raids: 0,
    extracts: 0,
    deaths: 0,
  };
}

export function load(): Save {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Save;
      if (s.v === 1) return s;
    }
  } catch {
    // private mode or corrupt data: start over
  }
  return fresh();
}

export function persist(s: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable; the run still works for this session
  }
}

export function wipe() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function addUnique(list: string[], v: string) {
  if (!list.includes(v)) list.push(v);
}
