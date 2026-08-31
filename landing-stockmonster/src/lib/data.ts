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

/**
 * Where the Play button goes. This pointed at game.stockmonsters.com, which
 * has never resolved — the game is live on the box that already had a
 * certificate. Change it here and every button follows.
 */
export const PLAY_URL = "https://game.stockmonsters.xyz/";

export const TWITTER_URL = "https://x.com/stonksters";

/**
 * The economy, in one place, so the copy on the site cannot drift from the
 * contracts. Every number here is the deployed one — see
 * stockmonsters-mmo/deployments/sepolia.json and docs/token-economy.md.
 *
 * The rule the whole thing rests on: THE GAME NEVER MINTS. Supply is fixed and
 * there is no mint function, so every reward is a claim on a pool that already
 * exists. If a feature seems to need new supply, it is an economy bug.
 */
export const ECONOMY = {
  /** Live. The token and the game's contracts are both on Robinhood Chain. */
  network: "Robinhood Chain",
  /**
   * The token's ticker, read off the deployed contract rather than the plan:
   * it launched as STONKSTERS, with no leading `$` and a trailing S. Anything
   * that renders a `$` in front of it is adding a currency prefix of its own.
   */
  symbol: "STONKSTERS",
  /** The token's full name, as the launchpad deploys it. */
  name: "Stock Monsters",
  /**
   * THE ONE LINE THAT FLIPS THE SITE TO "LAUNCHED".
   *
   * Empty string until the pons launchpad deploys the token on Robinhood
   * Chain. While it is empty the hero's CA field reads NOT DEPLOYED and is
   * inert; paste the 0x… string in here and the same field starts showing
   * the address with a copy button. Nothing else needs to change.
   *
   * Typed `as string` on purpose — without it the literal `""` would narrow
   * and TypeScript would treat the deployed branch as dead code.
   */
  address: "0xf30e4f2E1E715A77ceCade62F236c6d39dA0CE7a" as string,
  /** Where it launches. The chain id is 4663. */
  chain: "Robinhood Chain",
  chainId: 4663,
  supply: "1,000,000,000",
  /** Trading tax, buy and sell. Wallet-to-wallet is free. */
  taxPercent: 2,
  /**
   * Share of revenue that goes back to players. The treasury splits every
   * pound it receives in half: one half buys the token on the open market and
   * every token bought goes to the reward pool, the other funds operations.
   * The split has a floor in the contract — players can never be cut below a
   * quarter — and was 75 under the old self-issued token, which taxed
   * transfers directly into the pool. It does not do that any more.
   */
  taxToPlayersPercent: 50,
  /** Marketplace protocol fee, hard-capped at 5% in the contract. */
  marketFeePercent: 2.5,
  /** Creator royalty on a secondary sale (ERC-2981). */
  royaltyPercent: 5,
  /** What a seller keeps of the sale price. */
  sellerKeepsPercent: 92.5,
  /** Daily quests on the board. */
  questCount: 5,
  /** What the daily board is worth, in dollars, at target pricing. */
  questBoardUsd: "$7",
  /** Sealed loot boxes, cheapest to dearest, at target pricing. */
  boxUsd: ["$30", "$90", "$240"],
  /** The launch valuation every in-game dollar figure is priced from. */
  launchMarketCap: "$200k",
} as const;
