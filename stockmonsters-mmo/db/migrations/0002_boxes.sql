-- Purchasable sealed loot boxes.
--
-- THIS IS THE MOST PRECIOUS TABLE IN THE SCHEMA.
--
-- `boxes.salt` is the only copy of the 256 bits that stand between an
-- attribute commitment and an offline brute force, and — more importantly —
-- the only way an NFT can ever be opened. `StockmonstersNFT.open()` requires
-- the exact (dexId, level, ivs, natureId, shiny, caughtAt, salt) tuple that
-- hashes to the commitment stored on chain. There is no recovery path. Lose a
-- row and the token it belongs to is permanently sealed: not "recoverable with
-- effort", not "restorable by the contract owner" — gone.
--
-- Two consequences are enforced here rather than left to good intentions:
--   1. DELETE is refused by a trigger. Lifecycle changes are status updates.
--   2. The FK to players is ON DELETE RESTRICT, so deleting a player cannot
--      cascade through and take their salts with it.
-- The escape hatch, if a row genuinely must go, is deliberate and auditable:
--   ALTER TABLE boxes DISABLE TRIGGER boxes_no_delete;   -- then re-enable
--
-- Back this table up separately from everything else, and note that a
-- SERVER_SECRET rotation orphans wallet_id here exactly as it does in players
-- — but wallet_address is stored alongside, so the boxes can still be matched
-- to a human afterwards. That redundancy is on purpose.

-- ---------------------------------------------------------------------------
-- Provably-fair randomness: the commit half.
-- ---------------------------------------------------------------------------
-- A server seed is generated and its SHA-256 published BEFORE the player picks
-- a client seed. The roll is a pure function of both, so a server that has
-- already committed cannot grind the pair for a worse outcome. The seed itself
-- is secret until the box is revealed, because the roll is deterministic from
-- it — publishing the seed early would publish the contents.
CREATE TABLE box_seed_commits (
    commit_id        TEXT PRIMARY KEY,
    -- 0x + 64 hex. SECRET until the matching box is revealed.
    server_seed      TEXT NOT NULL CHECK (server_seed ~ '^0x[0-9a-f]{64}$'),
    -- SHA-256 of the seed BYTES (not of the hex string). Handed out publicly.
    server_seed_hash TEXT NOT NULL CHECK (server_seed_hash ~ '^0x[0-9a-f]{64}$'),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A commitment is single-use: two boxes sharing a seed would let the reveal
    -- of the first spoil the second.
    consumed_at      TIMESTAMPTZ,
    consumed_by      TEXT
);

-- Unconsumed commitments are the ones a quote might still be holding; sweep
-- old ones with a job if this ever grows, never with a DELETE on `boxes`.
CREATE INDEX box_seed_commits_unconsumed_idx
    ON box_seed_commits (created_at) WHERE consumed_at IS NULL;

