-- A failed campaign's backers are refunded net of the payment provider's fee,
-- for the charges taken under the words that say so. Issue #436.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   Check first: SELECT count(*) FROM refunds WHERE withheld_fee > 0;
--   If it is zero:
--     ALTER TABLE refunds
--         DROP CONSTRAINT refunds_withheld_fee_campaign_only,
--         DROP COLUMN withheld_fee;
--     ALTER TABLE transactions
--         DROP CONSTRAINT transactions_fee_withheld_on_charge_only,
--         DROP COLUMN provider_fee_withheld_on_refund;
--   If it is not, those refunds returned less than their charge on purpose,
--   and `withheld_fee` is the only record of why: without it every sum would
--   read the fee as still owed and the campaign-refunds sweep would send it.
--   Dropping `provider_fee_withheld_on_refund` while `withheld_fee` is still
--   zero everywhere loses only which charges were taken under the new words;
--   every charge would then refund in full, which is what the backers of the
--   charges before #436 were promised.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Two columns with constant defaults (no table rewrite, and no
-- UPDATE, so V41's append-only trigger on `transactions` does not fire) and
-- two CHECKs every existing row satisfies.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- THE DECISION (owner, 2026-10-13)
-- ---------------------------------------------------------------------------
--
-- Payriff does not return its commission on a refunded charge (#387), so
-- refunding a failed campaign's backers in full pays that commission out of
-- IdeyaNest's own account on every pledge. From now on, when a campaign ends
-- below 80%, is suspended or is cancelled, the backer gets the pledge back
-- less the provider's fee -- the figure posted to `psp_fee` with the charge
-- (#427), so what goes back equals what the platform received. The platform's
-- own fee is never deducted. Staff refunds (AD-06) and disputes keep their own
-- amounts.
--
-- Only for charges taken after the backer was told so. Every earlier backer
-- was told "refunded in full" and is refunded in full.
--
-- ---------------------------------------------------------------------------
-- transactions.provider_fee_withheld_on_refund
-- ---------------------------------------------------------------------------
--
-- Whether a campaign-outcome refund of this charge withholds the provider's
-- fee. Written once, when the charge is recorded, from the setting
-- `ideanest.payment.refunds.withhold-provider-fee`, and never read from the
-- setting again: the cut-over follows the words a backer was shown, not a
-- date, and a refund months later must not depend on what the setting says on
-- the day it is sent.
--
-- On `transactions` rather than on `pledges`, for three reasons:
--
--   * The campaign-refunds sweep is a reading of `transactions` -- it offers
--     one settled CHARGE row at a time (`RefundRepository#owedPlatformRefunds`)
--     and `RefundRecords#recordForCharge` reverses that row. The flag sits on
--     the row the refund path already has in hand.
--   * A pledge can be paid for in more than one charge (#171, a raise), and a
--     raise paid after the switch was paid under different words from the
--     pledge it raised. The terms belong to the payment, not to the pledge.
--   * `transactions` is insert-only (V41). A flag here cannot be changed after
--     the backer paid, by the application or by a support script.
--
-- A hosted payment's settled row copies its pending row, which was written
-- when the backer was sent to pay -- the moment they had read the checkout.
-- Only a CHARGE can carry it.
--
-- ---------------------------------------------------------------------------
-- refunds.withheld_fee
-- ---------------------------------------------------------------------------
--
-- What this refund deliberately did not send back: the provider's fee on its
-- charge. `amount` stays what was sent, so every reading of `amount` as money
-- that left is still true. The sums that decide what a charge or a pledge has
-- left count `amount + withheld_fee`, so a net refund settles the charge: the
-- sweep does not offer the fee again, and the pledge becomes REFUNDED when it
-- settles. Zero on every existing row and on every staff refund, dispute and
-- chargeback; only the two campaign reasons may withhold.
--
-- ---------------------------------------------------------------------------
-- The BEHAVIOUR for the minutes both releases run
-- ---------------------------------------------------------------------------
--
-- The previous release does not map either column: it inserts charges with
-- the default (refunded in full) and refunds with no fee withheld, which is
-- its behaviour. Its sums read `amount` alone, so it would see the withheld
-- fee of a net refund as money still owed and send it. That is why the switch
-- is configuration and off by default: no charge is flagged, and no refund
-- withholds anything, until a deployment sets
-- PAYMENT_REFUNDS_WITHHOLD_PROVIDER_FEE=true -- after every node runs this
-- release, and after the wording that tells the backer is live.

ALTER TABLE transactions
    ADD COLUMN provider_fee_withheld_on_refund boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT transactions_fee_withheld_on_charge_only
        CHECK (NOT provider_fee_withheld_on_refund OR type = 'CHARGE');

COMMENT ON COLUMN transactions.provider_fee_withheld_on_refund IS
    '#436: a campaign-outcome refund of this charge returns it less the provider fee posted with it. Set when the charge is recorded, never changed.';

ALTER TABLE refunds
    ADD COLUMN withheld_fee numeric(14, 2) NOT NULL DEFAULT 0,
    ADD CONSTRAINT refunds_withheld_fee_campaign_only
        CHECK (withheld_fee >= 0
               AND (withheld_fee = 0 OR reason IN ('CAMPAIGN_FAILED', 'CAMPAIGN_HALTED')));

COMMENT ON COLUMN refunds.withheld_fee IS
    '#436: the provider fee this refund kept back from its charge. Counted with amount wherever what a charge or pledge has left is decided.';
