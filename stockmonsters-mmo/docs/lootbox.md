# Sealed loot boxes

A player buys a **sealed box**, their own wallet pays the chain, and later they
open it to find a Stockmonster inside. This document is the whole design: the
odds, what they are worth, how the randomness is made checkable, the HTTP
contract, the schema, and the operational rules that keep tokens openable.

Code: `lootbox.mjs` (roll, signing, custody), `db/migrations/0002_boxes.sql`
(schema), `src/box-shop.ts` (the in-game window), `tools/lootbox-cli.mjs`
(inspect / simulate / verify / smoke test), `test/lootbox.test.mjs` (the proof).

---

## 1. The flow

```
  PLAYER                    SERVER                          CHAIN
    │  POST /box/quote        │                               │
    │ ───────────────────────►│  roll a server seed           │
    │ ◄─────────────────────── tiers + serverSeedHash         │
    │                         │                               │
    │  POST /box/voucher      │                               │
    │   tier, clientSeed ────►│  roll the creature            │
    │                         │  attrCommit = keccak(attrs)   │
    │                         │  sign MintVoucher (EIP-712)   │
    │                         │  PERSIST salt + roll  ← the   │
    │                         │      point of no return       │
    │ ◄─── uid, attrCommit, fee, deadline, signature          │
    │                         │                               │
    │  mintCaught{value: fee} ─────────────────────────────► mint
    │                         │                          (sealed token)
    │                         │◄── Minted event ──────────────│
    │  POST /box/reveal       │                               │
    │ ◄─── attrs + salt + serverSeed                          │
    │  open(tokenId, attrs…, salt) ──────────────────────────► reveal
```

Two properties fall out of that shape and both are deliberate:

- **The server never touches player money.** It signs a voucher; the fee is
  paid by the player's own wallet directly to the NFT contract. There is no hot
  wallet with a balance to drain, and no custody question.
- **The signature is released only after the salt is stored.** `issueVoucher`
  writes the row and *then* returns. A voucher whose row failed to persist would
  be a token that can be minted and never opened — so that ordering is not an
  implementation detail, it is the safety property.

---

## 2. The odds

One table, at the top of `lootbox.mjs`. Nothing else in the code decides what a
player can win. `node tools/lootbox-cli.mjs odds` renders it; if this document
and that command disagree, **the command is right**.

### Rarity bands

Species are banded by base-stat total. The cutoffs were chosen against the real
254-species roster (min 175, median 395, max 670) so that every band has a
population worth calling a band:

| Band     | Base-stat total | Species |
| -------- | --------------- | ------- |
| Common   | ≤ 400           | 132     |
| Uncommon | 401 – 470       | 45      |
| Rare     | 471 – 530       | 65      |
| Elite    | ≥ 531           | 12      |

Within a band every species is equally likely. Banding rather than a continuous
BST weight is a legibility choice: "45% RARE" is a claim a player can check
against 3,000 rolls in a second, whereas "weight ∝ BST²" is not something anyone
can hold in their head or audit at a glance.

### Tiers

| | **STANDARD** | **PRIME** | **APEX** |
| --- | --- | --- | --- |
| Price | 0.01 ETH | 0.03 ETH | 0.08 ETH |
| Common | 70% | 40% | 15% |
| Uncommon | 20% | 30% | 25% |
| Rare | 9% | 25% | 45% |
| Elite | 1% | 5% | 15% |
| Level | 5 – 25 | 20 – 45 | 40 – 70 |
| IV floor (each of 6) | 0 | 8 | 16 |
| Shiny | 1 in 1024 | 1 in 256 | 1 in 64 |

The three tier names are fixed by `src/marketplace.ts`, which already renders
`standard` / `prime` / `apex` on sealed listings.

Why these numbers:

- **Price ladder 1 : 3 : 8.** Apex is 8× the price for 15× the elite rate and
  16× the shiny rate, so the expensive box is the better *rate* — but it is also
  the one that can disappoint most expensively, which is the honest shape for
  this kind of product.
