# Sealed boxes and a marketplace for them

Design notes for `StockmonstersNFT.sol` and `StockmonstersMarket.sol`. The
README says what the code does; this says why, and what it costs.

---

## 1. The sealed box

A Stockmonster is caught **in the game**, on the server, during a battle the
chain cannot see. The chain's job is to record the catch, not to adjudicate it.
So the server signs an EIP-712 voucher and the player redeems it.

What goes on-chain at mint is a single hash:

```
attrCommit = keccak256(abi.encode(
    dexId, level, keccak256(abi.encodePacked(ivs)), natureId, shiny, caughtAt, salt))
```

and nothing else. The token is a **sealed box**. Later, its owner calls
`open()` with the reveal payload and the contract checks it against the
commitment. This is the product: an NFT you can trade without either party
knowing what is inside, until someone decides to look.

### What the seal actually guarantees

It guarantees that **the chain** learns nothing. That is a narrower claim than
it sounds, and the difference is the single most important thing in this
document:

- The **player** caught the creature. Their client showed them the species and
  the shiny flag; depending on the UI, the IV spread too.
- The **server** knows everything, and holds the salt.
- Only the **chain**, and therefore only a prospective buyer, is in the dark.

A sealed-box listing is not a lottery ticket. It is a used car sold by someone
who has read the service history. §4 is about what to do with that.

### Where the seal can break

The commitment's non-salt fields carry roughly 2^40 of joint entropy — 254-odd
species × 100 levels × 25 natures × 2 × a plausible timestamp window × 32^6 IV
combinations reduced to one hash. That is not a lot. A laptop would grind it.
**The salt is the entire seal.** `voucher-lib.mjs` uses `crypto.randomBytes(32)`.
If anyone ever "simplifies" it to `keccak(uid)` or a counter, every sealed box
in the collection becomes readable offline, silently, with no on-chain event to
notice.

The contract cannot enforce this. It is a property of the signer, so it is
called out in the README, in the contract's NatSpec and here.

### The scarcity trade

The collaborator's open-attributes design could enforce `GLOBAL_SUPPLY_CAP` and
one shiny per species on-chain, because the contract sees the dexId at mint.
Ours cannot — that is the whole point of the commitment. So **shiny rarity is
guaranteed by the signer key, not by the chain.** A compromised signer mints
254 shinies and no `require` stops it. The mitigations are operational: keep
the signer key on the server only, rotate it with `setGameSigner`, and index
the `Opened` events so the community can audit the realised distribution after
the fact.

---

## 2. Metadata on-chain, in two states

`tokenURI` builds the whole ERC-721 JSON in Solidity and base64-encodes it.

For most collections that is a convenience. Here it is a security requirement.
A `baseURI` metadata server for a sealed collection would have to know what is
in each box in order to serve the opened ones — which means holding the salts,
which means a server that can leak, be compromised, or be compelled into
leaking exactly the thing the commitment was built to hide. On-chain rendering
removes that server from existence.

The cost is code size. Unoptimised, the renderer puts the contract ~11 KB over
EIP-170; with `optimizer_runs = 200` it lands at 22,232 B, about 2.3 KB under
the limit. `test_runtimeCodeSizeUnderEip170` guards it. If the renderer needs
to grow much further, the next move is to split it into a separate
`StockmonstersRenderer` contract that the NFT calls — at the price of a
mutable pointer the owner controls, which is a real trust regression and should
not be done casually.

`tokenURI` costs up to ~519 k gas as a view call. Free from an RPC, painful for
an on-chain consumer; nothing on-chain should be reading it.

Two smaller decisions:

- **Degrade, don't revert.** A box can be opened onto a dexId the registry has
  never heard of — the commitment does not constrain dexId. Rather than
  reverting, `tokenURI` returns a reduced document. A reverting `tokenURI`
  makes a token invisible to every wallet and marketplace.
- **`freezeSpecies()`.** Base stats and names feed the rendered metadata, so
  without a freeze the owner could rewrite the creature behind a token that has
  already been sold. Freezing is the difference between a registry and a lever.

---

## 3. The marketplace

### Shape: off-chain signed orders, on-chain settlement, no escrow

The seller signs an EIP-712 `Order`; the game server hosts the order book (a
table the game UI needs anyway); the buyer pays for exactly one transaction.
Listing, re-pricing and delisting cost zero gas.

Rejected alternatives:

- **Escrow-on-list.** Two extra transactions, and — decisively — a sealed box
  sitting in escrow cannot be opened by its owner, because `open()` is gated on
  `ownerOf`. Listing would become a commitment to sell. For a collection whose
  entire appeal is "you can open it whenever you like", that is not acceptable.
