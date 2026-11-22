-- A plan payment records the period it pays for -- issue #660.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE subscription_charges
--       DROP CONSTRAINT subscription_charges_period_known,
--       DROP COLUMN billing_period;
--
--   A page settled after that is applied as the subscription's own period at
--   its own price, which is what the previous release did; a page opened for
--   another period and still pending at that moment would extend by the wrong
--   length, so drain pending pages first
--   (SELECT count(*) FROM subscription_charges WHERE status = 'PENDING').
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. A nullable column the previous release does not map, and
-- the CHECK accepts NULL, so a page that release opens during a rolling
-- deployment is written as before.
-- ---------------------------------------------------------------------------
--
-- WHY. A running subscription may now be extended by a period other than its
-- own, at the plan's current price for it (#660). The page is opened at one
-- moment and paid at another, and the plan may be repriced in between, so what
-- the money buys is taken from the page and never re-read from the plan: this
-- column says how long, `amount` says at what price. Settlement extends the
-- subscription by this period and copies both onto it.
--
-- WHY NULLABLE. A page opened before this release has no period, and the
-- previous release keeps opening such pages until it is gone. Settlement reads
-- NULL as "the subscription's own period at its own price" -- exactly what
-- those pages were opened for. No backfill: a pending page from before is
-- correctly described by NULL, and a settled one's period is on its receipt in
-- `subscription_payments`.
--
-- The names are V126's, the subscription module's BillingPeriod.

ALTER TABLE subscription_charges
    ADD COLUMN billing_period text;

ALTER TABLE subscription_charges
    ADD CONSTRAINT subscription_charges_period_known
        CHECK (billing_period IS NULL OR billing_period IN ('MONTHLY', 'SEMIANNUAL', 'YEARLY'));
