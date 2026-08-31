/*
 * Deploy the whole economy to a chain, wire it together, and print the .env
 * block the game needs.
 *
 *   cd contracts && forge build
 *   cd ../stockmonsters-mmo && node tools/deploy.mjs --chain sepolia
 *
 * WHAT IT DEPLOYS, IN THIS ORDER (the order matters — each needs the last):
 *
 *   1. StockmonstersToken     the currency. Tax destinations are set to the
 *                             deployer for one block, then repointed, because
 *                             the pool and the treasury need the token's own
 *                             address to exist first.
 *   2. StockmonstersRewards   the pool players are paid out of
 *   3. StockmonstersTreasury  where revenue lands and is split
 *   4. StockmonstersNFT       the creatures
 *   5. StockmonstersMarket    peer-to-peer trading
 *
 * ...then it wires them: the token's tax goes to the pool and the treasury,
 * the NFT and the market accept the token and send their fees to the treasury,
 * and every game contract is tax-exempt (they are not traders).
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
  anvil: { chain: foundry, rpc: process.env.RPC_URL ?? 'http://127.0.0.1:8545' },
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
    name: 'Stockmonsters',
    symbol: 'SMON',
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
const rawKey = contractsEnv.PRIVATE_KEY ?? process.env.PRIVATE_KEY
if (!rawKey || !/^(0x)?[0-9a-fA-F]{64}$/.test(rawKey)) {
  console.error('contracts/.env needs PRIVATE_KEY=0x… (64 hex chars) — the deployer key')
  process.exit(1)
}
const deployerKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`
const deployer = privateKeyToAccount(deployerKey)

// The two SERVER keys. Generated once and kept in the game's .env; never the
// same key, so one compromise is not both.
const mmoEnvPath = join(MMO, '.env')
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

  step('wiring')
  const tokenContract = { address: tokenAddress, abi: artifact('StockmonstersToken').abi }
  // Escrow contracts are not traders: a stake moving in or out must arrive
  // whole, or the contract ends up owing more than it holds.
  await send('token: gyms are tax-exempt', tokenContract, 'setTaxExempt', [gyms.address, true])
  await send('token: the arena is tax-exempt', tokenContract, 'setTaxExempt', [arena.address, true])

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
// The token's tax destinations cannot be their final values yet: neither
// contract exists. Point them at the deployer and repoint below — the token is
// not tradable until a pair is registered, so nothing is taxed in between.
const token = await deploy('StockmonstersToken', [
  PARAMS.token.name,
  PARAMS.token.symbol,
  PARAMS.token.supply,
  deployer.address,
  deployer.address,
  PARAMS.token.logo,
  PARAMS.token.description,
])
const rewards = await deploy('StockmonstersRewards', [token.address, claimSigner.address])
const treasury = await deploy('StockmonstersTreasury', [token.address, rewards.address, deployer.address])
const nft = await deploy('StockmonstersNFT', [
  gameSigner.address,
  PARAMS.nft.imageBaseURI,
  PARAMS.nft.sealedImageURI,
])
const market = await deploy('StockmonstersMarket', [nft.address, treasury.address, PARAMS.marketFeeBps])
const gyms = await deploy('StockmonstersGyms', [
  token.address, treasury.address, battleSigner.address, PARAMS.gyms.minStake, PARAMS.gyms.maxStake,
])
const arena = await deploy('StockmonstersArena', [
  token.address, treasury.address, battleSigner.address, PARAMS.arena.maxWager, PARAMS.arena.dailyPayoutCap,
])

step('wiring')
await send('token: tax → rewards pool + treasury', token, 'setTaxDestinations', [rewards.address, treasury.address])
await send('token: game contracts are tax-exempt (nft)', token, 'setTaxExempt', [nft.address, true])
await send('token: game contracts are tax-exempt (market)', token, 'setTaxExempt', [market.address, true])
await send('nft: fees → treasury', nft, 'setTreasury', [treasury.address])
await send('nft: accepts SMON', nft, 'setAcceptedCurrency', [token.address, true])
await send('nft: royalty → treasury', nft, 'setDefaultRoyalty', [treasury.address, PARAMS.royaltyBps])
await send('nft: claim fee', nft, 'setClaimFee', [parseEther(PARAMS.claimFeeEth)])
await send('market: accepts SMON', market, 'setAcceptedCurrency', [token.address, true])
await send('token: gyms are tax-exempt', token, 'setTaxExempt', [gyms.address, true])
await send('token: the arena is tax-exempt', token, 'setTaxExempt', [arena.address, true])

step('funding the rewards pool')
await send(
  `token: ${formatEther(PARAMS.rewardsSeed)} SMON → rewards pool`,
  token,
  'transfer',
  [rewards.address, PARAMS.rewardsSeed],
)
// Epochs are one UTC day each, counted from today. Funding a fortnight up
// front means nobody has to remember to do it during a test week; topping up
// later is `node tools/fund-epochs.mjs`.
const DAY0 = Math.floor(Date.now() / 86_400_000)
const EPOCHS_AHEAD = 14
for (let e = 1; e <= EPOCHS_AHEAD; e++) {
  await send(`rewards: epoch ${e} funded`, rewards, 'fundEpoch', [BigInt(e), parseEther('1000000')])
}

/* -------------------------------------------------------------- record ---*/

const deployment = {
  chainId: target.chain.id,
  chain: CHAIN_NAME,
  deployedAt: new Date().toISOString(),
  deployer: deployer.address,
  gameSigner: gameSigner.address,
  claimSigner: claimSigner.address,
  battleSigner: battleSigner.address,
  epochDay0: DAY0,
  contracts: {
    token: token.address,
    rewards: rewards.address,
    treasury: treasury.address,
    nft: nft.address,
    market: market.address,
    gyms: gyms.address,
    arena: arena.address,
  },
  params: {
    ...PARAMS,
    token: { ...PARAMS.token, supply: PARAMS.token.supply.toString() },
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
  SM_TOKEN_ADDRESS: token.address,
  SM_REWARDS_ADDRESS: rewards.address,
  SM_TREASURY_ADDRESS: treasury.address,
  SM_MARKET_ADDRESS: market.address,
  BOX_NFT_ADDRESS: nft.address,
  SM_GYMS_ADDRESS: gyms.address,
  SM_ARENA_ADDRESS: arena.address,
  BOX_CHAIN_ID: String(target.chain.id),
}
upsertEnv(mmoEnvPath, envUpdates)

step('done')
log(`wrote ${file}`)
log(`updated ${mmoEnvPath} (${Object.keys(envUpdates).length} keys${
  Object.keys(newKeys).length ? `, including ${Object.keys(newKeys).length} newly generated signer keys` : ''
})`)
log('\nAddresses:')
for (const [k, v] of Object.entries(deployment.contracts)) log(`  ${k.padEnd(10)} ${v}`)
log(`\nExplorer: https://sepolia.etherscan.io/address/${token.address}`)
log('\nNot verified on Etherscan — deliberate. Run forge verify-contract later if wanted.')
