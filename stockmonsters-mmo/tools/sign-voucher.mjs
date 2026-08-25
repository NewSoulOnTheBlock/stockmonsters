/*
 * The game server's voucher signer — the exact code path production will use.
 * All the crypto lives in voucher-lib.mjs, which the forge cross-check
 * (contracts/CommitVectors.t.sol) consumes, so this CLI and the contract can
 * never drift apart unnoticed.
 *
 *   node sign-voucher.mjs <signerPk> <contractAddr> <chainId> <playerAddr> \
 *        <dexId> <level> <iv1..iv6 csv> <natureId> <shiny> <caughtAt> \
 *        <uidHex32> <feeWei> <deadlineUnix>
 *
 * Prints JSON: { attrCommit, salt, signature, ... }. attrCommit + signature +
 * fee + deadline go to mintCaught(); the (attributes, salt) pair is held back
 * until the player opens the box.
 *
 * NOTE: `salt` is the entire strength of the seal. It is 256 CSPRNG bits here.
 * The other committed fields carry only ~2^40 joint entropy, so a predictable
 * salt would let anyone brute-force the contents of every sealed box offline.
 */
import { attrCommitment, randomSalt, signVoucher } from './voucher-lib.mjs'

const [pk, contract, chainId, player, dexId, level, ivsCsv, natureId, shiny, caughtAt, uid, fee, deadline] =
  process.argv.slice(2)

if (!deadline) {
  console.error(
    'usage: node sign-voucher.mjs <pk> <contract> <chainId> <player> <dexId> <level> <ivsCsv> ' +
      '<natureId> <shiny> <caughtAt> <uid> <feeWei> <deadlineUnix>',
  )
  process.exit(1)
}

const ivs = ivsCsv.split(',').map(Number)
const salt = randomSalt()
const attrCommit = attrCommitment({
  dexId,
  level,
  ivs,
  natureId,
  shiny: shiny === 'true',
  caughtAt,
  salt,
})

const { signature, signer } = await signVoucher({
  pk,
  contract,
  chainId,
  voucher: { player, attrCommit, uid, fee, deadline },
})

console.log(JSON.stringify({ attrCommit, salt, signature, signer, fee, deadline }))