- **The IV floor is the quiet one.** It is what actually makes an Apex creature
  competitive: a guaranteed 16 across all six stats is a mean IV of ~23.5 versus
  ~15.5 at Standard. It is also strictly inside the game's own notion of a legal
  individual (`src/battle/factory.ts` rolls 0–31), so a box creature is never a
  creature the game could not otherwise produce.
- **Shiny.** The wild-encounter rate in `factory.ts` is 1 in 4096. Every tier is
  a buy-up on that: 4×, 16×, 64×. The 1-in-64 Apex rate is deliberately
  *exciting rather than routine* — roughly one in a long evening's buying.
- **Levels** are banded to keep tiers from cannibalising each other: an Apex box
  never produces something a Standard box could have.

Check the realised distribution against the table at any time:

```
node tools/lootbox-cli.mjs simulate --tier apex -n 200000
```

### What the odds are worth

**They are not enforceable on chain, and it is important to be blunt about it.**

`mintCaught` receives a `bytes32` commitment. It cannot see a dexId, a level or
a shiny flag — that is the entire point of the sealed box, and the same property
`contracts/DESIGN.md` §1 calls out for shiny scarcity. No `require` in the
contract can cap elites, cap shinies, or check that a Standard box was rolled
with Standard odds. There is no on-chain audit either at mint time or at open
time that could catch a server that quietly rolled everyone a Common.

So the odds rest **entirely on the signing key and the code behind it**. In
practice that means:

1. **The key is the promise.** Whoever holds `BOX_SIGNER_PK` can mint any
   creature at any rarity. Keep it on the server, never in a repo, rotate with
   `setGameSigner` if it is ever exposed — and understand that a rotation
   invalidates outstanding vouchers players are holding.
2. **The audit is after the fact, and it is public.** Every `open()` emits
   `Opened(tokenId, dexId, shiny)`. Anyone can index those events and compare
   the realised distribution to this table. That is the community's real
   enforcement mechanism, and it is why the numbers here must stay accurate.
3. **Per-box, the fairness proof below is stronger than the aggregate.** It does
   not prove the *odds* were honest, but it does prove that *your* roll was
   fixed before you paid and was not re-rolled to something worse afterwards.
4. **Changing the table is a public act.** The odds are versioned by
   `ROLL_ALGORITHM` (`stockmonsters/box-roll/v1`) and the band a box landed in
   is stored on its row, so historical boxes stay verifiable against the odds
   they were actually sold under even after a retune.

---

## 3. Fairness: commit–reveal on the randomness

**Decision: implemented.** The attributes already get commit–reveal on chain;
the randomness gets the same treatment off chain.

### The protocol

1. `POST /box/quote` generates a 32-byte `serverSeed`, stores it, and returns
   only `serverSeedHash = SHA-256(serverSeed)` with a `commitId`.
2. The player picks a `clientSeed` (the shop generates a random one and lets
   them edit it) and sends it with `commitId` to `POST /box/voucher`.
3. The roll is a pure function:
   `rollBox(serverSeed, clientSeed, tier, address)`. Nothing else feeds it — no
   clock, no counter, no `Math.random`.
4. `POST /box/reveal` returns `serverSeed` alongside the salt and attributes.
5. The player checks it:
   ```
   curl … /box/reveal > reveal.json
   node tools/lootbox-cli.mjs verify --file reveal.json
   ```
   which asserts three things: the seed hashes to the hash published *before*
   the purchase; replaying the roll from that seed gives exactly these
   attributes; and those attributes hash to the commitment the contract holds.

The server commits before it can see the client seed, so it cannot grind the
pair. It cannot swap in a different committed seed either, because the client
echoes back the `commitId` it was given and a commitment is single-use (enforced
by the `UPDATE … WHERE consumed_at IS NULL` in `consumeCommit`). What remains is
refusal-to-serve, which is visible.

### Details worth knowing

- **SHA-256, not keccak256, for the seed commitment.** A player can verify it in
  a browser console with `crypto.subtle.digest` and no library. The *attribute*
  commitment stays keccak256 because the contract dictates it.
