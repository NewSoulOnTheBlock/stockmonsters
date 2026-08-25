# Stock Monster Collection

Two parts:

- **`src/`** — the off-chain reference implementation (data model + algorithm spec): catch-rate math,
  trait generation, cap enforcement, ERC-721 metadata shape. Pure TypeScript, tested with vitest.
- **`contracts/StockMonsterCollection.sol`** — the actual ERC-721 mint contract, a mechanical Solidity
  port of everything in `src/`. Tested with Hardhat (`npx hardhat test`), including a real end-to-end
  5000-mint run proving the supply cap, not just unit-level logic.

The `src/` version exists on purpose, separately from the contract: it's the place to validate the
math in plain, fast, float-friendly TypeScript before translating it into gas-conscious fixed-point
Solidity, and it stays as the readable spec for anyone extending the contract later.

## The Solidity contract (`contracts/StockMonsterCollection.sol`)

Standard OpenZeppelin `ERC721` + `Ownable`. Same rules as the TS spec below, ported to integer math:

- `throwBall(dexId, level, maxHp, currentHp, status, ball)` — the one entry point. Charges the exact
  ball price, resolves the catch (classic 4-shake mechanic, integer-exact port of the formula below),
  and on a catch generates traits and mints, respecting both caps.
- `registerSpecies(...)` — owner-only, **batched** (deploying all 254 species in a single call blows
  the block gas limit — confirmed while building this, not a guess; `scripts/deploy.ts` batches 50 at
  a time).
- `tokenURI()` — fully on-chain, no off-chain metadata server needed. Returns a base64 `data:` URI with
  the same attribute shape as `src/metadata.ts`. Only the actual PNG art lives off-chain (IPFS).
- `withdraw()` — owner pulls accumulated ETH out (ball payments are kept regardless of catch outcome,
  same as the off-chain spec).

**Run it:**
```
npx hardhat compile
npx hardhat test                              # 13 tests, ~10s, includes a real 5000-mint cap test
npx hardhat run scripts/deploy.ts             # deploys + registers all 254 species locally
npx hardhat run scripts/deploy.ts --network <name>   # real deployment, once a network is configured
```

**A real bug this caught, worth knowing about:** the species-extraction script originally mishandled
single-typed creatures — PSDK marks "no second type" with the literal string `"__undef__"`, not JSON
`null`, and the first version of `scripts/extract-species.mjs` let that sentinel through unchanged. It
surfaced as a Solidity ABI-encoding crash when registering the full roster, not as a silent bad value,
which is how it got caught. Fixed in the extraction script; `data/species.json` is regenerated clean.

---

Below is the original off-chain spec this contract was built from.

## The collection

- **254 species** (`data/species.json`), pulled directly from the live Stockmonsters game data — same
  base stats and catch rates the PSDK game itself uses for wild encounters. Regenerate with
  `npm run extract-species` if the game roster changes.
- **5000 total supply cap**, shared across every species combined (`GLOBAL_SUPPLY_CAP` in
  `src/collectionState.ts`).
- **Exactly 1 shiny per species, ever** — 254 possible shinies max, tracked via a per-dexId claimed
  flag. Once a species' shiny is minted, every future shiny *roll* for that species is discarded and
  the mint proceeds as a regular one instead of failing. Unlimited regular (non-shiny) mints per species,
  bounded only by the global 5000 cap.

## Catching (`src/catchRate.ts`)

Uses the real Gen III+ Pokémon catch formula — not a simplified approximation — because the game
already ships each species' `catchRate` (1-255) and the classic formula is exactly what makes that
number meaningful:

```
a = floor( floor(3*maxHP - 2*currentHP) * catchRate * ballBonus / (3*maxHP) ) * statusBonus
```

- `a >= 255` → guaranteed catch.
- Otherwise, 4 sequential "shake checks" each roll against `b = 65536 / (255/a)^0.25`; all 4 must
  succeed to catch (this is the source of the "so close!" break-free flavor from the real games).
