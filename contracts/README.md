# Stockmonsters contracts

Two contracts, no dependencies, Foundry. See **[DESIGN.md](./DESIGN.md)** for
why the sealed box and the marketplace are shaped the way they are — including
the lemons-market problem that the contract deliberately does *not* try to
solve on its own.

| File | What it is |
|---|---|
| `StockmonstersNFT.sol` | Sealed-box catch-to-mint ERC-721 + ERC-2981 + fully on-chain, dual-state `tokenURI` |
| `StockmonstersMarket.sol` | Off-chain EIP-712 signed orders, on-chain settlement, no escrow |
| `CommitVectors.sol` | **Generated.** JS-produced test vectors — do not edit by hand |
| `TestHelpers.sol` | Inline `Vm` interface, base64 decoder, hostile receiver contracts |

```
forge build --sizes     # StockmonstersNFT must stay under 24,576 B (EIP-170)
forge test              # 81 tests
```

`optimizer = true, runs = 200` is **required**: unoptimised, the on-chain
metadata renderer puts the NFT ~11 KB over the EIP-170 code-size limit. Current
runtime size is 22,232 B, leaving ~2.3 KB of headroom. `test_runtimeCodeSizeUnderEip170`
fails the suite before a deploy ever could.

---

## StockmonstersNFT

### Sealed minting

The **game server is authoritative**: a catch happens in-game, the server signs
an EIP-712 `MintVoucher`, the player redeems it from their own wallet. The
player pays gas; the server never holds funds; a voucher works exactly once.

```solidity
MintVoucher(address player, bytes32 attrCommit, bytes32 uid, uint256 fee, uint64 deadline)
```

Claiming is **optional** (the creature is playable in-game either way) and
**sealed**: `attrCommit` is all that goes on-chain.

```
attrCommit = keccak256(abi.encode(
    dexId, level, keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, salt))
```

Nothing about the creature is readable on-chain until the owner calls `open()`
with the reveal payload the server hands them. `open()` is gated on the owner
(or their operator) — not for cryptographic reasons (the commitment already
binds the data, so a wrong reveal reverts whoever submits it) but so a third
party cannot spoil a sealed listing.

> **`salt` is the whole seal.** The other committed fields carry roughly 2^40
> of joint entropy — trivially brute-forceable offline. `salt` must be 256 bits
> of CSPRNG output, never derived from the uid, the player address or a
> counter. `tools/voucher-lib.mjs` uses `crypto.randomBytes(32)`.

> **The chain does not enforce scarcity.** Because the contract cannot see a
> sealed dexId, it cannot cap shinies or per-species supply the way an
> open-attributes mint could. Shiny rarity is guaranteed by the **signer key**,
> enforced server-side before it signs. Do not let anyone assume otherwise.

`fee` and `deadline` are bound into the signature, so `setClaimFee` can neither
brick nor front-run an outstanding voucher. `claimFee` remains as the
*advertised* price the client and server read.

### On-chain metadata, in two states

`tokenURI` returns a base64 `data:application/json` document built entirely in
Solidity. There is no metadata server — which matters here beyond convenience:
a metadata server for a sealed collection would have to hold the salts, which
reintroduces exactly the leak the commitment exists to prevent.

- **Sealed** → a generic `"Sealed Stockmonster Box #N"` document. Identical for
  every box apart from the id. `test_sealedBoxLeaksNothing` asserts this
  byte-for-byte against a golden copy.
- **Opened** → name, species, ticker, types, level, nature, shiny, the raw IV
  spread, IV total, the six display stats and the catch date.
- **Opened onto an unregistered dexId** → a reduced document rather than a
  revert, so the token never becomes invisible to wallets.

Display stats are computed on-chain from the stored IVs against the species
registry, using **our** formulas (`src/battle/stats.ts` /
`docs/psdk-mechanics.md` §2.1, EVs always 0):

```
maxHp = (ivHp + 2*baseHp) * level / 100 + 10 + level
stat  = ((2*base + iv) * level / 100 + 5) * naturePercent / 100
```

`naturePercent` is the raw 90/100/110 integer, and the multiply-then-floor is
the **last** operation. `test_finalStatsMatchPsdkFormula` pins a hand-computed
reference line.

### Species registry

254 records (name, ticker, two types, six base stats) live in contract storage,
loaded post-deploy in batches — the full roster in one call blows the block gas
limit.

```
node stockmonsters-mmo/tools/register-species.mjs                 # dry run, prints calldata
node stockmonsters-mmo/tools/register-species.mjs --send \
     --rpc <url> --pk <key> --nft <address>
```

7 transactions of 40 (~3.1 M gas each). The script **verifies** that the type
and nature lookup tables baked into the contract still match `dex.json` and
`studio/natures.json` and refuses to run if they have drifted — a reordered
nature would silently change every token's stats.

