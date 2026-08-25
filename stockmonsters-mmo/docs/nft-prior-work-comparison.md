# NFT prior work: `stockmonsters-nft` vs. our `contracts/`

Read-only review of the collaborator's Hardhat project at
`/Users/rez/Desktop/kript/memes/stockmonsters/last-commits/stockmonsters-nft/`
against our current `/Users/rez/Desktop/kript/memes/stockmonsters/contracts/`.

Every claim below was checked against source. Nothing was inferred from filenames.

---

## 0. Headline

**There is no marketplace.** Not a listing, not a bid, not an escrow, not a fee split, not
ERC-2981. Their repo contains exactly one `.sol` file and it is a mint contract. A repo-wide
grep for `market|listing|buy|sell|offer|escrow|royalt|2981|auction|bid|trade` across all
`.sol`/`.ts`/`.mjs`/`.md`/`.json` (excluding `node_modules`, `artifacts`, `cache`, `dist`)
returns four files, and every hit is a false positive:

- `src/metadata.ts:55` — the string `"Market Core forces: "` in NFT description flavour text
- `data/species.json` — the same flavour text baked into descriptions
- `package-lock.json`, `types/.../StockMonsterCollection__factory.ts` — incidental substrings

Cross-checked against the compiled ABI in
`artifacts/contracts/StockMonsterCollection.sol/StockMonsterCollection.json`, whose complete
function list is:

```
GLOBAL_SUPPLY_CAP, IV_MAX, SHINY_ODDS_DENOMINATOR, approve, balanceOf, ballPrice, computeA,
getApproved, imageBaseUri, isApprovedForAll, name, owner, ownerOf, registerSpecies,
renounceOwnership, safeTransferFrom, safeTransferFrom, setApprovalForAll, setImageBaseUri,
shinyClaimed, species, supportsInterface, symbol, throwBall, tokenURI, totalMinted,
traitsOf, transferFrom, transferOwnership, withdraw
```

No `royaltyInfo`. No `list`. No `fill`. The marketplace has to be designed and built from
scratch — see §6.

The genuinely valuable things in their repo are the **on-chain metadata renderer**, the
**catch-rate maths**, and the **off-chain reference-implementation-plus-tests discipline**.
The mint mechanism itself is not adoptable: it contains a critical, chainable exploit pair
that lets any attacker with a contract wallet catch every creature for free and farm all
254 shinies (§3, S1+S2).

---

## 1. Inventory of their contracts

### `contracts/StockMonsterCollection.sol` (325 lines) — the only contract

| Aspect | Finding |
|---|---|
| Standard | ERC-721, via OpenZeppelin `@openzeppelin/contracts@^5.6.1` |
| Imports | `ERC721`, `Ownable`, `Base64`, `Strings` |
| Compiler | `^0.8.28`, optimizer 200 runs, `viaIR: true` |
| Compiled? | Yes — `deployedBytecode` present, 30,874 hex chars of `bytecode` |
| Access control | `Ownable` (OZ). `registerSpecies`, `setImageBaseUri`, `withdraw` are `onlyOwner` |
| Royalties | **None.** No ERC-2981, no `royaltyInfo`, no fee recipient |
| Metadata | **Fully on-chain**, base64 `data:application/json` URI. Art only is off-chain (IPFS) |
| Marketplace | **None** |
| Supply | `GLOBAL_SUPPLY_CAP = 5000`, plus exactly 1 shiny per species (254 max) |

There is also a `types/ethers-contracts/Placeholder.ts` — a TypeChain artifact for a
scaffold contract with a single `value()` getter, left over from `hardhat init`. It is not
in `contracts/` and has no source. Ignore it.

**Mint mechanics.** One payable entry point:

```solidity
function throwBall(uint16 dexId, uint8 level, uint16 maxHp, uint16 currentHp, Status status, BallType ball)
    external payable returns (bool caught, uint256 tokenId)
{
    require(msg.value == ballPrice(ball), "wrong payment for this ball");
    require(totalMinted < GLOBAL_SUPPLY_CAP, "supply exhausted");
    require(level >= 1 && level <= 100, "bad level");
    uint256 a = computeA(dexId, maxHp, currentHp, status, ball);
    caught = _resolveCatch(a);
    if (!caught) { emit BrokeFree(msg.sender, dexId, ball); return (false, 0); }
    ...
}
```

