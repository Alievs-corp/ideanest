-- Extending a running subscription -- issue #660.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE subscription_charges
--       DROP CONSTRAINT subscription_charges_period_known,
--       DROP COLUMN billing_period;
--   ALTER TABLE subscriptions
--       DROP COLUMN current_period_start;
--
--   A page settled after that is applied as the subscription's own period at
--   its own price, which is what the previous release did; a page opened for
--   another period and still pending at that moment would extend by the wrong
--   length, so drain pending pages first
--   (SELECT count(*) FROM subscription_charges WHERE status = 'PENDING').
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Two nullable columns the previous release does not map, and
-- a CHECK that accepts NULL, so a page or a renewal that release writes during
-- a rolling deployment is written as before.
-- ---------------------------------------------------------------------------
--
-- subscription_charges.billing_period. A running subscription may be extended
-- by a period other than its own, at the plan's current price for it (#660).
-- The page is opened at one moment and paid at another, and the plan may be
-- repriced in between, so what the money buys is taken from the page and never
-- re-read from the plan: this column says how long, `amount` says at what
-- price. Settlement extends the subscription by this period and copies both
-- onto it. NULL is a page opened before this release, which was opened for the
-- subscription's own period at its own price, and is settled as exactly that.
-- No backfill: a pending page from before is correctly described by NULL, and
-- a settled one's period is on its receipt in `subscription_payments`.
--
-- The release that adds this column still offers only the held period; the
-- next one offers the others. During this release's rolling deployment an
-- instance of the previous release may settle a page, and it renews by the
-- subscription's own period whatever the page says -- harmless while every page
-- is for that period.
--
-- subscriptions.current_period_start. When the running period began: the
-- activation, or the old end an extension ran on from. The renewal window opens
-- a calendar month before the end but never before this, so an extension paid
-- near a month's end (end 31 March, extended on 30 March to 30 April, whose
-- month-before is 30 March) does not reopen the window at once. NULL on a row
-- last activated or renewed by the previous release; the window then opens a
-- month before the end. No backfill: the start of a period renewed before this
-- release is not recorded anywhere.

ALTER TABLE subscription_charges
    ADD COLUMN billing_period text;

ALTER TABLE subscription_charges
    ADD CONSTRAINT subscription_charges_period_known
        CHECK (billing_period IS NULL OR billing_period IN ('MONTHLY', 'SEMIANNUAL', 'YEARLY'));

ALTER TABLE subscriptions
    ADD COLUMN current_period_start timestamptz;
