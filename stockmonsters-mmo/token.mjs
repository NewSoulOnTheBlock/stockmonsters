/*
 * token.mjs — the game's side of the currency.
 *
 *   GET  /token                      what the token IS (read off the chain)
 *   GET  /token/balance?address=…    a player's SMON and ETH
 *   GET  /rewards/mine?…             what this player has earned and can claim
 *   POST /rewards/claim              a signed claim they submit themselves
 *
 * ## One address configures everything
 *
 * `SM_TOKEN_ADDRESS` is the only thing that has to be set. Name, symbol,
 * decimals and logo are READ FROM THE TOKEN, which describes itself on chain —
 * so nothing in this codebase hardcodes "SMON", and swapping in a different
 * launch token later is one variable, not a search-and-replace.
 *
 * The four standard ERC-20 calls are required; `logo`, `description`,
 * `liquidityPool` and `socials` are read in their own try/catch, because a
 * plain ERC-20 does not have them and that is not an error.
 *
 * ## Degradation is a feature, again
 *
 * No address, no RPC, or a dead node: every endpoint answers with
 * `configured: false` and the UI hides the currency instead of inventing a
 * number. Exactly the rule the rest of the server follows — an unbuilt or
 * unconfigured thing says so.
 *
 * ## Rewards
 *
 * The pool contract pays out against a claim signed by REWARDS_SIGNER_PK, and
 * bounds the damage with a per-epoch budget (see StockmonstersRewards.sol).
 * This file decides the AMOUNT: it is the sum of what the player earned in
 * game this epoch, held in their profile row. The signer key is not the box
 * signer — a leak of one is not a leak of both.
 *
 * On chain a player may claim ONCE per epoch, so re-signing the same
 * (epoch, amount) is harmless and re-issuing after a failed transaction is the
 * intended flow. Earnings that arrive after a claim land in the next epoch.
 */
import { createPublicClient, http, parseAbi, formatUnits, parseUnits, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { timingSafeEqual } from 'node:crypto'
import { connectionIdFor } from './auth.mjs'

/* ------------------------------------------------------------- reading ---*/

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])

// The launch token's own extensions. Optional by design.
const SELF_DESCRIBING_ABI = parseAbi([
  'function logo() view returns (string)',
  'function description() view returns (string)',
  'function liquidityPool() view returns (address)',
  'function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)',
])

const REWARDS_ABI = parseAbi([
  'function epochBudget(uint256) view returns (uint256)',
  'function epochClaimed(uint256) view returns (uint256)',
  'function claimed(uint256, address) view returns (bool)',
  'function balance() view returns (uint256)',
])

const CLAIM_TYPE = [
  { name: 'player', type: 'address' },
  { name: 'epoch', type: 'uint256' },
  { name: 'amount', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
]

const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)

/** How long a signed claim stays valid. Long enough to approve and send. */
const CLAIM_TTL_S = 30 * 60

/* --------------------------------------------------------------- store ---*/

/**
 * @param {object} [opts]
 * @param {string|null} [opts.tokenAddress]   defaults to SM_TOKEN_ADDRESS
 * @param {string|null} [opts.rewardsAddress] defaults to SM_REWARDS_ADDRESS
 * @param {string|null} [opts.rpcUrl]         defaults to SM_RPC_URL
 * @param {number} [opts.chainId]             defaults to SM_CHAIN_ID
 * @param {string|null} [opts.signerPk]       defaults to REWARDS_SIGNER_PK
 * @param {object} [opts.log]
 */
