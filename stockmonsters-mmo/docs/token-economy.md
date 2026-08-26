# The token, and what it is for

**Status: built and live on Sepolia.** Not verified on Etherscan — deliberate.

```
token     0x9FF2cC8CdfC70d36e473Ae6cECCa0728D73c0580   SMON, 1,000,000,000 fixed
rewards   0xB16624Ebb621Fff77cFdfBFcC138ce94FAbA74Cf   what players are paid from
treasury  0x3313aa2f787cD4d8Ca158f7fB00beb9c67E1a577   where revenue lands
nft       0xB0B5219CD63E505269E7327F048E0976eDeD799B   the creatures
market    0x095bdB719e6c626b69C0ab0b5f9C6B657bedbe2E   peer-to-peer trading
```

Redeploy anywhere with `node tools/deploy.mjs --chain sepolia`, which writes
every address into `.env` and `deployments/<chain>.json`.

## The rule everything follows

**The game never mints money.** Supply is fixed at deploy — there is no mint
function in the token, at all. Every token a player earns is paid out of a pool
that already exists, filled by the trading tax and by the treasury buying back
with real revenue.

Battle-to-mint is the standard play-to-earn failure: bots farm it, supply
outruns demand, the price collapses, and the people holding the bag are the
players who believed in it. So the economy is zero-sum plus a rake, and if a
faucet is ever wanted it should be a decision with a number attached.

---

## One address configures everything

`SM_TOKEN_ADDRESS` is the only thing that has to be set. Name, symbol, decimals
and logo are **read off the token**, which describes itself on chain:

```
function logo() view returns (string)
function description() view returns (string)
function liquidityPool() view returns (address)
function socials() view returns (string twitter, string telegram, ...)
```

`StockmonstersToken` implements that interface, so when the real launch token
replaces it the change is one variable and nothing else. The four standard
ERC-20 calls are required; the four above are each read in their own try/catch,
because a plain ERC-20 does not have them and that is not an error.

Three things this gets right, each of which was a real trap:

- **`decimals()` is read, never assumed to be 18.** A 6-decimal token against
  an 18-decimal assumption is a 10^12 error in what players are owed.
- **No address means the pre-token behaviour, and the UI says so.** Prices stay
  in ETH, the balance chip is *removed* rather than left showing fiction, and
  the box shop keeps its DEMO MODE banner.
- **The server primes the metadata at boot**, because the reward ledger
  multiplies by those decimals and a guess there is not recoverable.

---

## The token

Fixed supply, no mint function, no blacklist, no pause, no transfer gate. The
owner can lower the tax and can renounce ownership outright; there is no
transaction that raises the tax past the constant cap.

| | |
|---|---|
| supply | 1,000,000,000, minted once at deploy |
| buy tax | 2% |
| sell tax | 2% |
| **wallet to wallet** | **0%, always** |
| tax cap | 5%, a `constant` — not a setting |
| players' share of tax | 75%, and it cannot be set below 50% |
| treasury's share | 25% |

**Tax only applies when one side is a registered AMM pair** — a buy or a sell
on a DEX. Sending tokens to a friend, paying for a loot box, settling a market
order or funding an escrow is never taxed. That is not politeness: every
contract in this system moves exact amounts, and a token that silently delivers
less than it was told to breaks escrow arithmetic everywhere. Until a pair is
registered, nothing is taxed at all — which is the state a fresh testnet is in.

The split happens **in place**, as two balance writes. No swapping, no callback
into a router mid-transfer, nothing that can fail or be sandwiched.

---

## Where revenue goes

Every fee the game charges lands in the treasury: NFT claim fees, the
marketplace rake, box sales. `route()` splits it, and **anyone may call it** —
the destinations are fixed, so letting anyone press it removes the "the team
never got round to it" failure mode.

| Arrives as | Half to players | Half to ops |
|---|---|---|
| ETH | held as a buyback reserve, spent on the open market by `buyback()` | pushed to the ops wallet |
| tokens | straight to the rewards pool — it is already the right asset | pushed to the ops wallet |

Every token a buyback purchases goes **to the rewards pool, never to us**. The
players' share is bounded below at 25% by the contract, so "half goes back into
the game" cannot quietly become a tenth.

`buyback` is a separate, owner-signed transaction with an explicit `minOut`.
Swapping automatically on receipt would make every NFT buyer pay for our DEX
trade, hand a sandwich bot a free lunch, and make mints revert whenever the
router had a bad day.

```bash
node tools/treasury.mjs status
node tools/treasury.mjs route
node tools/treasury.mjs set-router --address 0x...
node tools/treasury.mjs buyback --eth 0.05 --min 100000
```

---

## What players earn, and how they are paid

