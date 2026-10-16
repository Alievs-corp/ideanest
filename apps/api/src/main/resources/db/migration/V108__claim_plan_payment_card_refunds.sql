-- A card refund of an unapplied plan payment is claimed before the provider is asked.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE subscription_charges
--       DROP CONSTRAINT subscription_charges_card_refund_claim_whole,
--       DROP COLUMN card_refund_started_at,
--       DROP COLUMN card_refund_started_by;
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Two nullable columns the previous release does not map, and a
-- CHECK that every existing row (both null) satisfies.
-- ---------------------------------------------------------------------------
--
-- V104 returned an UNAPPLIED payment to the card by asking the provider first and
-- locking the row after. A refund the provider carried out and whose answer never
-- arrived left the row UNAPPLIED, so the console offered the bank transfer as the
-- way back and the creator could be paid twice. The row is now marked under its
-- lock before the provider is asked. While the mark is set and the row is still
-- UNAPPLIED the outcome is unknown: the bank transfer is refused, and the next card
-- refund asks the provider whether the payment was already returned before it
-- sends anything. The mark is cleared when the provider definitely refuses.

ALTER TABLE subscription_charges
    ADD COLUMN card_refund_started_at timestamptz,
    ADD COLUMN card_refund_started_by uuid;

ALTER TABLE subscription_charges
    ADD CONSTRAINT subscription_charges_card_refund_claim_whole
        CHECK ((card_refund_started_at IS NULL) = (card_refund_started_by IS NULL));
