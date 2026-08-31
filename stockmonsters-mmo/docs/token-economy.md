# The token, and what it is for

**Status: built and live on Sepolia.** Not verified on Etherscan — deliberate.

```
token     0x9FF2cC8CdfC70d36e473Ae6cECCa0728D73c0580   $STONKSTER, 1,000,000,000 fixed
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

**Loot boxes** — the shop offers a currency switch. Every tier has ONE price,
in dollars, anchored to its ether price, and the token quote is that dollar
converted at the live rate — see *What a dollar is worth* below. The client
*asks*, the server *decides*: the price comes from our tier table and the
currency address is ours, never the request's.

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

## What a dollar is worth

Every price in the game is denominated in **dollars** — a quest is worth $1-2,
the daily board about $7, a wallet may earn $20 a day, a standard box is 0.01
ETH — and converted to tokens at the last moment. So one number decides what
every reward is actually worth, and getting it wrong is the quietest bug in the
codebase: nothing throws, everybody is just paid a fraction of what the board
promised.

**It used to be an environment variable.** `SM_TOKEN_USD=0.0002`, written from
an assumed $200,000 fully-diluted valuation over a billion supply, and
`SM_ETH_USD=3000`, a guess. Both were wrong by the time they mattered.

**It is now read off the market.** The token launches on the **pons** launchpad
on **Robinhood Chain (4663)**, which mints the whole supply to a bonding curve
and lets the curve open the price. Nobody sets it, so nobody can write it down.

`price-oracle.mjs` is the single source of truth:

```
SM_TOKEN_ADDRESS  ->  pons factory.getLaunchedToken(token)
                          |
       graduated ---------+--------- not graduated
           |                              |
   a Uniswap v4 pool               its bonding curve
   PoolKey = (currencies sorted    curve.getReserves()
     ascending, poolFee, tick-       -> (quote, tokens)
     Spacing, the pons Meme hook)     and their ratio is
   poolId = keccak256(abi.encode(     the spot price
     poolKey))
   StateView.getSlot0(poolId)
     -> sqrtPriceX96
