export type BallType = 'regular' | 'great' | 'ultra';

export interface BallConfig {
  readonly name: string;
  /** Mint price in ETH. */
  readonly priceEth: number;
  /** Multiplier applied to the catch-rate formula (classic Poké Ball=1, Great Ball=1.5, Ultra Ball=2). */
  readonly catchBonus: number;
}

export const BALL_CONFIG: Record<BallType, BallConfig> = {
  regular: { name: 'Stock Ball', priceEth: 0.002, catchBonus: 1 },
  great: { name: 'Great Stock Ball', priceEth: 0.006, catchBonus: 1.5 },
  ultra: { name: 'Ultra Stock Ball', priceEth: 0.01, catchBonus: 2 },
};
