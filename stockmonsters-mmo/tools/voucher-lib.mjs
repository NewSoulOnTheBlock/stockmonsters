/*
 * The single source of truth for every EIP-712 payload the game server signs.
 *
 * Both the production CLIs (sign-voucher.mjs, sign-order.mjs) and the Solidity
 * cross-check generator (gen-commit-vectors.mjs) import THIS file, so the
 * forge suite is testing the exact code path production uses — not a copy of
 * it that can silently drift.
 *
 * If you change anything here you must regenerate contracts/CommitVectors.sol
 * (`node tools/gen-commit-vectors.mjs`) and `forge test` will tell you whether
 * Solidity still agrees. A divergence in `attrCommitment()` would make every
 * NFT minted in between PERMANENTLY UNOPENABLE, so treat a red cross-check as
 * a stop-the-line event.
 */
import { keccak256, encodeAbiParameters, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import crypto from 'node:crypto'

export const EIP712_DOMAIN_NAME = 'Stockmonsters'
export const MARKET_DOMAIN_NAME = 'StockmonstersMarket'

/** 256 bits of CSPRNG. The seal is only as strong as this value — never
 *  derive it from the uid, the player address or a counter. */
export const randomSalt = () => `0x${crypto.randomBytes(32).toString('hex')}`

/**
 * keccak256(abi.encodePacked(uint8[6])) — matches Solidity's padding of each
 * value-type array element to 32 bytes (192 bytes total, NOT 6).
 */
export function ivsHash(ivs) {
  if (!Array.isArray(ivs) || ivs.length !== 6) throw new Error('ivs must be 6 numbers')
  for (const iv of ivs) if (!Number.isInteger(iv) || iv < 0 || iv > 31) throw new Error(`bad iv: ${iv}`)
  return keccak256(encodePacked(['uint8[6]'], [ivs.map(Number)]))
}

/**
 * The sealed-box commitment. Mirrors, byte for byte:
 *   keccak256(abi.encode(dexId, level, keccak256(abi.encodePacked(ivs)),
 *                        natureId, shiny, caughtAt, salt))
 * in StockmonstersNFT.open().
 */
export function attrCommitment({ dexId, level, ivs, natureId, shiny, caughtAt, salt }) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint16' }, // dexId
        { type: 'uint8' }, // level
        { type: 'bytes32' }, // keccak(ivs)
        { type: 'uint8' }, // natureId
        { type: 'bool' }, // shiny
        { type: 'uint64' }, // caughtAt
        { type: 'bytes32' }, // salt
      ],
      [Number(dexId), Number(level), ivsHash(ivs), Number(natureId), Boolean(shiny), BigInt(caughtAt), salt],
    ),
  )
}

export const MINT_VOUCHER_TYPE = [
  { name: 'player', type: 'address' },
  { name: 'attrCommit', type: 'bytes32' },
  { name: 'uid', type: 'bytes32' },
  { name: 'fee', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
]

/**
 * The ERC-20 mint voucher is a DIFFERENT TYPE, not the ETH one with a field
 * added. Two distinct type hashes mean an ETH voucher can never be replayed as
 * a token voucher whatever the fee happens to be.
 */
export const MINT_VOUCHER_ERC20_TYPE = [
  { name: 'player', type: 'address' },
  { name: 'attrCommit', type: 'bytes32' },
  { name: 'uid', type: 'bytes32' },
  { name: 'currency', type: 'address' },
  { name: 'fee', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
]

export const ORDER_TYPE = [
  { name: 'seller', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'price', type: 'uint256' },
  { name: 'minProceeds', type: 'uint256' },
  { name: 'deadline', type: 'uint64' },
  { name: 'epoch', type: 'uint64' },
  { name: 'salt', type: 'uint256' },
  { name: 'requireSealed', type: 'bool' },
  { name: 'attrCommit', type: 'bytes32' },
  { name: 'taker', type: 'address' },
  // Signed, so a price and the asset it is denominated in cannot be separated.
  { name: 'currency', type: 'address' },
]

/** Sign a MintVoucher. `voucher` = { player, attrCommit, uid, fee, deadline }. */
export async function signVoucher({ pk, contract, chainId, voucher }) {
  const account = privateKeyToAccount(pk)
  const signature = await account.signTypedData({
    domain: { name: EIP712_DOMAIN_NAME, chainId: Number(chainId), verifyingContract: contract },
    types: { MintVoucher: MINT_VOUCHER_TYPE },
    primaryType: 'MintVoucher',
    message: {
      player: voucher.player,
      attrCommit: voucher.attrCommit,
      uid: voucher.uid,
      fee: BigInt(voucher.fee),
      deadline: Number(voucher.deadline),
    },
  })
  return { signature, signer: account.address }
}

/** Sign a MintVoucherERC20 — the same claim, priced in a whitelisted token. */
export async function signVoucherERC20({ pk, contract, chainId, voucher }) {
  const account = privateKeyToAccount(pk)
  const signature = await account.signTypedData({
    domain: { name: EIP712_DOMAIN_NAME, chainId: Number(chainId), verifyingContract: contract },
    types: { MintVoucherERC20: MINT_VOUCHER_ERC20_TYPE },
    primaryType: 'MintVoucherERC20',
    message: {
      player: voucher.player,
      attrCommit: voucher.attrCommit,
      uid: voucher.uid,
      currency: voucher.currency,
      fee: BigInt(voucher.fee),
      deadline: Number(voucher.deadline),
    },
  })
  return { signature, signer: account.address }
}

/** Sign a marketplace Order (an ask). Signed by the SELLER's wallet. */
export async function signOrder({ pk, market, chainId, order }) {
  const account = privateKeyToAccount(pk)
  const message = {
    seller: order.seller,
    tokenId: BigInt(order.tokenId),
    price: BigInt(order.price),
    minProceeds: BigInt(order.minProceeds ?? 0),
    deadline: Number(order.deadline),
    epoch: Number(order.epoch ?? 0),
    salt: BigInt(order.salt),
    requireSealed: Boolean(order.requireSealed),
    attrCommit: order.attrCommit,
    taker: order.taker ?? '0x0000000000000000000000000000000000000000',
    currency: order.currency ?? '0x0000000000000000000000000000000000000000',
  }
  const signature = await account.signTypedData({
    domain: { name: MARKET_DOMAIN_NAME, chainId: Number(chainId), verifyingContract: market },
    types: { Order: ORDER_TYPE },
    primaryType: 'Order',
    message,
  })
  return { signature, signer: account.address, order: message }
}
