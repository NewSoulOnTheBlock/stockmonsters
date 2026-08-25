/*
 * Marketplace order signer. Run by the PLAYER's wallet in production (this CLI
 * exists for tooling, tests and the house account); the game server only
 * stores and serves the resulting signature.
 *
 *   node sign-order.mjs <sellerPk> <marketAddr> <chainId> <tokenId> <priceWei> \
 *        <minProceedsWei> <deadlineUnix> <epoch> <saltUint> <requireSealed> \
 *        <attrCommitHex32> [takerAddr]
 *
 * Prints JSON: { order, signature, signer }.
 *
 * Two things the order book MUST get right:
 *  - `requireSealed` has to match the token's CURRENT state. A sealed listing
 *    dies the moment the seller opens the box, on purpose.
 *  - Removing a listing from the UI is NOT a cancellation. Anyone who saved
 *    the signature can still fill it while the approval is live. Call
 *    cancelOrder() (or incrementEpoch()) on-chain.
 */
import { signOrder } from './voucher-lib.mjs'

const [pk, market, chainId, tokenId, price, minProceeds, deadline, epoch, salt, requireSealed, attrCommit, taker] =
  process.argv.slice(2)

if (!attrCommit) {
  console.error(
    'usage: node sign-order.mjs <sellerPk> <market> <chainId> <tokenId> <priceWei> <minProceedsWei> ' +
      '<deadlineUnix> <epoch> <salt> <requireSealed> <attrCommit> [taker]',
  )
  process.exit(1)
}

const { privateKeyToAccount } = await import('viem/accounts')
const seller = privateKeyToAccount(pk).address

const { signature, signer, order } = await signOrder({
  pk,
  market,
  chainId,
  order: {
    seller,
    tokenId,
    price,
    minProceeds,
    deadline,
    epoch,
    salt,
    requireSealed: requireSealed === 'true',
    attrCommit,
    taker,
  },
})

console.log(
  JSON.stringify(
    { order, signature, signer },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
)
