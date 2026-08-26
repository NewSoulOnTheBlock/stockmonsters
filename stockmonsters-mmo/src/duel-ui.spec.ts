import { describe, it, expect } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'
import { encodeOpen, encodeSettle, OPEN_SELECTOR, SETTLE_SELECTOR } from './duel-ui'
import { encodeClaim, encodeApprove, bytesTail, word } from './wallet-ui'

/*
 * The client hand-encodes its calldata: viem is a server dependency, and
 * shipping an ABI coder to every player for four function calls is not a trade
 * worth making. The cost of that decision is that an offset error produces a
 * transaction that does not revert — it reads garbage as a signature and fails
 * somewhere else entirely.
 *
 * So the encoders are checked against viem HERE, where it is free: same
 * arguments, byte-for-byte the same calldata. `open` is the one that matters —
 * two dynamic tails, and every head word counts toward both offsets.
 */

const ARENA_ABI = parseAbi([
  'function open(bytes32 matchId,address playerA,address playerB,uint256 amount,bytes32 seedCommit,bytes32 pickA,bytes32 pickB,uint64 expiry,bytes sigA,bytes sigB)',
  'function settle(bytes32 matchId,address winner,bytes32 seed,uint256 tokenA,bytes32 saltA,uint256 tokenB,bytes32 saltB,uint64 deadline,bytes signature)',
])
const REWARDS_ABI = parseAbi(['function claim(uint256 epoch,uint256 amount,uint64 deadline,bytes signature)'])
const ERC20_ABI = parseAbi(['function approve(address spender,uint256 value)'])

const sig = (fill: string) => '0x' + fill.repeat(65)
const b32 = (fill: string) => '0x' + fill.repeat(32)
const addr = (fill: string) => '0x' + fill.repeat(20)

describe('open', () => {
  const args = {
    matchId: b32('11'),
    playerA: addr('aa'),
    playerB: addr('bb'),
    amount: '1000000000000000000000000',
    seedCommit: b32('22'),
    pickA: b32('33'),
    pickB: b32('44'),
    expiry: 4_000_000_000,
    sigA: sig('a1'),
    sigB: sig('b2'),
  }

  it('matches viem byte for byte', () => {
    const mine = encodeOpen(args)
    const theirs = encodeFunctionData({
      abi: ARENA_ABI,
      functionName: 'open',
      args: [
        args.matchId as `0x${string}`,
        args.playerA as `0x${string}`,
        args.playerB as `0x${string}`,
        BigInt(args.amount),
        args.seedCommit as `0x${string}`,
        args.pickA as `0x${string}`,
        args.pickB as `0x${string}`,
        BigInt(args.expiry),
        args.sigA as `0x${string}`,
        args.sigB as `0x${string}`,
      ],
    })
    expect(mine.toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('starts with the selector cast reported', () => {
    expect(encodeOpen(args).slice(0, 10)).toBe(OPEN_SELECTOR)
  })

  it('puts the SECOND signature after the first, not on top of it', () => {
    // The bug this catches: computing both offsets from the head length and
    // pointing them at the same place. Both signatures would decode as the
    // first one and the match would open with a forged B side... or, more
    // likely, revert with BAD_SIGNATURE_B and send you hunting in the wrong
    // file.
    const data = encodeOpen(args)
    const body = data.slice(10)
    const offsetA = Number(BigInt('0x' + body.slice(8 * 64, 9 * 64)))
    const offsetB = Number(BigInt('0x' + body.slice(9 * 64, 10 * 64)))
    expect(offsetA).toBe(320)
    expect(offsetB).toBeGreaterThan(offsetA)
    // 65 bytes of signature padded to 96, plus the 32-byte length word.
    expect(offsetB - offsetA).toBe(128)
  })
})

describe('settle', () => {
  const args = {
    matchId: b32('12'),
    winner: addr('cc'),
    seed: b32('34'),
    tokenA: '42',
    saltA: b32('56'),
    tokenB: '77',
    saltB: b32('78'),
    deadline: 4_000_000_000,
    signature: sig('c3'),
  }

  it('matches viem byte for byte', () => {
    const theirs = encodeFunctionData({
      abi: ARENA_ABI,
      functionName: 'settle',
      args: [
        args.matchId as `0x${string}`,
        args.winner as `0x${string}`,
        args.seed as `0x${string}`,
        BigInt(args.tokenA),
        args.saltA as `0x${string}`,
        BigInt(args.tokenB),
        args.saltB as `0x${string}`,
        BigInt(args.deadline),
        args.signature as `0x${string}`,
      ],
    })
    expect(encodeSettle(args).toLowerCase()).toBe(theirs.toLowerCase())
  })

  it('starts with the selector cast reported', () => {
    expect(encodeSettle(args).slice(0, 10)).toBe(SETTLE_SELECTOR)
  })
})

describe('the rest of the hand-encoded calls', () => {
  it('claim matches viem', () => {
    const theirs = encodeFunctionData({
      abi: REWARDS_ABI,
      functionName: 'claim',
      args: [7n, 1234567890000000000n, 4_000_000_000n, sig('d4') as `0x${string}`],
    })
    expect(encodeClaim(7, '1234567890000000000', 4_000_000_000, sig('d4')).toLowerCase())
      .toBe(theirs.toLowerCase())
  })

  it('approve matches viem', () => {
    const theirs = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [addr('ee') as `0x${string}`, 5n],
    })
    expect(encodeApprove(addr('ee'), '5').toLowerCase()).toBe(theirs.toLowerCase())
  })
})

describe('the primitives', () => {
  it('pads a word to 32 bytes', () => {
    expect(word(1)).toHaveLength(64)
    expect(word('0x' + 'ff'.repeat(20))).toBe('0'.repeat(24) + 'ff'.repeat(20))
  })

  it('refuses a value too wide to be one word', () => {
    expect(() => word('0x' + 'ff'.repeat(33))).toThrow(/too wide/)
  })

  it('pads a bytes tail to a multiple of 32 and prefixes the length', () => {
    const tail = bytesTail(sig('01'))
    expect(BigInt('0x' + tail.slice(0, 64))).toBe(65n)
    expect((tail.length - 64) / 2).toBe(96) // 65 rounded up to three words
  })
})
