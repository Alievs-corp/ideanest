-- A plan payment that could not be applied is returned to the creator -- issue #457.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   once no row has the status
--   (SELECT count(*) FROM subscription_charges WHERE status = 'REFUNDED'),
--   ALTER TABLE subscription_charges
--       DROP CONSTRAINT subscription_charges_refund_is_recorded,
--       DROP CONSTRAINT subscription_charges_refund_method_known,
--       DROP COLUMN refunded_at, DROP COLUMN refunded_by, DROP COLUMN refund_method,
--       DROP COLUMN refund_reference, DROP COLUMN refund_note;
--   and restore V102's subscription_charges_status_known without REFUNDED.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Nullable columns the previous release does not map, and a
-- widened CHECK whose old list the new one contains.
-- ---------------------------------------------------------------------------
--
-- An UNAPPLIED page is money the provider took for a subscription that had
-- already ended (#449). A member of staff returns it, to the card through the
-- provider while its refund window is open or by bank transfer after, and the
-- row says which, by whom and with what reference. No receipt row is reversed:
-- an UNAPPLIED payment never wrote one to `subscription_payments`.

ALTER TABLE subscription_charges
    DROP CONSTRAINT subscription_charges_status_known;
ALTER TABLE subscription_charges
    ADD CONSTRAINT subscription_charges_status_known
        CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'UNAPPLIED', 'REFUNDED'));

ALTER TABLE subscription_charges
    ADD COLUMN refunded_at      timestamptz,
    ADD COLUMN refunded_by      uuid,
    ADD COLUMN refund_method    text,
    ADD COLUMN refund_reference text,
    ADD COLUMN refund_note      text;

ALTER TABLE subscription_charges
    ADD CONSTRAINT subscription_charges_refund_method_known
        CHECK (refund_method IS NULL OR refund_method IN ('CARD', 'BANK_TRANSFER')),
    ADD CONSTRAINT subscription_charges_refund_is_recorded
        CHECK ((status = 'REFUNDED') = (refunded_at IS NOT NULL AND refunded_by IS NOT NULL AND refund_method IS NOT NULL));

CREATE INDEX subscription_charges_unapplied
    ON subscription_charges (settled_at)
    WHERE status = 'UNAPPLIED';
