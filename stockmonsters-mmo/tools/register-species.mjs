/*
 * Load the 254-species roster from src/data/dex.json into
 * StockmonstersNFT's on-chain registry, in batches.
 *
 *   node tools/register-species.mjs                       # dry run: print batches + calldata
 *   node tools/register-species.mjs --batch 40            # choose the batch size
 *   node tools/register-species.mjs --send \              # actually broadcast
 *        --rpc https://... --pk 0x... --nft 0x...
 *
 * WHY BATCHES: the whole roster in one call blows the block gas limit. 40 per
 * transaction leaves plenty of headroom (each entry is two string SSTOREs plus
 * one packed slot, ~120k gas).
 *
 * The script also VERIFIES the two lookup tables baked into the contract
 * (type names / nature names + modifiers) against the game's own data files,
 * so a renamed type or a reordered nature can never silently shift every
 * token's metadata. It refuses to run if they disagree.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeFunctionData } from 'viem'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const NFT_SOL = path.resolve(ROOT, '../contracts/StockmonstersNFT.sol')

const dex = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/dex.json'), 'utf8'))
const natures = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/studio/natures.json'), 'utf8'))

// ---------------------------------------------------------------- tables

/** Type ids are the index into the sorted list of renamed types in dex.json. */
export const TYPE_NAMES = [...new Set(dex.flatMap((d) => d.types))].sort()
/** Nature ids are the index into the alphabetical keys of natures.json,
 *  which is what src/battle/factory.ts uses (NATURE_NAMES = Object.keys). */
export const NATURE_NAMES = Object.keys(natures).sort()

const STAT_ORDER = ['atk', 'dfe', 'spd', 'ats', 'dfs']

const pad8 = (s) => {
  const b = Buffer.alloc(8)
  Buffer.from(s, 'ascii').copy(b)
  if (s.length > 8) throw new Error(`"${s}" does not fit an 8-byte table slot`)
  return b
}
const packNames = (names) => Buffer.concat(names.map(pad8)).toString('hex')

/** high nibble = boosted stat index, low nibble = reduced, 0xFF = neutral. */
const packNatureMods = () =>
  NATURE_NAMES.map((n) => {
    const s = natures[n]
    const up = STAT_ORDER.findIndex((k) => s[k] === 110)
    const down = STAT_ORDER.findIndex((k) => s[k] === 90)
    if (up < 0 && down < 0) return 'ff'
    if (up < 0 || down < 0) throw new Error(`nature ${n} boosts or reduces without the opposite`)
    return ((up << 4) | down).toString(16).padStart(2, '0')
  }).join('')

function verifyTables() {
  const sol = fs.readFileSync(NFT_SOL, 'utf8')
  const problems = []
  const capitalised = NATURE_NAMES.map((n) => n[0].toUpperCase() + n.slice(1))
  const expect = {
    TYPE_NAMES: packNames(TYPE_NAMES),
    NATURE_NAMES: packNames(capitalised),
    NATURE_MODS: packNatureMods(),
  }
  // The contract splits long constants over several hex"" literals; strip them
  // all out and compare the concatenation.
  for (const [label, want] of Object.entries(expect)) {
    const m = sol.match(new RegExp(`${label}\\s*=([\\s\\S]*?);`))
    if (!m) {
      problems.push(`${label}: not found in StockmonstersNFT.sol`)
      continue
    }
    const got = [...m[1].matchAll(/hex"([0-9a-fA-F]*)"/g)].map((x) => x[1]).join('').toLowerCase()
    if (got !== want) problems.push(`${label}: contract has\n  ${got}\nbut dex.json/natures.json imply\n  ${want}`)
  }
  if (TYPE_NAMES.length !== 18) problems.push(`expected 18 types, dex.json has ${TYPE_NAMES.length}`)
  if (NATURE_NAMES.length !== 25) problems.push(`expected 25 natures, natures.json has ${NATURE_NAMES.length}`)
  if (problems.length) {
    console.error('TABLE MISMATCH — the contract would render wrong metadata:\n' + problems.join('\n'))
    process.exit(1)
  }
}

