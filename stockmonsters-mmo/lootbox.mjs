/*
 * lootbox.mjs — purchasable sealed boxes: the roll, the signature, the custody
 * of the reveal.
 *
 * WHAT A BOX IS
 * A player buys a SEALED Stockmonster. The server rolls what is inside, commits
 * to it with keccak256 (voucher-lib.mjs `attrCommitment`), signs an EIP-712
 * MintVoucher bound to that player's ADDRESS + the tier's fee + a deadline, and
 * persists everything. The player's own wallet then calls
 * `mintCaught(...)` and pays the fee — the server never touches player funds
 * and never needs a hot wallet with a balance. Later the player asks for the
 * reveal payload and calls `open(...)` themselves.
 *
 * THE SALT IS THE PRODUCT
 * `boxes.salt` is the only copy of the 256 bits that make the commitment
 * un-brute-forceable. Lose the row and the NFT is permanently unopenable —
 * there is no recovery, on-chain or off. That is why the table refuses DELETE
 * at the database level (trigger `boxes_no_delete`) and every lifecycle change
 * is a status update instead.
 *
 * PROVABLY FAIR (commit–reveal on the randomness)
 * The attributes are commit–reveal on chain; the RANDOMNESS is commit–reveal
 * off chain, in the same spirit:
 *
 *   1. `POST /box/quote`  -> { commitId, serverSeedHash } where
 *      serverSeedHash = SHA-256(serverSeed). The seed itself stays secret.
 *   2. The player picks a `clientSeed` and sends it with the purchase. The
 *      server committed BEFORE it could see that seed, so it cannot grind the
 *      pair for a bad outcome.
 *   3. The roll is a pure function of (serverSeed, clientSeed, tier, address) —
 *      see `rollBox`. Nothing else feeds it.
 *   4. `POST /box/reveal` returns serverSeed alongside the salt. The player
 *      re-hashes it against the published hash and replays the roll
 *      (`node tools/lootbox-cli.mjs verify …`). A server that lied is caught.
 *
 * SHA-256 rather than keccak256 for the seed commitment on purpose: a player
 * can verify it in a browser console with `crypto.subtle.digest`, no library.
 * The ATTRIBUTE commitment stays keccak256 because the contract says so.
 *
 * DEGRADATION
 * Copied from profiles.mjs: no DATABASE_URL, Postgres down, no signer key —
 * the endpoints answer with a reason instead of throwing, and the rest of the
 * game is unaffected. But note the asymmetry: a profile write that is lost
 * costs a few seconds of play, a box row that is lost costs an NFT. So the
 * write here is synchronous and its failure aborts the voucher — we never hand
 * out a signature we did not first manage to store.
 */
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createPublicClient, http as viemHttp, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { attrCommitment, randomSalt, signVoucher, signVoucherERC20 } from './tools/voucher-lib.mjs'
import { connectionIdFor } from './auth.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const dex = JSON.parse(readFileSync(join(HERE, 'src/data/dex.json'), 'utf8'))
const natures = JSON.parse(readFileSync(join(HERE, 'src/data/studio/natures.json'), 'utf8'))

/** natureId is the index into the ALPHABETICAL keys of natures.json — the same
 *  ordering src/battle/factory.ts rolls against and StockmonstersNFT bakes into
 *  its NATURE_NAMES table. tools/register-species.mjs asserts the two agree. */
export const NATURE_NAMES = Object.keys(natures).sort()

/* =============================================================== THE ODDS ==
 * One table. Every number a player can win is decided here and nowhere else;
 * docs/lootbox.md reproduces it and explains the reasoning.
 *
 * NOT ENFORCEABLE ON CHAIN. `mintCaught` sees a hash, never a dexId, so no
 * `require` can cap shinies or elites. Rarity here rests entirely on the
 * signing key — see docs/lootbox.md "What the odds are worth".
 */

/** Base-stat total: the one axis the tiers skew along. */
const bstOf = (d) => {
  const s = d.stats
  return s.hp + s.atk + (s.dfe ?? s.def) + s.spd + s.ats + s.dfs
}

/**
 * Rarity bands by base-stat total. Cutoffs chosen against the real 254-species
 * roster (min 175, median 395, max 670) so every band has a usable population
 * — a band of three species would make "RARE" mean "one of three creatures".
 */
export const BANDS = [
  { id: 'common', label: 'Common', min: 0, max: 400 },
  { id: 'uncommon', label: 'Uncommon', min: 401, max: 470 },
  { id: 'rare', label: 'Rare', min: 471, max: 530 },
  { id: 'elite', label: 'Elite', min: 531, max: 9999 },
]

/*
 * ---------------------------------------------------------------- pricing --
 *
 * A box has ONE price, in dollars, and the two currencies are quoted from it.
 *
 * It used to have two independent prices and they disagreed by a factor of
 * twenty-four: 0.01 ETH, which is about $30, or 2,500 SMON, which is about
 * $1.25. Nobody would ever have paid in ether. The ether price is the anchor —
 * it is the one that was set deliberately — so the token price is derived from
 * it. The token price is written as a MARKET CAP divided by the fixed billion
 * supply — $200k fully diluted at launch — because that is the number anyone
 * can have an opinion about. The old fixed 2,500 SMON silently assumed a token
 * at about $0.012, i.e. a $12M valuation, which is why it looked so cheap.
 *
 * Both rates are configuration, because there is no market on a test network:
 * `SM_ETH_USD` and `SM_TOKEN_USD`. The second is the same variable the quest
 * board is priced from, so a box and a day's quests are always quoted against
 * the same dollar.
 *
 * THE MIRROR. src/modules/main/pricing.ts does the same arithmetic for quests
 * and is a TypeScript module bundled into the game server, which this plain
 * .mjs cannot import. The clamp below is deliberately identical to the one
 * there, and lootbox-pricing.spec.ts asserts the two agree — a divergence
 * would mean a quest and a box valued the same dollar differently.
 */
