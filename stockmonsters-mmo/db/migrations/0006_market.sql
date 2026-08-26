-- The order book for StockmonstersMarket.
--
-- WHAT THIS TABLE IS NOT: custody. Every row is a signature the SELLER made
-- over an Order struct; the token stays in the seller's wallet and the market
-- contract settles the swap in one transaction paid for by the buyer. The
-- server never holds a key that can move anything and never signs an order on
-- anyone's behalf. Losing this whole table costs the index, not the assets —
-- the opposite of `boxes`, where a lost row bricks an NFT. So unlike `boxes`
-- there is no no-delete trigger here: a row that can no longer fill SHOULD be
-- removable, and the worst case is a seller re-signing for free.
--
-- WHAT IT MUST NEVER CONTAIN: an order that cannot fill. A listing that
-- reverts at buy time costs a stranger gas and looks like theft, so
-- market.mjs verifies signature, ownership, approval, seal state, commitment,
-- epoch and currency against live chain state BEFORE inserting, and re-checks
-- lazily on every read. `status` is the whole lifecycle:
--
--   open       verified, and believed fillable
--   filled     an OrderFilled event was observed for this hash
--   cancelled  an OrderCancelled event, or the seller's epoch moved past it
--   delisted   the seller removed it from the index (NOT a chain cancellation)
--   expired    the deadline passed
--   stale      the chain no longer agrees: sold elsewhere, approval revoked,
--              box opened after signing
--
-- THE TRAP THIS SCHEMA CANNOT FIX: removing a row is not a cancellation.
-- Anyone who kept the signature can still fill the order while the approval is
-- live. `closed_reason` exists so the API can say that out loud instead of
-- implying a delist was a revocation.

CREATE TABLE market_orders (
    -- EIP-712 digest of the Order under the market's domain. The contract keys
    -- `orderConsumed` by exactly this value, so it is the natural primary key
    -- and it is also the id the game UI uses for a listing.
    order_hash     TEXT PRIMARY KEY CHECK (order_hash ~ '^0x[0-9a-f]{64}$'),

    -- Which deployment this order is bound to. An order signed for one chain
    -- or one market address is meaningless against another, and mixing them in
    -- one table is how a testnet signature ends up served to mainnet players.
    chain_id       BIGINT NOT NULL,
    market         TEXT NOT NULL CHECK (market ~ '^0x[0-9a-f]{40}$'),
    collection     TEXT NOT NULL CHECK (collection ~ '^0x[0-9a-f]{40}$'),

    -- --- the signed Order, field for field ---------------------------------
    -- Column order and names follow StockmonstersMarket.Order deliberately;
    -- the contract is the authority and a rename here would be a divergence
    -- waiting to happen.
    seller         TEXT NOT NULL CHECK (seller ~ '^0x[0-9a-f]{40}$'),
    token_id       NUMERIC(78,0) NOT NULL,
    -- NUMERIC(78,0) is a full uint256. BIGINT overflows at ~9.2 ETH in wei,
    -- which is squarely inside the range a listing can be priced at.
    price          NUMERIC(78,0) NOT NULL CHECK (price > 0),
    min_proceeds   NUMERIC(78,0) NOT NULL CHECK (min_proceeds >= 0),
    deadline       BIGINT NOT NULL,
    epoch          BIGINT NOT NULL,
    salt           NUMERIC(78,0) NOT NULL,
    require_sealed BOOLEAN NOT NULL,
    attr_commit    TEXT NOT NULL CHECK (attr_commit ~ '^0x[0-9a-f]{64}$'),
    -- address(0) means anyone may fill it; otherwise a private sale.
    taker          TEXT NOT NULL CHECK (taker ~ '^0x[0-9a-f]{40}$'),
    -- address(0) means native ETH. Signed, so a buyer cannot substitute one.
    currency       TEXT NOT NULL CHECK (currency ~ '^0x[0-9a-f]{40}$'),
    -- 65 bytes: r, s, v. The contract rejects anything else.
    signature      TEXT NOT NULL CHECK (signature ~ '^0x[0-9a-f]{130}$'),

    -- --- who posted it ------------------------------------------------------
    -- The auth.mjs identity, so `POST /market/cancel` can prove the caller is
    -- the seller without a second signature. No FK to players: an order is
    -- valid on chain whether or not this server has ever seen the wallet play,
    -- and a foreign key would turn "index a valid order" into "create a player
    -- row" as a side effect.
    wallet_id      TEXT,

    -- --- lifecycle ----------------------------------------------------------
    status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','filled','cancelled','delisted','expired','stale')),
    -- Free text, shown to the seller. "delisted" alone would let a player
    -- believe their signature is dead when it is not.
    closed_reason  TEXT,

    -- --- what the chain later told us ---------------------------------------
    buyer          TEXT CHECK (buyer IS NULL OR buyer ~ '^0x[0-9a-f]{40}$'),
    fill_tx        TEXT,
    fill_block     NUMERIC(78,0),

    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- When the row was last re-verified against the chain. The read path uses
    -- this to avoid asking an RPC about every row on every page view while
    -- still never serving a listing it has not checked recently.
    checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at      TIMESTAMPTZ
);

-- The browse query: open orders on this deployment, newest first.
CREATE INDEX market_orders_open_idx
    ON market_orders (market, created_at DESC) WHERE status = 'open';
-- "my listings", and the cancel lookup.
CREATE INDEX market_orders_seller_idx ON market_orders (seller, created_at DESC);
-- Superseding a relisted token, and joining a listing to the box that holds
-- its display metadata.
CREATE INDEX market_orders_token_idx ON market_orders (collection, token_id);
-- The lazy revalidation sweep picks the least recently checked rows.
CREATE INDEX market_orders_stale_idx
    ON market_orders (checked_at) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- Where the event indexer got to.
-- ---------------------------------------------------------------------------
-- A filled order left showing as open is the worst bug this system can have —
-- every buyer after it pays gas to revert — so the fill/cancel indexer runs on
-- a timer rather than only on demand, and remembers its position here. One row
-- per (chain, market): a redeployment gets its own cursor instead of
-- inheriting a block height that means nothing to it.
CREATE TABLE market_sync (
    chain_id   BIGINT NOT NULL,
    market     TEXT NOT NULL CHECK (market ~ '^0x[0-9a-f]{40}$'),
    -- The last block whose logs have been applied. Re-scanned with a small
    -- overlap on the next pass: duplicate events are idempotent here, a
    -- skipped one is not.
    last_block NUMERIC(78,0) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, market)
);