| | whole tokens |
|---|---|
| winning a wild battle | 10 |
| catching a species for the first time | 50 |
| any catch after that | 5 |
| opening a sealed box | 25 |
| standing on a map they have never seen | 2 |

Earnings accrue to a per-epoch ledger in the player's save
(`{ "<epoch>": "<base units>" }`). An **epoch is one UTC day**, matching the
budget the rewards contract enforces.

Claiming: the player asks, the server signs an EIP-712 `Claim`, and **the
player sends the transaction themselves**. No key on this server ever moves a
player's money.

**Rewards are parked when the wallet is not known yet.** A player joins a map —
and can already be earning — before the client has said which wallet they are.
Crediting straight to the ledger in that window dropped the reward silently AND
marked the map visited, so it could never be earned again. Found by driving a
real session; `flushPendingRewards` moves it across when `auth:wallet` lands,
after the profile has loaded rather than alongside it.

### The bound that matters

The chain cannot see a battle, so any distribution rests on the server's word.
The contract does not pretend otherwise — it bounds the damage:

- **A budget per epoch.** A leaked claim signer can drain one day and nothing
  more, ever. Without this, one key equals the whole pool.
- **One claim per player per epoch**, so a signature cannot be replayed.
- **Deadlines**, so an old signature cannot be banked and cashed later.
- **The claim is bound to the claiming address**, so it cannot be lifted from
  someone else's transaction.
- **The signer is not the owner, and not the box signer.** Three keys, three
  blast radii.
- **The owner cannot take the pool**: `sweep` refuses the reward token.

Fund more days with `node tools/fund-epochs.mjs` (owner-signed, on purpose).

---

## Paying with the token

**Loot boxes** — the shop offers a currency switch; every tier has a token
price (2,500 / 7,500 / 20,000 SMON). The client *asks*, the server *decides*:
the price comes from our tier table and the currency address is ours, never the
request's.

**The marketplace** — `Order` carries a `currency` field **inside the signed
struct**. As a bare parameter, a buyer could hand over a worthless token of
their own choosing and walk off with the NFT. Only currencies the owner has
whitelisted on chain can be used, so a seller cannot list against a token they
invented either.

Two traps handled rather than discovered later:

- **Approve is two transactions.** The UI narrates it — "1 of 2: allow the shop
  to spend your tokens", then "2 of 2: buy" — and waits for the approval
  receipt before the mint, which would otherwise revert.
- **A fee-on-transfer token breaks escrow arithmetic.** Every payment checks
  the recipient's balance delta and reverts on a shortfall rather than quietly
  short-paying the seller. (Our token does not tax these transfers at all — see
  above — but the market accepts more than one currency.)

---

## Tests

```bash
cd contracts && forge test          # 117, including 36 for the economy
npx vitest run                      # 204, including the reward ledger
npm run test:e2e:token              # the real chain, in a real browser
```

The end-to-end run is the one that matters. It injects a real EIP-1193 wallet
into a headless browser and asserts, against Sepolia: the server reads the
token's metadata off the chain, the HUD shows a real balance instead of the old
placeholder, a claim pays the player **on chain**, the shop prices boxes in
tokens, a box is bought with tokens, and the fee lands in the treasury.

One thing in that run is a fixture and is labelled as one: the amount a player
has earned is seeded directly into the profile. What the chain path proves is
that the server signs what is owed and the pool pays it; that earnings are
credited correctly by playing is covered exactly — and in milliseconds — by
`src/modules/main/earnings.spec.ts`.

---

## Not built yet

**Gyms.** A player stakes tokens to hold one; challengers pay an entry fee;
losing a challenge splits the fee to the holder and the treasury; winning takes
the gym and a slice of the old holder's stake. It funds itself out of entry
fees, needs no emissions, gives the 171-map world a destination, and is a
tournament rather than a bet between two people.

**Wagered PvP.** Both players sign, the stakes escrow, the server signs the
result. The trust surface is the same signing-key problem as above but with
locked money behind it, so it needs its own key, a wager cap, a rolling daily
payout cap, and a **timeout refund** so a server crash never locks a player's
stake. It is also gambling in many jurisdictions — a business decision to make
before the contract is written, not after it is deployed.

Gyms first, for those reasons.

## Before mainnet

1. **Register the AMM pair** with `setPair` once liquidity exists — until then
   nothing is taxed, which is correct for a testnet and wrong for a launch.
2. **Set the router** so `buyback` works (`tools/treasury.mjs set-router`).
3. **Move the three keys off the game server's disk.** Deployer, box signer and
   claim signer are three separate keys precisely so they can live in three
   separate places.
4. **Decide the ops wallet.** It is the deployer today, which is fine for a
   testnet and not for real revenue.
5. **Verify the contracts on Etherscan.** Skipped here on purpose.
