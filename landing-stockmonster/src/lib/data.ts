import creaturesRaw from "@/data/creatures.json";
import memesRaw from "@/data/memes.json";
import typesRaw from "@/data/types.json";

export type Stats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

export type Creature = {
  id: number;
  ticker: string;
  name: string;
  company: string;
  address: string;
  types: string[];
  species: string | null;
  description: string | null;
  stats: Stats | null;
  bst: number | null;
  height: number | null;
  weight: number | null;
  catchRate: number | null;
  /** cosmetic, deterministic from the contract address — never a real quote */
  drift: number;
};

export type Meme = {
  id: number;
  ticker: string;
  name: string;
  company: string;
  types: string[];
  species: string | null;
  description: string | null;
  subject: string | null;
  stats: Stats | null;
  bst: number | null;
};

export type ElementType = {
  name: string;
  color: string;
  blurb: string;
  /**
   * Multiplier when this type ATTACKS the keyed type. The generator only writes
   * the pairs that differ from neutral, so the map is sparse and any absent key
   * means 1x — read it through `effectiveness()`, never raw.
   */
  damageTo: Partial<Record<string, number>>;
  index: number;
};

export const CREATURES: Creature[] = creaturesRaw;
export const MEMES: Meme[] = memesRaw;
export const TYPES: ElementType[] = typesRaw;

export const TYPE_BY_NAME = Object.fromEntries(TYPES.map((t) => [t.name, t])) as Record<
  string,
  ElementType
>;

export const CREATURE_BY_TICKER = Object.fromEntries(
  CREATURES.map((c) => [c.ticker, c])
) as Record<string, Creature>;

/** The game's own starter slots: dex 1 / 4 / 7 landed on Apple, NVIDIA, Tesla. */
export const STARTER_TICKERS = ["AAPL", "NVDA", "TSLA"] as const;

export const STAT_LABELS: Array<[keyof Stats, string, string]> = [
  ["hp", "HP", "Float"],
  ["atk", "ATK", "Buy pressure"],
  ["def", "DEF", "Support"],
  ["spa", "SP.ATK", "Narrative"],
  ["spd", "SP.DEF", "Conviction"],
  ["spe", "SPD", "Fill speed"],
];

/**
 * Power tier, bucketed from the real base-stat total that ships in
 * Data/Studio/pokemon/*.json. Not invented — just renamed for the theme.
 */
export type Tier = "Small Cap" | "Mid Cap" | "Blue Chip";

export function tierOf(bst: number | null): Tier {
  if (bst === null) return "Small Cap";
  if (bst >= 460) return "Blue Chip";
  if (bst >= 320) return "Mid Cap";
  return "Small Cap";
}

export const TIERS: Tier[] = ["Small Cap", "Mid Cap", "Blue Chip"];

/** Defensive multiplier a creature with `defTypes` takes from `attacker`. */
export function effectiveness(attacker: string, defTypes: string[]): number {
  const chart = TYPE_BY_NAME[attacker]?.damageTo ?? {};
  return defTypes.reduce((m, d) => m * (chart[d] ?? 1), 1);
}

export type Matchups = { weak: Array<[string, number]>; resist: Array<[string, number]> };

/** Full defensive profile for one creature, computed off the shipped chart. */
export function matchups(defTypes: string[]): Matchups {
  const weak: Array<[string, number]> = [];
  const resist: Array<[string, number]> = [];
  for (const t of TYPES) {
    const m = effectiveness(t.name, defTypes);
    if (m > 1) weak.push([t.name, m]);
    else if (m < 1) resist.push([t.name, m]);
  }
  weak.sort((a, b) => b[1] - a[1]);
  resist.sort((a, b) => a[1] - b[1]);
  return { weak, resist };
}

export function spriteUrl(id: number, kind: "mon" | "meme" = "mon") {
  return `/${kind}/${id}.png`;
}

export function shortAddress(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export const PLAY_URL = "https://game.stockmonsters.com/";
