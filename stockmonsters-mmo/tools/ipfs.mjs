/*
 * The NFT art, packed for IPFS.
 *
 *   node tools/ipfs.mjs pack                  # build the folder, no network
 *   node tools/ipfs.mjs upload                # needs PINATA_JWT in .env
 *   node tools/ipfs.mjs check --cid bafy…     # does a gateway actually serve it?
 *   node tools/ipfs.mjs set --cid bafy…       # point the contract at it
 *
 * ## Which .env, and is a gateway needed
 *
 * `PINATA_JWT` goes in **stockmonsters-mmo/.env** — the same file the game
 * server reads, and the one this tool loads. (contracts/.env holds only the
 * deploy key; nothing there needs pinning credentials.)
 *
 * A gateway is **not** required. What goes on chain is `ipfs://<cid>/…`, and
 * wallets and marketplaces resolve that themselves. `PINATA_GATEWAY` is
 * optional and used for one thing only: proving, right after the upload, that
 * the art is really retrievable. Set it to your dedicated gateway host
 * (`something.mypinata.cloud`) if you have one — otherwise this falls back to
 * public gateways, which are rate limited but fine for a spot check.
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

/** Every file under `dir`, as paths relative to it, depth first and sorted. */
function walk(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel))
    else out.push(rel)
  }
  return out
}

/**
 * Pin the packed folder to Pinata in one request.
 *
 * The whole trick is the filename: giving each part a path like
 * `art/AAPL/regular.png` makes Pinata rebuild the directory tree and return the
 * CID of the ROOT folder, which is exactly what `imageBaseURI` needs. Upload
 * the files flat and you get 509 unrelated CIDs and no folder to point at.
 */
async function upload() {
  const provider = flag('provider', 'pinata')
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
  if (provider !== 'pinata') {
    console.error(`unknown provider "${provider}" — try: pinata, kubo`)
    process.exit(1)
  }

  const jwt = env.PINATA_JWT
  if (!jwt) {
    console.error('PINATA_JWT is not set.')
    console.error(`Put it in ${join(ROOT, '.env')} (that file is gitignored) and run this again:`)
    console.error('  PINATA_JWT=eyJhbGciOi…')
    console.error('\nPinata → API Keys → New Key → pinFileToIPFS permission → copy the JWT')
    console.error('(the JWT, not the "API Key"/"API Secret" pair)')
    process.exit(1)
  }

  const files = walk(OUT)
  const form = new FormData()
  let bytes = 0
  for (const rel of files) {
    const buf = readFileSync(join(OUT, rel))
    bytes += buf.length
    // The leading folder name is arbitrary — Pinata strips it and returns the
    // CID of what is inside — but it must be the SAME for every file.
    form.append('file', new Blob([buf], { type: 'image/png' }), `art/${rel}`)
  }
  form.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: false }))
  form.append('pinataMetadata', JSON.stringify({ name: 'stockmonsters-art' }))

  console.log(`uploading ${files.length} files (${human(bytes)}) to Pinata…`)
  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`Pinata refused it (HTTP ${res.status}):\n${text}`)
    if (res.status === 401) console.error('\nA 401 is the JWT: expired, revoked, or the key lacks pinFileToIPFS.')
    process.exit(1)
  }
  let body
  try { body = JSON.parse(text) } catch { console.error(`unreadable response:\n${text}`); process.exit(1) }
  const cid = body.IpfsHash
  if (!cid) { console.error(`no CID in the response:\n${text}`); process.exit(1) }

  console.log(`\n  cid: ${cid}`)
  if (body.isDuplicate) console.log('  (already pinned — same bytes, same CID, nothing was charged)')
  await check(cid)
  console.log('\nNext: node tools/ipfs.mjs set --cid ' + cid)
}

/* --------------------------------------------------------------- check ---*/

/**
 * A pin that no gateway will serve is not a pin. Fetch two real paths — the
 * ones the contract actually builds — before anybody points a contract at it.
 */
async function check(cid = flag('cid', '')) {
  if (!/^(baf|Qm)[A-Za-z0-9]+$/.test(cid)) {
    console.error('pass --cid <the folder cid>')
    process.exit(1)
  }
  const hosts = [
    env.PINATA_GATEWAY && `https://${env.PINATA_GATEWAY.replace(/^https?:\/\//, '').replace(/\/$/, '')}`,
    'https://gateway.pinata.cloud',
    'https://ipfs.io',
    'https://dweb.link',
  ].filter(Boolean)

  // Not the first alphabetically: a ticker we know exists, plus the box art.
  const paths = [`${cid}/AAPL/regular.png`, `${cid}/sealed.png`]
  let served = false
  for (const host of hosts) {
    const results = []
    for (const path of paths) {
      try {
        const r = await fetch(`${host}/ipfs/${path}`, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
        results.push(r.ok ? `ok ${human(Number(r.headers.get('content-length') ?? 0))}` : `HTTP ${r.status}`)
      } catch (e) {
        results.push(e.name === 'TimeoutError' ? 'timed out' : e.message)
      }
    }
    const ok = results.every((r) => r.startsWith('ok'))
    console.log(`  ${ok ? 'serves' : 'no   '}  ${host}  ${results.join(' / ')}`)
    if (ok) { served = true; break }
  }
  if (!served) {
    console.log('\nNo gateway served it. A fresh pin can take a minute to propagate —')
    console.log('re-run `node tools/ipfs.mjs check --cid ' + cid + '` before setting the contract.')
  }
  return served
}

/* ----------------------------------------------------------------- set ---*/

async function set() {
  const cid = flag('cid', '')
  if (!/^(baf|Qm)[A-Za-z0-9]+$/.test(cid)) {
    console.error('pass --cid <the folder cid the upload printed>')
    process.exit(1)
  }
  // Pointing the contract at art no gateway will serve gives every holder a
  // broken image, and the fix is another transaction. Look first.
  if (!args.includes('--force') && !(await check(cid))) {
    console.error('\nrefusing to point the contract at art nothing serves (--force to override)')
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
else if (command === 'check') await check()
else if (command === 'set') await set()
else {
  console.error(`unknown command "${command}" — try: pack | upload | check | set`)
  process.exit(1)
}
