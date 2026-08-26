/*
 * The order book's verification rules — the half of market.mjs that decides
 * whether a stranger's signature is worth putting in front of buyers.
 *
 *   node --test test/market.test.mjs
 *
 * No database and no chain: `checkOrderFillable` takes its chain reads through
 * a small injected interface precisely so these can be driven against a stub.
 * That is not a compromise, it is the point — the failures that matter here
 * are "we indexed an order whose approval had been revoked" and "we indexed an
 * order for a box that was opened after signing", and each of those is one
 * line of stub and one assertion, versus a testnet transaction and a wait.
 *
 * The two things a stub CANNOT check are pinned against the live deployment
 * instead: the EIP-712 type hash and the domain separator of the market at
 * SM_MARKET_ADDRESS on Sepolia, both read off chain once and written down
 * here. If the typed-data shape in tools/voucher-lib.mjs ever drifts from the
 * contract, every signature this server accepts becomes unfillable — so that
 * drift fails here rather than in a player's wallet.
 */
import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256, toBytes, hashDomain, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import {
  normaliseOrder, orderHash, recoverOrderSeller, checkOrderFillable,
  MarketError, ORDER_TYPE, MARKET_DOMAIN_NAME,
} from '../market.mjs'
import { signOrder } from '../tools/voucher-lib.mjs'

const ZERO = '0x0000000000000000000000000000000000000000'
const CHAIN_ID = 11155111
const MARKET = '0x095bdB719e6c626b69C0ab0b5f9C6B657bedbe2E'
const SMON = '0x9FF2cC8CdfC70d36e473Ae6cECCa0728D73c0580'

const SELLER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const STRANGER_PK = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const seller = privateKeyToAccount(SELLER_PK)
const stranger = privateKeyToAccount(STRANGER_PK)

const COMMIT = '0x' + 'c1'.repeat(32)
const PRICE = 12_500_000_000_000_000n // 0.0125 ETH

const baseOrder = (over = {}) => normaliseOrder({
  seller: seller.address,
  tokenId: '7',
  price: PRICE.toString(),
  minProceeds: '0',
  deadline: Math.floor(Date.now() / 1000) + 7 * 86_400,
  epoch: 0,
  salt: '424242',
  requireSealed: true,
  attrCommit: COMMIT,
  taker: ZERO,
  currency: ZERO,
  ...over,
})

const sign = (order, pk = SELLER_PK) =>
  signOrder({ pk, market: MARKET, chainId: CHAIN_ID, order }).then((r) => r.signature)

/**
 * A chain that agrees with everything. Each test overrides exactly the one
 * answer it is about, which keeps every case readable as the sentence it is
 * testing rather than as a wall of setup.
 */
const stubReader = (over = {}) => ({
  ownerOf: async () => seller.address,
  opened: async () => false,
  attrCommit: async () => COMMIT,
  isApprovedForAll: async () => true,
  getApproved: async () => ZERO,
  epochOf: async () => 0n,
  orderConsumed: async () => false,
  acceptedCurrency: async () => true,
  feeBps: async () => 250n,
  // 5% to the treasury, matching the deployed collection.
  royaltyInfo: async (_tokenId, price) => ['0x3313aa2f787cD4d8Ca158f7fB00beb9c67E1a577', (BigInt(price) * 5n) / 100n],
  ...over,
})

/** Assert the call is refused, and refused for the stated reason. */
async function refuses(code, run) {
  await assert.rejects(run, (err) => {
    assert.ok(err instanceof MarketError, `expected a MarketError, got ${err}`)
    assert.equal(err.code, code, `refused with "${err.code}" (${err.message}) instead of "${code}"`)
    // Every refusal is shown to a player, so an empty one is a bug of its own.
    assert.ok(err.message.length > 20, 'a refusal with no explanation is a dead end for the seller')
    return true
  })
}

