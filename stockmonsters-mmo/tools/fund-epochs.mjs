/*
 * Open reward epochs for claiming.
 *
 *   node tools/fund-epochs.mjs                 # the next 14 unfunded epochs
 *   node tools/fund-epochs.mjs --from 5 --to 20 --budget 250000
 *
 * An epoch is one UTC day. `fundEpoch` sets the CEILING on what may ever be
 * claimed from that day — the single control that stops a leaked claim signer
 * from emptying the pool, so it is a deliberate, owner-signed act rather than
 * something the game server can do for itself.
 *
 * Funding an epoch that is already funded is a no-op in effect (it just sets
 * the same number again), and lowering one below what has already been claimed
 * is refused by the contract.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia, foundry } from 'viem/chains'

const HERE = dirname(fileURLToPath(import.meta.url))
const MMO = resolve(HERE, '..')
const CONTRACTS = resolve(MMO, '../contracts')

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...readEnvFile(join(MMO, '.env')), ...process.env }
const contractsEnv = readEnvFile(join(CONTRACTS, '.env'))

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const rewards = env.SM_REWARDS_ADDRESS
const rpcUrl = env.SM_RPC_URL
const chainId = Number(env.SM_CHAIN_ID ?? 0)
const day0 = Number(env.SM_EPOCH_DAY0 ?? 0)
if (!rewards || !rpcUrl) {
  console.error('.env needs SM_REWARDS_ADDRESS and SM_RPC_URL — run tools/deploy.mjs first')
  process.exit(1)
}
const key = contractsEnv.PRIVATE_KEY ?? process.env.PRIVATE_KEY
if (!key) {
  console.error('contracts/.env needs PRIVATE_KEY — the owner of the rewards contract')
  process.exit(1)
}

const today = day0 ? Math.floor(Date.now() / 86_400_000) - day0 + 1 : 1
const from = Number(flag('from', today))
const to = Number(flag('to', from + 13))
const budget = parseEther(String(flag('budget', '1000000')))

const chain = chainId === 11155111 ? sepolia : foundry
const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) })

const ABI = parseAbi([
  'function fundEpoch(uint256 epoch, uint256 budget)',
  'function epochBudget(uint256) view returns (uint256)',
  'function epochClaimed(uint256) view returns (uint256)',
  'function balance() view returns (uint256)',
])

const poolBalance = await publicClient.readContract({ address: rewards, abi: ABI, functionName: 'balance' })
console.log(`rewards pool ${rewards}`)
console.log(`holds        ${formatEther(poolBalance)} tokens`)
console.log(`today is     epoch ${today}`)
console.log(`funding      epochs ${from}..${to} at ${formatEther(budget)} each\n`)

for (let epoch = from; epoch <= to; epoch++) {
  const already = await publicClient.readContract({
    address: rewards, abi: ABI, functionName: 'epochBudget', args: [BigInt(epoch)],
  })
  if (already >= budget) {
    console.log(`  epoch ${String(epoch).padStart(3)}  already at ${formatEther(already)} — skipped`)
    continue
  }
  const hash = await wallet.writeContract({
    address: rewards, abi: ABI, functionName: 'fundEpoch', args: [BigInt(epoch), budget],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`epoch ${epoch} reverted (${hash})`)
  console.log(`  epoch ${String(epoch).padStart(3)}  funded`)
}

console.log('\ndone')
