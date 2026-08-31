/*
 * Deploy the whole economy to a chain, wire it together, and print the .env
 * block the game needs.
 *
 *   cd contracts && forge build
 *   cd ../stockmonsters-mmo && node tools/deploy.mjs --chain robinhood --token 0x…
 *
 * IT DOES NOT DEPLOY THE TOKEN. pons launches it, and what pons deploys is a
 * plain fixed-supply ERC-20 with no owner, no mint and no tax. So the token's
 * address is an INPUT here (--token, or SM_TOKEN_ADDRESS in the game's .env),
 * and the script refuses to run without one. Launch first, deploy second.
 *
 * WHAT IT DEPLOYS, IN THIS ORDER (the order matters — each needs the last):
 *
 *   1. StockmonstersRewards   the pool players are paid out of
 *   2. StockmonstersTreasury  where revenue lands and is split
 *   3. StockmonstersNFT       the creatures
 *   4. StockmonstersMarket    peer-to-peer trading
 *   5. StockmonstersGyms      staked defences
 *   6. StockmonstersArena     duels
 *
 * ...then it wires them: the NFT and the market accept the token and send
 * their fees to the treasury, and the treasury is pointed at the pons escrow
 * it collects from and the router it buys the token back through.
 *
 * There is no tax wiring left. The old token taxed trades and every game
 * contract had to be exempted from it, or a stake moving into an escrow would
 * arrive short. A pons token moves exactly what was sent.
 *
 * SECRETS
 * The deployer key is read from contracts/.env (PRIVATE_KEY) and never
 * printed. Two more keys are needed by the SERVER, not by a person: one signs
 * mint vouchers, one signs reward claims. They are generated here if the game's
 * .env does not already have them, written there, and — deliberately — kept
 * apart, so a leak of one is not a leak of both.
 *
 * It does NOT verify the source on a block explorer: `--verify` needs an
 * Etherscan key and the user asked for the deploy without it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, getAddress, encodeFunctionData,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia, foundry } from 'viem/chains'

const HERE = dirname(fileURLToPath(import.meta.url))
const MMO = resolve(HERE, '..')
const CONTRACTS = resolve(MMO, '../contracts')
const OUT = join(CONTRACTS, 'out')

/* ------------------------------------------------------------- options ---*/

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback
}
const CHAIN_NAME = flag('chain', 'sepolia')
const DRY_RUN = args.includes('--dry-run')
/*
 * `--only pvp` deploys just the gyms and the arena, against the token,
 * treasury and NFT already in .env. A full redeploy would hand out fresh
 * addresses for everything and orphan every box already minted — cheap on a
 * testnet, but it throws away the state we are testing with.
 */
const ONLY = flag('only', null)