Three ball tiers priced 0.002 / 0.006 / 0.01 ETH with catch bonuses ×1 / ×1.5 / ×2. The fee
is charged for the *attempt*, kept whether or not the catch succeeds — a paid-lottery model.
Catch resolution is the Gen III+ Pokémon formula with the classic four shake checks, all
on-chain, using `blockhash`/`prevrandao` randomness. Traits (6 IVs + shiny) are rolled
on-chain at mint and stored immediately in cleartext.

**Species registry.** 254 species live in contract storage, loaded post-deploy in batches:

```solidity
function registerSpecies(uint16[] calldata dexIds, string[] calldata names, string[] calldata tickers,
    uint8[] calldata type1s, int8[] calldata type2s, uint8[] calldata catchRates,
    uint8[6][] calldata baseStats) external onlyOwner
```

`int8 type2` with `-1` as the "single-typed" sentinel. Their own test file documents *why*
it is batched, and it is a real measured constraint, not a guess:

```
/** registerSpecies is designed to be called in batches - the full 254-species roster in one
 * call blows the block gas limit (confirmed by trying it) ... */
const REGISTER_BATCH_SIZE = 50;
```

**Metadata / tokenURI.** This is the best part of the repo. `tokenURI` builds the whole
ERC-721 JSON in Solidity and base64-encodes it, so there is no metadata server to run,
break, or get censored:

```solidity
string memory image = string.concat(imageBaseUri, "/", s.ticker, "/", t.shiny ? "shiny.png" : "regular.png");
...
return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
```

Twelve attributes: Species, Ticker, Type 1, Type 2 (omitted when single-typed), Level, HP,
Attack, Defense, Special Attack, Special Defense, Speed, Shiny.

I checked the `type2` omission branch by hand for a trailing-comma JSON bug — there isn't
one. Both branches produce valid JSON (`type2Attr` is `""` or `,{...}` and is always
followed by a literal `','`). It is, however, untested in Solidity (§5).

**Inconsistency worth knowing before you pin anything to IPFS:** the TypeScript reference
builds the image path from `species.dbSymbol`…

```ts
return `${IMAGE_BASE_URI}/${species.dbSymbol}/${shiny ? 'shiny' : 'regular'}.png`;
```

…while the Solidity `tokenURI` builds it from `s.ticker` (`bulbasaur/` vs `AAPL/`). The
README claims dbSymbol. One of the three is wrong; whichever folder layout gets pinned, the
other path resolves to nothing. Their contract does not even store `dbSymbol`, so on-chain
it can only ever be ticker.

---

## 2. Design diff

### What they have that we lack

1. **On-chain `tokenURI`.** Ours is `string(abi.encodePacked(baseTokenURI, _toString(tokenId)))` —
   it needs a metadata server we have not written. Theirs needs nothing. This is the single
   most valuable thing to take.
2. **On-chain species data.** 254 name/ticker/types/catchRate/baseStats records in storage.
   Prerequisite for (1).
3. **Scarcity rules.** Global 5000 cap and a per-species shiny lock (`mapping(uint16 => bool) shinyClaimed`).
   We have no cap of any kind — unbounded `totalSupply`.
4. **A real catch economy.** Three priced ball tiers where the fee is sunk on failure. Ours
   is a flat 0.01 ETH claim fee on a catch that already succeeded in-game — no risk, no sink.
5. **Standards compliance via OpenZeppelin.** They get `safeTransferFrom` (both overloads),
   the receiver check, `transferOwnership`, and battle-tested ERC-721 internals for free.
   We hand-rolled and got this wrong (§3, O1).
6. **An off-chain reference implementation with 30 vitest tests**, deliberately kept separate
   from the contract as an executable spec. That discipline is worth copying even where the
   code is not.
7. **Deploy tooling.** `scripts/deploy.ts` + `toRegisterArgs()` batching helper + TypeChain types.

### What we have that they lack

