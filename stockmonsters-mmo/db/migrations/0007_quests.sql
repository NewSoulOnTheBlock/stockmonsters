-- Which Stockmonster unlocked quests for which wallet, per epoch.
--
-- Quests are gated on OWNING an NFT, and the gate exists for one reason:
-- without it, quest rewards are farmable by opening accounts. An account
-- costs nothing; a Stockmonster costs a box. That only holds if one NFT
-- cannot unlock quests for more than one account per day — otherwise a single
-- token passed from wallet to wallet is a skeleton key for as many accounts
-- as its owner has patience for. The user named this attack explicitly.
--
-- So: the FIRST wallet to qualify with a given token in a given epoch owns
-- that token's quest slot for the whole epoch, decided by this table's
-- primary key. The insert either lands or conflicts; there is no
-- check-then-write to race. Ownership itself is verified against the CHAIN at
-- qualification time — this table only adds "and nobody else already used it
-- today".
--
-- Rows are only meaningful for the current epoch. Old rows are pruned
-- opportunistically; keeping a few days of history costs nothing and shows
-- who quested with what.
CREATE TABLE quest_locks (
    epoch      BIGINT  NOT NULL,
    -- The NFT's token id. NUMERIC because uint256, same as market_orders.
    token_id   NUMERIC(78, 0) NOT NULL,
    wallet_id  TEXT    NOT NULL,
    locked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (epoch, token_id)
);

-- "Which token is mine today" is asked on every quest-panel open.
CREATE INDEX quest_locks_wallet ON quest_locks (epoch, wallet_id);
