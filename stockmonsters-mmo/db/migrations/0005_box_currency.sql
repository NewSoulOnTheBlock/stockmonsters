-- A box can be bought with ETH or with the game token.
--
-- NULL means native ETH, which is what every box issued before this migration
-- was paid for — hence a nullable column rather than a default of the token
-- address, which would rewrite history.
--
-- `fee_wei` keeps its name and holds the price in the smallest unit of
-- whichever currency this is: wei for ETH, base units for the token. Renaming
-- it would break every row and every query for a cosmetic gain.

ALTER TABLE boxes
    ADD COLUMN IF NOT EXISTS currency TEXT
    CHECK (currency IS NULL OR currency ~ '^0x[0-9a-fA-F]{40}$');

COMMENT ON COLUMN boxes.currency IS
    'ERC-20 the box was priced in; NULL = native ETH. fee_wei is in that asset''s smallest unit.';
