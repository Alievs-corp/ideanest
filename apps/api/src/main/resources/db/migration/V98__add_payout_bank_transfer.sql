-- A payout may be settled by a bank transfer made by a member of staff from
-- IdeyaNest's own account, and recorded here. Issue #397, epic #392.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE payouts
--       DROP CONSTRAINT payouts_bank_transfer_started_is_whole,
--       DROP CONSTRAINT payouts_bank_transfer_started_while_approved_or_paid,
--       DROP CONSTRAINT payouts_bank_transfer_is_not_an_unconfirmed_send,
--       DROP CONSTRAINT payouts_bank_transferred_on_is_paid,
--       DROP COLUMN bank_transfer_started_at,
--       DROP COLUMN bank_transfer_started_by,
--       DROP COLUMN bank_transferred_on;
--
--   Only once no payout has a transfer started and unrecorded:
--     SELECT id FROM payouts WHERE state = 'APPROVED' AND bank_transfer_started_at IS NOT NULL;
--   Each such row is money that may already be in a creator's account. Record
--   it or abandon it first. A PAID row loses only the date the bank gave; its
--   transaction keeps the bank's reference.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Three nullable columns the previous release does not map,
-- and four constraints every existing row satisfies, because every existing
-- row has the three columns null.
-- ---------------------------------------------------------------------------
--
-- WHY THERE IS NO NEW STATE
--
-- A started transfer is still APPROVED. V55's partial unique index counts
-- CALCULATED, PENDING_APPROVAL and APPROVED as in flight, every read that asks
-- "is this campaign's payout on its way" lists those three, and a node still
-- running the previous release parses `state` through an enum that would fail
-- on a fourth. V86 made the same choice for a send the provider never answered:
-- `send_unconfirmed_at` is a marker on an APPROVED row, not a state. This is its
-- sibling, and the two mean the same thing to everything that is not the
-- payout's own console: the money may have left, so the payout is not
-- cancelled, recalculated or disputed until somebody says what happened.
--
-- `bank_transfer_started_at`, `bank_transfer_started_by`: when a member of
-- staff opened the creator's account to pay into it, and who. Set together and
-- cleared together, by abandoning the transfer.
--
-- `bank_transferred_on`: the value date the bank gave the transfer, as the
-- person recording it read it off the statement. A date and not an instant,
-- because that is what a bank statement carries. Present only on a PAID row,
-- and only on one whose transfer was started here.
--
-- WHAT THE PREVIOUS RELEASE DOES DURING THE ROLLOUT
--
-- It does not know the marker. Asked to cancel a started payout, or to take a
-- signature back from one, it would move the row out of APPROVED with the
-- marker still set, and `payouts_bank_transfer_started_while_approved_or_paid`
-- refuses the write instead. Asked to send one, it finds a destination whose
-- provider is BANK_TRANSFER, which is not the provider it sends through, and
-- refuses as PAYOUT_DESTINATION_PROVIDER_MISMATCH. Both are the safe direction.
-- A backer dispute it upholds on such a campaign issues the refund before it
-- recalculates the payout, and the recalculation is the write this refuses: the
-- refund stands, the payout stays as priced, and the person recording the
-- transfer is shown the difference.

ALTER TABLE payouts
    ADD COLUMN bank_transfer_started_at timestamptz,
    ADD COLUMN bank_transfer_started_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    ADD COLUMN bank_transferred_on date;

ALTER TABLE payouts
    ADD CONSTRAINT payouts_bank_transfer_started_is_whole CHECK (
        (bank_transfer_started_at IS NULL) = (bank_transfer_started_by IS NULL)),
    ADD CONSTRAINT payouts_bank_transfer_started_while_approved_or_paid CHECK (
        bank_transfer_started_at IS NULL OR state IN ('APPROVED', 'PAID')),
    -- Two markers that each say "the money may have left" by a different route.
    -- A send the provider never answered is settled from the provider's statement
    -- before anybody pays the same money by hand.
    ADD CONSTRAINT payouts_bank_transfer_is_not_an_unconfirmed_send CHECK (
        bank_transfer_started_at IS NULL OR send_unconfirmed_at IS NULL),
    ADD CONSTRAINT payouts_bank_transferred_on_is_paid CHECK (
        bank_transferred_on IS NULL OR (state = 'PAID' AND bank_transfer_started_at IS NOT NULL));

COMMENT ON COLUMN payouts.bank_transfer_started_at IS
    'When a member of staff opened the creator''s account to pay this payout by bank transfer (#397). Still APPROVED: the money may have left, so the payout is neither cancelled nor recalculated.';
COMMENT ON COLUMN payouts.bank_transferred_on IS
    'The value date of the bank transfer that paid this payout, from the bank statement (#397).';