1. **The sealed box.** Commit-reveal is the entire premise of our design and is absent from
   theirs. Theirs writes cleartext traits at mint:
   ```solidity
   MintedTraits memory t = _generateTraits(dexId, level);
   traitsOf[tokenId] = t;
   ```
   Ours writes only `attrCommit[tokenId] = attrCommitment;` and reveals via `open()`.
2. **Server-authoritative catching via EIP-712.** Our `MintVoucher(address player, bytes32 attrCommit, bytes32 uid)`
   signed by `gameSigner` means the catch happens in the game and the chain merely records it.
   Theirs takes `currentHp`, `status` and `level` as unauthenticated caller arguments — their
   README lists this as an open question, and it is disqualifying (§3, S3).
3. **Replay protection.** `mapping(bytes32 => bool) voucherUsed` + `require(!voucherUsed[uid])`.
4. **Signature hardening.** Our `_recover` rejects EIP-2 malleable `s` values and the zero
   address, and the domain separator is recomputed per call from `block.chainid` (fork-safe,
   not cached). Both are correct and both are better than a naive `ecrecover`.
5. **IVs and nature stored, not just derived stats.** We keep `ivHp…ivDfs` (6 × uint8),
   `natureId` (0–24) and `caughtAt`. They store the *final computed stats* at catch level and
   **discard the IVs entirely** — `MintedTraits` has no IV fields. That is a permanent data
   loss: once the token is minted, you can never recompute what that creature's stats would be
   at any other level, and you can never verify its IV spread. If a Stockmonster ever levels
   up, their token is stale forever. Our storage choice is strictly better.
6. **No on-chain RNG at all**, therefore no RNG attack surface.
7. **Zero dependencies**, a single file, Foundry.

### Where the two designs genuinely disagree

| | Theirs | Ours | Verdict |
|---|---|---|---|
| **Reveal timing** | Cleartext at mint | Sealed until `open()` | Theirs is marketplace-friendly by default; ours creates an asymmetric-information problem (§6) that must be designed around, not ignored |
| **Randomness** | On-chain, exploitable | Off-chain, server-signed | Ours. Theirs is broken (S2); ours trades player-verifiability for operator trust, which is the right trade for a game whose server is already authoritative |
| **What's authoritative** | The chain | The game server | Ours. The chain cannot see a battle |
| **Payment model** | Per throw, sunk on failure | Per successful claim | Theirs earns more and creates a sink, but demands a transaction per ball throw with four on-chain RNG rolls — unusable UX inside an MMO battle |
| **Stored data** | Final stats (frozen at catch level) | IVs + nature + level (regenerable) | Ours |
| **Metadata** | On-chain base64 | Off-chain `baseURI` server (unwritten) | Theirs, adapted (§6) |
| **Supply caps** | On-chain, enforced | None | Theirs — but see the crux below |

**Crux: our seal makes on-chain caps impossible.** Their `shinyClaimed[dexId]` and
`GLOBAL_SUPPLY_CAP` work because the contract knows the dexId and shininess at mint time.
Ours does not — that is the whole point of the commitment. So we cannot port their caps to
the contract; the *server* must enforce shiny scarcity before it signs the voucher, and the
contract can at most enforce a blind global cap on total mints. Say this out loud in the
README so nobody later assumes the chain guarantees shiny rarity. It does not; the signer
key does.

---

## 3. Security review

### In their code

**S1 — CRITICAL: every catch is free and guaranteed. Do not adopt.**

`throwBall` does not revert on a failed catch; it returns `(false, 0)`. Any attacker calling
from a contract writes:

```solidity
(bool caught, uint256 id) = coll.throwBall{value: price}(dexId, 100, hp, 1, FREEZE, ULTRA);
require(caught);   // roll failed -> whole tx reverts -> ETH refunded, only gas burned
```

The paid-throw economy — the contract's entire revenue model — is defeated by four words. It
gets worse: `_safeMint` invokes `onERC721Received` on the attacker *after* traits are written,
so the attacker's callback can read `traitsOf[tokenId]` and revert on anything but a 31/31
shiny. Free rerolls until the perfect roll.

**S2 — CRITICAL: the on-chain randomness is fully predictable, not merely biasable.**

Their README calls this a miner-bias placeholder. It is worse than that:

```solidity
function _random() private returns (uint256) {
    _randNonce++;
    return uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.prevrandao, msg.sender, _randNonce)));
}
```

