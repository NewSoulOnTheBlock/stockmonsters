/*
 * 18x18 type effectiveness from Studio data (docs/psdk-mechanics.md §1.7.3).
 * types.json lists only non-1 matchups; anything missing is 1 — never 0.
 * `null`/undefined defender type (mono-type creatures) is always 1.
 */
import typesRaw from '../data/studio/types.json'

const chart = typesRaw as Record<string, Record<string, number>>

export const TYPE_SYMBOLS = Object.keys(chart)

export function typeMultiplier(attacking: string, defending: string | null | undefined): number {
  if (!defending) return 1
  return chart[attacking]?.[defending] ?? 1
}

/** Combined multiplier of one attacking type against a full defender typing. */
export function effectiveness(attacking: string, defenderTypes: (string | null | undefined)[]): number {
  return defenderTypes.reduce<number>((m, t) => m * typeMultiplier(attacking, t), 1)
}
