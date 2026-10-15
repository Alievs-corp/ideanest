-- IDN-EXT-01 cleanup (#470): the contract half of #45 (V106, PR #469).
--
-- 1. Pledges still in the stored-card states CONFIRMED, CHARGE_PENDING,
--    CHARGE_FAILED or DROPPED were never charged. Owner's decision: they end as
--    EXPIRED and every reward place they hold goes back. No money moves.
-- 2. Those four names leave pledges_state_known, the one-pledge-per-backer index
--    and saved backer segments.
-- 3. The columns #45 stopped reading and writing are dropped. The release before
--    this one (#469 onwards) maps none of them, so a node still on it is unaffected.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE projects ADD COLUMN late_pledge_enabled boolean NOT NULL DEFAULT false,
--                        ADD COLUMN late_pledge_ends_at timestamptz,
--                        ADD CONSTRAINT projects_late_pledge_window_needs_the_feature
--                            CHECK (late_pledge_ends_at IS NULL OR late_pledge_enabled);
--   ALTER TABLE pledges ADD COLUMN payment_method_id uuid,
--                       ADD COLUMN is_late_pledge boolean NOT NULL DEFAULT false,
--                       and V42's three columns, two checks and index;
--   restore V17's pledges_state_known and pledges_project_backer_active_key and
--   V31's backer_segments_states_known. Deploy the previous release first: this
--   release's PledgeState has none of the four names.
--
--   The conversion is not undone. The converted pledges are the EXPIRED rows whose
--   canceled_at equals this migration's run time, and the places released were
--   one per reward tier plus their add-on and supplement quantities.
-- ---------------------------------------------------------------------------

LOCK TABLE reward_tiers, pledges, backer_segments IN ACCESS EXCLUSIVE MODE;

CREATE TEMPORARY TABLE v107_retired_pledges ON COMMIT DROP AS
SELECT id
  FROM pledges
 WHERE state IN ('CONFIRMED', 'CHARGE_PENDING', 'CHARGE_FAILED', 'DROPPED');

-- ---------------------------------------------------------------------------
-- THE RETIRED COLUMNS
-- ---------------------------------------------------------------------------
--
-- First, because V42's pledges_collection_schedule_is_whole would refuse a
-- CHARGE_PENDING pledge moving to EXPIRED with its schedule still set.

DROP INDEX pledges_due_for_charge_idx;

ALTER TABLE pledges
    DROP CONSTRAINT pledges_collection_schedule_is_whole,
    DROP CONSTRAINT pledges_charge_window_follows_the_queue,
    DROP COLUMN charge_attempts,
    DROP COLUMN next_charge_attempt_at,
    DROP COLUMN charge_window_ends_at,
    DROP COLUMN is_late_pledge,
    DROP COLUMN payment_method_id;

ALTER TABLE projects
    DROP CONSTRAINT projects_late_pledge_window_needs_the_feature,
    DROP COLUMN late_pledge_enabled,
    DROP COLUMN late_pledge_ends_at;

-- ---------------------------------------------------------------------------
-- THE PLACES
-- ---------------------------------------------------------------------------
--
-- All four states hold claimed places: the reward tier, the add-on lines, and any
-- post-campaign supplement add-ons (an upgrade already moved the pledge's own tier).
-- GREATEST keeps a counter that drifted from refusing the migration.

WITH held (reward_tier_id, places) AS (
    SELECT p.reward_tier_id, 1
      FROM pledges p
      JOIN v107_retired_pledges r ON r.id = p.id
     WHERE p.reward_tier_id IS NOT NULL
    UNION ALL
    SELECT a.reward_tier_id, a.quantity
      FROM pledge_addons a
      JOIN v107_retired_pledges r ON r.id = a.pledge_id
    UNION ALL
    SELECT sa.reward_tier_id, sa.quantity
      FROM supplement_addons sa
      JOIN pledge_supplements s ON s.id = sa.supplement_id
      JOIN v107_retired_pledges r ON r.id = s.pledge_id
),
per_tier AS (
    SELECT reward_tier_id, sum(places)::int AS places
      FROM held
     GROUP BY reward_tier_id
)
UPDATE reward_tiers t
   SET claimed_quantity = GREATEST(t.claimed_quantity - per_tier.places, 0)
  FROM per_tier
 WHERE t.id = per_tier.reward_tier_id;

-- A supplement is owed money for a pledge that no longer exists. None was ever
-- collected (collected_at is null on every row the platform holds).
DELETE FROM pledge_supplements s
 USING v107_retired_pledges r
 WHERE s.pledge_id = r.id
   AND s.collected_at IS NULL;

-- ---------------------------------------------------------------------------
-- THE PLEDGES
-- ---------------------------------------------------------------------------

UPDATE pledges p
   SET state = 'EXPIRED',
       canceled_at = COALESCE(p.canceled_at, now())
  FROM v107_retired_pledges r
 WHERE p.id = r.id;

ALTER TABLE pledges DROP CONSTRAINT pledges_state_known;

ALTER TABLE pledges ADD CONSTRAINT pledges_state_known CHECK (
    state IN (
        'DRAFT',
        'EXPIRED',
        'CANCELED_BY_BACKER',
        'CANCELED_BY_PROJECT',
        'COLLECTED',
        'REFUNDED',
        'CHARGEBACK',
        'FULFILLED'
    )
);

DROP INDEX pledges_project_backer_active_key;

CREATE UNIQUE INDEX pledges_project_backer_active_key ON pledges (project_id, backer_id)
    WHERE state IN ('DRAFT', 'COLLECTED', 'FULFILLED');

-- ---------------------------------------------------------------------------
-- SAVED BACKER SEGMENTS
-- ---------------------------------------------------------------------------
--
-- A segment filtered to the three committed-but-uncharged states meant "backers
-- who committed"; today that is COLLECTED. DROPPED was never a report state.

UPDATE backer_segments
   SET states = ARRAY(
           SELECT DISTINCT CASE
                      WHEN s IN ('CONFIRMED', 'CHARGE_PENDING', 'CHARGE_FAILED') THEN 'COLLECTED'
                      ELSE s
                  END
             FROM unnest(states) AS s
            ORDER BY 1
       )
 WHERE states && ARRAY['CONFIRMED', 'CHARGE_PENDING', 'CHARGE_FAILED']::text[];

ALTER TABLE backer_segments DROP CONSTRAINT backer_segments_states_known;

ALTER TABLE backer_segments ADD CONSTRAINT backer_segments_states_known CHECK (
    states IS NULL OR (
        cardinality(states) BETWEEN 1 AND 2
        AND states <@ ARRAY['COLLECTED', 'FULFILLED']::text[]
    )
);

-- pledges_backer_report_idx keeps its five-state predicate: it covers more than the
-- report now asks for, which PostgreSQL still uses, and rebuilding it changes no plan.
