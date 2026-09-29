-- #175: a lost chargeback is recorded as a refund, so no refund path can send the same money again.
--
-- A chargeback the platform loses (or concedes) returns the backer's money through the card network.
-- `DisputeService` has always recorded that as a REFUND transaction and its ledger posting, but wrote
-- no `refunds` row -- and every read that decides what of a charge is still refundable sums `refunds`:
-- the staff overdraft check, the per-charge remainder (#171), the campaign-refunds sweep's
-- owedPlatformRefunds, and the payout's refunded figure. So a charge taken back by the network was
-- still offered for a refund, and a failed campaign or a member of staff paid the backer a second time.
--
-- From this release the loss also writes a `refunds` row with reason CHARGEBACK, already SUCCEEDED,
-- against the disputed charge and pointing at the REFUND transaction the loss recorded. It names the
-- member of staff who resolved the case. `full_refund` says whether it took everything its charge had
-- left, as every part of a staff refund of the rest does, so the console does not call a chargeback of
-- a whole charge partial.
--
-- The one row that may have no author is a CHARGEBACK backfilled below for a loss whose resolver's
-- account was since deleted (disputes.handled_by is ON DELETE SET NULL). Skipping those would leave
-- exactly the money this migration exists to protect refundable twice, so V76/V83's rule on authorless
-- refunds admits CHARGEBACK as well: its author is the card network, and the dispute names the case.
--
-- Reverse: once no row uses it --
--   SELECT count(*) FROM refunds WHERE reason = 'CHARGEBACK';
-- restore V83's refunds_reason_known and refunds_system_refunds_are_campaign_refunds without CHARGEBACK. Rows that exist record money that moved; they
-- cannot be removed, only re-labelled, and re-labelling them as anything else would miscount refunds.
--
-- Contract: none. One more value in each of two CHECKs. The SCHEMA is safe under a rolling deployment.
-- The BEHAVIOUR for the minutes both releases run:
--   * A previous-release node that resolves a chargeback as lost writes no row, as before; the
--     chargeback is then unprotected exactly as it was before this release. A lost chargeback resolved
--     during the deploy should be checked by hand (disputes resolved LOST or CONCEDED with no refunds row
--     WHERE idempotency_key = 'chargeback-' || disputes.id).
--   * A previous-release node listing refunds maps `reason` to its enum and fails on CHARGEBACK: the
--     console's refund list answers an error from that node until it is replaced. The sums the
--     previous release computes are native or aggregate and read the row correctly.
--
-- Chargebacks lost BEFORE this release are backfilled below, from the REFUND transaction each loss
-- recorded ('dispute-' || disputes.id): that row is what the ledger already counts as money gone, so a
-- refunds row beside it only makes the refund paths agree with the books. If such a charge was ALSO
-- refunded since, the refunds against it now add up to more than it was -- which is the truth (the
-- backer was paid twice) and blocks a third payment; it is for a person to recover, not for this file.
-- The pledge's state is not moved here: its totals are the campaign's figures, and a bulk rewrite of
-- those is a decision for whoever reads the list this query gives:
--   SELECT d.id, d.pledge_id, d.amount FROM disputes d
--     JOIN refunds r ON r.idempotency_key = 'chargeback-' || d.id;
-- A loss whose resolver's account was since deleted is backfilled with no author (above).
--
-- Re-runnable: both constraint swaps end where they started and the INSERT skips a case that has its
-- row, which is what lets RefundSafetyApiTests replay this file against rows written the old way.

ALTER TABLE refunds DROP CONSTRAINT refunds_reason_known;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_known CHECK (reason IN (
    'BACKER_REQUEST', 'CAMPAIGN_HALTED', 'CAMPAIGN_FAILED', 'FULFILMENT_FAILURE', 'DUPLICATE_CHARGE',
    'PLATFORM_ERROR', 'DISPUTE_CONCEDED', 'FRAUD', 'RAISE_NOT_APPLIED', 'CHARGEBACK'));

ALTER TABLE refunds DROP CONSTRAINT refunds_system_refunds_are_campaign_refunds;
ALTER TABLE refunds ADD CONSTRAINT refunds_system_refunds_are_campaign_refunds CHECK (
    requested_by IS NOT NULL OR reason IN ('CAMPAIGN_FAILED', 'CAMPAIGN_HALTED', 'RAISE_NOT_APPLIED', 'CHARGEBACK')
);

INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, refund_transaction_id, amount, currency,
                     full_refund, reason, detail, state, requested_by, requested_at, settled_at, idempotency_key)
SELECT gen_random_uuid(), d.pledge_id, d.project_id, d.charge_transaction_id, t.id, d.amount, d.currency,
       -- Whether it took everything its charge had left when it was lost.
       d.amount >= c.amount - (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
                                WHERE r.charge_transaction_id = c.id AND r.state <> 'FAILED'
                                  AND r.requested_at < t.created_at),
       'CHARGEBACK',
       'The card network took this charge back: dispute ' || d.id || ' was resolved against the platform'
           || ' (recorded by V84 for a loss resolved before #175).',
       'SUCCEEDED', d.handled_by, t.created_at, t.created_at, 'chargeback-' || d.id
  FROM disputes d
  JOIN transactions t ON t.idempotency_key = 'dispute-' || d.id AND t.type = 'REFUND'
  JOIN transactions c ON c.id = d.charge_transaction_id
 WHERE NOT EXISTS (SELECT 1 FROM refunds r WHERE r.idempotency_key = 'chargeback-' || d.id);
