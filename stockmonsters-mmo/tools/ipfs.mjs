/*
 * The NFT art, packed for IPFS.
 *
 *   node tools/ipfs.mjs pack                  # build the folder, no network
 *   node tools/ipfs.mjs upload --provider pinata
 *   node tools/ipfs.mjs set --cid bafy…       # point the contract at it
 *
 * ## What actually needs uploading, and what does not
 *
 * **The metadata does not.** `StockmonstersNFT.tokenURI` builds the JSON on
 * chain and returns it as a base64 data URI — there is no file to pin, no
 * gateway to go down, and no way for the description of a token to drift from
 * the token. That is strictly better than IPFS and it is already live.
 *
 * **The images do.** The JSON points at
 *     imageBaseURI + <TICKER> + "/regular.png"   (or "/shiny.png")
 * and `imageBaseURI` is currently `https://stockmonsters.game/dex/`, a domain
 * that does not exist. Every minted token therefore shows a broken image in a
 * wallet or on a marketplace. Pinning the art once and pointing the contract
 * at `ipfs://<cid>/` fixes it permanently: content-addressed, immutable, and
 * not dependent on our server being up in five years.
 *
 * ## The layout the contract expects
 *
 *   <cid>/AAPL/regular.png
 *   <cid>/AAPL/shiny.png
 *   … 254 of them …
 *   <cid>/sealed.png
 *
 * `pack` builds exactly that from `public/dex/`, generating the shiny variants
 * (we have one image per species, and shinies are a hue shift of it) and a
 * sealed-box image. It needs no network and no key, so the art can be checked
 * before anybody pays to pin it.
 */
