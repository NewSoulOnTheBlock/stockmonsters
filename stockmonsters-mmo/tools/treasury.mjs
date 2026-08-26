/*
 * Treasury operations.
 *
 *   node tools/treasury.mjs status
 *   node tools/treasury.mjs route
 *   node tools/treasury.mjs buyback --eth 0.05 --min 100000
 *
 * WHAT THE TREASURY DOES WITH REVENUE
 * Every fee the game charges — NFT claims, the marketplace rake, box sales —
 * lands in one contract. `route` splits it: half of it goes back into the game
 * (ETH is held as a buyback reserve, tokens go straight to the rewards pool
 * players are paid from), half funds operations.
 *
 * `buyback` is the half that has to be a separate, deliberate transaction:
 * swapping inside a fee-taking transfer would make every NFT buyer pay for our
 * DEX trade and hand a sandwich bot a free lunch. It spends reserve ETH on the
 * open market and sends every token bought to the rewards pool — never to us.
 *
 * `route` is permissionless by design: anyone may press it, nobody can change
 * where the money goes. `buyback` is owner-only because it names a slippage
 * floor.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia, foundry } from 'viem/chains'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CONTRACTS = resolve(ROOT, '../contracts')

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env }
const contractsEnv = readEnvFile(join(CONTRACTS, '.env'))
const args = process.argv.slice(2)
const command = args[0] ?? 'status'
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const treasury = env.SM_TREASURY_ADDRESS
const token = env.SM_TOKEN_ADDRESS
const rewards = env.SM_REWARDS_ADDRESS
const rpc = env.SM_RPC_URL
if (!treasury || !rpc) {
  console.error('.env needs SM_TREASURY_ADDRESS and SM_RPC_URL — run tools/deploy.mjs first')
  process.exit(1)
}

const chain = Number(env.SM_CHAIN_ID) === 11155111 ? sepolia : foundry
const publicClient = createPublicClient({ chain, transport: http(rpc) })

const TREASURY_ABI = parseAbi([
  'function buybackReserve() view returns (uint256)',
  'function playerShareBps() view returns (uint16)',
  'function rewardsPool() view returns (address)',
  'function opsWallet() view returns (address)',
  'function router() view returns (address)',
  'function route() returns (uint256,uint256,uint256,uint256)',
  'function buyback(uint256 amountIn, uint256 minOut, uint256 deadline) returns (uint256)',
  'function setRouter(address)',
])
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])

const walletFor = () => {
  const key = contractsEnv.PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!key) {
    console.error('contracts/.env needs PRIVATE_KEY for a transaction')
    process.exit(1)
  }
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
  return { account, client: createWalletClient({ account, chain, transport: http(rpc) }) }
}

async function send(functionName, functionArgs = []) {
  const { account, client } = walletFor()
  const hash = await client.writeContract({
    address: treasury, abi: TREASURY_ABI, functionName, args: functionArgs, account,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`)
  console.log(`  ${functionName} ok — ${hash}`)
  return receipt
}

async function status() {
  const [eth, reserve, share, pool, ops, router, held, poolHolds] = await Promise.all([
    publicClient.getBalance({ address: treasury }),
    publicClient.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'buybackReserve' }),
    publicClient.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'playerShareBps' }),
    publicClient.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'rewardsPool' }),
    publicClient.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'opsWallet' }),
    publicClient.readContract({ address: treasury, abi: TREASURY_ABI, functionName: 'router' }),
    token ? publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [treasury] }) : 0n,
    token && rewards
      ? publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [rewards] })
      : 0n,
  ])
  console.log(`treasury        ${treasury}`)
  console.log(`ETH held        ${formatEther(eth)}   (${formatEther(reserve)} reserved for buyback)`)
  console.log(`tokens held     ${formatEther(held)}`)
  console.log(`players' share  ${Number(share) / 100}%`)
  console.log(`rewards pool    ${pool}  holding ${formatEther(poolHolds)}`)
  console.log(`ops wallet      ${ops}`)
  console.log(`router          ${router === '0x0000000000000000000000000000000000000000' ? 'not set — buyback refuses' : router}`)
}

if (command === 'status') {
  await status()
} else if (command === 'route') {
  console.log('splitting whatever is sitting in the treasury…')
  await send('route')
  await status()
} else if (command === 'buyback') {
  const amount = parseEther(String(flag('eth', '0')))
  const minOut = parseUnits(String(flag('min', '0')), 18)
  if (amount === 0n) {
    console.error('say how much: --eth 0.05   (and please set --min, a zero floor is a free sandwich)')
    process.exit(1)
  }
  if (minOut === 0n) console.warn('WARNING: --min 0 means any price is acceptable. That is a gift to a sandwich bot.')
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
  console.log(`buying back with ${formatEther(amount)} ETH, floor ${formatEther(minOut)} tokens…`)
  await send('buyback', [amount, minOut, deadline])
  await status()
} else if (command === 'set-router') {
  const router = flag('address', '')
  if (!/^0x[0-9a-fA-F]{40}$/.test(router)) {
    console.error('pass --address 0x… (a Uniswap-V2-shaped router)')
    process.exit(1)
  }
  await send('setRouter', [router])
  await status()
} else {
  console.error(`unknown command "${command}" — try: status | route | buyback | set-router`)
  process.exit(1)
}
