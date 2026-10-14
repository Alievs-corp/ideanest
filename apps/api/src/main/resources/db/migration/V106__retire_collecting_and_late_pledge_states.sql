-- IDN-EXT-01 stage 4 (#45): the campaign states of the stored-card model leave
-- `projects.state`. COLLECTING was the collection at close, retired when a pledge
-- became charged at the moment it is made (#39); LATE_PLEDGE was the window after
-- it, switched off by #36. Rule 1.6: withdrawal closes the campaign, with no late
-- pledges.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE projects DROP CONSTRAINT projects_state_known;
--   and restore V74's projects_state_known, which adds 'COLLECTING' and
--   'LATE_PLEDGE' back between 'WITHDRAWN' and 'FULFILLING'. Deploy the
--   previous release of the application first: this release's ProjectState has
--   neither name.
--
--   The conversion below is not undone by that, and need not be: FULFILLING was
--   the only edge out of either state, so a converted campaign is where it would
--   have gone next. The campaigns it moved are the ones with a transition row
--   whose note starts 'V106', should anybody need the list:
--     SELECT project_id, from_state FROM project_state_transitions
--      WHERE actor_role = 'SYSTEM' AND note LIKE 'V106%';
--   The scheduled_jobs rows deleted below are recreated by the previous
--   release's start-up, which registers its jobs.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: this is the contract half of V74's expand, for the two states only.
--
-- Safe under rolling deployment. While this release rolls out, a node still on
-- the previous one can no longer write either name, and it does not try to:
--   * SUCCESSFUL -> COLLECTING was taken only by charge-processor, through a
--     provider able to collect stored cards. No adapter has claimed that since
--     #38 -- Epoint, Payriff and the sandbox all refuse it -- so the job has
--     found nothing to open in every deployed environment.
--   * Nothing has had an edge into LATE_PLEDGE since #36; the route refuses
--     every campaign with PROJECT_TRANSITION_NOT_ALLOWED.
-- An old node reading a FULFILLING campaign reads a state it knows.
--
-- What this does NOT contract, and why:
--   * project_state_transitions_states_known keeps both names. The table is
--     append-only history, and a campaign that passed through COLLECTING has a
--     row saying so; tightening the check would refuse nothing new and could not
--     be validated against the rows that are already there.
--   * projects_public_states_are_fully_specified keeps them in its NOT IN list.
--     Removing a name from a NOT IN list loosens the check, and no row can reach
--     either state after the conversion, so a rewrite would change nothing.
--   * The discovery and search partial indexes (V74) keep both names in their
--     predicates. The queries now ask for fewer states, and a predicate that
--     covers more than a query asks for is still one PostgreSQL uses; rebuilding
--     six indexes to drop two dead names would lock the table for no plan change.
--   * projects.late_pledge_enabled, projects.late_pledge_ends_at,
--     pledges.is_late_pledge, pledges.payment_method_id and V42's three
--     collection-schedule columns stay. This release stops reading and writing
--     them, but the previous release maps every one of them, and a node still on
--     it would fail on its first read if they were dropped now. Dropping them is
--     the next release's migration -- expand, then contract (CLAUDE.md).
--   * The pledge states CONFIRMED, CHARGE_PENDING, CHARGE_FAILED and DROPPED
--     stay in pledges_state_known. Nothing moves a pledge into them any more, but
--     pledges confirmed before IDN-EXT-01 can still be CONFIRMED, and what happens
--     to those backers is a decision, not a cleanup.
-- ---------------------------------------------------------------------------

-- Taken first, and in the strongest mode, so that nothing writes the table
-- between the conversion and the check that validates it, and so that the
-- ALTER below does not have to upgrade a weaker lock -- an upgrade can deadlock
-- with a transaction that read the table and is waiting to write it. The table
-- is small and the statements below are quick.
LOCK TABLE projects IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- STRAY ROWS
-- ---------------------------------------------------------------------------
--
-- Expected to touch nothing in any deployed environment (see above), and
-- written so that it cannot fail the deploy if it does: a campaign still in
-- either state moves to FULFILLING, the one edge out of both in V74's machine,
-- and the move is recorded the way every other move is. A campaign left in
-- COLLECTING was decided successful and had started taking its money; one in
-- LATE_PLEDGE had collected it. Both owe their rewards, which is FULFILLING.

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_role, actor_id, note)
SELECT gen_random_uuid(),
       p.id,
       p.state,
       'FULFILLING',
       'SYSTEM',
       NULL,
       'V106 (#45): ' || p.state || ' was removed with the stored-card collection; '
           || 'FULFILLING was its only edge out.'
  FROM projects p
 WHERE p.state IN ('COLLECTING', 'LATE_PLEDGE');

UPDATE projects
   SET state = 'FULFILLING'
 WHERE state IN ('COLLECTING', 'LATE_PLEDGE');

-- ---------------------------------------------------------------------------
-- THE VOCABULARY
-- ---------------------------------------------------------------------------

ALTER TABLE projects DROP CONSTRAINT projects_state_known;

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
        'CLOSING_WINDOW',
        'EXTENDED',
        'SUSPENDED',
        'CANCELED',
        'SUCCESSFUL',
        'UNSUCCESSFUL',
        'WITHDRAWN',
        'FULFILLING',
        'COMPLETED'
    )
);

-- ---------------------------------------------------------------------------
-- THE RETIRED JOBS
-- ---------------------------------------------------------------------------
--
-- charge-processor and charge-retry are gone with the collection. Their rows
-- would stay in the console's health list for ever, graded overdue because
-- nothing runs them. A job registers its row at start-up, so a node still on the
-- previous release -- already started -- does not put them back.

DELETE FROM scheduled_jobs
 WHERE name IN ('charge-processor', 'charge-retry');
