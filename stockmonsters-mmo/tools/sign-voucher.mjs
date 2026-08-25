/*
 * The game server's voucher signer — the exact code path production will use.
 *
 *   node sign-voucher.mjs <signerPk> <contractAddr> <chainId> <playerAddr> \
 *        <dexId> <level> <iv1..iv6 csv> <natureId> <shiny> <caughtAt> <uidHex32>
 *
 * Prints JSON: { attrCommit, salt, signature } — attrCommit+signature go to
 * mintCaught; the (attributes, salt) pair is held back until the player opens.
 */
import { createWalletClient, http, keccak256, encodeAbiParameters, encodePacked } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import crypto from 'node:crypto'

const [pk, contract, chainId, player, dexId, level, ivsCsv, natureId, shiny, caughtAt, uid] = process.argv.slice(2)
const ivs = ivsCsv.split(',').map(Number)
const salt = '0x' + crypto.randomBytes(32).toString('hex')

const ivsHash = keccak256(encodePacked(['uint8[6]'], [ivs]))
const attrCommit = keccak256(encodeAbiParameters(
  [{ type: 'uint16' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'bool' }, { type: 'uint64' }, { type: 'bytes32' }],
  [Number(dexId), Number(level), ivsHash, Number(natureId), shiny === 'true', BigInt(caughtAt), salt],
))

const account = privateKeyToAccount(pk)
const signature = await account.signTypedData({
  domain: { name: 'Stockmonsters', chainId: Number(chainId), verifyingContract: contract },
  types: {
    MintVoucher: [
      { name: 'player', type: 'address' },
      { name: 'attrCommit', type: 'bytes32' },
      { name: 'uid', type: 'bytes32' },
    ],
  },
  primaryType: 'MintVoucher',
  message: { player, attrCommit, uid },
})
console.log(JSON.stringify({ attrCommit, salt, signature, signer: account.address }))
