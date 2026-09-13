-- IDN-EXT-01 (#32): the campaign states for the seven days after the first
-- deadline, a one-time extension, and a withdrawal that closes the campaign.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   UPDATE nothing -- there is nothing to rewrite, because no code in this
--   release moves a campaign into any of the three states. Check first:
--     SELECT count(*) FROM projects
--      WHERE state IN ('CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN');
--   If that is zero:
--     ALTER TABLE projects DROP CONSTRAINT projects_extension_after_deadline;
--     ALTER TABLE projects DROP CONSTRAINT projects_extension_recorded_together;
--     ALTER TABLE projects DROP COLUMN extension_used_at;
--     ALTER TABLE projects DROP COLUMN extended_until;
--     and restore V6's projects_public_states_are_fully_specified and
--     project_state_transitions_states_known, with their original lists;
--     ALTER TABLE projects DROP CONSTRAINT projects_state_known;
--     ALTER TABLE projects ADD CONSTRAINT projects_state_known CHECK (state IN
--       ('DRAFT', 'PRELAUNCH', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED',
--        'APPROVED', 'SCHEDULED', 'LIVE', 'SUSPENDED', 'CANCELED', 'SUCCESSFUL',
--        'UNSUCCESSFUL', 'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED'));
--   and recreate the six partial indexes below with V12's, V13's and V16's
--   nine-state predicate.
--   If it is not zero, reversing would refuse those rows; they are campaigns
--   in the middle of the new rules and have to be decided first.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- EXPAND ONLY
-- ---------------------------------------------------------------------------
--
-- CLAUDE.md forbids expanding and contracting in one release, and this is the
-- expand half. COLLECTING and LATE_PLEDGE stay in the check: collection at
-- close is still how money moves until stage 2 (#39), and removing the states
-- a running release writes would refuse its own updates. Stage 4 (#45) takes
-- them out, one release after nothing writes them.
--
-- Safe under rolling deployment in the other direction too: a node still on
-- the previous release never meets these states, because nothing moves a
-- campaign into them before #33, #34 and #41 -- each of which ships after this.
-- ---------------------------------------------------------------------------

ALTER TABLE projects DROP CONSTRAINT projects_state_known;

-- The vocabulary lives in a CHECK rather than a native enum, for V6's reason:
-- adding a value to an enum type cannot run in the same transaction as a
-- statement using it. A nineteenth state is still a deliberate decision here.
ALTER TABLE projects ADD CONSTRAINT projects_state_known CHECK (
    state IN (
        'DRAFT',
        'PRELAUNCH',
        'SUBMITTED',
        'CHANGES_REQUESTED',
        'REJECTED',
        'APPROVED',
        'SCHEDULED',
        'LIVE',
        'CLOSING_WINDOW',     -- IDN-EXT-01: D..D+7, still taking pledges
        'EXTENDED',           -- IDN-EXT-01: extended once, still taking pledges
        'SUSPENDED',
        'CANCELED',
        'SUCCESSFUL',
        'UNSUCCESSFUL',
        'WITHDRAWN',          -- IDN-EXT-01: the creator withdrew; closed
        'COLLECTING',         -- until stage 4 (#45)
        'LATE_PLEDGE',        -- until stage 4 (#45)
        'FULFILLING',
        'COMPLETED'
    )
);

-- ---------------------------------------------------------------------------
-- THE TWO OTHER PLACES V6 WROTE THE STATES DOWN
-- ---------------------------------------------------------------------------
--
-- projects_state_known is not the only list. V6 repeats the vocabulary in two
-- more constraints, "rather than shared through a domain type", and a state
-- added to one and not the others is refused at whichever one it meets first.
-- The first draft of this migration widened only the first: a campaign could
-- have been moved into CLOSING_WINDOW and the history row recording the move
-- would have been refused -- which the next pull request (#33) found, as every
-- finalisation failing inside a sweep that swallows the error per campaign.

-- A public campaign must have what decides it. The three new states are past
-- LIVE and are decided on exactly those four columns.
ALTER TABLE projects DROP CONSTRAINT projects_public_states_are_fully_specified;
ALTER TABLE projects ADD CONSTRAINT projects_public_states_are_fully_specified CHECK (
    state NOT IN (
        'LIVE', 'SUSPENDED', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    )
    OR (
        goal_amount IS NOT NULL
        AND duration_days IS NOT NULL
        AND launched_at IS NOT NULL
        AND deadline IS NOT NULL
    )
);

-- The history of a campaign names the same nineteen states as the campaign.
ALTER TABLE project_state_transitions DROP CONSTRAINT project_state_transitions_states_known;
ALTER TABLE project_state_transitions ADD CONSTRAINT project_state_transitions_states_known CHECK (
    to_state IN (
        'DRAFT', 'PRELAUNCH', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED',
        'APPROVED', 'SCHEDULED', 'LIVE', 'SUSPENDED', 'CANCELED',
        'SUCCESSFUL', 'UNSUCCESSFUL', 'COLLECTING', 'LATE_PLEDGE',
        'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    )
    AND (
        from_state IS NULL
        OR from_state IN (
            'DRAFT', 'PRELAUNCH', 'SUBMITTED', 'CHANGES_REQUESTED', 'REJECTED',
            'APPROVED', 'SCHEDULED', 'LIVE', 'SUSPENDED', 'CANCELED',
            'SUCCESSFUL', 'UNSUCCESSFUL', 'COLLECTING', 'LATE_PLEDGE',
            'FULFILLING', 'COMPLETED',
            'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
        )
    )
);

-- ---------------------------------------------------------------------------
-- THE EXTENSION
-- ---------------------------------------------------------------------------
--
-- Two columns rather than moving `deadline`. `deadline` stays the FIRST
-- deadline, because §5.1 measures two things from it that an extension must
-- not move: the seven-day window, and the D+60 limit on how far an extension
-- may reach. Overwriting it would lose the one instant both rules are about.

-- Where the extension ends. Null until the creator extends.
ALTER TABLE projects ADD COLUMN extended_until timestamptz;

-- When the creator extended. Separate from `extended_until` so that "once" is a
-- fact on the row rather than an inference from a date that could in principle
-- be written twice; #34 refuses a second extension on this column.
ALTER TABLE projects ADD COLUMN extension_used_at timestamptz;

-- Both or neither: an end with no record of when it was chosen, or a use with
-- no end, is a row two readers would interpret differently.
ALTER TABLE projects ADD CONSTRAINT projects_extension_recorded_together CHECK (
    (extended_until IS NULL) = (extension_used_at IS NULL)
);

-- An extension moves the end later, never earlier. The D+60 bound is not a
-- CHECK: it is sixty days of calendar arithmetic that belongs beside the rule
-- in #34, and a constraint here would be a second, silent copy of the number.
ALTER TABLE projects ADD CONSTRAINT projects_extension_after_deadline CHECK (
    extended_until IS NULL OR deadline IS NULL OR extended_until > deadline
);

COMMENT ON COLUMN projects.extended_until IS
    'IDN-EXT-01: where the one extension ends. deadline stays the first deadline.';
COMMENT ON COLUMN projects.extension_used_at IS
    'IDN-EXT-01: when the creator extended. Set once; a second extension is refused.';

-- ---------------------------------------------------------------------------
-- DISCOVERY'S PARTIAL INDEXES
-- ---------------------------------------------------------------------------
--
-- V12, V13 and V16 index only the public states, and the three new states are
-- public: two still take pledges, and a withdrawn campaign is a successful
-- one. Left at nine states, every discovery or search query that includes them
-- would stop matching the index predicate and fall back to a scan -- correct
-- results, on a plan nobody chose. Recreated with the same columns and the
-- widened predicate.

DROP INDEX projects_discovery_newest_idx;
CREATE INDEX projects_discovery_newest_idx
    ON projects (launched_at DESC NULLS LAST, id ASC)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    );

DROP INDEX projects_discovery_ending_soon_idx;
CREATE INDEX projects_discovery_ending_soon_idx
    ON projects (deadline ASC NULLS LAST, id ASC)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    );

DROP INDEX projects_discovery_most_funded_idx;
CREATE INDEX projects_discovery_most_funded_idx
    ON projects (pledged_amount DESC, id ASC)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    );

DROP INDEX projects_search_vector_idx;
CREATE INDEX projects_search_vector_idx
    ON projects USING GIN (search_vector)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    );

DROP INDEX projects_search_title_trgm_idx;
CREATE INDEX projects_search_title_trgm_idx
    ON projects USING GIN (ideanest_fold(title) gin_trgm_ops)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    );

DROP INDEX projects_discovery_location_idx;
CREATE INDEX projects_discovery_location_idx
    ON projects (location_id)
    WHERE state IN (
        'PRELAUNCH', 'LIVE', 'CANCELED', 'SUCCESSFUL', 'UNSUCCESSFUL',
        'COLLECTING', 'LATE_PLEDGE', 'FULFILLING', 'COMPLETED',
        'CLOSING_WINDOW', 'EXTENDED', 'WITHDRAWN'
    );