const SUPPLY = 1_000_000_000
const DEFAULT_MARKET_CAP_USD = 200_000
const DEFAULT_USD_PER_TOKEN = DEFAULT_MARKET_CAP_USD / SUPPLY
const DEFAULT_USD_PER_ETH = 3000
const CLAMP_FACTOR = 20
const MIN_TOKENS_PER_USD = 1 / DEFAULT_USD_PER_TOKEN / CLAMP_FACTOR
const MAX_TOKENS_PER_USD = (1 / DEFAULT_USD_PER_TOKEN) * CLAMP_FACTOR

const positiveEnv = (key, fallback) => {
  const parsed = Number(process.env[key])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const tokenUsd = () => positiveEnv('SM_TOKEN_USD', DEFAULT_USD_PER_TOKEN)
export const ethUsd = () => positiveEnv('SM_ETH_USD', DEFAULT_USD_PER_ETH)

/** Whole tokens one dollar buys, clamped exactly as pricing.ts clamps it. */
export function tokensPerUsd() {
  const per = 1 / tokenUsd()
  if (per < MIN_TOKENS_PER_USD) return MIN_TOKENS_PER_USD
  if (per > MAX_TOKENS_PER_USD) return MAX_TOKENS_PER_USD
  return per
}

/** What a tier costs in dollars, read off its ether price. */
export function tierUsd(tier) {
  const wei = BigInt(TIERS[tier].priceWei)
  // Two decimals of a cent is plenty and keeps this in integer arithmetic
  // until the last step; 1e18 wei per ether.
  return Number((wei * 10_000n) / 10n ** 18n) / 10_000 * ethUsd()
}

/** What a tier costs in whole game tokens, right now. */
export function tierTokens(tier) {
  const usd = tierUsd(tier)
  if (!Number.isFinite(usd) || usd <= 0) return 0
  return Math.max(1, Math.round(usd * tokensPerUsd()))
}

/**
 * Tiers. `bands` are per-ten-thousand and MUST sum to 10000 (asserted below).
 * `shinyOneIn` is the odds denominator; the wild-encounter rate in
 * src/battle/factory.ts is 1 in 4096, so every tier is a buy-up on shinies.
 * `ivFloor` raises the minimum of each of the six IVs — still a legal
 * individual (0..31), just a better one.
 */
export const TIERS = {
  standard: {
    id: 'standard',
    label: 'Standard',
    // The anchor. The token price is derived from this — see the pricing note
    // above — so there is one price per box and not two that disagree.
    priceWei: '10000000000000000', // 0.01 ETH
    bands: { common: 7000, uncommon: 2000, rare: 900, elite: 100 },
    level: [5, 25],
    ivFloor: 0,
    shinyOneIn: 1024,
  },
  prime: {
    id: 'prime',
    label: 'Prime',
    priceWei: '30000000000000000', // 0.03 ETH
    bands: { common: 4000, uncommon: 3000, rare: 2500, elite: 500 },
    level: [20, 45],
    ivFloor: 8,
    shinyOneIn: 256,
  },
  apex: {
    id: 'apex',
    label: 'Apex',
    priceWei: '80000000000000000', // 0.08 ETH
    bands: { common: 1500, uncommon: 2500, rare: 4500, elite: 1500 },
    level: [40, 70],
    ivFloor: 16,
    shinyOneIn: 64,
  },
}

export const TIER_IDS = Object.keys(TIERS)
export const isTier = (t) => Object.prototype.hasOwnProperty.call(TIERS, t)

/** Species pools, one per band, sorted by dexId so the roll is reproducible
 *  regardless of how dex.json happens to be ordered on disk. */
export const POOLS = (() => {
  const out = {}
  for (const b of BANDS) {
    out[b.id] = dex
      .filter((d) => {
        const bst = bstOf(d)
        return bst >= b.min && bst <= b.max
      })
      .sort((a, b2) => a.dexId - b2.dexId)
  }
  return out
})()

// Fail at import, not at 3am: a mistyped weight would silently change the odds.
for (const t of Object.values(TIERS)) {
  const sum = BANDS.reduce((n, b) => n + (t.bands[b.id] ?? 0), 0)
  if (sum !== 10000) throw new Error(`tier ${t.id}: band weights sum to ${sum}, not 10000`)
  for (const b of BANDS) {
    if ((t.bands[b.id] ?? 0) > 0 && POOLS[b.id].length === 0) {
      throw new Error(`tier ${t.id}: band ${b.id} has weight but no species`)
    }
  }
  if (t.level[0] < 1 || t.level[1] > 100 || t.level[0] > t.level[1]) {
    throw new Error(`tier ${t.id}: bad level range`)
  }
  if (t.ivFloor < 0 || t.ivFloor > 31) throw new Error(`tier ${t.id}: bad ivFloor`)
}

/* ============================================================ THE ROLL =====
 * A pure function. Given the same (serverSeed, clientSeed, tier, address) it
 * produces the same creature on any machine, forever — that is what makes the
 * fairness proof checkable.
 */

export const ROLL_ALGORITHM = 'stockmonsters/box-roll/v1'

/** SHA-256 of the seed bytes, hex with 0x. The public half of the commitment. */
export function seedHash(seedHex) {
  return '0x' + createHash('sha256').update(Buffer.from(strip0x(seedHex), 'hex')).digest('hex')
}

const strip0x = (s) => (String(s).startsWith('0x') ? String(s).slice(2) : String(s))

/**
 * HMAC-SHA256 in counter mode: an endless, seekable keystream keyed by the
 * server seed. Chosen over `crypto.randomBytes` because it must be REPLAYABLE
 * by anyone holding the revealed seed.
 */
function keystream(serverSeed, label) {
  const key = Buffer.from(strip0x(serverSeed), 'hex')
  if (key.length !== 32) throw new Error('serverSeed must be 32 bytes')
  let counter = 0
  let block = Buffer.alloc(0)
  let off = 0
  const byte = () => {
    if (off >= block.length) {
      block = createHmac('sha256', key).update(`${label}|${counter++}`).digest()
      off = 0
    }
    return block[off++]
  }
  const uint32 = () => ((byte() << 24) >>> 0) + (byte() << 16) + (byte() << 8) + byte()
  return {
    uint32,
    /** Uniform in [0, n) with rejection sampling — a plain `% n` would bias
     *  the low values, which for a 254-entry pool is a visible thumb on the
     *  scale. */
    below(n) {
      if (n <= 0) throw new Error('below(n<=0)')
      const limit = Math.floor(0x100000000 / n) * n
      for (;;) {
        const v = uint32()
        if (v < limit) return v % n
      }
    },
    /** Inclusive both ends. */
    between(lo, hi) {
      return lo + this.below(hi - lo + 1)
    },
  }
}

/**
 * Roll a box. Draw order is fixed and documented — change it and every
 * historical verification breaks, so it is versioned by ROLL_ALGORITHM.
 *
 *   1. band            (per-ten-thousand against the tier's band weights)
 *   2. species         (uniform within the band, by dexId order)
 *   3. level           (uniform in the tier's range, inclusive)
 *   4. ivs[6]          (uniform in [ivFloor, 31], hp/atk/dfe/spd/ats/dfs)
 *   5. nature          (uniform over the 25 alphabetical natures)
 *   6. shiny           (1 in tier.shinyOneIn)
 *
 * `caughtAt` is NOT rolled: it is the wall-clock second the box was issued. It
 * goes into the commitment, is stored, and is echoed at reveal so the verifier
 * can rebuild the same commitment.
 */
export function rollBox({ serverSeed, clientSeed, tier, address }) {
  const t = TIERS[tier]
  if (!t) throw new Error(`unknown tier: ${tier}`)
  const label = `${ROLL_ALGORITHM}|${t.id}|${String(address).toLowerCase()}|${clientSeed ?? ''}`
  const s = keystream(serverSeed, label)

  const pick = s.below(10000)
  let acc = 0
  let band = BANDS[BANDS.length - 1]
  for (const b of BANDS) {
    acc += t.bands[b.id] ?? 0
    if (pick < acc) { band = b; break }
  }

  const pool = POOLS[band.id]
  const species = pool[s.below(pool.length)]
  const level = s.between(t.level[0], t.level[1])
  const ivs = []
  for (let i = 0; i < 6; i++) ivs.push(s.between(t.ivFloor, 31))
  const natureId = s.below(NATURE_NAMES.length)
  const shiny = s.below(t.shinyOneIn) === 0

  return {
    tier: t.id,
    band: band.id,
    dexId: species.dexId,
    ticker: species.ticker,
    name: species.name,
    types: species.types,
    bst: bstOf(species),
    level,
    ivs,
    natureId,
    nature: NATURE_NAMES[natureId],
    shiny,
  }
}

/**
 * Re-derive a roll from a revealed box and say whether it matches. This is the
 * verifier — tools/lootbox-cli.mjs and test/lootbox.test.mjs both call it, and
 * a player can too.
 */
export function replayRoll(reveal) {
  const problems = []
  const gotHash = seedHash(reveal.serverSeed)
  if (gotHash.toLowerCase() !== String(reveal.serverSeedHash).toLowerCase()) {
    problems.push(`serverSeed does not hash to the published commitment (${gotHash} != ${reveal.serverSeedHash})`)
  }
  const rolled = rollBox({
    serverSeed: reveal.serverSeed,
    clientSeed: reveal.clientSeed,
    tier: reveal.tier,
    address: reveal.address,
  })
  for (const k of ['dexId', 'level', 'natureId', 'shiny']) {
    if (rolled[k] !== reveal[k]) problems.push(`${k}: rolled ${rolled[k]}, server said ${reveal[k]}`)
  }
  if (JSON.stringify(rolled.ivs) !== JSON.stringify(reveal.ivs)) {
    problems.push(`ivs: rolled [${rolled.ivs}], server said [${reveal.ivs}]`)
  }

  // A malformed payload is a verification FAILURE, not a crash — this function
  // is handed untrusted JSON by anyone auditing their box.
  try {
    const commit = attrCommitment({
      dexId: reveal.dexId,
      level: reveal.level,
      ivs: reveal.ivs,
      natureId: reveal.natureId,
      shiny: reveal.shiny,
      caughtAt: reveal.caughtAt,
      salt: reveal.salt,
    })
    if (commit.toLowerCase() !== String(reveal.attrCommit).toLowerCase()) {
      problems.push(`attrCommit does not match the revealed attributes (${commit} != ${reveal.attrCommit})`)
    }
  } catch (err) {
    problems.push(`the revealed attributes do not form a valid commitment: ${err.message}`)
  }
  return { ok: problems.length === 0, problems, rolled }
}

/** The public odds summary — what the shop shows and what /box/quote returns. */
export function quoteTiers() {
  return TIER_IDS.map((id) => {
    const t = TIERS[id]
    return {
      id,
      label: t.label,
      priceWei: t.priceWei,
      priceTokens: tierTokens(id),
      priceUsd: Number(tierUsd(id).toFixed(2)),
      level: t.level,
      ivFloor: t.ivFloor,
      shinyOneIn: t.shinyOneIn,
      shinyOdds: `1 in ${t.shinyOneIn}`,
      bands: BANDS.map((b) => ({
        id: b.id,
        label: b.label,
        pct: (t.bands[b.id] ?? 0) / 100,
        bst: b.max >= 9999 ? `${b.min}+` : `${b.min}-${b.max}`,
        species: POOLS[b.id].length,
      })),
    }
  })
}

/* ============================================================== THE STORE ==*/

const RETRY_AFTER_MS = 10_000
const isWalletId = (v) => typeof v === 'string' && /^w:[0-9a-f]{32}$/.test(v)
const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)
const isBytes32 = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)