describe('the typed data matches the deployed contract', () => {
  test('ORDER_TYPEHASH', () => {
    const encoded = `Order(${ORDER_TYPE.map((f) => `${f.type} ${f.name}`).join(',')})`
    assert.equal(
      keccak256(toBytes(encoded)),
      // StockmonstersMarket.ORDER_TYPEHASH(), read off Sepolia.
      '0x3da54a89341f2b72d078b3d81acad885839b911eed71baea38c84211f7556b2f',
      'the Order type string has drifted from the contract — every signature would be unfillable',
    )
  })

  test('the domain separator', () => {
    assert.equal(
      hashDomain({
        domain: { name: MARKET_DOMAIN_NAME, chainId: CHAIN_ID, verifyingContract: getAddress(MARKET) },
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
        },
      }),
      // StockmonstersMarket.DOMAIN_SEPARATOR(), read off Sepolia.
      '0xdc83f5a4f691ad435148a3bd394d8cfbbd844e01470a2ad4e9dc36ed9bcd22b8',
    )
  })

  test('an order hash is stable and 32 bytes', () => {
    const hash = orderHash({ order: baseOrder(), market: MARKET, chainId: CHAIN_ID })
    assert.match(hash, /^0x[0-9a-f]{64}$/)
    assert.equal(hash, orderHash({ order: baseOrder(), market: MARKET, chainId: CHAIN_ID }))
  })

  test('changing one field changes the hash', () => {
    const a = orderHash({ order: baseOrder(), market: MARKET, chainId: CHAIN_ID })
    const b = orderHash({ order: baseOrder({ price: (PRICE + 1n).toString() }), market: MARKET, chainId: CHAIN_ID })
    assert.notEqual(a, b)
  })

  test('the same order on another chain is a different order', () => {
    assert.notEqual(
      orderHash({ order: baseOrder(), market: MARKET, chainId: CHAIN_ID }),
      orderHash({ order: baseOrder(), market: MARKET, chainId: 1 }),
    )
  })
})

describe('normaliseOrder', () => {
  test('lowercases addresses and stringifies every uint', () => {
    const o = baseOrder()
    assert.equal(o.seller, seller.address.toLowerCase())
    assert.equal(typeof o.price, 'string')
    assert.equal(typeof o.salt, 'string')
    assert.equal(o.currency, ZERO)
  })

  test('carries a full-width uint256 without losing precision', () => {
    const salt = (2n ** 256n - 1n).toString()
    assert.equal(baseOrder({ salt }).salt, salt)
  })

  test('refuses a uint that does not fit its field', () => {
    assert.throws(() => baseOrder({ tokenId: (2n ** 256n).toString() }), /out of range/)
    assert.throws(() => baseOrder({ deadline: (2n ** 64n).toString() }), /out of range/)
    assert.throws(() => baseOrder({ price: '-1' }), /out of range/)
  })

  test('refuses a malformed address or commitment', () => {
    assert.throws(() => baseOrder({ seller: '0xnope' }), /not an address/)
    assert.throws(() => baseOrder({ attrCommit: '0xdead' }), /32 bytes/)
  })
})

describe('recoverOrderSeller', () => {
  test('finds the signer', async () => {
    const order = baseOrder()
    const signature = await sign(order)
    assert.equal(
      await recoverOrderSeller({ order, market: MARKET, chainId: CHAIN_ID, signature }),
      seller.address.toLowerCase(),
    )
  })

  test('a signature for a different price recovers to somebody else', async () => {
    // Not an error — ecrecover always returns SOME address. That is exactly
    // why the caller compares it to the named seller rather than trusting a
    // signature to fail loudly.
    const signature = await sign(baseOrder())
    const recovered = await recoverOrderSeller({
      order: baseOrder({ price: (PRICE * 2n).toString() }),
      market: MARKET, chainId: CHAIN_ID, signature,
    })
    assert.notEqual(recovered, seller.address.toLowerCase())
  })

  test('refuses something that is not 65 bytes', async () => {
    await refuses('bad-signature', () => recoverOrderSeller({
      order: baseOrder(), market: MARKET, chainId: CHAIN_ID, signature: '0xdeadbeef',
    }))
  })
})

