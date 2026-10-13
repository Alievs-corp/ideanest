-- The creator is told a payout was paid, and the backer that a refund was
-- sent by bank transfer. Issue #418, epic #392.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   ALTER TABLE payouts
--       DROP CONSTRAINT payouts_bank_transfer_account_hint_is_a_hint,
--       DROP COLUMN bank_transfer_account_hint;
--   and, once no notification has the type
--   (SELECT count(*) FROM notifications WHERE type = 'REFUND_SENT_BY_BANK'),
--   restore V99's notifications_type_known without REFUND_SENT_BY_BANK.
--   Dropping the column loses only which masked account a paid payout's
--   message named; the account itself is the creator's destination, and the
--   bank's reference is on the payout's transaction.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. One nullable column the previous release does not map, and
-- one widened CHECK whose old list the new one contains.
-- ---------------------------------------------------------------------------
--
-- `bank_transfer_account_hint` is the masked IBAN of the account a member of
-- staff opened to pay this payout by bank transfer (`AZ21…1944`), written each
-- time the account is opened and cleared when the transfer is abandoned. It is
-- kept so the creator's message names the account that was actually shown,
-- even if they replace their destination before the transfer is recorded, and
-- so the account does not have to be opened, and audited, a second time just
-- to say which one it was. V72's ceiling of twelve characters applies: long
-- enough for a mask, too short for an IBAN.
--
-- A transfer a previous-release node starts during the rollout has no hint,
-- and its message leaves the account out rather than guessing it.
--
-- REFUND_SENT_BY_BANK is the backer's message when finance records the bank
-- transfer that paid a refund. PAYOUT_SENT was already in the list (V26) and
-- had no producer until now.

ALTER TABLE payouts
    ADD COLUMN bank_transfer_account_hint text;

ALTER TABLE payouts
    ADD CONSTRAINT payouts_bank_transfer_account_hint_is_a_hint CHECK (
        bank_transfer_account_hint IS NULL
            OR length(btrim(bank_transfer_account_hint)) BETWEEN 1 AND 12);

COMMENT ON COLUMN payouts.bank_transfer_account_hint IS
    'The masked IBAN of the account opened to pay this by bank transfer (AZ21…1944), for the creator''s message. Never the number.';

ALTER TABLE notifications
    DROP CONSTRAINT notifications_type_known;
ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_known CHECK (
        type IN (
            'PLEDGE_CONFIRMED', 'PLEDGE_EDITED',
            'GOAL_REACHED', 'DEADLINE_48H', 'DEADLINE_24H',
            'CAMPAIGN_SUCCEEDED', 'CAMPAIGN_UNSUCCESSFUL', 'CAMPAIGN_EXTENDED', 'PROJECT_APPROVED',
            'UPDATE_DUE_SOON',
            'PAYMENT_COLLECTED', 'PAYMENT_FAILED', 'FINAL_PAYMENT_WARNING', 'PAYOUT_SENT',
            'WITHDRAWAL_REQUESTED', 'PAYOUT_DETAILS_NEEDED', 'REFUND_NEEDS_BANK_DETAILS',
            'REFUND_SENT_BY_BANK',
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
