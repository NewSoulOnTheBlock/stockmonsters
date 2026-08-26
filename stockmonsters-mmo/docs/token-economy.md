# The token, and what it is for

**Status: a plan. Nothing here is built.** The token does not exist yet, and
this document is written so that when it does, the only thing anyone has to do
is paste its address.

Today every price in the game is in native ETH — `StockmonstersNFT.claimFee =
0.01 ether`, `StockmonstersMarket.fillOrder(...) payable` — and the `SMON
12,400` chip in the HUD is an invented number in `demoHudModel()`. So this is a
contract change, not a setting.

## The rule this whole design follows

**The game never mints money.** Every token a player earns comes out of another
player's pocket, and the treasury takes a small cut. Battle-to-mint is the
standard play-to-earn failure: bots farm it, supply outruns demand, the price
collapses, and the people left holding it are the players who believed in it.

Everything below is therefore zero-sum plus a rake. If a faucet is ever wanted,
it should be added deliberately, capped, and time-limited — never as a side
effect of playing.

---

## Phase 1 — one address, and the game configures itself

### One variable

```bash
# .env
SM_TOKEN_ADDRESS=0x…      # unset until launch; the game runs exactly as it does now
SM_CHAIN_ID=…             # already exists as BOX_CHAIN_ID
SM_RPC_URL=…              # read-only node, for balances and metadata
```

Nothing else. No symbol, no decimals, no logo in config — the launch token is
self-describing on chain, so the server asks it:

```ts
const tokenAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function logo() view returns (string)',
  'function description() view returns (string)',
  'function liquidityPool() view returns (address)',
  'function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)',
])
```

Read once at boot, cached, served to the client at `GET /token`. The HUD chip
then labels itself with the real symbol, formats with the real decimals, and
shows the real logo. **Nothing in the codebase hardcodes "SMON".**

Three things this must get right:

- **`decimals()` is read, never assumed to be 18.** A token with 6 decimals and
  an 18-decimal assumption is a 10¹² pricing error.
- **`logo()`, `description()` and `socials()` are not standard ERC-20.** Each is
  read in its own try/catch: a token without them still works, it just shows
  less. The four standard calls are the only ones allowed to fail loudly.
- **Unset means today's behaviour, and the UI says so.** No address → prices
  stay in ETH, the balance chip disappears rather than showing a fake number,
  and the box shop keeps its existing DEMO MODE banner. Following the rule the
  rest of this codebase already follows: an unbuilt thing says so.

### What the player sees in phase 1

Their real balance in the HUD, their real symbol, and nothing else changed. It
is a small phase on purpose: it proves the address, the RPC and the decimals
are right *before* any contract holds money.

---

## Phase 2 — buying with the token

### Marketplace

`Order` currently carries `seller, tokenId, price, minProceeds, deadline,
epoch, salt, requireSealed, attrCommit, taker`. It gains one field:

```solidity
address currency;   // address(0) = native ETH, otherwise an ERC-20
```

**`currency` must be inside the signed struct** (`ORDER_TYPEHASH`). If it were
a parameter instead, a filler could hand over a worthless token of their own
choosing and take the NFT. The signature is what binds "3,000 of *this* token"
to the order.

`fillOrder` then either takes `msg.value` as it does now, or pulls
`transferFrom(buyer, …)` — never both.

### Boxes

`lootbox.mjs` already quotes a price and signs a voucher bound to a contract and
a chain. The voucher gains the same `currency` field, and `/box/quote` returns
the price in token base units alongside the metadata from `/token`.

### The two traps here

**Approve is two transactions.** ERC-20 payment means `approve` then `buy`, and
a UI that opens one wallet prompt and then a second unexplained one reads as
broken. The flow must say "1 of 2 — allow the market to spend your TOKEN" and
"2 of 2 — buy". If the launch token implements EIP-2612 `permit`, that collapses
back to one signature; plan for approve, use permit when it is there.

**A fee-on-transfer token breaks exact accounting.** Launchpad tokens sometimes
tax transfers, so `transferFrom(x)` credits less than `x` — and escrow that
assumes it received `x` will be short when it pays out. Every contract that
takes custody must measure `balanceAfter - balanceBefore` and use that, or
refuse the token outright at deploy time with a clear error. **Decide which
before deploying: silently paying out less than promised is the worst outcome.**

---

## Phase 3 — gyms (the best of the three)

Shakespizzy's idea, made concrete: **players become the gym leaders.**

