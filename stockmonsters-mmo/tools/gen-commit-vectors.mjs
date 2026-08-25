/*
 * JS <-> Solidity cross-check generator.
 *
 *   node tools/gen-commit-vectors.mjs            # (re)write contracts/CommitVectors.sol
 *   node tools/gen-commit-vectors.mjs --check    # exit 1 if the file is stale
 *
 * WHY THIS EXISTS
 * ---------------
 * `sign-voucher.mjs` computes the sealed-box commitment in viem;
 * `StockmonstersNFT.open()` recomputes it in Solidity. They agree only because
 * viem pads each element of a `uint8[6]` inside `encodePacked` to 32 bytes,
 * exactly as `abi.encodePacked` does. That is a subtle, version-fragile seam:
 * if viem ever changes it, every NFT minted in between becomes PERMANENTLY
 * UNOPENABLE, and nothing on-chain would notice.
 *
 * So: this script drives the real production signing code (voucher-lib.mjs)
 * over a set of fixed vectors and freezes the results into a Solidity library.
 * `CommitVectors.t.sol` then
 *   1. recomputes ivsHash / attrCommit / the EIP-712 digest in Solidity and
 *      asserts they equal the JS values,
 *   2. deploys the real contract at the address the vectors were signed for
 *      and actually mints + opens with the JS-produced signature and salt.
 *
 * Running `--check` in CI catches "someone bumped viem" before it ships.
 *
 * Addresses are deterministic: the vectors are signed for the CREATE address
 * of DEPLOYER at nonce 0 (NFT) and nonce 1 (market), which the forge test
 * reproduces with vm.setNonce + vm.startPrank.
 */
import { getAddress, getContractAddress, hashTypedData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  attrCommitment,
  ivsHash,
  signVoucher,
  signOrder,
  MINT_VOUCHER_TYPE,
  ORDER_TYPE,
  EIP712_DOMAIN_NAME,
  MARKET_DOMAIN_NAME,
} from './voucher-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../contracts/CommitVectors.sol')

const CHAIN_ID = 31337
const DEPLOYER = getAddress('0x00000000000000000000000000000000000d3910')
const SIGNER_PK = '0x0000000000000000000000000000000000000000000000000000000000a11ce5'
const SELLER_PK = '0x00000000000000000000000000000000000000000000000000000000000b0b00'

const NFT_ADDRESS = getContractAddress({ from: DEPLOYER, nonce: 0n })
const MARKET_ADDRESS = getContractAddress({ from: DEPLOYER, nonce: 1n })
const signerAddr = privateKeyToAccount(SIGNER_PK).address
const sellerAddr = privateKeyToAccount(SELLER_PK).address

// Fixed, deliberately awkward vectors: iv extremes, single- and dual-typed
// species, shiny and not, nature 0 and nature 24, a level-1 and a level-100.
const VECTORS = [
  {
    dexId: 1, level: 12, ivs: [31, 20, 15, 31, 25, 10], natureId: 3, shiny: true,
    caughtAt: 1756000000, salt: '0x' + 'c0ffee'.padStart(64, '0'),
    player: getAddress('0x000000000000000000000000000000000000beef'),
    uid: '0x' + '01'.padStart(64, '0'), fee: '10000000000000000', deadline: 4000000000,
  },
  {
    dexId: 254, level: 100, ivs: [31, 31, 31, 31, 31, 31], natureId: 24, shiny: false,
    caughtAt: 1700000001, salt: '0x' + 'ff'.repeat(32),
    player: getAddress('0x000000000000000000000000000000000000cafe'),
    uid: '0x' + '02'.padStart(64, '0'), fee: '10000000000000000', deadline: 4000000000,
  },
  {
    dexId: 781, level: 1, ivs: [0, 0, 0, 0, 0, 0], natureId: 0, shiny: false,
    caughtAt: 1, salt: '0x' + '00'.repeat(31) + '01',
    player: getAddress('0x000000000000000000000000000000000000d00d'),
    uid: '0x' + '03'.padStart(64, '0'), fee: '1', deadline: 4000000000,
  },
  {
    dexId: 65535, level: 255, ivs: [0, 31, 0, 31, 0, 31], natureId: 12, shiny: true,
    caughtAt: '18446744073709551615', salt: '0x' + 'de'.repeat(32),
    player: getAddress('0x000000000000000000000000000000000000f00d'),
    uid: '0x' + 'ff'.repeat(32), fee: '0', deadline: 4000000000,
  },
]

const sol = []
const push = (s = '') => sol.push(s)

const vectors = []
for (const v of VECTORS) {
  const attrCommit = attrCommitment(v)
  const h = ivsHash(v.ivs)
  const { signature } = await signVoucher({
    pk: SIGNER_PK,
    contract: NFT_ADDRESS,
    chainId: CHAIN_ID,
    voucher: { player: v.player, attrCommit, uid: v.uid, fee: v.fee, deadline: v.deadline },
  })
  const digest = hashTypedData({
    domain: { name: EIP712_DOMAIN_NAME, chainId: CHAIN_ID, verifyingContract: NFT_ADDRESS },
    types: { MintVoucher: MINT_VOUCHER_TYPE },
    primaryType: 'MintVoucher',
    message: {
      player: v.player, attrCommit, uid: v.uid, fee: BigInt(v.fee), deadline: Number(v.deadline),
    },
  })
  vectors.push({ ...v, attrCommit, ivsHash: h, digest, signature })
}

