-- A feature flag carries the version it was last saved at.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE feature_flags DROP COLUMN version;
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One column with a default, which the previous release does
-- not map and never writes: its saves leave the value where it is, which is
-- the same as a save that changed nothing about concurrency.
-- ---------------------------------------------------------------------------
--
-- The console saved a flag by sending its whole row, read from a list that may
-- have been loaded minutes earlier. Two people editing one flag therefore lost
-- each other's change without either being told: the second save put back the
-- first one's percentage, or its account list, as it had been before. A save
-- now names the version it was made from, and one made from an older version
-- is refused rather than applied.

ALTER TABLE feature_flags
    ADD COLUMN version bigint NOT NULL DEFAULT 0;