- **The seed stays secret until reveal.** The roll is deterministic from it, so
  publishing the seed early would publish the contents and break the seal. Seed
  and salt are released together, to the same person, at the same moment.
- **One seed, one box.** Reusing a seed would let the reveal of the first box
  spoil the second.
- **`caughtAt` is not rolled.** It is the wall-clock second of issuance, stored
  and echoed at reveal so the verifier can rebuild the same commitment.
- **Degradation.** If a client sends no `commitId`, the server mints one inline
  and uses it. The roll is still deterministic and still logged, but the player
  has no proof it predated their seed. `/box/quote` also returns
  `fairness.commit: null` if Postgres is unavailable, and the shop says so.

### The draw order (frozen; changing it breaks every past verification)

Keystream: `HMAC-SHA256(serverSeed, "<algorithm>|<tier>|<address>|<clientSeed>|<counter>")`,
consumed byte by byte, with **rejection sampling** for every bounded draw — a
plain `% n` against a 254-entry pool is a visible thumb on the scale.

1. band — per-ten-thousand against the tier weights
2. species — uniform within the band, ordered by dexId
3. level — uniform in the tier range, inclusive
4. six IVs — uniform in `[ivFloor, 31]`, in the order hp, atk, dfe, spd, ats, dfs
5. nature — uniform over the 25 alphabetical natures
6. shiny — 1 in `tier.shinyOneIn`

---

## 4. HTTP contract

Mounted by `server.mjs` next to `/auth/*` and `/health`.

### Authorisation, in one rule

Every non-public call proves the caller holds the connection id **for a specific
address**, by recomputing `connectionIdFor(address)` and comparing in constant
time. `connectionId` alone is never accepted as proof of anything.

Where the caller does not supply an address (`/box/reveal` with just a uid,
`/box/mine` with just a connection id), the address comes from the stored row —
which still proves they hold that wallet's id and still refuses everybody else.

### `POST /box/quote` — public, no auth

```jsonc
{
  "chainId": 31337,
  "contract": "0x5FbD…",
  "sellable": true,                 // false when unconfigured or degraded
  "tiers": [ { "id": "standard", "priceWei": "10000000000000000",
               "level": [5,25], "ivFloor": 0, "shinyOneIn": 1024,
               "shinyOdds": "1 in 1024",
               "bands": [ { "id":"common", "pct":70, "bst":"0-400", "species":132 }, … ] }, … ],
  "fairness": { "algorithm": "stockmonsters/box-roll/v1", "seedHash": "sha256",
                "commit": { "commitId": "…", "serverSeedHash": "0x…" },
                "note": "…" }
}
```

Rate-limited per IP (30/min) for the commitment only; the tier data always
answers.

### `POST /box/voucher`

Request `{ connectionId, address, tier, commitId?, clientSeed? }` →

```jsonc
{ "uid": "0x…", "tier": "apex", "attrCommit": "0x…",
  "fee": "80000000000000000", "deadline": 1787686426,
  "signature": "0x…", "signer": "0x…", "chainId": 31337, "contract": "0x…",
  "serverSeedHash": "0x…", "clientSeed": "…", "commitId": "…" }
```

**It contains nothing about the contents** — no dexId, level, ivs, shiny,
natureId, salt or seed. `test/lootbox.test.mjs` asserts that field by field.

Refusals: `403 not-your-wallet`, `400 bad-tier`, `400 bad-client-seed`,
`409 commit-spent`, `429 rate-limited`, `429 too-many-outstanding`,
`503 no-signer` / `no-contract` / `boxes-unavailable`.

### `POST /box/reveal`

Request `{ connectionId, address?, uid? | tokenId? }` → the full attribute set,
the salt, and the fairness proof (`serverSeed`, `serverSeedHash`, `clientSeed`,
`rollAlgorithm`), in the argument order `open()` wants.

Custody: the reveal goes to the wallet the box was issued to, **or** to whoever
currently owns the token on chain (`via: "current-owner"`) when an RPC is
configured. The second case is not a loophole, it is the marketplace: a sealed
box whose buyer could never open it would be worthless. An RPC error is never
treated as a yes.