`blockhash(block.number - 1)` and `block.prevrandao` are both readable by **any contract in
the same block**. `msg.sender` is the attacker. `_randNonce` is `private` but its slot is
readable off-chain via `eth_getStorageAt` and its increments are deterministic. An attacker
contract can therefore recompute the identical keccak, simulate the catch, the six IV rolls
and the shiny roll, and — via S1 — only let the transaction stand when the outcome is a shiny.
Every one of the 254 shinies would be farmed on day one by a single script. Miner
collusion is not required; a regular user with 40 lines of Solidity suffices.

If we ever want on-chain rolls, VRF is a two-transaction request/fulfil architecture, not a
drop-in — their README says this correctly. Our server-signed model sidesteps it entirely.

**S3 — HIGH: encounter state is unauthenticated.** `throwBall` accepts `level`, `maxHp`,
`currentHp` and `status` as plain calldata. `computeA` validates only `maxHp > 0`,
`currentHp <= maxHp` and `s.registered`, and `throwBall` validates only `1 <= level <= 100`.
Nothing ties any of it to an actual battle. Anyone can mint a level-100 creature by claiming
it was frozen at 1 HP, without ever launching the game. Their README lists this as open. Our
EIP-712 voucher already solves it and is the correct answer.

**S4 — LOW: `withdraw` is fine.** `onlyOwner`, `.call` with the full balance, no state
written afterwards. No reentrancy consequence. Adoptable as-is (ours is identical).

**S5 — LOW (gas): `TYPE_NAMES` is mutable storage, not a constant.**
`string[18] private TYPE_NAMES = [...]` is a state variable — eighteen string `SSTORE`s at
deployment and an `SLOAD` on every `tokenURI` read. Replace with a pure function or
`bytes32` constants when porting.

**S6 — INFO: no ERC-2981.** Neither project has royalties. Needed before any marketplace,
ours or a third party's.

**S7 — verified correct, credit where due.** The integer fourth-root port is exact. Their
comment claims `65536*(a/255)^0.25 == isqrt(isqrt(2^64 * a / 255))`. I checked their
Babylonian `_isqrt` against `math.isqrt` and the nested result against the float formula for
every `a` in 1..255: zero divergences greater than 1 unit (e.g. `a=45` → 42476 integer vs
42476.43 float). This is the mathematically riskiest part of the port and it is right —
though nothing in either test suite actually checks it (§5).

### In our code — findings that block a marketplace

**O1 — HIGH: our token is not actually ERC-721, but claims to be.**

```solidity
function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f;
}
```

We advertise `0x80ac58cd` (ERC-721) but implement **neither** `safeTransferFrom(address,address,uint256)`
**nor** `safeTransferFrom(address,address,uint256,bytes)` — the file has only `transferFrom`.
There is also no `IERC721Receiver` check anywhere. OpenSea, Blur, Reservoir, most bridges,
most staking contracts and any escrow-style marketplace call `safeTransferFrom`; every one of
those calls reverts against our contract today. This must be fixed before anything else.
(Their OZ-based contract has both overloads, per the ABI dump in §0.)

**O2 — MEDIUM: ownership cannot be transferred or rotated.** Our contract sets `owner = msg.sender`
in the constructor and defines `onlyOwner`, but there is **no `transferOwnership` function at
all**. Whatever key deploys the contract controls `setGameSigner`, `setBaseTokenURI`,
`setClaimFee` and `withdraw` forever. If that key is a hot deploy key, or is lost, there is no
recovery and no path to a multisig. Add two-step ownership transfer before mainnet.

**O3 — MEDIUM: vouchers never expire and don't bind the fee.**
`MintVoucher(address player, bytes32 attrCommit, bytes32 uid)` has no `deadline`. A voucher
issued today, unused, is redeemable in two years. And because `mintCaught` requires
`msg.value == claimFee`, any `setClaimFee` change silently bricks every outstanding voucher.
Add `uint64 deadline` and `uint256 fee` to the struct.