- `catchProbability()` exposes the closed-form probability (`(b/65536)^4`) for UI/EV display; the actual
  resolution should still call `attemptCatch()` with real randomness so a species with a=250 still *can*
  genuinely break free, matching the original games' feel.

**Status bonus:** sleep/freeze = ×2, paralyze/poison/burn = ×1.5, none = ×1.

## Balls (`src/ballTypes.ts`)

| Ball | Mint price | Catch bonus |
|---|---|---|
| Stock Ball | 0.002 ETH | ×1 |
| Great Stock Ball | 0.006 ETH | ×1.5 |
| Ultra Stock Ball | 0.01 ETH | ×2 |

Price is charged for the *attempt* regardless of outcome (same as spending a real Poké Ball) — the
caller (contract) collects payment before calling `catchAndMint()`.

## Minted traits (`src/traits.ts`)

Exactly the 7 traits requested, plus Level as an 8th:

- **Level** — supplied by the caller, not randomized here. Narratively this is a property of *which*
  wild Stockmonster you're fighting (the game's own encounter tables decide that), not a mint lottery.
- **HP / Attack / Defense / Special Attack / Special Defense / Speed** — each stat gets an IV roll
  (0-31, classic Pokémon convention) and the final value uses the standard Gen III+ formula against the
  species' real base stats:
  - `HP = floor((2*base + iv) * level / 100) + level + 10`
  - other stats = `floor((2*base + iv) * level / 100) + 5`
  - (No nature modifier yet — every mint is stat-neutral for now. Easy to add later as a 9th trait.)
- **Shiny** — 1/8192 odds per mint (`SHINY_ODDS`), gated by the per-species claimed flag above.

## Putting it together (`src/mint.ts`)

`catchAndMint(input, state, rng)` is the single entry point: checks the global supply cap, resolves the
catch attempt, and — only on a successful catch — resolves shiny availability and generates traits,
recording the mint into `state`. Three possible outcomes: `supply_exhausted`, `broke_free`, `minted`.

**On `rng`:** every function here takes an injected `() => number` uniform-[0,1) source rather than
calling `Math.random()` internally. That's deliberate — a real deployment needs verifiable randomness
(Chainlink VRF or similar) for anything that gates money changing hands, and this keeps the pure logic
testable/deterministic while making the "plug in real randomness here" seam explicit.

## Metadata (`src/metadata.ts`)

Standard ERC-721 `tokenURI` JSON shape. `IMAGE_BASE_URI` is a placeholder — swap it for the real pinned
IPFS CID root once art is finalized. Expects one folder per species (by `dbSymbol`) containing
`regular.png` and `shiny.png`.

**Known gap:** the game currently has no shiny sprite variants generated for any species (confirmed
while building this - only regular fronts exist). Shiny art needs to exist before `image` URIs for
shiny mints resolve to anything real.

## Running it

```
npm install
npm run extract-species   # regenerate data/species.json from the live game data
npm run typecheck
npm test                  # 30 tests: catch-rate math, IV/stat bounds, shiny-cap + supply-cap
                           # enforcement, metadata shape
npx tsc && node scripts/demo.mjs   # build + run a live example: a few catch attempts + real JSON output
```

## Open questions — still open in the deployed contract

- **Randomness is a placeholder.** `_random()` in the contract uses `blockhash`/`block.prevrandao`,
  which a miner/validator can bias. Fine for local/testnet development (which is what's been tested),
  but swap in Chainlink VRF (or equivalent) before any real-money mainnet launch. Because VRF is
  request/fulfill (two transactions), that's a real architecture change to `throwBall()` — not a
  drop-in swap — and should happen before launch, not after.
- **Encounter data is trusted, not verified.** `throwBall()` takes `currentHp`/`status`/`level` as plain
  arguments — nothing stops a caller from lying about them to inflate their catch odds. A real
  deployment needs the game backend to sign the wild-encounter state (EIP-712) and the contract to
  verify that signature before trusting it.
- Fixed-point math: **done** — `computeA` and the shake-check threshold are both exact integer ports
  (see `_shakeThreshold`'s `isqrt(isqrt(...))` trick for the 4th-root), not float approximations.
