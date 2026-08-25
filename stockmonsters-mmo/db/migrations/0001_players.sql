-- Player identity and save data, keyed by the wallet id.
--
-- The wallet id is NOT the address. auth.mjs derives it as
--     "w:" + HMAC-SHA256(SERVER_SECRET, lowercase address)   (32 hex chars)
-- so the address never becomes a primary key a client can type, and the id
-- cannot be forged without the server secret. Rotating SERVER_SECRET orphans
-- every row here; see .env.example.

CREATE TABLE players (
    wallet_id      TEXT PRIMARY KEY
                   -- Reject anything that is not an auth.mjs id at the storage
                   -- layer too: a bug that lets a raw address through should
                   -- fail loudly, not quietly create a forgeable account.
                   CHECK (wallet_id ~ '^w:[0-9a-f]{32}$'),
    -- Kept for support/debugging and for on-chain work (mint queue -> owner).
    -- Nullable: a client may present a valid id without re-sending the address.
    wallet_address TEXT CHECK (wallet_address IS NULL OR wallet_address ~ '^0x[0-9a-f]{40}$'),
    -- NULL until the player chooses one. Uniqueness is enforced by the index
    -- below, not by a column constraint, because it must be case-insensitive
    -- and must not treat "no name yet" as a colliding value.
    name           TEXT CHECK (name IS NULL OR char_length(name) BETWEEN 3 AND 14),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Names are player-visible and must be unique. Enforced HERE rather than only
-- in application code: two Node processes (or two sockets racing inside one)
-- can both read "free" and both write. The partial index leaves unnamed
-- players out of the constraint entirely; lower() makes "Satoshi" and
-- "satoshi" the same claim, which is the point — impersonation is the risk.
CREATE UNIQUE INDEX players_name_lower_key ON players (lower(name)) WHERE name IS NOT NULL;

-- Support lookups go address -> player.
CREATE INDEX players_wallet_address_idx ON players (wallet_address);

-- The save blob. One row per player.
--
-- JSONB rather than columns because these shapes are still moving weekly:
-- CreatureInstance grew status/ivs this month, BAG is about to grow items, and
-- the character id array changes with every designer revision. Anything we
-- need to QUERY (leaderboards, "who owns this creature", mint queues) gets a
-- real column or its own table later; the blob is for state we only ever load
-- and store whole.
CREATE TABLE player_state (
    wallet_id  TEXT PRIMARY KEY REFERENCES players (wallet_id) ON DELETE CASCADE,
    -- Bumped when the blob's shape changes in a way that needs migrating.
    -- Read it before trusting the contents.
    version    INTEGER NOT NULL DEFAULT 1,
    -- { character: string[], party: CreatureInstance[], box: CreatureInstance[],
    --   bag: { balls: number, potions: number } }
    state      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
