-- Indexes for the platform figures on /admin/analytics and the console's front page.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP INDEX IF EXISTS pledges_collected_counted_idx;
--   DROP INDEX IF EXISTS project_state_transitions_decided_idx;
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Two indexes; nothing the previous release reads or writes
-- changes shape, and both releases are served correctly with or without them.
-- ---------------------------------------------------------------------------
--
-- The figures used to be summed from V27's rollups, which are built from
-- referral attributions and never forget a refunded pledge. They are now read
-- from `pledges` itself: collected in the window, still COLLECTED or FULFILLED,
-- keyed on `collected_at`. Without an index that is a pass over every checkout
-- ever started, on every visit to the front page by somebody in finance.
--
-- Campaign outcomes are now counted by the transition that decided them rather
-- than by the deadline, which IDN-EXT-01 put a closing window in front of. The
-- partial index holds only those two kinds of transition, so it is a handful of
-- rows per decided campaign.
--
-- Not CONCURRENTLY, although V31's note expected the next index on `pledges` to
-- need it. Flyway holds its migration lock in an open transaction on a second
-- connection, and CREATE INDEX CONCURRENTLY waits for every open transaction to
-- finish -- including that one -- so the migration waits on itself for ever (it
-- did, in the test suite). A plain CREATE INDEX takes a SHARE lock: reads carry
-- on and writes to `pledges` wait for the build. Both indexes are partial, over
-- the collected pledges and the decision rows only, so the build is a pass over
-- the table and a sort of a fraction of it -- seconds at this platform's size.

CREATE INDEX IF NOT EXISTS pledges_collected_counted_idx
    ON pledges (collected_at)
    WHERE state IN ('COLLECTED', 'FULFILLED');

CREATE INDEX IF NOT EXISTS project_state_transitions_decided_idx
    ON project_state_transitions (created_at)
    WHERE to_state IN ('SUCCESSFUL', 'UNSUCCESSFUL');