- **On-chain listings without escrow.** All the gas cost of escrow-style
  listing with none of its safety.

### Departures from the original §6 proposal

Four, each a deliberate simplification or tightening:

1. **One collection, fixed at deploy** (`immutable collection`), instead of a
   `collection` field in the order. A collection-agnostic market has to call
   `ownerOf`, `attrCommit`, `royaltyInfo` and `transferFrom` on an
   attacker-supplied address — a malicious "collection" can reenter, lie about
   ownership, or return a royalty that drains the payment. Pinning the
   collection deletes that class of bug. EIP-712's `verifyingContract` already
   prevents cross-market replay, so the field bought nothing.

2. **Order-hash consumption + a seller epoch, instead of a nonce bitmap.**
   `mapping(bytes32 => bool) orderConsumed` is one SSTORE and requires the
   order-book server to allocate nothing; a random `salt` field keeps
   re-listings distinct. For mass cancellation, `epoch` is signed into the
   order and `incrementEpoch()` invalidates everything outstanding in one
   transaction. A bitmap plus a "nonce floor" composes badly (a bitmap is
   unordered, so a floor cannot express "everything before this"), and it makes
   the server responsible for never reusing an index — a bug class we simply do
   not need.

3. **`minProceeds` in the order.** The original design left the seller exposed
   to the owner raising `feeBps` or `setDefaultRoyalty` between signing and
   filling. Both are capped (5% + 10%), so the worst case is bounded rather
   than catastrophic, but bounded-but-silent is still wrong: the seller signed
   for an amount. `minProceeds` binds it. One field, one `require`.

4. **`taker` for private sales.** address(0) means anyone. A named taker makes
   a signed order a private deal, which is also the only clean answer to
   "someone else filled the order I was about to fill" (see §5).

### The crux: `requireSealed`

The one check that makes sealed trading possible at all:

```solidity
require(collection.opened(o.tokenId) == !o.requireSealed, "SEAL_STATE_MISMATCH");
```

A seller lists a sealed box for 0.5 ETH. A buyer's fill sits in the mempool.
The seller — who holds the reveal payload and knows exactly what is inside —
sees the fill and can open the box first with higher gas, then let the sale
land at the sealed price for something now publicly known to be worthless.

With this check, the seller's `open()` invalidates their own listing. The
buyer's transaction reverts; they lose gas, not principal. `attrCommit` is
pinned alongside it so no substitution is possible either.

The check is symmetric on purpose: an order priced for an *opened* token
(`requireSealed = false`) cannot be filled while the box is still sealed. Both
directions are tested.

### Payout safety

Checks-effects-interactions with a reentrancy guard: the order hash is consumed
*before* the NFT moves, and the NFT moves before anyone is paid. `fillOrder`
uses `safeTransferFrom`, so a contract buyer's `onERC721Received` runs
mid-fill — the guard is what makes that safe, and there is a test that
re-enters from exactly there and asserts it fails with `REENTRANCY`.

Payments push with a 30 k-gas stipend and fall back to a `pendingWithdrawals`
pull ledger if the push fails. This is deliberately belt-and-braces: a payee
that reverts on receive, or burns gas on purpose, cannot brick a sale, and no
ETH is ever stranded in the market.

One consequence worth knowing: because `fillOrder` uses `safeTransferFrom`, a
**contract buyer without an `onERC721Received` hook cannot buy**. Safes and
account-abstraction wallets implement it; a bare script contract does not. That
is the correct default (it is exactly the check that prevents tokens being sent
into contracts that cannot move them again), but it will surprise someone.

---

## 4. The lemons market

> "Rational sellers open the good boxes and list the bad ones sealed. Buyers
> learn this within a week, sealed-box bids collapse to the floor price of the
> worst possible roll, and the sealed market dies."

This is Akerlof, and no amount of Solidity fixes it. `requireSealed` stops the
seller *cheating* — it does not stop them *knowing*. The contract's honest
position is that it supports both sealed and opened listings via one boolean,
and the answer lives at the product level.

What the contract makes possible:

- **Provenance is cheap.** Every `Opened(tokenId, dexId, shiny)` event is
  indexable. The UI can show, next to a sealed listing: how long this seller
  has held this box, and what their previously-opened boxes contained. A seller
  who has opened nine boxes and kept the two good ones is legible.
- **The house can be a seller with no edge.** If the server mints unowned
  sealed boxes and lists them, there is provably no informed counterparty,
  because there is no counterparty. That is a real lottery. Player-to-player
  sealed trading never is.