Refusals: `403 not-yours`, `404 no-such-box`, `400 bad-uid` / `bad-token`.

### `GET /box/mine?connectionId=…&address=…`

That wallet's boxes, newest first. Before answering it ages out vouchers past
their deadline and syncs mint/open state **from the chain** (`Minted` events and
`opened(tokenId)`), never from anything the client claims — a client-supplied
tokenId would be a free way to point someone else's box at your token.

A sealed row carries `contents: null`. Only a box the chain says is `opened`
returns its creature. A leaked session must not spoil a sealed listing.

---

## 5. Schema

`db/migrations/0002_boxes.sql`. Two tables.

**`box_seed_commits`** — `commit_id`, the secret `server_seed`, the public
`server_seed_hash`, and `consumed_at`/`consumed_by` making it single-use.

**`boxes`** — one row per box, keyed by `uid` (the same nonce
`voucherUsed[uid]` makes single-mint on chain). It holds who owns it
(`wallet_id` + `wallet_address`), the roll (`dex_id`, `level`, `ivs[6]`,
`nature_id`, `shiny`, `caught_at`), **`salt`**, `attr_commit`, the voucher
(`fee_wei NUMERIC(78,0)`, `deadline`, `signature`, `signer`, `chain_id`,
`contract`), the fairness proof (`commit_id`, `client_seed`, `server_seed_hash`,
`roll_algorithm`, `band`), and what the chain later said (`token_id`,
`mint_tx`). Lifecycle is a `status`:

```
issued → minted → revealed → opened
   └──→ expired            (deadline passed, never minted)
   └──→ voided             (retired by an operator; never deleted)
```

`fee_wei` is `NUMERIC(78,0)` rather than `BIGINT` because a uint256 of wei
overflows a bigint at about 9.2 ETH — squarely inside the range box prices live
in.

### This table is never deleted from

`boxes.salt` is the only copy of the value that can open its token. There is no
recovery path — not on chain, not from the contract owner, not from a
re-derivation. Lose the row and the NFT is permanently sealed.

So DELETE is refused **by the database**, with a trigger:

```
ERROR:  boxes rows are never deleted: 0x… holds the only salt that can open its token.
HINT:   If you really must, ALTER TABLE boxes DISABLE TRIGGER boxes_no_delete.
```

and the foreign key to `players` is `ON DELETE RESTRICT` so a player deletion
cannot cascade through it. A consumed `box_seed_commits` row is protected the
same way, because it is half the fairness proof.

The escape hatch exists and is deliberately noisy. Use it for a real deletion
request; never for a tidy-up.

**Back this table up on its own schedule.** Note also that rotating
`SERVER_SECRET` orphans `wallet_id` here exactly as it does in `players` — but
`wallet_address` is stored alongside, so boxes can still be matched to a human
afterwards. That redundancy is on purpose.

### Two operational notes

- `npm run db:reset` drops only `players`, `player_state` and
  `schema_migrations`, so it will now fail against a database with boxes in it
  (the FK holds). That is the correct outcome — a reset that silently destroyed
  salts would be worse. Drop `boxes` and `box_seed_commits` by hand if you truly
  mean to.
- `(contract, token_id)` is UNIQUE. On a real chain that is always true. In
  development, redeploying to the same address on a fresh anvil makes yesterday's
  token #1 collide with today's; the sync logs it and leaves the box unlinked
  rather than failing the whole request. Mark the stale rows `voided` and clear
  their `token_id`.

---