const CHAINS = {
  sepolia: {
    chain: sepolia,
    // A public endpoint, so a deploy needs no account anywhere. Override with
    // SEPOLIA_RPC_URL when this one is rate-limiting.
    rpc: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  /*
   * Robinhood Chain — where the token is launched and therefore where the
   * game's economy has to live. An arbitrum-based L2; native currency is ETH.
   * A duel escrow cannot hold a token on another chain, so this is not a
   * preference.
   */
  robinhood: {
    chain: {
      id: 4663,
      name: 'Robinhood Chain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
      blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
    },
    rpc: null, // filled from ROBINHOOD_RPC_URL below; the public one is rate limited
    explorer: 'https://robinhoodchain.blockscout.com',
    key: 'ROBINHOOD_PRIVATE_KEY',
  },
  /*
   * A REHEARSAL of the Robinhood deploy, against a local fork of it.
   *
   *   anvil --fork-url "$ROBINHOOD_RPC_URL" --port 8545
   *   node tools/deploy.mjs --chain robinhood-fork --token 0x…
   *
   * Same key, same chain id, same real pons and Uniswap contracts, and the
   * same nonce sequence — so the addresses it prints are the addresses the
   * real deploy will produce, and the gas it reports is what the real one
   * will cost. It writes to .env.fork rather than the game's own .env, which
   * is the point: a rehearsal that overwrote the live server's addresses
   * would take the game down to prove a deploy works.
   */
  'robinhood-fork': {
    chain: {
      id: 4663,
      name: 'Robinhood Chain (fork)',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
    },
    rpc: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
    explorer: 'https://robinhoodchain.blockscout.com',
    key: 'ROBINHOOD_PRIVATE_KEY',
    rehearsal: true,
  },
  anvil: { chain: foundry, rpc: process.env.RPC_URL ?? 'http://127.0.0.1:8545' },
}
/*
 * The pons and Uniswap v4 contracts on Robinhood Chain, all read back from
 * the live chain rather than copied from a page.
 *
 * FEE_ESCROW is where our creator fees accrue and the treasury withdraws
 * from. MEME_HOOK is the shared v4 hook every graduated pons pool uses, and
 * where fees sit until they are swept across. UNIVERSAL_ROUTER is what the
 * treasury's buyback swaps through — a v4 swap is a command stream, so the
 * treasury stores the router and asserts the outcome rather than knowing its
 * ABI.
 */
const PONS = {
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  feeEscrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',
  memeHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044',
}
const UNISWAP = {
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
  universalRouter: '0x8876789976dEcBfCbBbe364623C63652db8C0904',
  stateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b',
}

const target = CHAINS[CHAIN_NAME]
if (!target) {
  console.error(`unknown chain "${CHAIN_NAME}" — try: ${Object.keys(CHAINS).join(', ')}`)
  process.exit(1)
}

/* ------------------------------------------------------ the parameters ---*/
// Everything a human might want to change, in one place, with the reasoning.

const PARAMS = {
  token: {
    // The identity the token launches under. Mainnet supply comes from the
    // pons launchpad on Robinhood Chain, which deploys a plain fixed-supply
    // ERC-20 under this name; these params are what a testnet stack of our
    // own is deployed with, kept in step so the two do not read differently.
    // The leading `$` is part of the symbol the user chose.
    name: 'Stock Monsters',
    symbol: '$STONKSTER',
    // One billion, fixed forever — there is no mint function.
    supply: parseEther('1000000000'),
    logo: '',
    description: 'The currency of Stockmonsters: 254 tickers you can catch, trade and battle.',
  },
  // What the rewards pool starts with. 10% of supply, so the game can actually
  // pay players on a testnet without anyone topping it up by hand.
  rewardsSeed: parseEther('100000000'),
  // Marketplace rake, in basis points. 2.5% is the market standard; the
  // contract caps it at 5% and the owner cannot raise it past that.
  marketFeeBps: 250,
  // Creator royalty on secondary sales, in basis points.
  royaltyBps: 500,
  // NFT claim fee in ETH. Deliberately tiny on a testnet: faucet ETH is
  // annoying to get and the fee is not what we are testing.
  claimFeeEth: '0.0002',
  gyms: {
    // A gym nobody can afford to lose is not a contest; one that can hold a
    // fortune is a bigger target than a testnet needs.
    minStake: parseEther('1000'),
    maxStake: parseEther('500000'),
  },
  arena: {
    // The wager the game advertises. A duel for a million tokens is the
    // headline; the cap is what stops one signature moving more than that.
    maxWager: parseEther('1000000'),
    // ...and this is what a leaked result signer could move in a day, total.
    dailyPayoutCap: parseEther('20000000'),
  },
  nft: {
    // The pinned art, not a domain that has never resolved. `ipfs://` is what
    // goes on chain — wallets resolve it themselves, no gateway required — and
    // pointing at it here means a freshly deployed NFT shows the right picture
    // from its first block rather than after a follow-up transaction.
    // Re-pin and re-point with `node tools/ipfs.mjs set --cid <cid>`.
    imageBaseURI: 'ipfs://bafybeickaanjlxwbmcxaccjylsedi7omexniy56euyuio2agmffw5w3zrm/',
    sealedImageURI: 'ipfs://bafybeickaanjlxwbmcxaccjylsedi7omexniy56euyuio2agmffw5w3zrm/sealed.png',
  },
}

/* ------------------------------------------------------------ plumbing ---*/

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/** Append or replace a key in an .env file, keeping everything else intact. */
function upsertEnv(path, updates) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []
  for (const [key, value] of Object.entries(updates)) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l))
    if (i >= 0) lines[i] = `${key}=${value}`
    else lines.push(`${key}=${value}`)
  }
  writeFileSync(path, lines.join('\n').replace(/\n{3,}$/, '\n\n'))
}

/**
 * @param name the contract
 * @param file the .sol it lives in, when that is not the same name — the proxy
 *        is declared in Upgradeable.sol alongside the rest of the machinery.
 */
function artifact(name, file = name) {
  const path = join(OUT, `${file}.sol`, `${name}.json`)
  if (!existsSync(path)) {
    console.error(`missing artifact ${path}\nrun: cd ../contracts && forge build`)
    process.exit(1)
  }
  const json = JSON.parse(readFileSync(path, 'utf8'))
  return { abi: json.abi, bytecode: json.bytecode.object }
}