Recommended v1 product shape:

1. Default the player-to-player market to **opened tokens only**. This is the
   liquid, honest market and it needs no explanation.
2. Put sealed boxes behind a separate tab that shows seller provenance and
   charges a higher protocol fee — the fee is a Pigouvian tax on the
   information asymmetry, and it discourages using sealed listings as a dump.
3. Sell blind boxes **from the house**, not from players, whenever the pitch is
   "gamble on a roll".

A stronger version, if sealed player-to-player trading ever matters
commercially: make the seller commit to *not knowing*. Have the server withhold
the reveal payload from the catcher until they ask for it, and record the ask
on-chain (a `revealRequested` flag). A box whose reveal has never been
requested is genuinely blind to its owner too. That is a bigger change — it
means the game must not show the player what they caught, which fights the
core loop — so it is documented, not built.

---

## 5. Front-running, and what happens between listing and fill

| Scenario | Outcome |
|---|---|
| Seller opens the box after signing | `SEAL_STATE_MISMATCH` — buyer loses gas, not principal |
| Seller transfers the token away | `SELLER_NOT_OWNER` |
| Seller revokes the market's approval | the NFT's `NOT_AUTHORIZED` |
| Seller cancels on-chain | `ORDER_CONSUMED` |
| Seller bumps their epoch | `ORDER_STALE` |
| Owner raises fee or royalty | `PROCEEDS_TOO_LOW` if it breaches `minProceeds` |
| Another buyer copies the signature from the mempool and fills first | **works, by design** |

That last row is inherent to any public order book: a signed ask is a public
offer, and whoever lands the transaction first buys it. The seller is paid
either way, so this is competition, not theft. A seller who wants a specific
counterparty sets `taker`.

Two griefing shapes that are accepted rather than solved:

- A seller can repeatedly invalidate their own listings (open the box, move the
  token, revoke approval) and burn buyers' gas. There is no principal at risk
  and no on-chain fix that does not require escrow. It is a reputation problem;
  the order book should down-rank sellers whose fills fail.
- A buyer can watch for a sealed listing and try to fill it in the same block
  the seller opens it. Ordering decides; both outcomes are safe.

---

## 6. Open risks

**The reveal payload is a single point of failure for every buyer.** `open()`
requires the reveal, and only the server has the salt. If a sealed box changes
hands and the server refuses, loses the salt, or shuts down, that NFT is
permanently unopenable and permanently worthless. The contract cannot fix this;
it needs an operational answer, and the recommended one is both of:

- hand the encrypted `(attributes, salt)` blob to the token owner at mint,
  re-encrypting to each new owner on `Transfer`; and
- publish the whole salt set on a public bucket after a fixed, announced sunset
  date, so the collection survives the company.

**Vouchers are only as good as the signer key.** A compromised `gameSigner`
mints arbitrary creatures, including every shiny. Two-step ownership means a
multisig can rotate it; nothing makes the damage retroactively reversible.

**No supply cap of any kind.** Deliberate — see §1 — but it means `totalSupply`
is unbounded and the collection's scarcity story is entirely off-chain.

**No EIP-1271.** Order signatures are recovered with `ecrecover`, so a
smart-contract wallet cannot be a seller. Adding `isValidSignature` support is
straightforward and should happen before any serious volume, because Safes are
exactly who holds valuable NFTs.

---

## 7. Not built

Named explicitly so nobody assumes otherwise:

- **Bids / offers.** Only ask orders exist. A bid must be fillable by the
  seller at a moment of the seller's choosing, which means the buyer's funds
  must be pullable — ETH cannot be, so bids need WETH (or escrow, which §3
  rejects). The `Order` struct is one `side` field and an `IERC20` away; it was
  left out rather than half-done. Note that `requireSealed` matters *more* for
  bids than for asks: a standing sealed-price bid is exactly what a seller with
  a bad roll wants to hit.
- **Auctions**, Dutch or English.
- **Bundles**, collection-wide offers, trait offers.
- **ERC-20 payment** of any kind.
- **The order-book service and the in-game market UI.**
- **`throwBall` / on-chain catching.** The collaborator's version is not
  adoptable: a failed catch returns `(false, 0)` instead of reverting, so an
  attacker calling from a contract can `require(caught)` and get their ETH back
  on a bad roll; and `_random()` mixes `blockhash(block.number - 1)`,
  `prevrandao` and `msg.sender`, all readable in the same block, so the outcome
  is predictable rather than merely biasable. Together those two farm every
  shiny on day one. Our server-signed model sidesteps the whole area.
