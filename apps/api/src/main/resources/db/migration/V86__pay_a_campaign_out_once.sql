-- #182: a campaign is paid out once.
--
-- V55 kept a campaign free to be paid more than once over its life -- a late pledge collected after the
-- first payout would produce a second -- so its unique index covers only the payouts still in flight.
-- Nothing refused a new calculation once a payout was PAID, and a new calculation prices the campaign's
-- whole collections again: every figure is summed from the start, nothing subtracts what was already
-- sent. A second payout was the first one paid again. A chargeback lost after the payout made it worse:
-- it is the creator's debt (V80) and, since #175, also a CHARGEBACK refund in the campaign's refunded
-- figure, so it would be taken off twice.
--
-- The reason for a second payout is gone. IDN-EXT-01 (#36) switched late pledges off, and nothing is
-- refunded through the platform after payout (§6.3): money that moves after the payout moves against
-- the creator's debts, not the campaign's figures. So one PAID payout per campaign, here as well as in
-- `PayoutService.calculate`, `PayoutService.send` and `WithdrawalPayouts.request`, which refuse first
-- and say why. FAILED and CANCELLED rows stay free to repeat: a refused send is retried as a fresh
-- calculation.
--
-- A PAYOUT SETTLED ENTIRELY AGAINST DEBTS. A withdrawal whose whole net goes towards the creator's
-- chargeback debts used to recover the debts and write no payout row, so the campaign still read as
-- unpaid -- with the debts cleared -- and a redelivered withdrawal or a finance calculation priced the
-- money the platform had kept all over again. It is now a PAID row with a net of zero, nothing sent and
-- no transaction; payouts_paid_has_transaction is relaxed for exactly that row and no other.
--
-- A SEND THE PROVIDER NEVER ANSWERED. `send_unconfirmed_at` is stamped when a send ended with the
-- provider unreachable. Such a payout was recorded FAILED and priced again under a new idempotency key,
-- which pays twice if the first instruction was carried out; it now stays APPROVED, is sent again only
-- under its own key (a refusal of that retry proves nothing: Epoint refuses an order_id it already
-- carried out), and cannot be cancelled, recalculated or disputed. Staff settle it from the provider's
-- statement: POST /v1/admin/payouts/{id}/unconfirmed-send/sent or /not-sent. The UPDATE below turns
-- the rows the previous release wrote FAILED 'provider_unreachable' into that -- the latest per campaign,
-- when the campaign has no other payout in flight or paid (the query after it lists any it could not).
-- A previous-release node can still write one during the deploy; the campaign then refuses a new
-- calculation (PAYOUT_SEND_UNCONFIRMED) until staff settle that payout from the statement through the
-- same two endpoints, or this UPDATE is run once more (it only matches such rows).
--
-- If the index fails to build, a campaign has already been paid twice. That is money to recover from the
-- creator, not an index to drop:
--   SELECT project_id, count(*) FROM payouts WHERE state = 'PAID' GROUP BY project_id HAVING count(*) > 1;
-- A payout still in flight for a campaign already paid is refused at send (CAMPAIGN_ALREADY_PAID_OUT) and
-- is for staff to cancel:
--   SELECT f.id, f.project_id FROM payouts f JOIN payouts p ON p.project_id = f.project_id
--    WHERE f.state IN ('CALCULATED', 'PENDING_APPROVAL', 'APPROVED') AND p.state = 'PAID';
--
-- Unanswered sends the UPDATE could not reopen, for staff to settle from the statement:
--   SELECT id, project_id FROM payouts WHERE state = 'FAILED' AND failure_code = 'provider_unreachable';
--
-- Reverse: DROP INDEX payouts_one_paid_per_project; ALTER TABLE payouts DROP COLUMN send_unconfirmed_at;
-- and restore V55's payouts_paid_has_transaction -- once no PAID row with a zero net and no transaction
-- exists. Reopened payouts are not put back to FAILED: that is the double payment this file removes.
--
-- Contract: none. A new index, a nullable column the previous release does not map, and a CHECK that
-- only admits more. The previous release never writes a second PAID row for a campaign unless somebody
-- asks it to, and that is what this refuses.

ALTER TABLE payouts ADD COLUMN send_unconfirmed_at timestamptz;

UPDATE payouts r
   SET state = 'APPROVED',
       send_unconfirmed_at = r.sent_at,
       sent_at = NULL,
       failure_code = NULL,
       failure_message = NULL
 WHERE r.state = 'FAILED'
   AND r.failure_code = 'provider_unreachable'
   AND r.id = (SELECT x.id FROM payouts x
                WHERE x.project_id = r.project_id AND x.state = 'FAILED' AND x.failure_code = 'provider_unreachable'
                ORDER BY x.sent_at DESC, x.id
                LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM payouts o
                    WHERE o.project_id = r.project_id
                      AND o.state IN ('CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PAID'));

ALTER TABLE payouts DROP CONSTRAINT payouts_paid_has_transaction;
ALTER TABLE payouts ADD CONSTRAINT payouts_paid_has_transaction CHECK (
    state <> 'PAID' OR payout_transaction_id IS NOT NULL OR (net_amount = 0 AND debt_withheld > 0));

CREATE UNIQUE INDEX payouts_one_paid_per_project
    ON payouts (project_id)
    WHERE state = 'PAID';