**O4 — MEDIUM: the reveal payload is a single point of failure for every buyer.**
`open()` requires `msg.sender == ownerOf(tokenId)`, and only the server holds the `salt`. If a
sealed box changes hands and the server refuses, loses the salt, or shuts down, that NFT is
**permanently unopenable and permanently worthless**. Note that the owner-gate buys no
cryptographic security — the commitment already binds the data, so a wrong reveal reverts
regardless of who submits it. The gate exists purely so a third party cannot spoil the
surprise (which *is* a real requirement for sealed listings, so keep it) — but it needs a
liveness escape hatch. Recommended: the server hands the encrypted `(attributes, salt)` blob
to the token owner at mint time, re-encrypting to each new owner on transfer, or publishes the
whole salt set on a public bucket after a fixed sunset date.

**O5 — CRITICAL FOR THE MARKETPLACE: the box is sealed to the chain, not to the seller.**
This is the design crux and no amount of Solidity fixes it. The player *caught the creature
in-game* — the client showed them the dexId, the shiny flag, and (if the UI reveals it) the IV
spread. The server knows. Only the blockchain, and therefore only the buyer, is in the dark.
A sealed-box listing is not a lottery ticket; it is a used car sold by someone who has read
the service history. Rational sellers open the good boxes and list the bad ones sealed.
Buyers learn this within a week, sealed-box bids collapse to the floor price of the worst
possible roll, and the sealed market dies. Design for this explicitly (§6).

**O6 — LOW, verified: the JS and Solidity commitments agree, but nothing tests it.**
`tools/sign-voucher.mjs` computes `keccak256(encodePacked(['uint8[6]'], ivs))` while
`open()` computes `keccak256(abi.encodePacked(ivs))`. These agree only because Solidity pads
each element of a value-type array to 32 bytes inside `encodePacked`, and viem does the same.
I confirmed empirically — viem emits 192 bytes (6 × 32), not 6. This is a subtle,
version-fragile seam, and if it ever diverges **every NFT minted in between becomes
permanently unopenable**. There is no test on either side of it.

---

## 4. Their `scripts/`, `src/`, `data/`

**`scripts/deploy.ts` (33 lines).** Deploys, then registers 254 species in batches of 50 via
`toRegisterArgs()`. Clean, and the batching pattern is worth copying if we adopt an on-chain
registry.

**Network config: there is none.** `hardhat.config.ts` has no `networks` key whatsoever — no
RPC, no chainId, no accounts. Their README's
`npx hardhat run scripts/deploy.ts --network <name>` cannot work as shipped. Their entire
deployment story is localhost-only and untested against a real chain. Nothing to adopt here;
we are on Foundry anyway.

**`scripts/extract-species.mjs` (92 lines) — skip it.** It hardcodes
`C:/Users/roota/Downloads/Stockmonsters` and `C:/Users/roota/Downloads/stockmonsters-reskin`,
and it produces `data/species.json`, which our `src/data/dex.json` already **supersets**: same
254 entries, same dexIds, same base stats, same catch rates, same renamed types — plus
`company`, the per-creature EVM `address`, `description`, `species` flavour line, `height`,
`weight` and `sprite`. The only things their file has that ours lacks are `dbSymbol` (the
original PSDK slug) and the `roster: 'stock' | 'meme'` split. Two things are worth keeping
from this script anyway:

- the `TYPE_RENAME` table (PSDK type → our 18 renamed types), if we ever re-derive from PSDK;
- the bug they documented in the README: PSDK writes `"__undef__"`, not JSON `null`, for
  "no second type". It surfaced as a Solidity ABI-encoding crash while registering the roster.
  If we ever touch PSDK data again, check for that sentinel.

**`src/metadata.ts` (59 lines) — adopt the shape.** Standard ERC-721 JSON with the 13-attribute
list. Maps onto our `dex.json` almost 1:1; only the stat key names differ
(`atk/def/spd/ats/dfs` for us, `attack/defense/speed/spAttack/spDefense` for them), so a
small mapping layer is needed.

**`src/traits.ts` `computeFinalStats()` — directly reusable and genuinely needed by us.**
Because we store IVs rather than final stats, our metadata service has to *compute* the
display stats, which is precisely this function:

```ts
const core = (b: number, i: number) => Math.floor(((2 * b + i) * level) / 100);
return { hp: core(base.hp, iv.hp) + level + 10, attack: core(base.attack, iv.attack) + 5, ... };
```

