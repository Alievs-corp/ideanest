-- When the hosted-charge sweep last asked the provider about a payment page whose
-- callback never came -- issue #353.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS hosted_charge_checks;
--
--   Nothing else reads it. Safe under a rolling deployment in both directions:
--   the previous release neither writes nor reads it, and without it the next
--   pass simply asks about every pending page again, oldest first.
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE AND NOT A COLUMN ON `transactions`. That table is append-only by
-- trigger (V41), and a pending row that grew a "last asked" stamp would be the
-- first row on it that changes. The stamp is not a fact about the money; it is
-- the sweep's bookkeeping, so that a page the provider keeps calling pending --
-- an abandoned one -- goes to the back of the queue and cannot fill every pass.
--
-- ON DELETE CASCADE only because a transaction is never deleted outside a test
-- suite's cleanup, which disables V41's trigger to do it; production never
-- exercises the cascade.

CREATE TABLE hosted_charge_checks (
    transaction_id uuid        PRIMARY KEY REFERENCES transactions (id) ON DELETE CASCADE,
    checked_at     timestamptz NOT NULL,
    -- What the provider said last time, for whoever reads why a page is still open.
    last_state     text        NOT NULL,

    CONSTRAINT hosted_charge_checks_state_known
        CHECK (last_state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'RETURNED', 'UNANSWERED'))
);