describe('checkOrderFillable', () => {
  const run = (over = {}, readerOver = {}, orderOver = {}) => async () => {
    const order = baseOrder(orderOver)
    const signature = over.signature ?? await sign(order, over.pk ?? SELLER_PK)
    return checkOrderFillable({
      order, signature, market: MARKET, chainId: CHAIN_ID, reader: stubReader(readerOver),
    })
  }

  test('accepts an order every check agrees with', async () => {
    const out = await run()()
    assert.match(out.hash, /^0x[0-9a-f]{64}$/)
    // 2.5% fee + 5% royalty on 0.0125 ETH.
    assert.equal(out.fee, (PRICE * 250n / 10_000n).toString())
    assert.equal(out.royalty, (PRICE * 5n / 100n).toString())
    assert.equal(out.proceeds, (PRICE - PRICE * 250n / 10_000n - PRICE * 5n / 100n).toString())
  })

  test('refuses a signature made by anybody else', async () => {
    assert.notEqual(stranger.address, seller.address)
    await refuses('wrong-signer', run({ pk: STRANGER_PK }))
  })

  test('refuses a price of zero', async () => {
    await refuses('zero-price', run({}, {}, { price: '0' }))
  })

  test('refuses an order that has already expired', async () => {
    await refuses('already-expired', run({}, {}, { deadline: Math.floor(Date.now() / 1000) - 1 }))
  })

  test('refuses a deadline years out', async () => {
    await refuses('deadline-too-far', run({}, {}, { deadline: Math.floor(Date.now() / 1000) + 400 * 86_400 }))
  })

  test('refuses a currency the contract does not accept', async () => {
    await refuses('currency-not-accepted', run({}, { acceptedCurrency: async () => false }, { currency: SMON }))
  })

  test('but never asks about ETH — address(0) is always accepted', async () => {
    // A reader that throws on acceptedCurrency proves the ETH path does not
    // consult the whitelist, which the contract also does not.
    await run({}, { acceptedCurrency: async () => { throw new Error('should not be asked') } })()
  })

  test('refuses an order the chain has already consumed', async () => {
    await refuses('order-consumed', run({}, { orderConsumed: async () => true }))
  })

  test('refuses an order from somebody who no longer owns the token', async () => {
    await refuses('not-the-owner', run({}, { ownerOf: async () => stranger.address }))
  })

  test('refuses an order the market cannot move', async () => {
    await refuses('not-approved', run({}, { isApprovedForAll: async () => false, getApproved: async () => ZERO }))
  })

  test('accepts a single-token approval instead of the blanket one', async () => {
    await run({}, { isApprovedForAll: async () => false, getApproved: async () => MARKET })()
  })

  test('refuses an order the seller has mass-cancelled past', async () => {
    await refuses('stale-epoch', run({}, { epochOf: async () => 4n }))
  })

  test('refuses a sealed-priced order once the box has been opened', async () => {
    // The one that costs a seller real money if it slips through: the contents
    // are public now, and the price was set on the odds.
    await refuses('seal-mismatch', run({}, { opened: async () => true }))
  })

  test('refuses an opened-priced order for a token that is still sealed', async () => {
    await refuses('seal-mismatch', run({}, { opened: async () => false }, { requireSealed: false }))
  })

  test('refuses an order whose commitment no longer matches the token', async () => {
    await refuses('commit-mismatch', run({}, { attrCommit: async () => '0x' + 'ab'.repeat(32) }))
  })

  test('refuses an order that would pay the seller under their own floor', async () => {
    // The seller signed a floor of the whole price; fee and royalty make that
    // impossible, and the contract would revert with PROCEEDS_TOO_LOW.
    await refuses('proceeds-too-low', run({}, {}, { minProceeds: PRICE.toString() }))
  })

  test('accepts a floor that today\'s fee and royalty still clear', async () => {
    const floor = PRICE - PRICE * 250n / 10_000n - PRICE * 5n / 100n
    await run({}, {}, { minProceeds: floor.toString() })()
  })

  test('a zero royalty receiver means no royalty is deducted', async () => {
    const out = await run({}, { royaltyInfo: async () => [ZERO, 999n] })()
    assert.equal(out.royalty, '0')
  })
})