export function createTokenStore(opts = {}) {
  const log = opts.log ?? console
  const tokenAddress = pick(opts, 'tokenAddress', process.env.SM_TOKEN_ADDRESS)
  const rewardsAddress = pick(opts, 'rewardsAddress', process.env.SM_REWARDS_ADDRESS)
  const treasuryAddress = pick(opts, 'treasuryAddress', process.env.SM_TREASURY_ADDRESS)
  const marketAddress = pick(opts, 'marketAddress', process.env.SM_MARKET_ADDRESS)
  const nftAddress = pick(opts, 'nftAddress', process.env.BOX_NFT_ADDRESS)
  const rpcUrl = pick(opts, 'rpcUrl', process.env.SM_RPC_URL)
  const chainId = Number(opts.chainId ?? process.env.SM_CHAIN_ID ?? 0)
  const signerPk = pick(opts, 'signerPk', process.env.REWARDS_SIGNER_PK)

  const configured = !!(tokenAddress && isAddress(tokenAddress) && rpcUrl)
  const client = configured ? createPublicClient({ transport: http(rpcUrl) }) : null

  let signer = null
  if (signerPk) {
    try {
      signer = privateKeyToAccount(signerPk.startsWith('0x') ? signerPk : `0x${signerPk}`)
    } catch (err) {
      log.warn?.(`[token] REWARDS_SIGNER_PK is not a valid key (${err.message}) — claims disabled`)
    }
  }

  if (!configured) {
    log.warn?.(
      '[token] SM_TOKEN_ADDRESS / SM_RPC_URL not set — the game runs with no currency ' +
        '(prices stay in ETH, the balance chip is hidden). Paste the address in .env to switch it on.',
    )
  } else {
    log.log?.(`[token] currency at ${tokenAddress} on chain ${chainId}`)
    if (!signer) log.warn?.('[token] no REWARDS_SIGNER_PK — /rewards/claim will refuse')
  }

  /** Metadata, read once and kept. A token does not rename itself. */
  let meta = null
  let metaAt = 0
  const META_TTL_MS = 5 * 60_000

  async function metadata() {
    if (!configured) return { configured: false }
    if (meta && Date.now() - metaAt < META_TTL_MS) return meta

    const read = (abi, functionName) =>
      client.readContract({ address: tokenAddress, abi, functionName })

    // The four that must work. If these fail the address is not an ERC-20 and
    // saying so beats guessing.
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      read(ERC20_ABI, 'name'),
      read(ERC20_ABI, 'symbol'),
      read(ERC20_ABI, 'decimals'),
      read(ERC20_ABI, 'totalSupply'),
    ])

    // The four that may not exist. A plain ERC-20 simply has less to show.
    const optional = async (functionName, fallback) => {
      try {
        return await read(SELF_DESCRIBING_ABI, functionName)
      } catch {
        return fallback
      }
    }
    const [logo, description, liquidityPool, socialsRaw] = await Promise.all([
      optional('logo', ''),
      optional('description', ''),
      optional('liquidityPool', null),
      optional('socials', null),
    ])

    const socials = socialsRaw
      ? {
          twitter: socialsRaw[0] || '',
          telegram: socialsRaw[1] || '',
          discord: socialsRaw[2] || '',
          website: socialsRaw[3] || '',
          farcaster: socialsRaw[4] || '',
        }
      : null

    meta = {
      configured: true,
      chainId,
      address: getAddress(tokenAddress),
      name,
      symbol,
      decimals: Number(decimals),
      totalSupply: totalSupply.toString(),
      logo,
      description,
      liquidityPool: liquidityPool && liquidityPool !== '0x0000000000000000000000000000000000000000'
        ? getAddress(liquidityPool)
        : null,
      socials,
      contracts: {
        token: getAddress(tokenAddress),
        rewards: isAddress(rewardsAddress) ? getAddress(rewardsAddress) : null,
        treasury: isAddress(treasuryAddress) ? getAddress(treasuryAddress) : null,
        market: isAddress(marketAddress) ? getAddress(marketAddress) : null,
        nft: isAddress(nftAddress) ? getAddress(nftAddress) : null,
      },
    }
    metaAt = Date.now()
    return meta
  }

  /** SMON and ETH for one address, formatted with the token's own decimals. */
  async function balances(address) {
    if (!configured) return { configured: false }
    if (!isAddress(address)) throw new TokenError(400, 'bad-address', 'Bad address.')
    const m = await metadata()
    const [raw, wei] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [getAddress(address)],
      }),
      client.getBalance({ address: getAddress(address) }),
    ])
    return {
      configured: true,
      address: getAddress(address),
      symbol: m.symbol,
      decimals: m.decimals,
      raw: raw.toString(),
      formatted: formatUnits(raw, m.decimals),
      ethWei: wei.toString(),
      eth: formatUnits(wei, 18),
    }
  }

  /* ------------------------------------------------------------ claims ---*/

  /**
   * The current epoch: one per UTC day, counted from the day the rewards
   * contract was deployed, so the first day of the game is epoch 1.
   *
   * `SM_EPOCH_DAY0` is that deploy day as a UTC day number. It is written by
   * tools/deploy.mjs and MUST NOT drift afterwards — changing it renumbers
   * every epoch, which would point today's claims at a budget that belongs to
   * a different day and silently fail.
   */
  const day0 = Number(opts.epochDay0 ?? process.env.SM_EPOCH_DAY0 ?? 0)
  const currentEpoch = (now = Date.now()) => (day0 ? Math.floor(now / 86_400_000) - day0 + 1 : 1)

  /**
   * What this wallet may claim right now.
   * @param {{ walletId: string, address: string, earned: object }} p
   *        `earned` is the profile's per-epoch ledger: { [epoch]: amountString }
   */
  async function claimable({ address, earned }) {
    const epoch = currentEpoch()
    const m = await metadata()
    const amount = BigInt(earned?.[String(epoch)] ?? '0')
    const already = rewardsAddress && isAddress(rewardsAddress)
      ? await client.readContract({
          address: rewardsAddress,
          abi: REWARDS_ABI,
          functionName: 'claimed',
          args: [BigInt(epoch), getAddress(address)],
        })
      : false

    let budgetLeft = 0n
    if (rewardsAddress && isAddress(rewardsAddress)) {
      const [budget, spent] = await Promise.all([
        client.readContract({ address: rewardsAddress, abi: REWARDS_ABI, functionName: 'epochBudget', args: [BigInt(epoch)] }),
        client.readContract({ address: rewardsAddress, abi: REWARDS_ABI, functionName: 'epochClaimed', args: [BigInt(epoch)] }),
      ])
      budgetLeft = budget - spent
    }

    const payable = already ? 0n : amount > budgetLeft ? budgetLeft : amount

    return {
      configured: true,
      epoch,
      symbol: m.symbol,
      decimals: m.decimals,
      earnedRaw: amount.toString(),
      earned: formatUnits(amount, m.decimals),
      claimable: formatUnits(payable, m.decimals),
      claimableRaw: payable.toString(),
      alreadyClaimed: already,
      // An honest reason when the number is zero, rather than a dead button.
      reason: already
        ? 'You have already claimed this epoch. Anything you earn now pays out in the next one.'
        : amount === 0n
          ? 'Nothing earned yet this epoch — win battles, catch new species, open boxes.'
          : payable === 0n
            ? 'The pool is out of budget for this epoch. Try again after it rolls over.'
            : null,
    }
  }

  /** Sign a claim the player submits themselves. Never sends a transaction. */
  async function signClaim({ address, earned }) {
    if (!configured) throw new TokenError(503, 'no-token', 'This server has no token configured.')
    if (!signer) throw new TokenError(503, 'no-signer', 'This server cannot sign reward claims.')
    if (!isAddress(rewardsAddress)) throw new TokenError(503, 'no-rewards', 'No rewards contract configured.')

    const state = await claimable({ address, earned })
    const amount = BigInt(state.claimableRaw)
    if (amount === 0n) throw new TokenError(400, 'nothing-to-claim', state.reason ?? 'Nothing to claim.')

    const deadline = Math.floor(Date.now() / 1000) + CLAIM_TTL_S
    const signature = await signer.signTypedData({
      domain: { name: 'StockmonstersRewards', chainId, verifyingContract: getAddress(rewardsAddress) },
      types: { Claim: CLAIM_TYPE },
      primaryType: 'Claim',
      message: {
        player: getAddress(address),
        epoch: BigInt(state.epoch),
        amount,
        deadline: Number(deadline),
      },
    })

    return {
      contract: getAddress(rewardsAddress),
      chainId,
      epoch: state.epoch,
      amount: amount.toString(),
      formatted: formatUnits(amount, state.decimals),
      symbol: state.symbol,
      deadline,
      signature,
    }
  }

  return {
    get enabled() {
      return configured
    },
    /**
     * The token's decimals, synchronously, for code that cannot await — the
     * game modules crediting rewards. Defaults to 18 until the first metadata
     * read lands, which server.mjs primes at boot precisely so this is never
     * a guess in practice.
     */
    decimalsSync() {
      return meta?.decimals ?? 18
    },
    get canSign() {
      return !!signer && configured
    },
    get address() {
      return configured ? getAddress(tokenAddress) : null
    },
    get chainId() {
      return chainId
    },
    get contracts() {
      return { token: tokenAddress, rewards: rewardsAddress, treasury: treasuryAddress, market: marketAddress, nft: nftAddress }
    },
    currentEpoch,
    metadata,
    balances,
    claimable,
    signClaim,
    /** Convert a human amount ("12.5") to base units using the live decimals. */
    async toBaseUnits(value) {
      const m = await metadata()
      return parseUnits(String(value), m.decimals ?? 18)
    },
  }
}

