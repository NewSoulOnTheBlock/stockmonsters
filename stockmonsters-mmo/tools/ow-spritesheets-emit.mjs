/*
 * Shared emitter for src/data/ow-spritesheets.ts, used by BOTH
 * tools/import-overworld.mjs (real PSDK charsets) and tools/gen-ow.mjs
 * (fallback charsets from dex front art). It scans public/spritesheets/ow/
 * so the emitted list is always exactly the sheets on disk, no matter which
 * generator ran last.
 */
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Rewrites src/data/ow-spritesheets.ts from the sheets on disk; returns the count. */
export function emitOwSpritesheets(root) {
  const tickers = readdirSync(join(root, 'public/spritesheets/ow'))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4))
    .sort()
  // No @rpgjs/client import here: the server module reads this file too, and
  // pulling the client package into the Node graph breaks the mmorpg build
  // ("window is not defined" from canvasengine).
  writeFileSync(join(root, 'src/data/ow-spritesheets.ts'), [
    '// GENERATED — do not edit by hand. Emitted from a scan of',
    '// public/spritesheets/ow/ by tools/import-overworld.mjs (real PSDK',
    '// charsets) and tools/gen-ow.mjs (fallback charsets from dex front art)',
    '// via tools/ow-spritesheets-emit.mjs; either script re-running emits the',
    '// same full list.',
    `export const OW_TICKERS = ${JSON.stringify(tickers)} as const`,
    '',
  ].join('\n'))
  return tickers.length
}
