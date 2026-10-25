-- A reward tier created on a launched campaign waits for a moderator (#569).
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DELETE FROM reward_tiers WHERE NOT approved;
--   ALTER TABLE reward_tiers DROP COLUMN IF EXISTS approved;
--
--   Safe under a rolling deployment in the forward direction: the column has a
--   default, so an instance of the previous release inserts approved tiers as it
--   always did and never maps the column. While both releases serve, an instance
--   of the previous release would show a tier the new one has just created on a
--   launched campaign, because it does not know to filter; the window is the
--   rollout and nothing else creates unapproved rows. A reverse must delete the
--   unapproved rows first, for the same reason: without the column every reader
--   would show them.
-- ---------------------------------------------------------------------------
--
-- Until now a tier created, duplicated or edited on a live campaign was public
-- the moment it was saved. Every change to a launched campaign's tiers now waits
-- in the campaign's open revision (V117) instead, and a created tier is a real
-- row from the start, so that its composition, shipping rates, picture and the
-- rest keep the constraints they have on any other tier. What keeps it from the
-- public until a moderator approves it is this flag.
--
-- Every tier that exists today is one the public may see, so the default is
-- true and the backfill is the default. Only a tier created after launch is
-- inserted false; approval sets it, and rejecting or discarding the revision
-- deletes the row.

ALTER TABLE reward_tiers
    ADD COLUMN approved boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN reward_tiers.approved IS
    'False for a tier created on a launched campaign until a moderator approves its revision. '
    'The public catalogue, checkout, pledges and stock read only approved tiers. See V118.';
