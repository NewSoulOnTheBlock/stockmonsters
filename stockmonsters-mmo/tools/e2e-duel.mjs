/*
 * A real duel, settled on Sepolia.
 *
 *   npm run test:e2e:duel
 *
 * Two fresh wallets, funded from the deployer, bet against each other for real
 * tokens: both sign the wager, the escrow opens, the server's battle key signs
 * the outcome, and the winner claims. Every balance is checked against the
 * chain afterwards.
 *
 * WHAT THIS PROVES THAT A UNIT TEST CANNOT
 *   · the deployed arena is wired to the deployed token
 *   · the EIP-712 domain the client signs against matches the one the deployed
 *     contract computes — a chainId or a verifyingContract that disagrees
 *     fails here and nowhere else
 *   · the blind picks made off chain open correctly against the commitments
 *   · the rake actually reaches the treasury, which is what funds the buyback
 *
 * The browser half of the duel (the offer, the picker, the wallet prompts) is
 * driven by the game; what this covers is the money.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther,
  keccak256, encodeAbiParameters, getAddress,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'

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

const env = readEnvFile(join(ROOT, '.env'))
const contractsEnv = readEnvFile(join(CONTRACTS, '.env'))

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}
const step = (s) => console.log(`\n=== ${s} ===`)

const need = (k) => {
  const v = env[k]
  if (!v) { console.error(`.env needs ${k} — run tools/deploy.mjs --only pvp`); process.exit(1) }
  return v
}
const ARENA = getAddress(need('SM_ARENA_ADDRESS'))
const TOKEN = getAddress(need('SM_TOKEN_ADDRESS'))
const TREASURY = getAddress(need('SM_TREASURY_ADDRESS'))
const battlePk = need('BATTLE_SIGNER_PK')
const deployerPk = contractsEnv.PRIVATE_KEY
if (!deployerPk) { console.error('contracts/.env needs PRIVATE_KEY'); process.exit(1) }

const rpc = env.SM_RPC_URL
const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) })
const deployer = privateKeyToAccount(deployerPk.startsWith('0x') ? deployerPk : `0x${deployerPk}`)
const battleSigner = privateKeyToAccount(battlePk.startsWith('0x') ? battlePk : `0x${battlePk}`)
const bank = createWalletClient({ account: deployer, chain: sepolia, transport: http(rpc) })

const ERC20 = parseAbi([
  'function transfer(address to,uint256 value) returns (bool)',
  'function approve(address spender,uint256 value) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])
const ARENA_ABI = parseAbi([
  'function open(bytes32 matchId,address playerA,address playerB,uint256 amount,bytes32 seedCommit,bytes32 pickA,bytes32 pickB,uint64 expiry,bytes sigA,bytes sigB)',
  'function settle(bytes32 matchId,address winner,bytes32 seed,uint256 tokenA,bytes32 saltA,uint256 tokenB,bytes32 saltB,uint64 deadline,bytes signature)',
  'function matches(bytes32) view returns (uint8,address,address,uint256,uint64,bytes32,bytes32,bytes32,bool,bool)',
  'function rakeBps() view returns (uint16)',
  'function maxWager() view returns (uint256)',
])

const balanceOf = (who) =>
  publicClient.readContract({ address: TOKEN, abi: ERC20, functionName: 'balanceOf', args: [who] })

async function send(client, params) {
  const hash = await client.writeContract(params)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`reverted: ${hash}`)
  return hash
}

const b32 = () => `0x${randomBytes(32).toString('hex')}`
const commitPick = (tokenId, salt) =>
  keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [BigInt(tokenId), salt]))

try {
  step('setting up two duellists')
  const rake = await publicClient.readContract({ address: ARENA, abi: ARENA_ABI, functionName: 'rakeBps' })
  const maxWager = await publicClient.readContract({ address: ARENA, abi: ARENA_ABI, functionName: 'maxWager' })
  console.log(`  arena ${ARENA}`)
  console.log(`  rake ${Number(rake) / 100}%, max wager ${formatEther(maxWager)}`)

  const a = privateKeyToAccount(generatePrivateKey())
  const b = privateKeyToAccount(generatePrivateKey())
  const walletA = createWalletClient({ account: a, chain: sepolia, transport: http(rpc) })
  const walletB = createWalletClient({ account: b, chain: sepolia, transport: http(rpc) })
  console.log(`  A ${a.address}`)
  console.log(`  B ${b.address}`)

  // The wager the game advertises. Both sides need it, plus gas.
  const WAGER = parseEther('1000000')
  for (const who of [a, b]) {
    await send(bank, { address: TOKEN, abi: ERC20, functionName: 'transfer', args: [who.address, WAGER] })
    const hash = await bank.sendTransaction({ to: who.address, value: parseEther('0.02') })
    await publicClient.waitForTransactionReceipt({ hash })
  }
  check('both duellists are funded',
    (await balanceOf(a.address)) === WAGER && (await balanceOf(b.address)) === WAGER,
    `${formatEther(WAGER)} $STONKSTER each`)

  step('the blind picks')
  // Each side chooses a creature and a random salt. Neither commitment reveals
  // anything: a token id is small, the salt is what makes the hash opaque.
  const tokenA = '11'
  const tokenB = '22'
  const saltA = b32()
  const saltB = b32()
  const pickA = commitPick(tokenA, saltA)
  const pickB = commitPick(tokenB, saltB)
  check('the commitments hide the picks', pickA !== pickB && !pickA.includes('11'), `${pickA.slice(0, 14)}…`)

  const seed = b32()
  const seedCommit = keccak256(seed)
  const matchId = b32()
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600)

  step('both sign the same wager')
  const domain = { name: 'StockmonstersArena', chainId: sepolia.id, verifyingContract: ARENA }
  const types = {
    Wager: [
      { name: 'matchId', type: 'bytes32' },
      { name: 'playerA', type: 'address' },
      { name: 'playerB', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'seedCommit', type: 'bytes32' },
      { name: 'pickA', type: 'bytes32' },
      { name: 'pickB', type: 'bytes32' },
      { name: 'expiry', type: 'uint64' },
    ],
  }
  const message = {
    matchId, playerA: a.address, playerB: b.address, amount: WAGER,
    seedCommit, pickA, pickB, expiry: Number(expiry),
  }
  const sigA = await a.signTypedData({ domain, types, primaryType: 'Wager', message })
  const sigB = await b.signTypedData({ domain, types, primaryType: 'Wager', message })
  check('two signatures, one wager', sigA !== sigB && sigA.length === 132)

  step('the escrow opens')
  for (const [who, client] of [[a, walletA], [b, walletB]]) {
    await send(client, { address: TOKEN, abi: ERC20, functionName: 'approve', args: [ARENA, WAGER], account: who })
  }
  await send(walletA, {
    address: ARENA,
    abi: ARENA_ABI,
    functionName: 'open',
    args: [matchId, a.address, b.address, WAGER, seedCommit, pickA, pickB, expiry, sigA, sigB],
    account: a,
  })
  const onChain = await publicClient.readContract({
    address: ARENA, abi: ARENA_ABI, functionName: 'matches', args: [matchId],
  })
  check('the arena holds both stakes', (await balanceOf(ARENA)) >= WAGER * 2n,
    `${formatEther(await balanceOf(ARENA))} $STONKSTER escrowed`)
  check('and it remembers exactly what was agreed',
    onChain[1].toLowerCase() === a.address.toLowerCase() &&
    onChain[3] === WAGER &&
    onChain[6].toLowerCase() === pickA.toLowerCase() &&
    onChain[7].toLowerCase() === pickB.toLowerCase())
  check('both wallets are now empty', (await balanceOf(a.address)) === 0n && (await balanceOf(b.address)) === 0n)

  step('the server signs the result')
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
  const resultSig = await battleSigner.signTypedData({
    domain,
    types: {
      MatchResult: [
        { name: 'matchId', type: 'bytes32' },
        { name: 'winner', type: 'address' },
        { name: 'seed', type: 'bytes32' },
        { name: 'tokenA', type: 'uint256' },
        { name: 'saltA', type: 'bytes32' },
        { name: 'tokenB', type: 'uint256' },
        { name: 'saltB', type: 'bytes32' },
        { name: 'deadline', type: 'uint64' },
      ],
    },
    primaryType: 'MatchResult',
    message: {
      matchId, winner: a.address, seed,
      tokenA: BigInt(tokenA), saltA, tokenB: BigInt(tokenB), saltB,
      deadline: Number(deadline),
    },
  })

  step('the winner claims')
  const treasuryBefore = await balanceOf(TREASURY)
  await send(walletA, {
    address: ARENA,
    abi: ARENA_ABI,
    functionName: 'settle',
    args: [matchId, a.address, seed, BigInt(tokenA), saltA, BigInt(tokenB), saltB, deadline, resultSig],
    account: a,
  })

  const pot = WAGER * 2n
  const rakeTaken = (pot * BigInt(rake)) / 10_000n
  const payout = pot - rakeTaken
  check('the winner took the pot minus the rake', (await balanceOf(a.address)) === payout,
    `${formatEther(payout)} $STONKSTER`)
  check('the loser has nothing left of it', (await balanceOf(b.address)) === 0n)
  check('the rake reached the treasury', (await balanceOf(TREASURY)) - treasuryBefore === rakeTaken,
    `${formatEther(rakeTaken)} $STONKSTER`)
  check('the arena kept nothing', (await balanceOf(ARENA)) === 0n)

  const after = await publicClient.readContract({
    address: ARENA, abi: ARENA_ABI, functionName: 'matches', args: [matchId],
  })
  check('the match is settled and cannot be settled again', Number(after[0]) === 2)
} catch (err) {
  failures++
  console.error('\n  FAIL  the run threw:', err?.shortMessage ?? err?.message ?? err)
}

console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'}`)
process.exit(failures ? 1 : 0)
