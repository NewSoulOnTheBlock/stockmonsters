/*
 * chain-guard.ts — a typed shim over public/chain-guard.js.
 *
 * The logic lives in public/chain-guard.js, not here, because the title screen
 * in index.html is plain inline script and cannot import a module. One
 * implementation, two callers; this side just gives the bundled UI types and a
 * safe answer when the script did not load.
 *
 * Use it immediately before anything that signs or sends:
 *
 *     await ensureChain(eth)      // throws with a player-readable message
 *     await eth.request({ method: 'eth_sendTransaction', params: [tx] })
 */

export interface ChainInfo {
  chainId: number
  name: string
  explorer: string | null
}

/** Every failure carries a code so callers need not parse a wallet's prose. */
export type ChainFailure =
  | 'no-wallet'
  | 'no-config'
  | 'rejected'
  | 'cannot-add'
  | 'wrong-chain'

export interface ChainError extends Error {
  smCode?: ChainFailure
}

interface Guard {
  expected(): Promise<ChainInfo>
  current(eth: any): Promise<number>
  ensure(eth: any): Promise<number>
  explorerTx(hash: string): string | null
}

const guard = (): Guard | null => (globalThis as any).SMChain ?? null

/**
 * Put the wallet on the chain the server signs for, or throw saying why.
 *
 * When the guard script is missing this does NOT silently pass: a page that
 * cannot check the network is a page that can broadcast a Sepolia-signed
 * transaction to mainnet, and failing loudly here is much cheaper.
 */
export async function ensureChain(eth: any): Promise<number> {
  const g = guard()
  if (!g) {
    const err: ChainError = new Error('The network check did not load — reload the page before transacting.')
    err.smCode = 'no-config'
    throw err
  }
  return g.ensure(eth)
}

/** What chain the server expects, or null if it will not say. */
export async function expectedChain(): Promise<ChainInfo | null> {
  try {
    return (await guard()?.expected()) ?? null
  } catch {
    return null
  }
}

/** A block explorer link for a transaction, or null on a chain without one. */
export function explorerTx(hash: string): string | null {
  try {
    return guard()?.explorerTx(hash) ?? null
  } catch {
    return null
  }
}

/** The message to show a player. Wallet errors are noisy; these are not. */
export function chainErrorMessage(err: unknown): string {
  const e = err as ChainError
  if (e?.smCode) return e.message
  return e?.message ?? 'Could not reach your wallet.'
}
