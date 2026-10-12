-- A refund the provider can no longer carry out goes back by bank transfer.
-- Issue #399, epic #392.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   Check first: SELECT count(*) FROM refunds
--                 WHERE state IN ('AWAITING_BANK_DETAILS', 'AWAITING_TRANSFER');
--   and SELECT count(*) FROM refund_bank_transfers;
--   If both are zero:
--     DROP TABLE refund_bank_transfers;
--     ALTER TABLE refunds DROP CONSTRAINT refunds_state_known;
--     ALTER TABLE refunds ADD CONSTRAINT refunds_state_known
--         CHECK (state IN ('REQUESTED', 'SUCCEEDED', 'FAILED'));
--     ALTER TABLE refunds DROP CONSTRAINT refunds_settled_at_matches_state;
--     ALTER TABLE refunds ADD CONSTRAINT refunds_settled_at_matches_state
--         CHECK ((state = 'REQUESTED') = (settled_at IS NULL));
--     and restore V77's notifications_type_known without REFUND_NEEDS_BANK_DETAILS,
--     once no notification has that type.
--   If they are not, those refunds are owed to backers or were paid by hand;
--   they have to be settled first, and a row in refund_bank_transfers is the
--   only record of which account a backer was paid into.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none in the expand-then-contract sense. Three CHECKs are widened
-- (every row the old ones accepted, the new ones accept) and one table is new.
-- ---------------------------------------------------------------------------
--
-- The BEHAVIOUR for the minutes both releases run, which is why the switch is
-- configuration and not this file. `refunds.state` is read through an enum, and
-- a node of the previous release that loads a row in either new state fails to
-- map it. Nothing writes one until a deployment sets a refund window
-- (`ideanest.payment.refunds.windows.<provider>`, unset by default) or a member
-- of staff routes a refused refund to a bank transfer by hand, and neither is
-- to be done before every node runs this release. Even then the previous
-- release's jobs would not stop: the campaign-refunds sweep reads `refunds`
-- through native sums and asks only about REQUESTED rows by name, so what fails
-- is a console list on that node, never a job loop. Its sums read the new
-- states correctly: every one of them counts a refund that has not FAILED as
-- gone, and both new states are money owed back that has not left.
--
-- ---------------------------------------------------------------------------
-- THE TWO NEW STATES
-- ---------------------------------------------------------------------------
--
-- A provider reverses a card payment only within a window -- Payriff, thirty
-- days -- and a refund owed after it has nowhere to go but the backer's bank
-- account. On 2026-10-12 the owner decided how: the backer contacts support,
-- support records the account on the refund, and a member of finance makes the
-- transfer from IdeyaNest's own account and records it here. So a refund past
-- the window waits twice, for two different people:
--
--   AWAITING_BANK_DETAILS  owed, never sent to the provider, and the platform
--                          does not know where to send it
--   AWAITING_TRANSFER      support recorded the account; finance has not yet
--                          recorded the transfer
--
-- Neither is settled, so `settled_at` is null on both, as on REQUESTED. Both
-- leave by SUCCEEDED, when the transfer is recorded with the bank's reference.
-- Neither is FAILED: the money is owed, and every sum that decides what a
-- charge has left, what a payout may pay and whether a pledge may be raised
-- counts it as gone, exactly as it counts a REQUESTED one.
--
-- ---------------------------------------------------------------------------
-- refund_bank_transfers
-- ---------------------------------------------------------------------------
--
-- One row per refund paid by bank, written when support records the account.
-- The IBAN is sealed under the `bank-details` keyring (#393), AES-256-GCM, with
-- `refund_bank_transfers:<refund_id>` as additional authenticated data, so a
-- ciphertext copied onto another backer's refund fails its tag instead of
-- paying them. Any country's IBAN: a backer banks wherever they bank.
-- `iban_hint` is the masked form (`AZ21…1944`), and is what lists, logs and the
-- audit trail carry; the full number leaves only through an audited reveal.
--
-- `ticket_id` is the support conversation the account came from: a member of
-- staff does not type a backer's IBAN from nowhere. `details_recorded_by` and
-- `transfer_recorded_by` must be two different people, because the person who
-- writes down where the money goes must not also be the person who says it
-- went -- the separation V66 and #436 drew for a creator's payout destination,
-- here for a backer's refund.

ALTER TABLE refunds DROP CONSTRAINT refunds_state_known;
ALTER TABLE refunds ADD CONSTRAINT refunds_state_known CHECK (state IN (
    'REQUESTED', 'SUCCEEDED', 'FAILED', 'AWAITING_BANK_DETAILS', 'AWAITING_TRANSFER'));

ALTER TABLE refunds DROP CONSTRAINT refunds_settled_at_matches_state;
ALTER TABLE refunds ADD CONSTRAINT refunds_settled_at_matches_state CHECK (
    (state IN ('REQUESTED', 'AWAITING_BANK_DETAILS', 'AWAITING_TRANSFER')) = (settled_at IS NULL));

CREATE TABLE refund_bank_transfers (
    refund_id uuid PRIMARY KEY REFERENCES refunds (id) ON DELETE NO ACTION,

    iban_ciphertext bytea NOT NULL
        CONSTRAINT refund_bank_transfers_iban_present CHECK (length(iban_ciphertext) > 0),
    iban_nonce bytea NOT NULL
        CONSTRAINT refund_bank_transfers_iban_nonce_length CHECK (length(iban_nonce) = 12),
    iban_key_id text NOT NULL
        CONSTRAINT refund_bank_transfers_iban_key_id_shape CHECK (iban_key_id ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),

    -- V72's ceiling on a hint: long enough for a mask, too short for an IBAN.
    iban_hint text NOT NULL
        CONSTRAINT refund_bank_transfers_iban_hint_length CHECK (length(iban_hint) BETWEEN 1 AND 12),

    holder_name text NOT NULL
        CONSTRAINT refund_bank_transfers_holder_name_length CHECK (length(btrim(holder_name)) BETWEEN 1 AND 200),

    ticket_id uuid NOT NULL REFERENCES support_tickets (id) ON DELETE RESTRICT,

    details_recorded_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    details_recorded_at timestamptz NOT NULL,

    -- The transfer, once finance has made it: all four or none.
    bank_reference text
        CONSTRAINT refund_bank_transfers_bank_reference_length CHECK (
            bank_reference IS NULL OR length(btrim(bank_reference)) BETWEEN 1 AND 100),
    transferred_on date,
    transfer_recorded_by uuid REFERENCES users (id) ON DELETE RESTRICT,
    transfer_recorded_at timestamptz,

    CONSTRAINT refund_bank_transfers_transfer_is_whole CHECK (
        (bank_reference IS NULL) = (transferred_on IS NULL)
            AND (bank_reference IS NULL) = (transfer_recorded_by IS NULL)
            AND (bank_reference IS NULL) = (transfer_recorded_at IS NULL)),

    CONSTRAINT refund_bank_transfers_duties_are_separate CHECK (
        transfer_recorded_by IS NULL OR transfer_recorded_by <> details_recorded_by)
);

-- "Has this bank reference already been recorded for another backer's refund."
CREATE INDEX refund_bank_transfers_by_reference
    ON refund_bank_transfers (bank_reference)
    WHERE bank_reference IS NOT NULL;

COMMENT ON TABLE refund_bank_transfers IS
    'A refund paid by bank transfer because the provider''s refund window had closed (#399): the backer''s account, sealed, and the transfer that paid it.';
COMMENT ON COLUMN refund_bank_transfers.iban_ciphertext IS
    'The IBAN, AES-256-GCM under the bank-details keyring, with refund_bank_transfers:<refund_id> as additional data. Never logged.';
COMMENT ON COLUMN refund_bank_transfers.iban_hint IS
    'Country, check digits and last four (AZ21…1944): what a list, a log line or an audit row may carry instead of the IBAN.';

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
            'NEW_UPDATE_PUBLISHED', 'COMMENT_REPLY', 'DIRECT_MESSAGE',
            'SURVEY_AVAILABLE', 'SURVEY_OVERDUE', 'REWARD_SHIPPED',
            'FOLLOWED_CREATOR_LAUNCHED', 'LAUNCH_REMINDER', 'SAVED_PROJECT_ENDING_SOON',
            'NEW_DEVICE_SIGN_IN'));
