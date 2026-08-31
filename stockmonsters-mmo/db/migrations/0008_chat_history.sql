-- The global chat transcript, so somebody who logs in later can read the room.
--
-- Chat used to be broadcast-only: a line reached whoever happened to be
-- connected at that second and then stopped existing. A player who arrived
-- five minutes after a conversation saw an empty panel and a game that looked
-- dead. This table is the memory.
--
-- ONLY GLOBAL CHAT LANDS HERE. Direct messages (dm.ts) are private and are
-- never written down; system lines ("Easy — 5 messages every 15s") are
-- generated per-player on the client's own screen and belong to nobody. The
-- single writer is handleChat() in src/modules/main/chat.ts, through
-- chat-log.mjs.
--
-- THE NAME IS STORED AS IT WAS SAID, not joined from players.name at read
-- time. A player may rename once a day, and a freed name can be claimed by
-- somebody else — so resolving history through the CURRENT name would
-- eventually attribute an old line to a different human being. A transcript
-- that changes what it says happened is worse than no transcript.
--
-- THIS TABLE IS NOT PRECIOUS. Losing it costs a few hours of small talk.
-- Everything here degrades: if Postgres is unavailable, chat still works
-- live exactly as it did before this table existed (chat.ts keeps an
-- in-memory ring buffer and serves that).

CREATE TABLE chat_messages (
    -- Monotonic, and the retention trim leans on that: "keep the newest N"
    -- is `id > max(id) - N`, which needs no sort and no timestamp maths.
    id          BIGSERIAL PRIMARY KEY,
    -- Who said it, for moderation and support. DELIBERATELY NOT A FOREIGN KEY:
    -- a log must not refuse a row because a players row is missing (a name
    -- accepted while the database was down leaves exactly that gap), and the
    -- transcript should outlive an account being removed. The CHECK still
    -- rejects anything that is not an auth.mjs wallet id.
    wallet_id   TEXT CHECK (wallet_id IS NULL OR wallet_id ~ '^w:[0-9a-f]{32}$'),
    -- The display name AT THE TIME OF SPEAKING. See above.
    sender_name TEXT NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 32),
    -- Already validated and filtered by chat-filter.ts (CHAT_MAX = 140); the
    -- bound here is a storage-layer backstop, not the rule.
    body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    said_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read this table ever serves is "the newest few, most recent first",
-- and the only write besides INSERT is the retention trim. Both are covered by
-- the primary key's order — but the trim also has an age half, and a player
-- joining an idle world must not scan a week of rows to find nothing recent.
CREATE INDEX chat_messages_said_at_idx ON chat_messages (said_at DESC);