function pick(opts, key, fallback) {
  const v = key in opts ? opts[key] : fallback
  return v ? String(v) : null
}

export class TokenError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}


/* ================================================================ ROUTES ==*/

const isWalletId = (v) => typeof v === 'string' && /^w:[0-9a-f]{32}$/.test(v)

/**
 * The same proof of wallet ownership the box endpoints use: the caller shows
 * an address AND the opaque id only this server can derive from it. Constant
 * time, because it is a comparison against a secret-derived value.
 */
function authorise(address, connectionId) {
  if (!isAddress(address)) throw new TokenError(400, 'bad-address', 'Bad address.')
  if (!isWalletId(connectionId)) throw new TokenError(400, 'bad-connection', 'Bad connection id.')
  const expected = Buffer.from(connectionIdFor(address))
  const given = Buffer.from(connectionId)
  const ok = expected.length === given.length && timingSafeEqual(expected, given)
  if (!ok) throw new TokenError(403, 'not-your-wallet', 'That connection id does not belong to that wallet.')
  return connectionId
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  res.end(text)
}

async function readJson(req, limit = 8192) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new TokenError(413, 'too-large', 'Body too large.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Reads a player's per-epoch earnings out of their stored profile.
 *
 * The profile store is the same one the game writes through, so this sees
 * whatever the last flush wrote — earnings credited seconds ago may still be
 * in the batching window, which is why the claim endpoint is the one place
 * that forces a flush first.
 */
async function earningsOf(profiles, walletId) {
  if (!profiles?.loadProfile) return {}
  const profile = await profiles.loadProfile(walletId)
  const earned = profile?.earned
  return earned && typeof earned === 'object' ? earned : {}
}

/**
 *   GET  /token                          the currency, read off the chain
 *   GET  /token/balance?address=…        one wallet's SMON and ETH
 *   GET  /rewards/mine?address=&connectionId=
 *   POST /rewards/claim { address, connectionId }
 *
 * @returns true when the request was handled (so the caller stops).
 */
export async function handleTokenRoutes(req, res, store, profiles) {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  if (path !== '/token' && !path.startsWith('/token/') && !path.startsWith('/rewards/')) return false

  try {
    if (path === '/token' && req.method === 'GET') {
      json(res, 200, await store.metadata())
      return true
    }

    if (path === '/token/balance' && req.method === 'GET') {
      const address = url.searchParams.get('address') ?? ''
      json(res, 200, await store.balances(address))
      return true
    }

    if (path === '/rewards/mine' && req.method === 'GET') {
      if (!store.enabled) { json(res, 200, { configured: false }); return true }
      const address = url.searchParams.get('address') ?? ''
      const walletId = authorise(address, url.searchParams.get('connectionId') ?? '')
      const earned = await earningsOf(profiles, walletId)
      json(res, 200, { ...(await store.claimable({ address, earned })), canSign: store.canSign })
      return true
    }

    if (path === '/rewards/claim' && req.method === 'POST') {
      const body = await readJson(req)
      const address = String(body.address ?? '')
      const walletId = authorise(address, body.connectionId)
      // Earnings from the last few seconds may still be sitting in the write
      // batch; a claim that silently omits them would look like theft.
      await profiles?.flush?.(walletId)
      const earned = await earningsOf(profiles, walletId)
      json(res, 200, await store.signClaim({ address, earned }))
      return true
    }

    json(res, 404, { error: 'not-found' })
    return true
  } catch (err) {
    if (err instanceof TokenError) json(res, err.status, { error: err.code, message: err.message })
    else if (err instanceof SyntaxError) json(res, 400, { error: 'bad-json', message: 'Body is not JSON.' })
    else {
      console.error('[token]', err)
      json(res, 500, { error: 'server-error', message: 'Something went wrong.' })
    }
    return true
  }
}
