import { describe, it, expect } from 'vitest'
import { encodeFunctionData, parseAbi, toFunctionSelector } from 'viem'
import {
  encodeFillOrder, encodeCancelOrder, encodeSetApprovalForAll,
  encodeIsApprovedForAll, encodeRoyaltyInfo, encodeTokenQuery, SELECTORS,
  type ChainOrder,
} from './market-source-chain'

/*
 * The marketplace calldata is written out by hand, for the same standing
 * reason box-shop.ts and duel-ui.ts are: viem is a server dependency and
 * shipping an ABI coder to every player for four calls is not a trade worth
 * making. The price of that decision is paid here.
 *
 * `fillOrder` is the one that matters. Its argument is a STRUCT of eleven
 * value types — which makes the struct static, so it encodes INLINE with no
 * offset and no length. Encode it as dynamic instead (the instinctive reading
 * of "a struct is a tuple, tuples are dynamic") and the call does not revert
 * cleanly: it reads the seller address out of an offset word, recovers a
 * signature for a different order, and fails with BAD_SIGNATURE — sending you
 * to look at the signing code, which is fine.
 *
 * So: same arguments, byte for byte the same calldata as viem, every time.
 */

const MARKET_ABI = parseAbi([
  'struct Order { address seller; uint256 tokenId; uint256 price; uint256 minProceeds; uint64 deadline; uint64 epoch; uint256 salt; bool requireSealed; bytes32 attrCommit; address taker; address currency; }',
  'function fillOrder(Order o, bytes signature)',
  'function cancelOrder(Order o)',
])
const NFT_ABI = parseAbi([
  'function setApprovalForAll(address operator,bool approved)',
  'function isApprovedForAll(address owner,address operator)',
  'function royaltyInfo(uint256 tokenId,uint256 salePrice)',
  'function opened(uint256 tokenId)',
  'function attrCommit(uint256 tokenId)',
])

const sig = (fill: string) => ('0x' + fill.repeat(65)) as `0x${string}`
const b32 = (fill: string) => ('0x' + fill.repeat(32)) as `0x${string}`
const addr = (fill: string) => ('0x' + fill.repeat(20)) as `0x${string}`

const ORDER: ChainOrder = {
  seller: addr('aa'),
  tokenId: '7',
  price: '12500000000000000',
  minProceeds: '11562500000000000',
  deadline: 4_000_000_000,
  epoch: 3,
  // A full-width uint256, so a salt that overflows a JS number is caught here
  // rather than by a wallet refusing to sign.
  salt: '115792089237316195423570985008687907853269984665640564039457584007913129639933',
  requireSealed: true,
  attrCommit: b32('c1'),
  taker: addr('00'),
  currency: addr('bb'),
}

const asTuple = (o: ChainOrder) => ({
  seller: o.seller as `0x${string}`,
  tokenId: BigInt(o.tokenId),
  price: BigInt(o.price),
  minProceeds: BigInt(o.minProceeds),
  deadline: BigInt(o.deadline),
  epoch: BigInt(o.epoch),
  salt: BigInt(o.salt),
  requireSealed: o.requireSealed,
  attrCommit: o.attrCommit as `0x${string}`,
  taker: o.taker as `0x${string}`,
  currency: o.currency as `0x${string}`,
})

describe('the pinned selectors', () => {
  const expected: Array<[keyof typeof SELECTORS, string]> = [
    ['fillOrder', 'fillOrder((address,uint256,uint256,uint256,uint64,uint64,uint256,bool,bytes32,address,address),bytes)'],
    ['cancelOrder', 'cancelOrder((address,uint256,uint256,uint256,uint64,uint64,uint256,bool,bytes32,address,address))'],
    ['setApprovalForAll', 'setApprovalForAll(address,bool)'],
    ['isApprovedForAll', 'isApprovedForAll(address,address)'],
    ['opened', 'opened(uint256)'],
    ['attrCommit', 'attrCommit(uint256)'],
    ['epochOf', 'epochOf(address)'],
    ['feeBps', 'feeBps()'],
    ['royaltyInfo', 'royaltyInfo(uint256,uint256)'],
    ['allowance', 'allowance(address,address)'],
    ['approve', 'approve(address,uint256)'],
  ]
  for (const [name, signature] of expected) {
    it(`${name} is the selector for ${signature}`, () => {
      expect(SELECTORS[name]).toBe(toFunctionSelector(signature))
    })
  }
})