const NFT_ABI = parseAbi([
  'event Minted(address indexed player, uint256 indexed tokenId, bytes32 uid)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function opened(uint256 tokenId) view returns (bool)',
])
const MINTED_EVENT = NFT_ABI.find((e) => e.type === 'event' && e.name === 'Minted')

/**
 * @param {object} [opts]
 * @param {string|null} [opts.databaseUrl]  defaults to DATABASE_URL
 * @param {string|null} [opts.signerPk]     defaults to BOX_SIGNER_PK
 * @param {string|null} [opts.contract]     NFT address, defaults to BOX_NFT_ADDRESS
 * @param {number} [opts.chainId]           defaults to BOX_CHAIN_ID or 31337
 * @param {string|null} [opts.rpcUrl]       defaults to BOX_RPC_URL (optional)
 * @param {object} [opts.log]
 */
export function createBoxStore(opts = {}) {
  const databaseUrl = 'databaseUrl' in opts ? opts.databaseUrl : process.env.DATABASE_URL
  const signerPk = 'signerPk' in opts ? opts.signerPk : process.env.BOX_SIGNER_PK
  const contract = (('contract' in opts ? opts.contract : process.env.BOX_NFT_ADDRESS) || '') || null
  const chainId = Number(opts.chainId ?? process.env.BOX_CHAIN_ID ?? 31337)
  const rpcUrl = ('rpcUrl' in opts ? opts.rpcUrl : process.env.BOX_RPC_URL) || null
  const log = opts.log ?? console

  const ttlSeconds = Number(opts.ttlSeconds ?? process.env.BOX_VOUCHER_TTL_S ?? 900)
  const rateMax = Number(opts.rateMax ?? process.env.BOX_RATE_MAX ?? 10)
  const rateWindowS = Number(opts.rateWindowS ?? process.env.BOX_RATE_WINDOW_S ?? 60)
  const maxOutstanding = Number(opts.maxOutstanding ?? process.env.BOX_MAX_OUTSTANDING ?? 25)
  const fromBlock = BigInt(opts.fromBlock ?? process.env.BOX_FROM_BLOCK ?? 0)

  let account = null
  const normalisedPk = signerPk ? (signerPk.startsWith('0x') ? signerPk : `0x${signerPk}`) : null
  if (normalisedPk) {
    try {
      account = privateKeyToAccount(normalisedPk)
    } catch (err) {
      log.warn?.(`[boxes] BOX_SIGNER_PK is not a valid private key (${err.message}) — vouchers disabled`)
    }
  }
  if (!account) log.warn?.('[boxes] no BOX_SIGNER_PK — /box/quote works, /box/voucher will refuse')
  if (account && !contract) log.warn?.('[boxes] no BOX_NFT_ADDRESS — vouchers cannot be bound to a contract')

  const chain = rpcUrl && contract
    ? createPublicClient({ transport: viemHttp(rpcUrl) })
    : null

  let pool = null
  let downUntil = 0
  let warnedDown = false
  const counters = { quotes: 0, vouchers: 0, reveals: 0, refusals: 0, dbErrors: 0, synced: 0 }

  if (databaseUrl) {
    pool = new pg.Pool({
      connectionString: databaseUrl,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30_000,
      query_timeout: 5000,
    })
    pool.on('error', (err) => markDown(err))
  } else {
    log.warn?.('[boxes] no DATABASE_URL — boxes cannot be sold (the salt would have nowhere to live)')
  }

  function markDown(err) {
    downUntil = Date.now() + RETRY_AFTER_MS
    if (!warnedDown) {
      warnedDown = true
      log.warn?.(`[boxes] Postgres unavailable (${err?.message ?? err}) — box sales paused`)
    }
  }
  function markUp() {
    if (warnedDown) {
      warnedDown = false
      log.log?.('[boxes] Postgres reachable again — box sales resumed')
    }
    downUntil = 0
  }
  const usable = () => !!pool && Date.now() >= downUntil

  /**
   * Unlike profiles.mjs this THROWS on failure. A profile write that silently
   * does not land costs a few seconds of play; a box write that silently does
   * not land costs the salt, and with it the NFT. Callers must abort.
   */
  async function q(sql, params) {
    if (!usable()) throw new BoxError(503, 'boxes-unavailable', 'The box vault is offline. Try again shortly.')
    try {
      const res = await pool.query(sql, params)
      markUp()
      return res
    } catch (err) {
      // A healthy database saying "no" is an ANSWER, not an outage, and must
      // not trip the breaker: 22xx data exception, 23xx integrity violation,
      // 42xx syntax/access, P0001 the boxes_no_delete trigger's RAISE. Only
      // connection-shaped failures mean Postgres is actually gone.
      const said = typeof err?.code === 'string' && /^(22|23|42|P0)/.test(err.code)
      if (!said) markDown(err)
      counters.dbErrors++
      throw err
    }
  }

  /* ---------------------------------------------------------- fairness --- */

  /**
   * Reserve one server seed and publish its hash. Called by /box/quote so the
   * commitment exists BEFORE the player chooses a client seed — that ordering
   * is the entire fairness guarantee.
   */
  async function issueCommit() {
    const commitId = randomUUID()
    const serverSeed = '0x' + randomBytes(32).toString('hex')
    const hash = seedHash(serverSeed)
    await q(
      `INSERT INTO box_seed_commits (commit_id, server_seed, server_seed_hash) VALUES ($1, $2, $3)`,
      [commitId, serverSeed, hash],
    )
    return { commitId, serverSeedHash: hash, algorithm: ROLL_ALGORITHM }
  }

  /** Claim a commitment for use exactly once. Returns the secret seed. */
  async function consumeCommit(commitId, walletId) {
    const res = await q(
      `UPDATE box_seed_commits
          SET consumed_at = now(), consumed_by = $2
        WHERE commit_id = $1 AND consumed_at IS NULL
        RETURNING server_seed, server_seed_hash`,
      [commitId, walletId],
    )
    if (!res.rowCount) return null
    return { serverSeed: res.rows[0].server_seed, serverSeedHash: res.rows[0].server_seed_hash }
  }

  /* ------------------------------------------------------------- quote --- */

  async function quote({ withCommit = true } = {}) {
    counters.quotes++
    let fairness = {
      algorithm: ROLL_ALGORITHM,
      seedHash: 'sha256',
      commit: null,
      note: 'No pre-committed seed available — the roll is still logged durably, '
        + 'but it cannot be independently verified. See docs/lootbox.md.',
    }
    if (withCommit && usable()) {
      try {
        const c = await issueCommit()
        fairness = {
          algorithm: ROLL_ALGORITHM,
          seedHash: 'sha256',
          commit: c,
          note: 'serverSeedHash = SHA-256(serverSeed), published before you choose a client seed. '
            + 'The seed itself is revealed with the contents.',
        }
      } catch { /* quote must never fail on the fairness extra */ }
    }
    return {
      chainId,
      contract,
      currency: 'ETH',
      sellable: !!(account && contract && usable()),
      tiers: quoteTiers(),
      fairness,
    }
  }

  /* ----------------------------------------------------------- vouchers --- */

  async function rateLimit(walletId) {
    const res = await q(
      `SELECT
         count(*) FILTER (WHERE created_at > now() - ($2 || ' seconds')::interval) AS recent,
         count(*) FILTER (WHERE status = 'issued' AND deadline > extract(epoch from now())) AS outstanding
       FROM boxes WHERE wallet_id = $1`,
      [walletId, String(rateWindowS)],
    )
    const { recent, outstanding } = res.rows[0]
    if (Number(recent) >= rateMax) {
      throw new BoxError(429, 'rate-limited', `Too many boxes too fast — ${rateMax} per ${rateWindowS}s.`)
    }
    if (Number(outstanding) >= maxOutstanding) {
      throw new BoxError(429, 'too-many-outstanding',
        `You have ${outstanding} unminted vouchers. Mint or let them expire before buying more.`)
    }
  }

  /**
   * Roll, commit, sign, PERSIST, then hand back the voucher. The order matters:
   * the signature is only released after the salt is safely in Postgres.
   */
  /**
   * The game token, if this server has one. Read through the global the way
   * everything else reaches it, so lootbox.mjs has no import of token.mjs and
   * works unchanged on a server with no currency.
   */
  function currencyStore() {
    const t = globalThis.__smTokens
    return t && t.enabled ? t : null
  }

  /**
   * The creature behind a minted token id, for a duel.
   *
   * OPENED BOXES ONLY, and that is a product rule rather than a technical one:
   * a sealed box's contents are the whole product, and letting one fight would
   * reveal what it holds to anyone watching the replay. It also means both
   * duellists are betting on something they can actually see the stats of.
   *
   * Returns null for anything else — a token that is not ours, not theirs, or
   * still sealed.
   */
  async function creatureForToken({ walletId, tokenId }) {
    if (!isWalletId(walletId)) return null
    if (!/^\d{1,20}$/.test(String(tokenId))) return null
    const res = await q(
      `SELECT dex_id, level, ivs, nature_id, shiny, status, token_id
         FROM boxes
        WHERE wallet_id = $1 AND token_id = $2
        LIMIT 1`,
      [walletId, String(tokenId)],
    )
    const row = res?.rows?.[0]
    if (!row || row.status !== 'opened') return null
    return {
      tokenId: String(row.token_id),
      dexId: Number(row.dex_id),
      level: Number(row.level),
      ivs: row.ivs,
      natureId: Number(row.nature_id),
      shiny: !!row.shiny,
    }
  }

  async function issueVoucher({ walletId, address, tier, commitId, clientSeed, currency }) {
    if (!account) throw new BoxError(503, 'no-signer', 'Box sales are not configured on this server.')
    if (!contract) throw new BoxError(503, 'no-contract', 'No NFT contract is configured on this server.')
    if (!isTier(tier)) throw new BoxError(400, 'bad-tier', `Unknown tier "${tier}".`)
    const seed = String(clientSeed ?? '')
    if (seed.length > 128) throw new BoxError(400, 'bad-client-seed', 'Client seed is too long (128 chars max).')
    if (seed && !/^[\x20-\x7e]*$/.test(seed)) {
      throw new BoxError(400, 'bad-client-seed', 'Client seed must be printable ASCII.')
    }

    await rateLimit(walletId)

    let serverSeed = null
    let serverSeedHash = null
    let usedCommitId = null
    if (commitId) {
      const claimed = await consumeCommit(commitId, walletId)
      if (!claimed) {
        throw new BoxError(409, 'commit-spent',
          'That fairness commitment was already used or does not exist. Ask for a fresh quote.')
      }
      serverSeed = claimed.serverSeed
      serverSeedHash = claimed.serverSeedHash
      usedCommitId = commitId
    } else {
      // No pre-commitment: the roll is still deterministic and logged, but the
      // player has no proof it was fixed before they bought. Recorded as such.
      const fresh = await issueCommit()
      const claimed = await consumeCommit(fresh.commitId, walletId)
      serverSeed = claimed.serverSeed
      serverSeedHash = claimed.serverSeedHash
      usedCommitId = fresh.commitId
    }

    const rolled = rollBox({ serverSeed, clientSeed: seed, tier, address })
    const caughtAt = Math.floor(Date.now() / 1000)
    const salt = randomSalt()
    const attrCommit = attrCommitment({
      dexId: rolled.dexId,
      level: rolled.level,
      ivs: rolled.ivs,
      natureId: rolled.natureId,
      shiny: rolled.shiny,
      caughtAt,
      salt,
    })
    const uid = '0x' + randomBytes(32).toString('hex')
    const deadline = caughtAt + ttlSeconds

    // Which asset is this box priced in? The client ASKS, the server DECIDES:
    // a price is only ever taken from our own tier table, never from the
    // request, and the token address is ours rather than whatever was sent.
    const tokens = currencyStore()
    const payInToken = String(currency ?? '').toLowerCase() === 'token'
    if (payInToken && !tokens) {
      throw new BoxError(503, 'no-token', 'This server has no game token configured.')
    }
    const tokenAddress = payInToken ? tokens.address : null
    const priceTokens = tierTokens(tier)
    if (payInToken && !priceTokens) {
      throw new BoxError(400, 'no-token-price', 'That box cannot be bought with tokens.')
    }
    const fee = payInToken
      ? (await tokens.toBaseUnits(priceTokens)).toString()
      : TIERS[tier].priceWei

    // tools/voucher-lib.mjs is THE signing path. Reimplementing the EIP-712
    // encoding here — even "just to avoid a key round-trip" — is how a
    // divergence gets in, and a divergence makes every token minted after it
    // permanently unopenable.
    const signed = payInToken
      ? await signVoucherERC20({
          pk: normalisedPk,
          contract,
          chainId,
          voucher: { player: address, attrCommit, uid, currency: tokenAddress, fee, deadline },
        })
      : await signVoucher({
          pk: normalisedPk,
          contract,
          chainId,
          voucher: { player: address, attrCommit, uid, fee, deadline },
        })

    await q(
      `INSERT INTO players (wallet_id, wallet_address)
       VALUES ($1, $2)
       ON CONFLICT (wallet_id) DO UPDATE SET last_seen_at = now(),
         wallet_address = COALESCE(EXCLUDED.wallet_address, players.wallet_address)`,
      [walletId, address.toLowerCase()],
    )
    await q(
      `INSERT INTO boxes (
         uid, wallet_id, wallet_address, tier, status,
         dex_id, level, ivs, nature_id, shiny, caught_at, salt, attr_commit,
         fee_wei, deadline, signature, signer, chain_id, contract,
         commit_id, client_seed, server_seed_hash, roll_algorithm, band, currency
       ) VALUES (
         $1,$2,$3,$4,'issued',
         $5,$6,$7,$8,$9,$10,$11,$12,
         $13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24
       )`,
      [
        uid, walletId, address.toLowerCase(), tier,
        rolled.dexId, rolled.level, rolled.ivs, rolled.natureId, rolled.shiny, caughtAt, salt, attrCommit,
        fee, deadline, signed.signature, signed.signer.toLowerCase(), chainId, contract.toLowerCase(),
        usedCommitId, seed, serverSeedHash, ROLL_ALGORITHM, rolled.band, tokenAddress,
      ],
    )
    counters.vouchers++
    // Durable audit line even if the database is later lost to a restore.
    log.log?.(`[boxes] issued ${uid} ${tier} -> dex ${rolled.dexId} lv${rolled.level} `
      + `${rolled.shiny ? 'SHINY ' : ''}for ${address.toLowerCase()} (commit ${serverSeedHash})`)

    return {
      uid,
      tier,
      attrCommit,
      fee,
      // null = native ETH. The client picks its calldata from this, so it is
      // the server that decides which entry point gets called.
      currency: tokenAddress,
      priceTokens: payInToken ? priceTokens : null,
      deadline,
      signature: signed.signature,
      signer: signed.signer,
      chainId,
      contract,
      serverSeedHash,
      clientSeed: seed,
      commitId: usedCommitId,
      // Deliberately NOT the contents. The seal is the product.
    }
  }

  /* ------------------------------------------------------------- reveal --- */

  /**
   * Custody rule: a reveal goes to the wallet the box was issued to, or — when
   * the token has been minted and an RPC is configured — to whoever currently
   * owns it on chain. The second case is not a loophole, it is the marketplace:
   * a sealed box that could never be opened by its buyer would be worthless.
   */
  async function reveal({ walletId, address, uid, tokenId }) {
    const find = async () => (await q(
      `SELECT * FROM boxes WHERE ${uid ? 'uid = $1' : 'token_id = $1::numeric AND contract = $2'}`,
      uid ? [uid] : [String(tokenId), (contract ?? '').toLowerCase()],
    )).rows[0]

    let box = await find()
    // A box bought on the marketplace was never in THIS wallet's list, so the
    // row has no token_id yet — nothing has ever synced it. Ask the chain which
    // uid that token came from rather than 404ing at the new owner.
    if (!box && tokenId && chain) {
      await linkToken(tokenId)
      box = await find()
    }
    if (!box) throw new BoxError(404, 'no-such-box', 'No such box.')

    let allowed = false
    let via = null
    if (box.wallet_id === walletId) { allowed = true; via = 'issued-to' }
    if (!allowed && box.token_id != null && chain && address) {
      try {
        const onchain = await chain.readContract({
          address: contract, abi: NFT_ABI, functionName: 'ownerOf', args: [BigInt(box.token_id)],
        })
        if (String(onchain).toLowerCase() === address.toLowerCase()) { allowed = true; via = 'current-owner' }
      } catch { /* an RPC hiccup must not turn into "yes" */ }
    }
    if (!allowed) {
      counters.refusals++
      throw new BoxError(403, 'not-yours', 'That box does not belong to you.')
    }

    await q(
      `UPDATE boxes SET status = CASE WHEN status IN ('issued','minted') THEN 'revealed' ELSE status END,
                        revealed_at = COALESCE(revealed_at, now()),
                        updated_at = now()
        WHERE uid = $1`,
      [box.uid],
    )
    counters.reveals++

    return {
      uid: box.uid,
      tokenId: box.token_id == null ? null : String(box.token_id),
      tier: box.tier,
      band: box.band,
      via,
      address: box.wallet_address,
      contract: box.contract,
      chainId: Number(box.chain_id),
      // The reveal payload `open()` needs, in the contract's argument order.
      dexId: box.dex_id,
      level: box.level,
      ivs: box.ivs.map(Number),
      natureId: box.nature_id,
      nature: NATURE_NAMES[box.nature_id],
      shiny: box.shiny,
      caughtAt: Number(box.caught_at),
      salt: box.salt,
      attrCommit: box.attr_commit,
      // The fairness proof.
      serverSeed: box.server_seed_hash ? await seedFor(box.commit_id) : null,
      serverSeedHash: box.server_seed_hash,
      clientSeed: box.client_seed,
      rollAlgorithm: box.roll_algorithm,
      species: dex.find((d) => d.dexId === box.dex_id) ?? null,
    }
  }

  /**
   * Bind one tokenId to the uid it was minted from, straight from the Minted
   * event. tokenId is an indexed topic, so this is a single cheap filter and
   * never trusts anything the caller said.
   */
  async function linkToken(tokenId) {
    let logs = []
    try {
      logs = await chain.getLogs({
        address: contract, event: MINTED_EVENT, args: { tokenId: BigInt(tokenId) },
        fromBlock, toBlock: 'latest',
      })
    } catch (err) {
      log.warn?.(`[boxes] token lookup skipped (${err.shortMessage ?? err.message})`)
      return
    }
    const l = logs[0]
    if (!l) return
    await q(
      `UPDATE boxes SET token_id = $2::numeric, mint_tx = $3,
                        status = CASE WHEN status = 'issued' THEN 'minted' ELSE status END,
                        updated_at = now()
        WHERE uid = $1 AND token_id IS NULL`,
      [String(l.args.uid).toLowerCase(), String(l.args.tokenId), l.transactionHash],
    )
    counters.synced++
  }

  async function seedFor(commitId) {
    if (!commitId) return null
    const r = await q('SELECT server_seed FROM box_seed_commits WHERE commit_id = $1', [commitId])
    return r.rows[0]?.server_seed ?? null
  }

  /* --------------------------------------------------------------- mine --- */

  /** Lazily age out vouchers nobody minted. Never deletes. */
  async function expireStale(walletId) {
    await q(
      `UPDATE boxes SET status = 'expired', updated_at = now()
        WHERE wallet_id = $1 AND status = 'issued' AND token_id IS NULL
          AND deadline < extract(epoch from now())`,
      [walletId],
    )
  }

  /**
   * Learn which vouchers actually became tokens, from the chain rather than
   * from the client. A client-reported tokenId would be a free way to point
   * someone else's box at your token.
   */
  async function syncMints(walletId, address) {
    if (!chain || !address) return
    const pending = await q(
      `SELECT uid FROM boxes WHERE wallet_id = $1 AND token_id IS NULL AND status <> 'expired'`,
      [walletId],
    )
    // No early return when this is empty: boxes that already have a token id
    // still need their OPENED state checked below, and forgetting that is how
    // a box that was opened on chain sat at "revealed" forever.
    if (pending.rowCount) {
      const want = new Set(pending.rows.map((r) => r.uid.toLowerCase()))
      let logs = []
      try {
        logs = await chain.getLogs({
          address: contract,
          event: MINTED_EVENT,
          args: { player: address },
          fromBlock,
          toBlock: 'latest',
        })
      } catch (err) {
        log.warn?.(`[boxes] mint sync skipped (${err.shortMessage ?? err.message})`)
        logs = []
      }
      for (const l of logs) {
        const uid = String(l.args.uid).toLowerCase()
        if (!want.has(uid)) continue
        try {
          await q(
            `UPDATE boxes SET token_id = $2::numeric, mint_tx = $3,
                              status = CASE WHEN status = 'issued' THEN 'minted' ELSE status END,
                              updated_at = now()
              WHERE uid = $1 AND token_id IS NULL`,
            [uid, String(l.args.tokenId), l.transactionHash],
          )
          counters.synced++
        } catch (err) {
          // (contract, token_id) is unique. A clash means the table already
          // claims that token for a different uid — in production impossible,
          // in development the everyday result of redeploying to the same
          // address on a fresh anvil. One box must not block the other nine.
          if (err?.code !== '23505') throw err
          log.warn?.(`[boxes] ${uid}: token ${l.args.tokenId} on ${contract} is already claimed by `
            + 'another box row (stale chain state?) — left unlinked')
        }
      }
    }
    // And find out which of those have since been opened on chain.
    const minted = await q(
      `SELECT uid, token_id FROM boxes WHERE wallet_id = $1 AND token_id IS NOT NULL AND status <> 'opened'`,
      [walletId],
    )
    for (const row of minted.rows) {
      try {
        const isOpen = await chain.readContract({
          address: contract, abi: NFT_ABI, functionName: 'opened', args: [BigInt(row.token_id)],
        })
        if (isOpen) {
          await q(
            `UPDATE boxes SET status = 'opened', opened_at = COALESCE(opened_at, now()), updated_at = now()
              WHERE uid = $1`,
            [row.uid],
          )
        }
      } catch { /* best effort */ }
    }
  }

  /** The wallet's boxes. Sealed rows NEVER carry their contents. */
  async function listBoxes({ walletId, address }) {
    await expireStale(walletId)
    // A sync failure must not hide the boxes we already know about — but it
    // must not be silent either, or a token that never gets linked looks like
    // a box that was never bought.
    await syncMints(walletId, address).catch((err) => {
      log.warn?.(`[boxes] mint sync failed for ${walletId}: ${err.message}`)
    })
    const res = await q(
      `SELECT uid, tier, band, status, token_id, fee_wei, currency, deadline, attr_commit, signature,
              server_seed_hash, client_seed, created_at, opened_at,
              dex_id, level, ivs, nature_id, shiny, caught_at
         FROM boxes WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [walletId],
    )
    return res.rows.map((b) => {
      const open = b.status === 'opened'
      const species = open ? dex.find((d) => d.dexId === b.dex_id) : null
      return {
        uid: b.uid,
        tier: b.tier,
        status: b.status,
        tokenId: b.token_id == null ? null : String(b.token_id),
        feeWei: String(b.fee_wei),
        currency: b.currency ?? null,
        deadline: Number(b.deadline),
        attrCommit: b.attr_commit,
        signature: b.signature,
        serverSeedHash: b.server_seed_hash,
        clientSeed: b.client_seed,
        createdAt: b.created_at,
        openedAt: b.opened_at,
        chainId,
        contract,
        // Only an already-opened box says what is inside. Anything else would
        // leak the contents of a sealed listing to anyone who steals a session.
        contents: open
          ? {
              dexId: b.dex_id, ticker: species?.ticker ?? null, name: species?.name ?? `#${b.dex_id}`,
              types: species?.types ?? [], sprite: species?.sprite ?? null,
              level: b.level, ivs: b.ivs.map(Number),
              natureId: b.nature_id, nature: NATURE_NAMES[b.nature_id],
              shiny: b.shiny, caughtAt: Number(b.caught_at), band: b.band,
            }
          : null,
      }
    })
  }

  return {
    get enabled() { return !!pool && !!account && !!contract },
    get healthy() { return usable() },
    get signer() { return account?.address ?? null },
    get contract() { return contract },
    get chainId() { return chainId },
    stats: () => ({ ...counters, enabled: !!pool && !!account && !!contract, healthy: usable() }),
    quote,
    issueVoucher,
    reveal,
    listBoxes,
    creatureForToken,
    syncMints,
    _q: q,
    async close() {
      if (pool) await pool.end().catch(() => {})
      pool = null
    },
  }
}