-- ---------------------------------------------------------------------------
-- The boxes themselves.
-- ---------------------------------------------------------------------------
CREATE TABLE boxes (
    -- The voucher nonce. `StockmonstersNFT.voucherUsed[uid]` makes it
    -- single-mint on chain, so it is the natural primary key here too.
    uid              TEXT PRIMARY KEY CHECK (uid ~ '^0x[0-9a-f]{64}$'),

    -- Who owns it. wallet_id is the auth.mjs identity (unforgeable without
    -- SERVER_SECRET); wallet_address is what the voucher is signed against and
    -- what the chain will see as msg.sender.
    wallet_id        TEXT NOT NULL REFERENCES players (wallet_id) ON DELETE RESTRICT,
    wallet_address   TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),

    tier             TEXT NOT NULL CHECK (tier IN ('standard', 'prime', 'apex')),
    -- Which rarity band the roll landed in. Denormalised from dex_id on
    -- purpose: the band cutoffs in lootbox.mjs may be retuned later and this
    -- must stay a record of what the player was actually sold.
    band             TEXT NOT NULL,

    -- issued   voucher signed, nothing on chain yet
    -- minted   a Minted event with this uid was observed
    -- revealed the reveal payload has been handed to the owner
    -- opened   open() succeeded on chain
    -- expired  the deadline passed with no mint
    -- voided   an operator retired it (never delete — say why in a note)
    status           TEXT NOT NULL DEFAULT 'issued'
                     CHECK (status IN ('issued','minted','revealed','opened','expired','voided')),

    -- --- the roll: exactly the arguments StockmonstersNFT.open() wants ------
    dex_id           INTEGER  NOT NULL CHECK (dex_id BETWEEN 1 AND 65535),
    level            SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 255),
    -- hp, atk, dfe, spd, ats, dfs — the order voucher-lib.mjs hashes them in.
    ivs              SMALLINT[] NOT NULL
                     CHECK (array_length(ivs, 1) = 6
                            AND 0 <= ALL (ivs) AND 31 >= ALL (ivs)),
    nature_id        SMALLINT NOT NULL CHECK (nature_id BETWEEN 0 AND 24),
    shiny            BOOLEAN  NOT NULL,
    caught_at        BIGINT   NOT NULL,

    -- !! THE SALT. 256 bits of CSPRNG from voucher-lib.randomSalt(). !!
    -- Without this exact value the token can never be opened, by anyone.
    salt             TEXT NOT NULL CHECK (salt ~ '^0x[0-9a-f]{64}$'),
    -- keccak256(abi.encode(dexId, level, keccak(ivs), natureId, shiny,
    --                      caughtAt, salt)) — what goes on chain at mint.
    attr_commit      TEXT NOT NULL CHECK (attr_commit ~ '^0x[0-9a-f]{64}$'),

    -- --- the voucher --------------------------------------------------------
    -- NUMERIC(78,0) holds a full uint256; BIGINT would silently overflow at
    -- ~9.2 ETH expressed in wei... which is exactly the range box prices live in.
    fee_wei          NUMERIC(78,0) NOT NULL CHECK (fee_wei >= 0),
    deadline         BIGINT NOT NULL,
    signature        TEXT NOT NULL CHECK (signature ~ '^0x[0-9a-f]+$'),
    -- Stored so a signer rotation is diagnosable after the fact: a voucher
    -- that stops verifying can be traced to the key that made it.
    signer           TEXT NOT NULL CHECK (signer ~ '^0x[0-9a-f]{40}$'),
    chain_id         BIGINT NOT NULL,
    contract         TEXT NOT NULL CHECK (contract ~ '^0x[0-9a-f]{40}$'),

    -- --- the fairness proof -------------------------------------------------
    commit_id        TEXT REFERENCES box_seed_commits (commit_id) ON DELETE RESTRICT,
    client_seed      TEXT NOT NULL DEFAULT '',
    server_seed_hash TEXT,
    roll_algorithm   TEXT NOT NULL,

    -- --- what the chain later told us ---------------------------------------
    token_id         NUMERIC(78,0),
    mint_tx          TEXT,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    revealed_at      TIMESTAMPTZ,
    opened_at        TIMESTAMPTZ
);

-- "my boxes", newest first — the only query the shop makes.
CREATE INDEX boxes_wallet_idx ON boxes (wallet_id, created_at DESC);
-- Reveal-by-tokenId, and the mint-sync join.
CREATE UNIQUE INDEX boxes_token_idx ON boxes (contract, token_id) WHERE token_id IS NOT NULL;
-- Support: "which boxes did this address buy?" without needing SERVER_SECRET.
CREATE INDEX boxes_address_idx ON boxes (wallet_address);
-- The rate limiter counts recent rows per wallet.
CREATE INDEX boxes_recent_idx ON boxes (wallet_id, created_at);

-- ---------------------------------------------------------------------------
-- The no-delete guard.
-- ---------------------------------------------------------------------------
-- Not paranoia: the failure mode is silent and permanent. A `DELETE FROM boxes
-- WHERE status = 'expired'` written to tidy up would brick every token whose
-- owner had not got round to minting the voucher yet, and nothing would notice
-- until a player pressed OPEN months later.
CREATE FUNCTION boxes_refuse_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'boxes rows are never deleted: % holds the only salt that can open its token. Set status instead.',
        OLD.uid
        USING HINT = 'If you really must, ALTER TABLE boxes DISABLE TRIGGER boxes_no_delete.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER boxes_no_delete
    BEFORE DELETE ON boxes
    FOR EACH ROW EXECUTE FUNCTION boxes_refuse_delete();

-- A consumed seed is half of a box's audit trail, so it gets the same guard.
CREATE FUNCTION box_seed_commits_refuse_delete() RETURNS trigger AS $$
BEGIN
    IF OLD.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'commitment % has been used by a box; deleting it destroys the fairness proof', OLD.commit_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER box_seed_commits_no_delete
    BEFORE DELETE ON box_seed_commits
    FOR EACH ROW EXECUTE FUNCTION box_seed_commits_refuse_delete();
