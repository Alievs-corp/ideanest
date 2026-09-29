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
-- `PayoutService.calculate` and `WithdrawalPayouts.request`, which refuse first and say why. FAILED and
-- CANCELLED rows stay free to repeat: a failed send is retried as a fresh calculation.
--
-- If this fails to build, a campaign has already been paid twice. That is money to recover from the
-- creator, not an index to drop:
--   SELECT project_id, count(*) FROM payouts WHERE state = 'PAID' GROUP BY project_id HAVING count(*) > 1;
--
-- Reverse: DROP INDEX payouts_one_paid_per_project;
--
-- Contract: none. A new index; the previous release never writes a second PAID row for a campaign
-- unless somebody asks it to, and that is what this refuses.

CREATE UNIQUE INDEX payouts_one_paid_per_project
    ON payouts (project_id)
    WHERE state = 'PAID';