Copy it verbatim, keyed to our stat names. Their Solidity port in `_generateTraits` is the
same formula and can be lifted straight into our `tokenURI`.

**`src/catchRate.ts`** — the Gen III+ formula and the `(b/65536)^4` closed form. Useful if we
ever want to show catch odds in the game UI. Our battle system already lives in
`stockmonsters-mmo/src/battle/`; check whether it duplicates this before importing.

**`src/collectionState.ts`, `src/mint.ts`, `src/ballTypes.ts`** — reference-implementation
scaffolding for a model we are not adopting. Skip.

**Indexer / backend / frontend: none exist.** `dist/` is plain `tsc` output of `src/`.
`types/` is TypeChain output. `scripts/demo.mjs` is a console demo. There is no server, no
API, no UI, no subgraph, no order book.

---

## 5. Their tests

**Solidity, Hardhat + Mocha, 13 tests** (`test/contracts/StockMonsterCollection.test.ts`, 184 lines):
ball prices, wrong-payment revert, `computeA` against a hand-computed value plus two revert
paths, a guaranteed-catch mint, an `a == 0` guaranteed break-free, IV-bounded stat ranges,
the shiny cap held across 40 mints, a genuine **5000-mint** run to exhaust the global cap
(10-minute timeout — a real end-to-end test, not a mock), a base64 `tokenURI` decode
asserting all 12 attribute names, and registering the full 254-species roster.

**TypeScript, vitest, 30 tests** across five files: catch-rate maths including a statistical
convergence check of `attemptCatch` against the closed-form `catchProbability`; IV bounds;
IV→stat monotonicity; a known Gen III reference stat line at level 100; shiny frequency over
many trials; both caps; metadata shape including the single-typed Type 2 omission.

That is a solid, honest suite for the happy path. What it does **not** cover is the half that
matters:

- **No adversarial tests at all.** Not one test calls `throwBall` from a contract. S1 — the
  free-catch exploit — would have been caught by a single 10-line attacker contract.
- **No randomness-predictability test.** S2 is likewise invisible to this suite.
- **No access-control tests.** Nothing asserts that a non-owner is rejected by
  `registerSpecies`, `setImageBaseUri`, or `withdraw`. Three `onlyOwner` functions, zero
  negative tests.
- **No `withdraw` test whatsoever** — no balance accounting after N paid throws.
- **The TS and Solidity implementations are never cross-checked** beyond a single `computeA`
  data point. `_shakeThreshold`'s `isqrt(isqrt(...))` fourth root — the most delicate line in
  the port — has no test on either side. (I verified it externally; it is correct. But that
  was luck, not process.)
- **The Solidity single-typed `tokenURI` branch is untested** (the test uses a two-typed
  species and asserts Type 2 *is* present). The TS equivalent is tested. I checked the
  Solidity branch by hand; the JSON is valid.