## 6. Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOX_SIGNER_PK` | — | The game signer. **Without it `/box/voucher` refuses**; `/box/quote` still answers. |
| `BOX_NFT_ADDRESS` | — | StockmonstersNFT. Bound into every signature. |
| `BOX_CHAIN_ID` | `31337` | Bound into the EIP-712 domain. |
| `BOX_RPC_URL` | — | Optional. Without it the server cannot learn token ids or ownership, so `/box/mine` shows no tokens and a marketplace buyer cannot get a reveal. |
| `BOX_FROM_BLOCK` | `0` | Where the `Minted` log scan starts. Set it to the deploy block on a real chain. |
| `BOX_VOUCHER_TTL_S` | `900` | Voucher lifetime. |
| `BOX_RATE_MAX` / `BOX_RATE_WINDOW_S` | `10` / `60` | Vouchers per wallet per window. |
| `BOX_MAX_OUTSTANDING` | `25` | Unminted live vouchers per wallet. |

Degradation follows `profiles.mjs`: a missing key, a missing contract or a
Postgres outage produces a `503` with a reason and one warning line, never a
throw that reaches a game handler. The one deliberate difference is that box
writes **abort** rather than degrade — see §1.

---

## 7. Verifying it works

```bash
docker compose up -d
npm run db:migrate
node --env-file-if-exists=.env --test test/lootbox.test.mjs   # needs anvil on PATH
```

The suite boots anvil, deploys `StockmonstersNFT`, and drives the real HTTP
handlers: quote → voucher → `mintCaught` with the exact fee → the token reads
empty on chain → reveal → `open()` → the stored attributes equal the roll. It
also proves the refusals: a foreign connection id, a stranger's reveal, a
double mint, an expired deadline, a wrong fee (under, over and zero), a tampered
reveal, a stranger's `open()`, a re-used fairness commitment, the rate limiter,
and the no-delete trigger.

Manual smoke test against a running server and chain:

```bash
anvil &
forge create --rpc-url http://127.0.0.1:8545 --private-key <k> --broadcast \
  StockmonstersNFT.sol:StockmonstersNFT --constructor-args <signer> "ipfs://x/" "ipfs://sealed"
BOX_SIGNER_PK=… BOX_NFT_ADDRESS=… BOX_RPC_URL=http://127.0.0.1:8545 npm start
node tools/lootbox-cli.mjs buy --url http://localhost:3000 --tier apex --pk <buyer> --open
```

---

## 8. The shop window (`src/box-shop.ts`)

`mountBoxShop(engine, socket)` at boot, `openBoxShop()` from anywhere — the same
shape as `mountMarketplace` / `openMarketplace`, using the same `ui-kit.ts`
vocabulary and the same z-index budget, so the two windows are siblings.

Three rules the file keeps:

1. **A sealed box never renders creature art.** The only place contents appear
   is a box the server says is already open.
2. **The reveal animation is theatre over fact.** It plays while the request is
   in flight and lands on exactly what the server returned. It rolls nothing,
   pre-guesses nothing, and on failure says so instead of inventing a creature.
3. **The player's wallet pays.** `window.ethereum` sends `mintCaught` and
   `open` directly. No dependency is added: both calldata payloads are
   hand-encoded, and the two selectors are pinned as constants that
   `test/lootbox.test.mjs` checks against the compiled artifact's
   `methodIdentifiers` — so a contract signature change breaks a test rather
   than a player's transaction. Regenerate with
   `node tools/lootbox-cli.mjs selectors`.

With no wallet connected the window says so, on both tabs, and still shows real
prices and real odds.

---

## 9. Known gaps

- **Aggregate odds are unverifiable by construction.** §2 covers this; the
  mitigation is indexing `Opened` events, which nothing does yet.
- **No refund path for a signed-but-unminted voucher.** Nothing was paid, so
  nothing is owed — the row just ages to `expired` — but a player who paid gas
  on a reverting mint gets no help from us.
- **`/box/mine` scans `Minted` logs from `BOX_FROM_BLOCK` on every call.** Fine
  on anvil and fine for a few thousand blocks; a busy real chain wants a cursor
  or an indexer.
- **Prices are hard-coded in ETH.** There is no oracle, so a 10× move in ETH is
  a 10× move in the price of a box.
- **`box_seed_commits` grows with unconsumed quotes.** Harmless (a row is ~150
  bytes) but a sweep of old *unconsumed* rows would be tidy. Consumed ones must
  stay.
