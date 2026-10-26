-- #587: a payment page that outlives the sweep's window is reported, once, instead of forgotten.
--
-- hosted-charge-sweep asks the provider about a pending page until `asked-for` (P7D) after it was
-- opened, and then stopped looking at it: a page whose callback was lost and which the provider would
-- not answer for a week left a backer who may have paid with a draft nobody would ever confirm, and
-- nothing said so. From this release the pass that finds such a page logs it at ERROR and counts it
-- (ideanest.payment.hosted.anomalies{reason="aged_out"}, alerted in ops/observability/alerts.yml),
-- and stamps it here so the next pass does not report it again. What becomes of it is a person's
-- decision.
--
-- Reverse: ALTER TABLE hosted_charge_checks DROP COLUMN aged_out_at;
--   The previous release never reads it.
--
-- Contract: none. A nullable column on V95's bookkeeping table; the previous release's upsert names
-- its own columns and leaves this one alone. Pages that aged out before this release are reported by
-- the first passes after it, oldest first and `per-pass` at a time, which is the backlog this exists
-- to surface.

ALTER TABLE hosted_charge_checks ADD COLUMN aged_out_at timestamptz;
