-- Friends: a request one side sends and the OTHER side must accept.
--
-- Two tables rather than one row with a status column, because the two states
-- have different shapes. A request is directed and temporary (it has a sender
-- and a receiver, and it stops existing the moment it is answered); a
-- friendship is undirected and permanent until someone removes it. Folding
-- both into one table means every query has to remember which column is "me",
-- and a pair can end up with two rows that disagree.
--
-- Everything is keyed by wallet_id, the same identity chat, names and saves
-- use. A friendship therefore survives a reload, a new browser and a new
-- device, which is the entire point of asking someone to accept one.

-- A pending ask. Deleted when accepted, declined, or cancelled by the sender.
CREATE TABLE friend_requests (
    from_wallet TEXT NOT NULL REFERENCES players (wallet_id) ON DELETE CASCADE,
    to_wallet   TEXT NOT NULL REFERENCES players (wallet_id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (from_wallet, to_wallet),
    -- Befriending yourself would make areFriends() true for one player alone,
    -- which quietly turns every proximity rule into a no-op for them.
    CONSTRAINT friend_requests_not_self CHECK (from_wallet <> to_wallet)
);

-- "Who is asking to be MY friend" is the query the notification badge runs on
-- every login, and it is the one direction the primary key cannot serve.
CREATE INDEX friend_requests_to_idx ON friend_requests (to_wallet);

-- An accepted friendship. ONE row per pair, ever.
--
-- The canonical ordering (lo < hi) is what makes that true: without it,
-- (a,b) and (b,a) are two different primary keys and a double-accept — two
-- sockets, two clicks, one race — leaves a pair that is friends twice and
-- un-friends once. The CHECK makes an out-of-order insert an error rather
-- than a duplicate; every writer must sort the two ids first.
CREATE TABLE friendships (
    wallet_lo TEXT NOT NULL REFERENCES players (wallet_id) ON DELETE CASCADE,
    wallet_hi TEXT NOT NULL REFERENCES players (wallet_id) ON DELETE CASCADE,
    since     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (wallet_lo, wallet_hi),
    CONSTRAINT friendships_ordered CHECK (wallet_lo < wallet_hi)
);

-- Listing my friends reads both columns; the primary key only indexes one.
CREATE INDEX friendships_hi_idx ON friendships (wallet_hi);