/* --------------------------------------------------------------- keys ----*/

const contractsEnv = readEnvFile(join(CONTRACTS, '.env'))

// Each chain may name its own deployer key, so a mainnet key is never the
// default and a testnet key can never reach mainnet by omission.
const KEY_NAME = target.key ?? 'PRIVATE_KEY'
const rawKey = contractsEnv[KEY_NAME] ?? process.env[KEY_NAME]
if (!rawKey || !/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) {
  console.error(`contracts/.env needs ${KEY_NAME}=0x… (64 hex chars) — the deployer key for ${CHAIN_NAME}`)
  process.exit(1)
}
if (target.rpc === null) {
  target.rpc = contractsEnv.ROBINHOOD_RPC_URL ?? process.env.ROBINHOOD_RPC_URL
    ?? target.chain.rpcUrls.default.http[0]
}
const deployerKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`
const deployer = privateKeyToAccount(deployerKey)

// The two SERVER keys. Generated once and kept in the game's .env; never the
// same key, so one compromise is not both.
// A rehearsal writes beside the real one, never over it.
const mmoEnvPath = join(MMO, target.rehearsal ? '.env.fork' : '.env')
const mmoEnv = readEnvFile(mmoEnvPath)
const newKeys = {}
const gameSignerKey = mmoEnv.BOX_SIGNER_PK ?? (newKeys.BOX_SIGNER_PK = generatePrivateKey())
const claimSignerKey = mmoEnv.REWARDS_SIGNER_PK ?? (newKeys.REWARDS_SIGNER_PK = generatePrivateKey())
// One key for battle outcomes — gyms and duels are the same kind of claim,
// and splitting them would double the key management without changing what a
// compromise costs. It is separate from the box and reward signers, which is
// where the blast radii actually differ.
const battleSignerKey = mmoEnv.BATTLE_SIGNER_PK ?? (newKeys.BATTLE_SIGNER_PK = generatePrivateKey())
const gameSigner = privateKeyToAccount(gameSignerKey)
const claimSigner = privateKeyToAccount(claimSignerKey)
const battleSigner = privateKeyToAccount(battleSignerKey)

/* -------------------------------------------------------------- deploy ---*/

const publicClient = createPublicClient({ chain: target.chain, transport: http(target.rpc) })
const wallet = createWalletClient({ account: deployer, chain: target.chain, transport: http(target.rpc) })

const log = (...a) => console.log(...a)
const step = (s) => log(`\n=== ${s} ===`)

step('who and where')
log(`chain     ${target.chain.name} (${target.chain.id})`)
log(`rpc       ${target.rpc}`)
log(`deployer  ${deployer.address}`)
log(`game signer   ${gameSigner.address}${newKeys.BOX_SIGNER_PK ? '  (new)' : ''}`)
log(`claim signer  ${claimSigner.address}${newKeys.REWARDS_SIGNER_PK ? '  (new)' : ''}`)
log(`battle signer ${battleSigner.address}${newKeys.BATTLE_SIGNER_PK ? '  (new)' : ''}`)

const REQUIRES_TOKEN = CHAIN_NAME !== 'anvil'
const tokenArg = flag('token', null) ?? mmoEnv.SM_TOKEN_ADDRESS ?? process.env.SM_TOKEN_ADDRESS
if (REQUIRES_TOKEN && !/^0x[0-9a-fA-F]{40}$/.test(tokenArg ?? '')) {
  console.error('\nno token address. pons launches the token; this script only deploys the game around it.')
  console.error('pass --token 0x… or set SM_TOKEN_ADDRESS in the game .env, then run again.')
  process.exit(1)
}

const balance = await publicClient.getBalance({ address: deployer.address })
log(`balance   ${formatEther(balance)} ETH`)
if (balance === 0n) {
  console.error('\nthe deployer has no ETH on this chain — fund it from a faucet first')
  process.exit(1)
}
if (DRY_RUN) {
  log('\n--dry-run: stopping before anything is sent')
  process.exit(0)
}

async function deployProxy(implAddress, initData, label) {
  const { abi, bytecode } = artifact('StockmonstersProxy', 'Upgradeable')
  const hash = await wallet.deployContract({ abi, bytecode, args: [implAddress, initData] })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} deployment reverted (${hash})`)
  return { address: getAddress(receipt.contractAddress), gas: receipt.gasUsed }
}