/* ============================================================= HTTP GLUE ===*/

export class BoxError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const json = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

async function readJson(req, limit = 8192) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new BoxError(413, 'too-large', 'Payload too large.')
  }
  return body ? JSON.parse(body) : {}
}

/**
 * The one authorisation primitive: prove the caller holds the connectionId for
 * a specific ADDRESS by recomputing the HMAC. `connectionId` on its own is
 * never enough — every path here goes through an address, either the one the
 * caller supplied or the one stored on the row they are asking about.
 */
function authorise(address, connectionId) {
  if (!isAddress(address)) throw new BoxError(400, 'bad-address', 'Bad address.')
  if (!isWalletId(connectionId)) throw new BoxError(400, 'bad-connection', 'Bad connection id.')
  const expected = Buffer.from(connectionIdFor(address))
  const given = Buffer.from(connectionId)
  const ok = expected.length === given.length && timingSafeEqual(expected, given)
  if (!ok) throw new BoxError(403, 'not-your-wallet', 'That connection id does not belong to that wallet.')
  return connectionId
}

/* Cheap per-IP brake on the public endpoint so commitment rows cannot be
 * spammed into the table by anyone who can reach the port. */
const quoteHits = new Map()
function quoteBudget(ip, max = 30, windowMs = 60_000) {
  const now = Date.now()
  const e = quoteHits.get(ip)
  if (!e || now > e.until) { quoteHits.set(ip, { n: 1, until: now + windowMs }); return true }
  e.n++
  if (quoteHits.size > 5000) for (const [k, v] of quoteHits) if (now > v.until) quoteHits.delete(k)
  return e.n <= max
}

