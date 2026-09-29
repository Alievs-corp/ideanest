-- #176: refunds recorded FAILED because the provider could not be reached go back to REQUESTED.
--
-- Before this release a refund whose provider call ended unreachable (a timeout, a dropped connection,
-- an answer nobody could read) was recorded FAILED with failure_code 'provider_unreachable'. A FAILED
-- refund counts as nothing: the campaign-refunds sweep offers its charge again after retry-after, and a
-- member of staff may refund the same money again. But the call may have reached Epoint and been
-- carried out -- /reverse has no duplicate protection -- so either could pay the backer twice. From
-- this release such a refund stays REQUESTED and the reconciliation asks the provider (/get-status)
-- before anything is sent again. This moves the rows written the old way to where the new code would
-- have left them: REQUESTED, with settled_at and the failure fields cleared and everything else -- the
-- amount, the charge, the key, the author -- kept. The next campaign-refunds pass reconciles each one:
-- 'returned' settles it SUCCEEDED, 'still paid' fails it (reverse_not_confirmed) and only then is it
-- sent again.
--
-- A LATER REFUND ON THE SAME CHARGE. The sweep or a member of staff may already have refunded the charge
-- again after the unreachable attempt (or there may be more than one unreachable attempt). Then the
-- provider's status of the whole payment cannot say which of them happened, so such a row is reopened
-- already marked for a person (review_reason, V83): it counts as gone -- the refunds against the charge
-- may now add up to more than it was, which blocks any further refund, the safe direction -- and the
-- reconciliation does not ask about it. A person settles it from the provider's statement. The same
-- when the row names no charge at all.
--
-- Indexes and constraints: no index is unique over state, so any number of REQUESTED rows per charge or
-- pledge is allowed (refunds_idempotency_key_unique is untouched: keys are not changed).
-- refunds_failure_matches_state, refunds_settled_at_matches_state and refunds_review_only_while_requested
-- all hold for the rows as rewritten. Reopened rows also count in a payout's refunded figure, so a
-- payout calculated before this ran is cancelled at send (figuresMoved) rather than paying out money
-- that may have gone back -- the safe direction again.
--
-- Reverse: not by statement. Restoring FAILED is the double payment this file removes, and once the
-- reconciliation has settled a reopened row its outcome is the provider's, not a guess. To undo for one
-- row before it is reconciled, set it back by hand from the provider's statement; the rows this touched
-- are REQUESTED ones requested before this migration ran (flyway_schema_history.installed_on).
--
-- Contract: none. Data only; no schema change. Under a rolling deployment a previous-release node can
-- still record a new unreachable refund FAILED in the minutes both releases run. Such rows are not
-- touched by this file, which has already run. After the deploy, run the UPDATE below once more (it only
-- matches rows that are still FAILED with 'provider_unreachable', so running it twice changes nothing
-- else), or check with
--   SELECT id, pledge_id, amount FROM refunds WHERE state = 'FAILED' AND failure_code = 'provider_unreachable';
--
-- Re-runnable for that reason, and RefundSafetyApiTests replays it against rows written the old way.

UPDATE refunds r
   SET state = 'REQUESTED',
       settled_at = NULL,
       failure_code = NULL,
       failure_message = NULL,
       review_reason = CASE
           WHEN r.charge_transaction_id IS NULL THEN
               'Recorded failed as unreachable before #176 and names no charge: whether it happened needs the'
               || ' provider''s statement.'
           WHEN EXISTS (SELECT 1 FROM refunds o
                         WHERE o.charge_transaction_id = r.charge_transaction_id
                           AND o.id <> r.id
                           AND (o.state <> 'FAILED' OR o.failure_code = 'provider_unreachable')) THEN
               'Recorded failed as unreachable before #176, and another refund went against the same charge:'
               || ' the payment''s status cannot tell which happened, so it needs the provider''s statement.'
       END
 WHERE r.state = 'FAILED'
   AND r.failure_code = 'provider_unreachable';