import { readdirSync, mkdirSync, existsSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DEX = join(ROOT, 'public', 'dex')
const OUT = join(ROOT, 'dist', 'ipfs')

const args = process.argv.slice(2)
const command = args[0] ?? 'pack'
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

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

const human = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

/* ---------------------------------------------------------------- pack ---*/

/**
 * A shiny is the same creature in different colours. We have one image per
 * species, so the variant is generated: a hue rotation plus a little more
 * saturation, which is what a shiny reads as at 96px anyway.
 */
const shinyOf = (buf) => sharp(buf).modulate({ hue: 150, saturation: 1.25 }).png().toBuffer()

/** The one image every sealed box shows. Drawn here so it is not a stray asset. */
const SEALED_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" shape-rendering="crispEdges">
  <rect width="512" height="512" fill="#1b1730"/>
  <rect x="96" y="128" width="320" height="256" fill="#26213a" stroke="#f6c177" stroke-width="12"/>
  <rect x="96" y="128" width="320" height="72" fill="#2f2947" stroke="#f6c177" stroke-width="12"/>
  <rect x="232" y="128" width="48" height="256" fill="#f6c177" opacity="0.85"/>
  <circle cx="256" cy="272" r="42" fill="#1b1730" stroke="#f6c177" stroke-width="10"/>
  <text x="256" y="452" font-family="monospace" font-size="34" fill="#b9b2d6"
        text-anchor="middle" letter-spacing="6">SEALED</text>
</svg>`

async function pack() {
  if (!existsSync(DEX)) {
    console.error(`no art at ${DEX}`)
    process.exit(1)
  }
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const files = readdirSync(DEX).filter((f) => f.toLowerCase().endsWith('.png'))
  let bytes = 0
  for (const file of files) {
    const ticker = basename(file, '.png').toUpperCase()
    const dir = join(OUT, ticker)
    mkdirSync(dir, { recursive: true })
    const src = readFileSync(join(DEX, file))
    writeFileSync(join(dir, 'regular.png'), src)
    writeFileSync(join(dir, 'shiny.png'), await shinyOf(src))
    bytes += src.length
  }

  const sealed = await sharp(Buffer.from(SEALED_SVG)).png().toBuffer()
  writeFileSync(join(OUT, 'sealed.png'), sealed)

  // Walk it back to report what will actually be pinned.
  const total = (dir) =>
    readdirSync(dir, { withFileTypes: true }).reduce(
      (sum, e) => sum + (e.isDirectory() ? total(join(dir, e.name)) : statSync(join(dir, e.name)).size),
      0,
    )
  console.log(`packed ${files.length} species (regular + shiny) + sealed.png`)
  console.log(`  ${OUT}`)
  console.log(`  ${human(total(OUT))} across ${files.length * 2 + 1} files`)
  console.log('\nThe contract expects exactly this layout:')
  console.log('  <cid>/AAPL/regular.png   <cid>/AAPL/shiny.png   <cid>/sealed.png')
  console.log('\nNext: node tools/ipfs.mjs upload --provider pinata')
}

/* -------------------------------------------------------------- upload ---*/

/**
 * Uploading needs somebody's key. Rather than half-guess a provider, this says
 * exactly what is missing and stops — a pinning service that silently drops
 * the pin is worse than one that was never used.
 */
async function upload() {
  const provider = flag('provider', 'pinata')
  const keys = {
    pinata: 'PINATA_JWT',
    web3storage: 'WEB3_STORAGE_TOKEN',
    kubo: null, // a local node needs no key
  }
  if (!(provider in keys)) {
    console.error(`unknown provider "${provider}" — try: ${Object.keys(keys).join(', ')}`)
    process.exit(1)
  }
  if (!existsSync(OUT)) {
    console.error('nothing packed yet — run: node tools/ipfs.mjs pack')
    process.exit(1)
  }

  if (provider === 'kubo') {
    console.log('With a local IPFS node running:')
    console.log(`  ipfs add -r --cid-version 1 ${OUT}`)
    console.log('Take the LAST cid it prints (the folder), then:')
    console.log('  node tools/ipfs.mjs set --cid <cid>')
    console.log('\nA local pin is not a hosted pin: something has to keep serving it.')
    return
  }

  const key = env[keys[provider]]
  if (!key) {
    console.error(`${keys[provider]} is not set.`)
    console.error(`Put it in .env (it is gitignored) and run this again.`)
    console.error(provider === 'pinata'
      ? '  Pinata → API Keys → New Key → copy the JWT'
      : '  web3.storage → Account → Create API token')
    process.exit(1)
  }
  console.error(
    `Uploading ${OUT} to ${provider} is not wired up yet — deliberately.\n` +
    'It is one call, but pinning is a paid, account-bound action and this tool\n' +
    'has never been run against a real account. Use the provider\'s own CLI:\n' +
    provider === 'pinata'
      ? '  npx pinata-cli -u ' + OUT
      : '  npx w3 up ' + OUT,
  )
  process.exit(1)
}

/* ----------------------------------------------------------------- set ---*/

async function set() {
  const cid = flag('cid', '')
  if (!/^(baf|Qm)[A-Za-z0-9]+$/.test(cid)) {
    console.error('pass --cid <the folder cid the upload printed>')
    process.exit(1)
  }
  const { createPublicClient, createWalletClient, http, parseAbi } = await import('viem')
  const { privateKeyToAccount } = await import('viem/accounts')
  const { sepolia, foundry } = await import('viem/chains')

  const contractsEnv = readEnvFile(resolve(ROOT, '../contracts/.env'))
  const key = contractsEnv.PRIVATE_KEY ?? process.env.PRIVATE_KEY
  const nft = env.BOX_NFT_ADDRESS
  if (!key || !nft || !env.SM_RPC_URL) {
    console.error('needs contracts/.env PRIVATE_KEY, and BOX_NFT_ADDRESS + SM_RPC_URL in .env')
    process.exit(1)
  }
  const chain = Number(env.SM_CHAIN_ID) === 11155111 ? sepolia : foundry
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`)
  const publicClient = createPublicClient({ chain, transport: http(env.SM_RPC_URL) })
  const wallet = createWalletClient({ account, chain, transport: http(env.SM_RPC_URL) })
  const abi = parseAbi([
    'function setImageBaseURI(string uri)',
    'function setSealedImageURI(string uri)',
    'function imageBaseURI() view returns (string)',
  ])

  for (const [fn, value] of [
    ['setImageBaseURI', `ipfs://${cid}/`],
    ['setSealedImageURI', `ipfs://${cid}/sealed.png`],
  ]) {
    const hash = await wallet.writeContract({ address: nft, abi, functionName: fn, args: [value] })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`${fn} reverted (${hash})`)
    console.log(`  ${fn} → ${value}`)
  }
  console.log('\nnow:', await publicClient.readContract({ address: nft, abi, functionName: 'imageBaseURI' }))
  console.log('Every token already minted picks this up immediately — the JSON is')
  console.log('built on chain, so there is nothing cached to invalidate.')
}

/* ----------------------------------------------------------------- run ---*/

if (command === 'pack') await pack()
else if (command === 'upload') await upload()
else if (command === 'set') await set()
else {
  console.error(`unknown command "${command}" — try: pack | upload | set`)
  process.exit(1)
}