async function deployRaw(name, args_, label = name) {
  const { abi, bytecode } = artifact(name)
  const hash = await wallet.deployContract({ abi, bytecode, args: args_ })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} deployment reverted (${hash})`)
  return { address: getAddress(receipt.contractAddress), abi, gas: receipt.gasUsed }
}

/**
 * Deploy a contract BEHIND A PROXY, and initialise it in the same transaction.
 *
 * Everything the game owns is upgradeable now: the rules change every week and
 * redeploying would strand every balance, every minted creature and every open
 * order at the old address. What is returned is the PROXY — that is the address
 * that holds the state, the address the game talks to, and the address every
 * signature verifies against.
 *
 * `initialize` is called from inside the proxy's constructor rather than in a
 * follow-up transaction. A proxy that exists uninitialised for even one block
 * can be initialised by whoever is watching, and they become the owner.
 *
 * The initializer's last argument is always the owner, so it is appended here
 * rather than repeated at seven call sites.
 */
async function deploy(name, initArgs) {
  const impl = await deployRaw(name, [], `${name} implementation`)
  const initData = encodeFunctionData({
    abi: impl.abi,
    functionName: 'initialize',
    args: [...initArgs, deployer.address],
  })
  const proxy = await deployProxy(impl.address, initData, `${name} proxy`)
  log(`  ${name.padEnd(22)} ${proxy.address}   impl ${impl.address}   gas ${impl.gas + proxy.gas}`)
  // The ABI is the implementation's: that is what callers encode against, and
  // the proxy forwards everything it does not understand, which is everything.
  return { address: proxy.address, abi: impl.abi, implementation: impl.address }
}

async function send(label, contract, functionName, args_ = []) {
  const hash = await wallet.writeContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args: args_,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  log(`  ${label}`)
}

/* ----------------------------------------------------- pvp only ---------*/

if (ONLY === 'pvp') {
  const need = (key) => {
    const v = mmoEnv[key]
    if (!v) {
      console.error(`--only pvp needs ${key} in .env — run a full deploy first`)
      process.exit(1)
    }
    return v
  }
  const tokenAddress = need('SM_TOKEN_ADDRESS')
  const treasuryAddress = need('SM_TREASURY_ADDRESS')

  step('deploying gyms and the arena')
  const gyms = await deploy('StockmonstersGyms', [
    tokenAddress,
    treasuryAddress,
    battleSigner.address,
    PARAMS.gyms.minStake,
    PARAMS.gyms.maxStake,
  ])
  const arena = await deploy('StockmonstersArena', [
    tokenAddress,
    treasuryAddress,
    battleSigner.address,
    PARAMS.arena.maxWager,
    PARAMS.arena.dailyPayoutCap,
  ])

  // Nothing to wire on the token: a pons token has no owner and no tax, so
  // there is no exemption to grant. The old token taxed transfers, and an
  // escrow that received a stake short would end up owing more than it held.

  upsertEnv(mmoEnvPath, {
    ...newKeys,
    SM_GYMS_ADDRESS: gyms.address,
    SM_ARENA_ADDRESS: arena.address,
  })

  const file = join(MMO, 'deployments', `${CHAIN_NAME}.json`)
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, 'utf8'))
    existing.contracts.gyms = gyms.address
    existing.contracts.arena = arena.address
    existing.battleSigner = battleSigner.address
    existing.params = { ...existing.params, gyms: {
      minStake: PARAMS.gyms.minStake.toString(), maxStake: PARAMS.gyms.maxStake.toString(),
    }, arena: {
      maxWager: PARAMS.arena.maxWager.toString(), dailyPayoutCap: PARAMS.arena.dailyPayoutCap.toString(),
    } }
    writeFileSync(file, JSON.stringify(existing, null, 2) + '\n')
    log(`\nupdated ${file}`)
  }

  step('done')
  log(`  gyms   ${gyms.address}`)
  log(`  arena  ${arena.address}`)
  process.exit(0)
}

step('deploying')
/*
 * The token is NOT deployed here. pons launched it, and its address is an
 * input — everything below needs it, and nothing below can change it.
 */
const tokenAddress = getAddress(
  flag('token', null) ?? mmoEnv.SM_TOKEN_ADDRESS ?? process.env.SM_TOKEN_ADDRESS ?? '',
)
log(`  token (launched by pons)  ${tokenAddress}`)

/*
 * Where the operating half of revenue is pushed.
 *
 * Deliberately NOT the deployer. The deployer owns every contract here and can
 * upgrade all of them, and a key that both holds the upgrade authority and
 * receives the money is one compromise away from losing both at once.
 */
const opsWallet = getAddress(contractsEnv.FEE_RECEIVER ?? process.env.FEE_RECEIVER ?? '')
log(`  ops wallet                ${opsWallet}`)
if (opsWallet.toLowerCase() === deployer.address.toLowerCase()) {
  console.error('\nFEE_RECEIVER is the deployer. Use a separate wallet: the deployer can upgrade every contract.')
  process.exit(1)
}

const rewards = await deploy('StockmonstersRewards', [tokenAddress, claimSigner.address])
const treasury = await deploy('StockmonstersTreasury', [tokenAddress, rewards.address, opsWallet])
const nft = await deploy('StockmonstersNFT', [
  gameSigner.address,
  PARAMS.nft.imageBaseURI,
  PARAMS.nft.sealedImageURI,
])
const market = await deploy('StockmonstersMarket', [nft.address, treasury.address, PARAMS.marketFeeBps])
const gyms = await deploy('StockmonstersGyms', [
  tokenAddress, treasury.address, battleSigner.address, PARAMS.gyms.minStake, PARAMS.gyms.maxStake,
])
const arena = await deploy('StockmonstersArena', [
  tokenAddress, treasury.address, battleSigner.address, PARAMS.arena.maxWager, PARAMS.arena.dailyPayoutCap,
])

step('wiring')
await send('nft: fees → treasury', nft, 'setTreasury', [treasury.address])
await send('nft: accepts the token', nft, 'setAcceptedCurrency', [tokenAddress, true])
await send('nft: royalty → treasury', nft, 'setDefaultRoyalty', [treasury.address, PARAMS.royaltyBps])
await send('nft: claim fee', nft, 'setClaimFee', [parseEther(PARAMS.claimFeeEth)])
await send('market: accepts the token', market, 'setAcceptedCurrency', [tokenAddress, true])

// Where the money now comes from, and how it gets back to players. Without
// these two the treasury collects nothing and can buy nothing.
await send('treasury: collects from the pons escrow', treasury, 'setPonsSources', [PONS.feeEscrow, PONS.memeHook])
await send('treasury: buys back through the universal router', treasury, 'setRouter', [UNISWAP.universalRouter])

step('the rewards pool')
/*
 * IT STARTS EMPTY, AND THAT IS THE CHANGE.
 *
 * The old deploy transferred 100,000,000 tokens into the pool, because we had
 * minted the supply and could. pons mints the entire supply to the bonding
 * curve, so we hold none of it and there is nothing to transfer. The pool is
 * filled the only way left: revenue reaches the treasury as ETH, `buyback`
 * spends the players' half of it on the open market, and every token bought
 * lands here.
 *
 * The consequence to state out loud: until a buyback has run, a reward claim
 * has nothing to pay from. Epoch budgets are a CEILING on what a signer may
 * authorise, not a balance — funding fourteen of them against an empty pool
 * would authorise payouts that cannot settle.
 */
const DAY0 = Math.floor(Date.now() / 86_400_000)
const poolBalance = await publicClient.readContract({
  address: tokenAddress,
  abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view',
          inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
  functionName: 'balanceOf',
  args: [rewards.address],
})
log(`  pool holds ${formatEther(poolBalance)} tokens`)
if (poolBalance === 0n) {
  log('  no epochs funded — there is nothing to pay out yet.')
  log('  fill it with a buyback, then: node tools/fund-epochs.mjs')
} else {
  const perEpoch = poolBalance / 14n
  for (let e = 1; e <= 14; e++) {
    await send(`rewards: epoch ${e} funded`, rewards, 'fundEpoch', [BigInt(e), perEpoch])
  }
}

/* -------------------------------------------------------------- record ---*/

/*
 * What the token ACTUALLY says it is, read off the chain.
 *
 * PARAMS.token is what we would have asked a launchpad for, and the two are
 * not the same thing: this launch was requested as "$STONKSTER" and deployed
 * as "STONKSTERS". Recording the request would leave a file that looks
 * authoritative and disagrees with the contract, and anything reading a
 * ticker out of it would be wrong.
 */
const tokenErc20 = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]
const onChainToken = Object.fromEntries(await Promise.all(
  ['name', 'symbol', 'decimals', 'totalSupply'].map(async (fn) => [
    fn,
    String(await publicClient.readContract({ address: tokenAddress, abi: tokenErc20, functionName: fn })),
  ]),
))
log(`  token reports  ${onChainToken.name} (${onChainToken.symbol})`)

/*
 * The block the game's contracts appeared in.
 *
 * The event indexers scan FROM a block, and the value they were given used to
 * survive a chain change: a Sepolia block number pointed at Robinhood Chain
 * starts the scan 39 million blocks in the past and finds nothing, silently.
 * Recording it here, and writing it into the .env below, means the indexer's
 * starting point moves with the deployment rather than being remembered.
 */
const deployBlock = await publicClient.getBlockNumber()

const deployment = {
  chainId: target.chain.id,
  deployBlock: deployBlock.toString(),
  chain: CHAIN_NAME,
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  gameSigner: gameSigner.address,
  claimSigner: claimSigner.address,
  battleSigner: battleSigner.address,
  epochDay0: DAY0,
  tokenLaunchedBy: 'pons',
  pons: PONS,
  uniswap: UNISWAP,
  opsWallet,
  contracts: {
    token: tokenAddress,
    rewards: rewards.address,
    treasury: treasury.address,
    nft: nft.address,
    market: market.address,
    gyms: gyms.address,
    arena: arena.address,
  },
  /// Read from the deployed contract, not from what we asked for.
  token: onChainToken,
  params: {
    ...PARAMS,
    /// The launch REQUEST, kept only as a record of what was asked. The
    /// authoritative name and symbol are in `token` above.
    token: { ...PARAMS.token, supply: PARAMS.token.supply.toString(), requestedNotDeployed: true },
    rewardsSeed: PARAMS.rewardsSeed.toString(),
  },
}
const dir = join(MMO, 'deployments')
mkdirSync(dir, { recursive: true })
const file = join(dir, `${CHAIN_NAME}.json`)
/*
 * BigInt-aware, and this is not decoration.
 *
 * Two of PARAMS's numbers are BigInts that nothing stringified — the gym stake
 * range and the arena's limits — and JSON.stringify throws on those. It threw
 * AFTER a completely successful deploy: seven contracts live, wired and
 * funded, and then no record of a single address, because the last four lines
 * of the script are where the addresses get written down. They had to be
 * recovered by walking the deployer's nonces.
 */
writeFileSync(
  file,
  JSON.stringify(deployment, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
)

const envUpdates = {
  ...newKeys,
  SM_CHAIN_ID: String(target.chain.id),
  SM_EPOCH_DAY0: String(DAY0),
  SM_RPC_URL: target.rpc,
  SM_TOKEN_ADDRESS: tokenAddress,
  SM_REWARDS_ADDRESS: rewards.address,
  SM_TREASURY_ADDRESS: treasury.address,
  SM_MARKET_ADDRESS: market.address,
  BOX_NFT_ADDRESS: nft.address,
  SM_GYMS_ADDRESS: gyms.address,
  SM_ARENA_ADDRESS: arena.address,
  BOX_CHAIN_ID: String(target.chain.id),
  // The indexers' own RPC and starting block. Both were left behind on a
  // chain change before: the box indexer kept a Sepolia endpoint and a
  // Sepolia block height while every address around it had moved.
  BOX_RPC_URL: target.rpc,
  BOX_FROM_BLOCK: deployBlock.toString(),
  MARKET_FROM_BLOCK: deployBlock.toString(),
  // What the price oracle prices. Without it the game falls back to a
  // written-down guess at the token's value.
  SM_PRICE_TOKEN_ADDRESS: tokenAddress,
}
upsertEnv(mmoEnvPath, envUpdates)

step('done')
log(`wrote ${file}`)
log(`updated ${mmoEnvPath} (${Object.keys(envUpdates).length} keys${
  Object.keys(newKeys).length ? `, including ${Object.keys(newKeys).length} newly generated signer keys` : ''
})`)
log('\nAddresses:')
for (const [k, v] of Object.entries(deployment.contracts)) log(`  ${k.padEnd(10)} ${v}`)
const explorer = target.explorer ?? 'https://sepolia.etherscan.io'
log(`\nExplorer: ${explorer}/address/${treasury.address}`)
log('\nNot verified on a block explorer. Run forge verify-contract to publish the source.')

log('\nTHE TOKEN IS NOT OURS TO CONFIGURE. Two things still have to happen by hand:')
log(`  1. point the launch's creator fees at the treasury:`)
log(`     pons factory ${PONS.factory} → transferCreatorFeeRecipient(${tokenAddress}, ${treasury.address})`)
log('     callable only by the wallet that currently receives them.')
log('  2. fill the rewards pool with a buyback once fees have accrued.')