// One marketplace order, signed by the seller for the deterministic market.
const orderInput = {
  seller: sellerAddr,
  tokenId: 1,
  price: '1000000000000000000',
  minProceeds: '900000000000000000',
  deadline: 4000000000,
  epoch: 0,
  salt: '123456789',
  requireSealed: true,
  attrCommit: vectors[0].attrCommit,
  taker: '0x0000000000000000000000000000000000000000',
}
const { signature: orderSig } = await signOrder({
  pk: SELLER_PK, market: MARKET_ADDRESS, chainId: CHAIN_ID, order: orderInput,
})
const orderDigest = hashTypedData({
  domain: { name: MARKET_DOMAIN_NAME, chainId: CHAIN_ID, verifyingContract: MARKET_ADDRESS },
  types: { Order: ORDER_TYPE },
  primaryType: 'Order',
  message: {
    seller: orderInput.seller,
    tokenId: BigInt(orderInput.tokenId),
    price: BigInt(orderInput.price),
    minProceeds: BigInt(orderInput.minProceeds),
    deadline: Number(orderInput.deadline),
    epoch: Number(orderInput.epoch),
    salt: BigInt(orderInput.salt),
    requireSealed: orderInput.requireSealed,
    attrCommit: orderInput.attrCommit,
    taker: orderInput.taker,
  },
})

push('// SPDX-License-Identifier: MIT')
push('// GENERATED FILE — DO NOT EDIT BY HAND.')
push('// Source: stockmonsters-mmo/tools/gen-commit-vectors.mjs (which drives the real')
push('// production signer in tools/voucher-lib.mjs). Regenerate with:')
push('//   node stockmonsters-mmo/tools/gen-commit-vectors.mjs')
push('// CI guard: `node ... --check` fails if this file is stale.')
push('pragma solidity ^0.8.24;')
push()
push('library CommitVectors {')
push(`    uint256 internal constant COUNT = ${vectors.length};`)
push(`    uint256 internal constant CHAIN_ID = ${CHAIN_ID};`)
push(`    address internal constant DEPLOYER = ${DEPLOYER};`)
push(`    address internal constant NFT_ADDRESS = ${NFT_ADDRESS};`)
push(`    address internal constant MARKET_ADDRESS = ${MARKET_ADDRESS};`)
push(`    address internal constant GAME_SIGNER = ${signerAddr};`)
push(`    address internal constant SELLER = ${sellerAddr};`)
push()
push('    struct Vector {')
push('        uint16 dexId;')
push('        uint8 level;')
push('        uint8[6] ivs;')
push('        uint8 natureId;')
push('        bool shiny;')
push('        uint64 caughtAt;')
push('        bytes32 salt;')
push('        address player;')
push('        bytes32 uid;')
push('        uint256 fee;')
push('        uint64 deadline;')
push('        bytes32 ivsHash;')
push('        bytes32 attrCommit;')
push('        bytes32 digest;')
push('        bytes signature;')
push('    }')
push()
push('    function vector(uint256 i) internal pure returns (Vector memory v) {')
vectors.forEach((v, i) => {
  push(`        ${i === 0 ? 'if' : 'else if'} (i == ${i}) {`)
  push(`            v.dexId = ${v.dexId};`)
  push(`            v.level = ${v.level};`)
  push(`            v.ivs = [uint8(${v.ivs[0]}), ${v.ivs.slice(1).join(', ')}];`)
  push(`            v.natureId = ${v.natureId};`)
  push(`            v.shiny = ${v.shiny};`)
  push(`            v.caughtAt = ${v.caughtAt};`)
  push(`            v.salt = ${v.salt};`)
  push(`            v.player = ${v.player};`)
  push(`            v.uid = ${v.uid};`)
  push(`            v.fee = ${v.fee};`)
  push(`            v.deadline = ${v.deadline};`)
  push(`            v.ivsHash = ${v.ivsHash};`)
  push(`            v.attrCommit = ${v.attrCommit};`)
  push(`            v.digest = ${v.digest};`)
  push(`            v.signature = hex"${v.signature.slice(2)}";`)
  push('        }')
})
push('        else revert("NO_SUCH_VECTOR");')
push('    }')
push()
push('    struct OrderVector {')
push('        address seller;')
push('        uint256 tokenId;')
push('        uint256 price;')
push('        uint256 minProceeds;')
push('        uint64 deadline;')
push('        uint64 epoch;')
push('        uint256 salt;')
push('        bool requireSealed;')
push('        bytes32 attrCommit;')
push('        address taker;')
push('        bytes32 digest;')
push('        bytes signature;')
push('    }')
push()
push('    function orderVector() internal pure returns (OrderVector memory o) {')
push(`        o.seller = ${orderInput.seller};`)
push(`        o.tokenId = ${orderInput.tokenId};`)
push(`        o.price = ${orderInput.price};`)
push(`        o.minProceeds = ${orderInput.minProceeds};`)
push(`        o.deadline = ${orderInput.deadline};`)
push(`        o.epoch = ${orderInput.epoch};`)
push(`        o.salt = ${orderInput.salt};`)
push(`        o.requireSealed = ${orderInput.requireSealed};`)
push(`        o.attrCommit = ${orderInput.attrCommit};`)
push(`        o.taker = ${orderInput.taker};`)
push(`        o.digest = ${orderDigest};`)
push(`        o.signature = hex"${orderSig.slice(2)}";`)
push('    }')
push('}')
push()

const out = sol.join('\n')

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== out) {
    console.error(
      'CommitVectors.sol is STALE.\n' +
        'The JS signing path no longer produces the frozen vectors — either the\n' +
        'encoding changed (STOP: existing sealed boxes may become unopenable) or\n' +
        'the vectors need regenerating. Run:\n' +
        '  node stockmonsters-mmo/tools/gen-commit-vectors.mjs',
    )
    process.exit(1)
  }
  console.log('CommitVectors.sol is up to date.')
  process.exit(0)
}

fs.writeFileSync(OUT, out)
console.log(`wrote ${OUT} (${vectors.length} voucher vectors + 1 order vector)`)