// ---------------------------------------------------------------- entries

function toEntry(d) {
  const type1 = TYPE_NAMES.indexOf(d.types[0])
  const type2 = d.types.length > 1 ? TYPE_NAMES.indexOf(d.types[1]) : 255
  if (type1 < 0 || (d.types.length > 1 && type2 < 0)) throw new Error(`${d.ticker}: unknown type`)
  const stats = [d.stats.hp, d.stats.atk, d.stats.dfe ?? d.stats.def, d.stats.spd, d.stats.ats, d.stats.dfs]
  for (const s of stats) {
    if (!Number.isInteger(s) || s < 0 || s > 255) throw new Error(`${d.ticker}: base stat ${s} does not fit uint8`)
  }
  if (d.dexId > 65535) throw new Error(`${d.ticker}: dexId ${d.dexId} does not fit uint16`)
  return {
    dexId: d.dexId,
    type1,
    type2,
    baseStats: stats,
    speciesName: d.name,
    ticker: d.ticker,
  }
}

const REGISTER_ABI = [
  {
    type: 'function',
    name: 'registerSpecies',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'batch',
        type: 'tuple[]',
        components: [
          { name: 'dexId', type: 'uint16' },
          { name: 'type1', type: 'uint8' },
          { name: 'type2', type: 'uint8' },
          { name: 'baseStats', type: 'uint8[6]' },
          { name: 'speciesName', type: 'string' },
          { name: 'ticker', type: 'string' },
        ],
      },
    ],
    outputs: [],
  },
]

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(n)
  return i < 0 ? d : argv[i + 1]
}

verifyTables()

const batchSize = Number(flag('--batch', 40))
const entries = dex.map(toEntry)
const batches = []
for (let i = 0; i < entries.length; i += batchSize) batches.push(entries.slice(i, i + batchSize))

const calls = batches.map((b) => encodeFunctionData({ abi: REGISTER_ABI, functionName: 'registerSpecies', args: [b] }))

if (!argv.includes('--send')) {
  console.log(
    `tables verified against dex.json + natures.json\n` +
      `${entries.length} species -> ${batches.length} transactions of <=${batchSize}\n` +
      `types (id order): ${TYPE_NAMES.join(', ')}\n` +
      `natures (id order): ${NATURE_NAMES.join(', ')}\n`,
  )
  calls.forEach((c, i) =>
    console.log(`# batch ${i + 1}/${calls.length} (${batches[i].length} species, ${c.length / 2 - 1} bytes calldata)\n${c}\n`),
  )
  console.log('Dry run. Re-run with --send --rpc <url> --pk <key> --nft <address> to broadcast,')
  console.log('then call freezeSpecies() once you are happy — after that the registry is immutable.')
  process.exit(0)
}

const rpc = flag('--rpc')
const pk = flag('--pk')
const nftAddress = flag('--nft')
if (!rpc || !pk || !nftAddress) {
  console.error('--send requires --rpc, --pk and --nft')
  process.exit(1)
}

const { createWalletClient, createPublicClient, http } = await import('viem')
const { privateKeyToAccount } = await import('viem/accounts')
const account = privateKeyToAccount(pk)
const wallet = createWalletClient({ account, transport: http(rpc) })
const pub = createPublicClient({ transport: http(rpc) })
const chainId = await pub.getChainId()

for (let i = 0; i < batches.length; i++) {
  const hash = await wallet.sendTransaction({ to: nftAddress, data: calls[i], chain: null, chainId })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  console.log(`batch ${i + 1}/${batches.length}: ${hash} (${receipt.status}, gas ${receipt.gasUsed})`)
  if (receipt.status !== 'success') process.exit(1)
}
console.log('done — remember freezeSpecies() when the roster is final')