/**
 * Mount point. Returns true when it handled the request.
 *
 *   POST /box/quote    (public)  -> tiers, prices, odds, a fairness commitment
 *   POST /box/voucher            -> a signed MintVoucher for one sealed box
 *   POST /box/reveal             -> the attributes + salt for a box you own
 *   GET  /box/mine?connectionId= -> your boxes and their status
 */
export async function handleBoxRoutes(req, res, store) {
  const url = new URL(req.url, 'http://x')
  const path = url.pathname
  if (!path.startsWith('/box/')) return false

  try {
    if (path === '/box/quote' && (req.method === 'POST' || req.method === 'GET')) {
      const ip = req.socket?.remoteAddress ?? 'unknown'
      const quote = await store.quote({ withCommit: quoteBudget(ip) })
      const tokens = globalThis.__smTokens
      if (tokens?.enabled) {
        const meta = await tokens.metadata().catch(() => null)
        if (meta?.configured) {
          quote.token = { address: meta.address, symbol: meta.symbol, decimals: meta.decimals }
        }
      }
      json(res, 200, quote)
      return true
    }

    if (path === '/box/voucher' && req.method === 'POST') {
      const body = await readJson(req)
      const address = String(body.address ?? '')
      const walletId = authorise(address, body.connectionId)
      const out = await store.issueVoucher({
        walletId,
        address: address.toLowerCase(),
        tier: body.tier,
        commitId: body.commitId ?? null,
        clientSeed: body.clientSeed ?? '',
        currency: body.currency ?? null,
      })
      json(res, 200, out)
      return true
    }

    if (path === '/box/reveal' && req.method === 'POST') {
      const body = await readJson(req)
      const uid = body.uid ? String(body.uid).toLowerCase() : null
      const tokenId = body.tokenId != null ? String(body.tokenId) : null
      if (!uid && !tokenId) throw new BoxError(400, 'bad-request', 'Pass a uid or a tokenId.')
      if (uid && !isBytes32(uid)) throw new BoxError(400, 'bad-uid', 'Bad uid.')
      if (tokenId && !/^\d{1,20}$/.test(tokenId)) throw new BoxError(400, 'bad-token', 'Bad token id.')

      // The address is not optional here even though the endpoint contract
      // allows { connectionId, uid }: without it there is nothing to recompute
      // the HMAC from. When the caller omits it we fall back to the address on
      // the row — which still proves they hold that wallet's id, and still
      // refuses everybody else.
      let address = body.address ? String(body.address) : null
      let walletId
      if (address) {
        walletId = authorise(address, body.connectionId)
        address = address.toLowerCase()
      } else {
        if (!isWalletId(body.connectionId)) throw new BoxError(400, 'bad-connection', 'Bad connection id.')
        walletId = body.connectionId
      }
      const out = await store.reveal({ walletId, address, uid, tokenId })
      json(res, 200, out)
      return true
    }

    if (path === '/box/mine' && req.method === 'GET') {
      const connectionId = url.searchParams.get('connectionId') ?? ''
      const addrParam = url.searchParams.get('address')
      let walletId
      let address = null
      if (addrParam) {
        walletId = authorise(addrParam, connectionId)
        address = addrParam.toLowerCase()
      } else {
        if (!isWalletId(connectionId)) throw new BoxError(400, 'bad-connection', 'Bad connection id.')
        walletId = connectionId
      }
      const boxes = await store.listBoxes({ walletId, address })
      json(res, 200, { boxes, chainId: store.chainId, contract: store.contract })
      return true
    }

    json(res, 404, { error: 'not-found' })
    return true
  } catch (err) {
    if (err instanceof BoxError) {
      json(res, err.status, { error: err.code, message: err.message })
    } else if (err instanceof SyntaxError) {
      json(res, 400, { error: 'bad-json', message: 'Body is not JSON.' })
    } else {
      console.error('[boxes]', err)
      json(res, 500, { error: 'server-error', message: 'Something went wrong opening the vault.' })
    }
    return true
  }
}