```

Either way the answer is a price in **ether**, multiplied by an ETH/USD rate
fetched from a keyless public API (Coinbase, then Kraken). Both are cached for
`PRICE_TTL_MS` (45s) and refreshed on a background timer, because the consumers
— `src/modules/main/pricing.ts` for quests and the daily cap, `lootbox.mjs` for
boxes — are synchronous and cannot await. They reach it through
`globalThis.__smPrices`, the same bridge the profile, box and token stores use,
because `src/modules/**` is bundled into the browser and must not import an RPC
client.

`GET /token/price` shows what the server currently believes and, more
importantly, **where it got it**.

### Falling back, and refusing

| what is true | what happens |
|---|---|
| the pool or curve answered recently | that price. Not clamped. |
| the RPC is down, `SM_TOKEN_USD` is set | that value, with a loud log line. A person wrote it and can be argued with. |
| no oracle configured at all (pre-launch, dev, tests) | the built-in $200k launch assumption, clamped. Pays normally. |
| an oracle IS configured and has nothing | **refuse.** `tokensForUsd` returns 0, quests do not consume their claim, boxes cannot be bought with tokens. |

The last row is the point. Once a real market exists, the $200k assumption is
not a fallback — it is a guess about a price that exists and disagrees, and
paying from it is exactly the failure this was built to remove. A visibly
broken reward is recoverable; months of quietly underpaying everyone is not.

### What bounds a live price

The old clamp — 20x either side of the launch assumption — still guards a
**mistyped configuration**. It must not touch a market price: its anchor is the
very assumption the real launch contradicts, so clamping against it is how you
pay a fifth of what you promised with every test green. A live price is bounded
by three things that are actually about the market instead:

- the oracle **refuses a reading** whose implied market cap is not the right
  order of magnitude ($100 … $100bn) — that is a units bug, not a cheap token;
- it **will not act on a 25x jump** until a second read, 45 seconds later,
  still agrees. A pons pool graduates with about one ether of liquidity, so a
  few hundred dollars moves it tenfold and a crashed price *inflates* what a
  quest pays;
- **`DAILY_CAP_USD` is denominated in dollars.** A wallet earns at most $20 a
  day whatever the price does, so the cap shrinks in tokens exactly as fast as
  a crash inflates a payout. That is the real bound.

### Proving it before our token exists

```bash
node tools/e2e-pons-price.mjs
```

Indexes `TokenLaunched` off the pons factory, finds real graduated launches,
prices them, and **cross-checks each against the v4 Quoter** — which simulates
a swap rather than reading storage. Spot must sit between what a buy pays and
what a sell receives, because the difference is the fee. It also prices a token
still on its bonding curve, and drives both fallback paths.

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

## Duels

```
arena  0x4B4b255E47B7dFaE8B99fd5E7C60089A5E81a6e2
gyms   0x8d697Bf3c383fC90204E9279413Fd3849794B7f1
```

Walk up to someone, bet tokens, and fight for them. **Both picks are blind**:
each player chooses a Stockmonster, the server hashes it with a random salt,
and the two hashes go into the wager they both sign. Neither can see the
other's, and neither can substitute a counter after the fact — the reveal at
settlement is checked against the commitment, on chain.

```
1. offer     you must be standing next to them (the same proximity rule DMs use)
2. accept    nothing is escrowed yet; declining costs nothing
3. pick      each side locks a creature, hashed with a random salt
4. sign      ONE wager, BOTH signatures — a bet, not something done to somebody
5. open      the challenger sends open(); both stakes escrow on chain
6. fight     only after the SERVER reads the escrow back off the chain
7. settle    the winner sends settle() and takes the pot minus the rake
```

**The fight is auto-resolved from the committed seed.** A wagered duel cannot
be played turn-by-turn: somebody would disconnect the moment they were losing,
and "the server says you forfeited" is not a judgement a bet should need. The
seed's hash is published before either player picks and the seed itself is
revealed on settlement, so the whole fight can be replayed and checked —
`src/battle/duel.ts` is the function to run.

Only OPENED Stockmonsters can fight. A sealed box's contents are the product;
letting one duel would reveal what it holds to anyone reading the replay.

| | |
|---|---|
| rake | 3% of the pot, to the treasury |
| max wager | 1,000,000 $STONKSTER |
| daily payout cap | 20,000,000 $STONKSTER |
| result window | 30 minutes, then **either player takes their own stake back** |

The refund is the important one: a server that crashes mid-duel cannot hold
anybody's money, and neither player has to wait for the other to act.

Proven on Sepolia by `npm run test:e2e:duel` — two fresh wallets, a real
1,000,000 $STONKSTER wager, escrow opened, result signed, winner paid 1,940,000 and
60,000 of rake in the treasury.

## Gyms

> **Deployed, funded, and not wired to the game.** Everything below describes
> `StockmonstersGyms` as it exists on Sepolia, and every word of it is true of
> the contract. None of it is reachable from the game: there is no ABI, no
> server module, no UI, and no gym anywhere in the world. `SM_GYMS_ADDRESS` is
> read in `token.mjs` and echoed at `/token`, and that is the whole integration.
> Read this as a design that is waiting to be built, not a feature players have.

Players hold the gyms. Stake tokens to take one; anyone can pay an entry fee to
challenge it.

```
challenger loses  ->  70% of the fee to the holder, 30% to the treasury
challenger wins   ->  the gym changes hands; the old holder keeps their stake
                      minus a 20% takeover bounty, which goes to the winner
```

Entry fee is 5% of the holder's stake. A challenger posts their own stake up
front — a winner has to be able to hold what they took — and gets it straight
back if they lose. Nothing here is minted: every payout is an entry fee
somebody chose to pay.

Same shape of protection as the arena: a result is bound to ONE challenge (the
gym, the challenger, and the moment it opened) so it cannot be replayed against
the next one, results expire, and `resolveTimeout` gives the challenger their
money back if no result is signed. There is a per-gym cooldown so a holder
cannot be ground down by twenty challenges a minute.

## What is still a decision, not a task

**Wagered PvP is gambling in many jurisdictions.** The contract is written,
tested and deployed to a testnet; whether it ships on mainnet is a business
call. Gyms are a tournament with an entry fee, which is a materially different
thing — that is why they exist as a separate contract rather than as a mode of
the arena.

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