```
A player stakes S to hold a gym (one per location, 8–16 locations).
A challenger pays entry fee F to fight it.

  challenger loses  ->  F splits: 70% to the holder, 30% to the treasury
  challenger wins   ->  the gym changes hands. The challenger posts their own
                        stake, the old holder gets S back minus a takeover
                        bounty (~20%) that goes to the new holder.
```

Why this comes before wagered PvP:

- **It funds itself.** No emissions, no faucet — every payout comes from an
  entry fee someone chose to pay.
- **It creates a reason to hold both the token and good NFTs.** A gym is
  income, and defending it needs a real team.
- **It is a destination in a 171-map world.** Gyms give the map a purpose
  beyond walking through it.
- **The legal shape is softer** than head-to-head wagering: an entry fee for a
  challenge with a prize is a tournament, not a bet between two players. Not
  legal advice, but a materially different thing.

Needed alongside it: a per-gym challenge cooldown (a holder cannot be ground
down by twenty challenges a minute), a minimum stake, and a "gym is being
challenged" lock so two challengers cannot fight the same gym at once.

---

## Phase 4 — wagered PvP (`StockmonstersArena`)

Two players agree, the money is escrowed, the winner takes it minus a rake.

```
1. Both players sign an EIP-712 Wager
     matchId, playerA, playerB, currency, amount, expiry
   Both signatures are required to open the match: the server cannot invent a
   wager between two people who did not agree to it.
2. open(...) pulls both stakes into the contract.
3. The battle happens on our server, exactly as it does now.
4. The server signs Result(matchId, winner, seed) and either player submits it.
   The contract pays 2 × amount − rake to the winner.
```

### The part that cannot be engineered away

**Our server decides who won.** The chain cannot watch a battle; the contract
only ever sees a signature. So a wagering system is a full trust bet on one
key — the same shape as the sealed box, except now there is locked money behind
it. If that key leaks, the escrow is drained and nothing on chain looks wrong.

That is not a reason to skip it. It is a reason to bound it, from day one:

| Control | Why |
|---|---|
| `matchId` used exactly once | replay: one signed result must not pay twice |
| result expiry | a stale signature cannot be held and cashed weeks later |
| `maxWager` | caps the damage of one bad signature |
| rolling daily payout cap | caps the damage of a key leak to one day's ceiling |
| **timeout refund** | if no result is signed within N minutes, *either* player withdraws their own stake. A server crash must never lock a player's money. |
| pause switch (owner) | a compromised key gets stopped at the contract |
| its own signing key, **not** the box key | separate keys, separate blast radius |

### Making the outcome auditable

Reuse the commit-reveal already built for boxes: the server publishes
`keccak(seed)` before the match and reveals `seed` with the result. It does not
prove the server followed its own rules, but it does prove the RNG was fixed
before the fight rather than chosen after it — and combined with the open battle
engine, a cheating server becomes detectable rather than merely deniable.

### Disconnects

A player who closes the tab mid-match must not void the wager, or every losing
player will "lose connection". The server signs a forfeit result after a
timeout — which is also why `onLeaveMap` now reliably detects leaving
(`docs/friends.md`).

---

## Where the token flows

| Out of players' hands (sinks) | Into players' hands (only source) |
|---|---|
| NFT claim fee | winning a PvP wager |
| buying a sealed box | holding a gym others challenge |
| gym entry fee | taking over a gym |
| marketplace rake | selling an NFT to another player |

**There is no other source.** The treasury accrues; the player pool is
zero-sum minus the rake. If that ever needs to change, it should be a decision
with a number attached, not an accident.

---

## What has to be decided before any of this ships

1. **Does the launch token tax transfers?** Determines whether escrow uses
   balance deltas or refuses the token. (Phase 2 blocker.)
2. **Rake percentages** — market, arena, gym. One number each.
3. **Who holds the arena signing key, and where.** Not on the game server's
   disk next to the box key.
4. **Whether wagered PvP ships at all.** Staking real value on a match outcome
   is gambling in many jurisdictions. Gyms sidestep most of it; head-to-head
   wagering does not. This is a business decision, not a technical one, and it
   should be made before the contract is written rather than after it is
   deployed.

## The order, and why

The phases above are numbered in the order they should be built: address
plumbing, then paying with the token, then **gyms**, then wagered PvP if it is
wanted at all.

Gyms before PvP on purpose: they deliver the play-to-earn loop with a smaller
trust surface and a much smaller legal one, and if they work, the arena is a
small addition to the same escrow machinery. Every phase is testable against a
local anvil chain with a throwaway ERC-20, so none of it waits on the real
token — only the final deploy does.