Call `freezeSpecies()` when the roster is final. Without it, the owner could
rewrite the species behind an already-sold token.

### Also on the NFT

- Both `safeTransferFrom` overloads with a real `IERC721Receiver` check
  (previously absent — every escrow, bridge and marketplace that calls
  `safeTransferFrom` reverted against us).
- **Two-step ownership** (`transferOwnership` → `acceptOwnership`), so a
  multisig can take over and a typo cannot brick the contract.
- **ERC-2981** `royaltyInfo`, settable receiver and bps, hard-capped at
  `MAX_ROYALTY_BPS = 1000` (10%).
- `supportsInterface` advertises `0x01ffc9a7 / 0x80ac58cd / 0x5b5e139f / 0x2a55205a`.

## StockmonstersMarket

Off-chain signed orders, on-chain settlement, **no escrow** — a sealed box in
escrow could not be opened by its owner, which would turn "list" into "commit
to sell". The seller keeps custody and approves the market; listing and
re-pricing cost zero gas.

```solidity
Order(address seller, uint256 tokenId, uint256 price, uint256 minProceeds,
      uint64 deadline, uint64 epoch, uint256 salt, bool requireSealed,
      bytes32 attrCommit, address taker)
```

At fill time the market checks the order against **live chain state**:

| Check | Stops |
|---|---|
| `opened(tokenId) == !requireSealed` | the seller opening the box to front-run a sealed-priced fill (and the reverse) |
| `attrCommit(tokenId) == order.attrCommit` | any substitution of a different creature |
| `ownerOf(tokenId) == seller` | filling after the token moved |
| `epoch == epochOf[seller]` | orders the seller mass-cancelled |
| `!orderConsumed[hash]` | replay and post-cancellation fills |
| `proceeds >= minProceeds` | an owner raising the fee or royalty between signing and filling |

Cancellation is on-chain: `cancelOrder(order)` for one, `incrementEpoch()` to
kill every outstanding order at once. **Delisting in the game UI is not a
cancellation** — a saved signature plus a live approval stays fillable.

Payouts are checks-effects-interactions behind a reentrancy guard, pushed with
a 30k-gas stipend and credited to a `pendingWithdrawals` pull ledger if the
push fails, so no payee can brick a sale. Protocol fee is hard-capped at
`MAX_FEE_BPS = 500` (5%); royalties follow ERC-2981.

ETH only, ask orders only. See DESIGN.md for what that leaves out.

## Tooling (`stockmonsters-mmo/tools/`)

| Script | Purpose |
|---|---|
| `voucher-lib.mjs` | **The** EIP-712 signing code. Everything else imports it |
| `sign-voucher.mjs` | Server CLI: mint voucher + commitment + salt |
| `sign-order.mjs` | Marketplace order signer |
| `register-species.mjs` | Batch-load the roster; verifies the on-chain lookup tables |
| `gen-commit-vectors.mjs` | Regenerates `contracts/CommitVectors.sol`; `--check` in CI |

### The cross-check you must not remove

`voucher-lib.mjs` computes the commitment in viem; `open()` recomputes it in
Solidity. They agree only because viem pads each element of a `uint8[6]` inside
`encodePacked` to 32 bytes, exactly as `abi.encodePacked` does. If that ever
diverges, **every NFT minted in between becomes permanently unopenable** and
nothing on-chain would notice.

`gen-commit-vectors.mjs` drives the real production signer over fixed vectors
and freezes the output into `CommitVectors.sol`. `CommitVectors.t.sol` then

1. recomputes the ivs hash, the commitment and both EIP-712 digests in Solidity
   and asserts they equal the JS values, and
2. deploys the contracts at the exact addresses the vectors were signed for and
   **actually mints and opens** with the JS-produced signature and salt.

CI should run both halves:

```
node stockmonsters-mmo/tools/gen-commit-vectors.mjs --check
forge test
```

## Deploy checklist

1. Generate a dedicated signer keypair for the game server; its address is the
   `gameSigner` constructor arg. Private key in the server's env only.
2. `forge create StockmonstersNFT --constructor-args <gameSigner> <imageBaseURI> <sealedImageURI>`.
3. `register-species.mjs --send`, then `freezeSpecies()`.
4. `setDefaultRoyalty(<treasury>, <bps ≤ 1000>)`.
5. `forge create StockmonstersMarket --constructor-args <nft> <feeRecipient> <feeBps ≤ 500>`.
6. `transferOwnership(<multisig>)` on **both**, then `acceptOwnership()` from
   the multisig. Verify `owner()` changed before retiring the deploy key.
7. Wire the game: voucher endpoint → `mintCaught`, order book → `fillOrder`.

Still to do: the order-book service and in-game market UI, and the
reveal-payload durability story (see DESIGN.md, "Open risks").
