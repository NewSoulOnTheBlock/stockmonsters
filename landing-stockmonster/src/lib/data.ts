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
 * contracts. See stockmonsters-mmo/deployments/*.json and docs/token-economy.md.
 *
 * NOTHING HERE MAY DESCRIBE A TOKEN THAT IS NOT DEPLOYED AS IF IT WERE, and
 * no address may survive its token. A first launch on Robinhood Chain was
 * abandoned, and a live tradeable contract nobody supports is worse to publish
 * than no contract at all, because somebody copies it off this page and buys
 * it. The relaunched token below was read back off the chain — `symbol()`,
 * `name()`, `decimals()`, `totalSupply()` — not copied from a deploy script.
 *
 * The GAME's contracts (treasury, rewards, NFT, marketplace, gyms, arena) are
 * deliberately absent: that set is being redeployed and none of it is publish-
 * able yet. Only the token address is live and correct.
 *
 * The rule the whole thing rests on: THE GAME NEVER MINTS. Supply is fixed and
 * there is no mint function, so every reward is a claim on a pool that already
 * exists. If a feature seems to need new supply, it is an economy bug.
 */
export const ECONOMY = {
  /** Live. The token and the game's contracts are both on Robinhood Chain. */
  network: "Robinhood Chain",
  /**
   * THE ONLY PLACE THE TICKER IS WRITTEN. Every rendered mention of it on the
   * site reads this value — hero pill, play-to-earn cards, FAQ — so the
   * relaunch is a one-word edit here, and nothing needs finding.
   *
   * No leading `$`: the abandoned launch went out as STONKSTERS, bare, and the
   * planning documents that say `$STONKSTER` were wrong about both the prefix
   * and the trailing S. Whatever the relaunch deploys, put the exact
   * `symbol()` string here and nothing else.
   */
  symbol: "STONKSTERS",
  /** The token's full name, as the launchpad deploys it. */
  name: "Stock Monsters",
  /**
   * THE ONE LINE THAT FLIPS THE SITE BETWEEN "LAUNCHED" AND NOT.
   *
   * Empty → the hero's CA field reads NOT DEPLOYED and is inert. A 0x… string
   * → the same field shows the address with a copy button. Nothing else needs
   * to change either way, which is the point: it costs nothing to blank this
   * the moment an address stops being the right one.
   *
   * The copy button exists to be pasted into a wallet, so a wrong value here
   * spends somebody's money. This is the RELAUNCHED token, verified against
   * chain 4663; the abandoned first launch, 0xf30e…CE7a, must never reappear.
   *
   * Typed `as string` on purpose — without it the literal would narrow and
   * TypeScript would treat the NOT DEPLOYED branch as dead code.
   */
  address: "0x01B4eCB3255D5eB29b4427CA149e860b5fd7472B" as string,
  /** Where it launches. The chain id is 4663. */
  chain: "Robinhood Chain",
  chainId: 4663,
  supply: "1,000,000,000",
  /** Trading tax, buy and sell. Wallet-to-wallet is free. */
  taxPercent: 2,
  /**
   * Share of revenue that goes back to players — the treasury's live
   * `playerShareBps`, 5000. The treasury splits every pound it receives in
   * half: one half buys the token on the open market and every token bought
   * goes to the reward pool, the other funds operations.
   *
   * The split has a floor in the contract (`MIN_PLAYER_SHARE_BPS`, 2500), so
   * players can never be cut below a quarter. It was 75 under the old
   * self-issued token, which taxed transfers straight into the pool. That
   * mechanism no longer exists — do not describe it anywhere on the site.
   */
  taxToPlayersPercent: 50,
  /** The contract's hard floor under the players' share. */
  minPlayerSharePercent: 25,
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

/**
 * The chain's block explorer, and the token's page on it — the one link that
 * lets a reader check the pill instead of trusting it. Derived from
 * `ECONOMY.address`, so it can never point at a different token than the pill
 * does, and it is only ever rendered when that address is non-empty.
 */
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const TOKEN_EXPLORER_URL = `${EXPLORER_URL}/address/${ECONOMY.address}`;
