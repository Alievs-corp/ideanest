-- #324: one person blocking another, which App Store Review Guideline 1.2 requires
-- of an app with user-generated content alongside reporting.
--
-- ---------------------------------------------------------------------------
-- WHAT A BLOCK DOES, AND WHAT IT DELIBERATELY DOES NOT
-- ---------------------------------------------------------------------------
--
-- A block is about conversation. The blocker stops seeing the blocked account's
-- comments and replies, and the blocked account can no longer reply to the
-- blocker's comments. `CommentService` is where both are carried out.
--
-- It does NOT hide the blocked account's campaigns from discovery, and it does
-- not hide the updates a blocked creator publishes on their own campaign. A
-- campaign is a public commercial listing with backers' money behind it, and a
-- block that distorted what somebody sees about a campaign they may already
-- have pledged to would be the platform withholding facts about their money.
-- Reporting remains the path for an abusive campaign. `BlockService` carries
-- the argument in full.
--
-- ---------------------------------------------------------------------------
-- PRIVATE, AND THEREFORE NO EVENT
-- ---------------------------------------------------------------------------
--
-- The blocked account is never told. Nothing reads this table to notify
-- anybody, and nothing about it is served to anybody but the blocker: a block
-- that announced itself would invite exactly the retaliation it exists to stop.
--
-- ---------------------------------------------------------------------------
-- UNBLOCKING IS A DELETE, AS UNFOLLOWING IS
-- ---------------------------------------------------------------------------
--
-- V32's argument for `follows`, unchanged: a `deleted_at` here would be a
-- retained history of who somebody once wanted nothing to do with, filtered out
-- of every read forever. The history that matters -- who blocked whom, and
-- when they changed their mind -- is in `audit_logs` (`account.blocked`,
-- `account.unblocked`), which is append-only and read only by staff.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS user_blocks;
--   -- Reversing discards every block. Nothing references the table, so the way
--   -- back from a bad release is the previous build plus this line. What it
--   -- costs: every blocked account's comments reappear for the people who
--   -- blocked them, and the rows cannot be rebuilt -- a block is a decision
--   -- somebody made, not a fact derived from anything else in the schema. The
--   -- audit trail still says who had blocked whom.
-- ---------------------------------------------------------------------------

CREATE TABLE user_blocks (
    id          uuid        PRIMARY KEY,
    -- Who decided. No ON DELETE, for `follows.follower_id`'s reason: §17.4
    -- closes an account by anonymising it in place, so the reference stays
    -- valid and points at a row that is no longer anybody.
    blocker_id  uuid        NOT NULL REFERENCES users (id),
    -- Who is no longer heard from. No ON DELETE, for the same reason.
    blocked_id  uuid        NOT NULL REFERENCES users (id),
    created_at  timestamptz NOT NULL DEFAULT now(),

    -- Nobody blocks themselves. The service refuses it with a sentence first;
    -- this is the rule stated where a support script cannot write around it.
    CONSTRAINT user_blocks_is_not_self CHECK (blocker_id <> blocked_id),

    -- Idempotency lives here, for V32's reason: two taps on a slow connection
    -- both read "not blocked" and both insert, so the service inserts with
    -- ON CONFLICT DO NOTHING and lets this constraint decide.
    --
    -- Ordered (blocker_id, blocked_id) because both reads the comment paths make
    -- are "has this account blocked that one" -- the reader filtering a page, and
    -- a reply's parent author being asked about the replier -- and an exact
    -- lookup on this pair is what the index serves.
    CONSTRAINT user_blocks_one_per_pair UNIQUE (blocker_id, blocked_id)
);

-- "Who have I blocked", newest first -- GET /v1/me/blocks, keyset paged on
-- (created_at, id) exactly as `follows_follower_idx` is.
CREATE INDEX user_blocks_blocker_idx ON user_blocks (blocker_id, created_at DESC, id DESC);

COMMENT ON TABLE user_blocks IS
    '#324: an account blocking another. Hides the blocked account''s comments from the blocker and refuses their replies to the blocker''s comments. Private: never served to the blocked account. One row per pair; unblocking deletes it. Never self-directed.';
COMMENT ON COLUMN user_blocks.blocker_id IS
    'Who decided to block. The only account this row is ever shown to.';
COMMENT ON COLUMN user_blocks.blocked_id IS
    'Who is blocked. Never told, by design.';
