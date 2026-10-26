-- #587: a pledge paid for twice is refunded the second payment, on its own.
--
-- Two payment pages could be open for one draft (a second Idempotency-Key opened a second provider
-- order), and both could be paid. The first settlement collects the pledge; the second was posted to
-- the ledger and then dropped by PledgePayments.recordPaid without a word -- money taken that nothing
-- returned. From this release the second is recorded here, at ERROR and on a metric, and the
-- campaign-refunds job returns it in full as DUPLICATE_CHARGE, the way it returns a raise that could not
-- be applied (V83): it bought nothing, so it is never part of a payout, and its refund is not the
-- pledge's money.
--
-- A row per charge, written in the transaction that settled it. Never updated and never deleted:
-- whether its refund has gone out is `refunds`' to say.
--
-- DUPLICATE_CHARGE joins the reasons a refund may carry with no member of staff behind it, because the
-- platform issues this one on its own; a member of staff may still issue it with their name on it.
--
-- Reverse: once nothing reads it --
--   DROP TABLE duplicate_charges;
--   and restore V84's refunds_system_refunds_are_campaign_refunds without DUPLICATE_CHARGE, after
--   SELECT count(*) FROM refunds WHERE reason = 'DUPLICATE_CHARGE' AND requested_by IS NULL;
--   is zero (rows that exist record money that moved and cannot be removed).
--
-- Contract: none. A new table and one more value in one CHECK, both safe under a rolling deployment:
-- the previous release neither reads nor writes the table, and a previous-release node that settles a
-- second payment drops it silently as before -- such a charge is found with
--   SELECT t.id FROM transactions t WHERE t.type = 'CHARGE' AND t.status = 'SUCCEEDED'
--     AND t.pledge_id IN (SELECT pledge_id FROM transactions WHERE type = 'CHARGE' AND status = 'SUCCEEDED'
--                          GROUP BY pledge_id HAVING count(*) > 1)
-- and recorded here by hand once the release is everywhere. Nothing is backfilled: a raised pledge has
-- several settled charges by design, and telling a duplicate from a raise is a person's reading.
--
-- ON DELETE CASCADE only for V95's reason: a transaction is never deleted outside a test suite's
-- cleanup, which disables V41's trigger to do it.

CREATE TABLE duplicate_charges (
    charge_transaction_id uuid        PRIMARY KEY REFERENCES transactions (id) ON DELETE CASCADE,
    pledge_id             uuid        NOT NULL,
    recorded_at           timestamptz NOT NULL
);

CREATE INDEX duplicate_charges_pledge_idx ON duplicate_charges (pledge_id);

ALTER TABLE refunds DROP CONSTRAINT refunds_system_refunds_are_campaign_refunds;
ALTER TABLE refunds ADD CONSTRAINT refunds_system_refunds_are_campaign_refunds CHECK (
    requested_by IS NOT NULL
        OR reason IN ('CAMPAIGN_FAILED', 'CAMPAIGN_HALTED', 'RAISE_NOT_APPLIED', 'CHARGEBACK', 'DUPLICATE_CHARGE')
);
