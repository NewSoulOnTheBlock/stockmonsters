# Stockmonsters contracts

`StockmonstersNFT.sol` — the catch-to-mint ERC-721 (see HANDOVER "Direction
notes" for the agreed design):

- **Server-authoritative minting.** A catch happens in-game; the game server
  signs an EIP-712 `MintVoucher` for it (player address, dexId, level, IVs,
  nature, shiny, catch time, unique id). The player redeems the voucher from
  their own wallet via `mintCaught(...)` — they pay gas, the server holds no
  funds, and a voucher works exactly once.
- **On-chain individuality.** IVs/nature/shiny live in the `monsters`
  mapping, so every token is a verifiable unique individual, not just a
  species id.
- **No dependencies.** Minimal ERC-721 inline; compiles standalone with
  solc >= 0.8.24. Swap in OpenZeppelin if the surface grows.

## Deploy (when the time comes)

1. Generate a dedicated signer keypair for the game server; its address is
   the `gameSigner` constructor arg. Keep the private key in the server's
   env only.
2. Deploy with `forge create` or Remix to the target chain (the token map's
   existing per-monster contract addresses on RH Chain are separate
   token contracts — this NFT is a new collection).
3. Server-side voucher signing: viem `signTypedData` with domain
   `{ name: "Stockmonsters", chainId, verifyingContract }` and the
   `MintVoucher` type exactly as in the contract.
4. Wire the Box "Mint" button to request a voucher from the server, then
   submit the transaction from the player's wallet.

Not yet done: metadata service for `tokenURI` (serve JSON built from
`src/data/dex.json` + on-chain Monster fields), and the in-game glue.