- No `supportsInterface` test, no transfer/approval tests (defensible — that surface is OZ's),
  no gas or deployment-cost test.

Our own suite (`contracts/StockmonstersNFT.t.sol`, 5 tests) has a mirror-image gap profile:
good on the voucher/commit-reveal core (sealed-then-open, wrong fee, bad reveal, voucher
replay, wrong signer, withdraw), and **nothing** on access control, `safeTransferFrom`
(which does not exist — O1), ownership, or the JS↔Solidity commitment agreement (O6).

---

## 6. Adoption plan

### Recommended marketplace design

Theirs does not exist, so this is ours. Requirements: in-game listing and buying, player to
player, for both sealed and opened tokens.

**Architecture: off-chain signed orders, on-chain settlement, no escrow.** (Seaport-lite.)

The seller signs an EIP-712 `Order` and the game server hosts the order book — the same shape
we already use for `MintVoucher`, with the same viem tooling. Listing and cancelling cost zero
gas; the buyer pays for one transaction. The order book is a server table the game UI needs
anyway. Rejected alternatives: escrow-on-list (two extra transactions, and a sealed box locked
in escrow cannot be opened by its owner, so listing becomes a commitment to sell); on-chain
listings without escrow (all the gas cost of escrow-style listing with none of the safety).

```solidity
struct Order {
    address seller;
    uint256 tokenId;
    uint256 price;        // wei
    uint64  deadline;
    uint256 nonce;
    bool    requireSealed; // must match !opened[tokenId] at fill time
    bytes32 attrCommit;    // must match attrCommit[tokenId] at fill time
}
```

The five rules that make it safe:

1. **`requireSealed` is the sealed-box front-running defence — this is the crux the user
   asked about.** A seller lists a sealed box for 0.5 ETH. A buyer's fill sits in the mempool.
   The seller — who holds the reveal payload and knows exactly what is inside — sees the fill
   and can call `open()` first with higher gas. Without this check the sale still completes and
   the buyer has paid 0.5 ETH for a now-publicly-worthless revealed box. With
   `require((!opened[tokenId]) == order.requireSealed)`, the seller's `open()` invalidates
   their own listing and the buyer's transaction reverts, losing gas but not principal. Pin
   `attrCommit` too, so a burn-and-remint shell game cannot substitute a different creature.
2. **Checks-effects-interactions plus a reentrancy guard.** Consume the nonce *first* (a
   `mapping(address => mapping(uint256 => uint256))` bitmap), then pull the NFT, then pay.
   ETH goes to the seller and the fee recipient by `.call`; a seller contract that reverts on
   receive only grieves itself, but prefer a `pendingWithdrawals` pull pattern for robustness.
3. **Cancellation must be on-chain.** `cancelNonce(uint256)` and `bumpNonceFloor()` to
   invalidate everything outstanding. **Delisting in the game UI is not a cancellation** — a
   signed order plus a live approval stays fillable by anyone who saved the signature. Document
   this in the UI and revoke approvals on delist.
4. **Approval scope.** `setApprovalForAll(market, true)` is standard, but the market must only
   ever pull the exact `tokenId` named in a signed order. Never expose a generic transfer path.
5. **Fees and royalties.** `feeBps` to a treasury, hard-capped in the constructor
   (`require(feeBps <= 1000)`) so the owner cannot rug it to 100%. Honour `royaltyInfo` from
   the NFT — which means adding ERC-2981 to `StockmonstersNFT` so third-party marketplaces pay
   us too.

**On the lemons problem (O5) — a product decision, not a contract one.** The contract supports
both sealed and opened listings via one boolean; the question is what the game surfaces.
Recommendation for v1: **default the player-to-player market to opened tokens only**, and put
sealed boxes behind a separate tab that (a) shows on-chain provenance — how long the seller has
held the box, and what their previously-opened boxes contained, all cheaply indexed from our
`Opened(tokenId, dexId, shiny)` events — and (b) charges a higher fee. Sell genuinely blind
boxes from the house instead: the server mints unowned sealed boxes and lists them, where the
seller provably does not have an information edge because there is no seller. That is a real
lottery. Player-to-player sealed trading never is.

**How the seal interacts with `tokenURI` — adopt their renderer, dual-state.** This is the
neatest fit in the whole review. Make `tokenURI` return two different on-chain base64
documents:

- `!opened[tokenId]` → a generic sealed-box JSON: name `"Sealed Stockmonster Box #N"`, a single
  box image, and attributes limited to what is genuinely public (`Sealed: Yes`, `Caught: <era>`).
  No dexId, no stats, nothing to leak.
- `opened[tokenId]` → the full attribute set, computed on-chain from the stored IVs, nature and
  level against the on-chain species registry — their `_attributesJson` almost verbatim.

Every wallet and every third-party marketplace then renders the sealed state correctly with no
work on our part, and — critically — there is no metadata server holding the reveal that could
leak or be subpoenaed into leaking sealed contents. A `baseURI` server is the alternative, but
it must then hold the salts, which reintroduces exactly the leak the commitment was built to
prevent.

### Ordered plan

| # | Task | Files | Effort |
|---|---|---|---|
| 1 | **Fix ERC-721 conformance.** Add both `safeTransferFrom` overloads + `IERC721Receiver` check; add two-step `transferOwnership`; add ERC-2981 `royaltyInfo` + interface id `0x2a55205a`. Nothing can list until this lands. | `contracts/StockmonstersNFT.sol` | 0.5 d |
| 2 | **Test hardening.** Access-control negatives on all four `onlyOwner` functions; `safeTransferFrom` to an EOA and to a rejecting contract; and a JS↔Solidity commitment cross-check (O6) that fails CI if `sign-voucher.mjs` and `open()` ever diverge. | `contracts/StockmonstersNFT.t.sol`, new `stockmonsters-mmo/test/voucher-commit.test.mjs` | 0.5 d |
| 3 | **Dual-state on-chain `tokenURI`.** Port their `Base64`/`Strings` renderer and `_attributesJson`; add a `SpeciesRegistry` (either a separate contract or a mapping in the NFT) loaded in batches of 50 from `dex.json`; port `computeFinalStats` to Solidity to derive display stats from stored IVs. | `contracts/StockmonstersNFT.sol`, new `contracts/SpeciesRegistry.sol`, new `stockmonsters-mmo/tools/register-species.mjs` | 1.5 d |
| 4 | **Voucher hardening.** Add `deadline` and `fee` to `MintVoucher`; update the typehash, the contract, `sign-voucher.mjs` and the tests in lockstep. | `contracts/StockmonstersNFT.sol`, `tools/sign-voucher.mjs`, `.t.sol` | 0.5 d |
| 5 | **Reveal-payload durability (O4).** Server stores encrypted `(attributes, salt)` per token, re-encrypted to each new owner on `Transfer`; plus a documented sunset date after which all salts are published. | server-side + `docs/` | 1 d |
| 6 | **`StockmonstersMarket.sol`.** The design above: EIP-712 `Order`, nonce bitmap, `requireSealed` + `attrCommit` guards, CEI + reentrancy guard, capped `feeBps`, ERC-2981 payout, `cancelNonce` / `bumpNonceFloor`. | new `contracts/StockmonstersMarket.sol` | 2–3 d |
| 7 | **Market test suite.** Happy-path fill; expired order; replayed nonce; cancelled nonce; **seller opens the box to front-run a sealed fill**; fee and royalty split arithmetic; reentrant buyer; non-owner seller; revoked approval; malleable signature. | new `contracts/StockmonstersMarket.t.sol` | 1 d |
| 8 | **Order book + in-game UI.** `sign-order.mjs` (sibling of `sign-voucher.mjs`), server order-book storage and REST, an `Opened`-event indexer for provenance, and the market screen. | new `tools/sign-order.mjs`, new `src/modules/main/market.ts`, server routes | 3–5 d |
| 9 | **Metadata helper (off-chain mirror).** Port their `metadata.ts` shape + `computeFinalStats` against our `dex.json` stat keys — used by the game UI and as an executable spec cross-checked against the on-chain renderer. | new `stockmonsters-mmo/tools/build-metadata.mjs` | 2 h |

**Copy nearly as-is:** `Base64`/`Strings`-based `tokenURI` construction and `_attributesJson`
(§1); `computeFinalStats` (`src/traits.ts`); the `toRegisterArgs` / batch-of-50 registration
pattern (`test/contracts/helpers/loadSpeciesArgs.ts` + `scripts/deploy.ts`); `withdraw`.

**Port with changes:** the species registry (feed from `dex.json`, not `species.json`); the
metadata attribute list (our stat keys, plus Nature, minus Ball Used); the shiny-scarcity
rule (server-enforced at signing time, since the chain cannot see a sealed dexId).

**Rewrite:** anything touching randomness or catch resolution — our server-signed voucher
already replaces it.

**Skip entirely:** `throwBall` and the on-chain catch model (S1, S2, S3); `_random` (S2);
`extract-species.mjs` (Windows-hardcoded, and `dex.json` already supersets its output); the
Hardhat/TypeChain toolchain (we are on Foundry and their config has no networks at all);
`collectionState.ts` / `mint.ts` / `ballTypes.ts`; `dist/`, `types/`, `Placeholder`.

**First three steps:** (1) make our ERC-721 actually an ERC-721 — add both `safeTransferFrom`
overloads, the receiver check, `transferOwnership`, and ERC-2981; (2) add the missing
access-control and commitment cross-check tests; (3) port their on-chain `tokenURI` as a
dual-state sealed/opened renderer with an on-chain species registry built from `dex.json`.