describe('fillOrder', () => {
  it('matches viem byte for byte', () => {
    const theirs = encodeFunctionData({
      abi: MARKET_ABI, functionName: 'fillOrder', args: [asTuple(ORDER), sig('a1')],
    })
    expect(encodeFillOrder(ORDER, sig('a1')).toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('inlines the struct instead of pointing at it', () => {
    // The eleven struct members occupy words 0..10, so word 0 must be the
    // SELLER ADDRESS and not an offset of 0x20. This is the whole bug class.
    const body = encodeFillOrder(ORDER, sig('a1')).slice(10)
    expect('0x' + body.slice(24, 64)).toBe(ORDER.seller)
    // Word 11 is the only offset, and it points past all twelve head words.
    expect(Number(BigInt('0x' + body.slice(11 * 64, 12 * 64)))).toBe(384)
  })

  it('carries a full-width uint256 salt without losing precision', () => {
    const body = encodeFillOrder(ORDER, sig('a1')).slice(10)
    expect(BigInt('0x' + body.slice(6 * 64, 7 * 64)).toString()).toBe(ORDER.salt)
  })

  it('encodes an ETH order (currency zero) the same way viem does', () => {
    const eth = { ...ORDER, currency: addr('00'), requireSealed: false }
    const theirs = encodeFunctionData({
      abi: MARKET_ABI, functionName: 'fillOrder', args: [asTuple(eth), sig('b2')],
    })
    expect(encodeFillOrder(eth, sig('b2')).toLowerCase()).toBe(theirs.toLowerCase())
  })
})

describe('cancelOrder', () => {
  it('matches viem byte for byte', () => {
    const theirs = encodeFunctionData({ abi: MARKET_ABI, functionName: 'cancelOrder', args: [asTuple(ORDER)] })
    expect(encodeCancelOrder(ORDER).toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('has no tail at all — every member is a value type', () => {
    // 4 bytes of selector plus exactly eleven words. A twelfth word would mean
    // something dynamic crept in.
    expect(encodeCancelOrder(ORDER).length).toBe(2 + 8 + 11 * 64)
  })
})

describe('the approval and view calls', () => {
  it('setApprovalForAll matches viem', () => {
    const theirs = encodeFunctionData({
      abi: NFT_ABI, functionName: 'setApprovalForAll', args: [addr('cc'), true],
    })
    expect(encodeSetApprovalForAll(addr('cc'), true).toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('isApprovedForAll matches viem', () => {
    const theirs = encodeFunctionData({
      abi: NFT_ABI, functionName: 'isApprovedForAll', args: [addr('dd'), addr('ee')],
    })
    expect(encodeIsApprovedForAll(addr('dd'), addr('ee')).toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('royaltyInfo matches viem', () => {
    const theirs = encodeFunctionData({
      abi: NFT_ABI, functionName: 'royaltyInfo', args: [7n, 12_500_000_000_000_000n],
    })
    expect(encodeRoyaltyInfo('7', '12500000000000000').toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('the one-uint256 queries match viem', () => {
    expect(encodeTokenQuery(SELECTORS.opened, '7').toLowerCase())
      .toBe(encodeFunctionData({ abi: NFT_ABI, functionName: 'opened', args: [7n] }).toLowerCase())
    expect(encodeTokenQuery(SELECTORS.attrCommit, '7').toLowerCase())
      .toBe(encodeFunctionData({ abi: NFT_ABI, functionName: 'attrCommit', args: [7n] }).toLowerCase())
  })
})
