-- A creator's payout destination may be a bank account the platform holds,
-- encrypted. Issue #394, epic #392.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DELETE FROM payout_destinations WHERE provider = 'BANK_TRANSFER';
--   DROP INDEX IF EXISTS payout_destinations_bank_fingerprint_idx;
--   ALTER TABLE payout_destinations
--       DROP CONSTRAINT payout_destinations_account_only_for_bank_transfer,
--       DROP CONSTRAINT payout_destinations_account_is_whole,
--       DROP CONSTRAINT payout_destinations_account_nonce_length,
--       DROP CONSTRAINT payout_destinations_account_key_id_shape,
--       DROP COLUMN account_ciphertext,
--       DROP COLUMN account_nonce,
--       DROP COLUMN account_key_id;
--   ALTER TABLE payout_destinations DROP CONSTRAINT payout_destinations_provider_known;
--   ALTER TABLE payout_destinations ADD CONSTRAINT payout_destinations_provider_known
--       CHECK (provider IN ('PAYRIFF', 'EPOINT', 'AZERICARD', 'SANDBOX'));
--
--   Lossy, and worth naming: every creator who filed a bank account files it
--   again, and their verification is lost with it. Export before reversing.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Expand only. Nothing to contract.
-- ---------------------------------------------------------------------------
--
-- Three nullable columns, a widened constraint and three new ones that every
-- existing row already satisfies: no row the previous release wrote is refused,
-- and nothing the previous release reads changes shape.
--
-- A node still running the previous release, during the rollout, reads a
-- BANK_TRANSFER row as a destination issued by a provider it does not send
-- through -- `provider` is a string to it -- and refuses the payout as
-- PAYOUT_DESTINATION_PROVIDER_MISMATCH. That is the safe direction. If it
-- replaces such a row with a provider token it does not know to clear the
-- sealed account, and `payout_destinations_account_only_for_bank_transfer`
-- refuses the write rather than leave a token with somebody's IBAN beside it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS REVERSES, AND WHY
-- ---------------------------------------------------------------------------
--
-- V72's header is titled "THE PLATFORM STILL DOES NOT STORE AN IBAN", and
-- `PayoutRequest` gave the reason: bank details are the provider's to hold, and
-- a platform that stored an IBAN would have acquired a second class of
-- sensitive data with none of the SAQ A reasoning behind the first.
--
-- On 2026-10-12 the owner decided otherwise, for a reason V72 could not have
-- weighed: creators are paid by bank transfer, made by staff from IdeyaNest's
-- own account and recorded here, and the provider's payouts are not used. A
-- transfer needs the account it is made to, so the platform holds it. V72 is
-- left as it was written -- a migration that has run is history, and editing
-- it would change its checksum under every deployed database -- and this
-- header is where the reversal is recorded. `PayoutRequest`, `PayoutDestination`
-- and the column comment below say the same.
--
-- What does not change: an IBAN is not card data, so §17.2's SAQ A position is
-- untouched; and §17.4 already said how bank details are held -- "Encrypted;
-- only the last four digits are ever displayed". That is what this is.
--
-- ---------------------------------------------------------------------------
-- HOW THE ACCOUNT IS HELD
-- ---------------------------------------------------------------------------
--
-- `account_ciphertext`, `account_nonce`, `account_key_id`: the IBAN sealed by
-- the `bank-details` keyring (#393, `shared/crypto`), AES-256-GCM, with the
-- table and the creator's id as additional authenticated data -- a ciphertext
-- copied into another creator's row fails its tag instead of paying them.
-- V36's shape for shipping addresses, constraint for constraint: whole or
-- absent together, a twelve-byte nonce, a key label of the shape the keyring
-- accepts.
--
-- `provider` is 'BANK_TRANSFER', which is `ProviderName.BANK_TRANSFER` -- a
-- value that is not an adapter, so nothing can charge, refund or receive a
-- webhook through it. The sealed account is present exactly when the provider
-- says so, enforced here because the failure it guards against is silent: a
-- token filed over a bank account, with the old IBAN still sealed beside it.
--
-- `reference` stays NOT NULL and becomes, for a bank account, the IBAN's keyed
-- fingerprint: HMAC-SHA256 under a key derived from the same keyring, prefixed
-- with the key's label. Equal accounts give equal fingerprints, so "has another
-- creator filed this IBAN" is an indexed lookup; without the key it is useless,
-- which an unkeyed hash of a short, structured number would not be. The partial
-- index below serves exactly that lookup.
--
-- `display_hint` is the masked IBAN -- country, check digits, an ellipsis and
-- the last four, `AZ21…1944` -- nine characters, inside V72's ceiling of
-- twelve, which was set to refuse anything long enough to be an IBAN and still
-- does.

ALTER TABLE payout_destinations DROP CONSTRAINT payout_destinations_provider_known;

ALTER TABLE payout_destinations ADD CONSTRAINT payout_destinations_provider_known
    CHECK (provider IN ('PAYRIFF', 'EPOINT', 'AZERICARD', 'SANDBOX', 'BANK_TRANSFER'));

ALTER TABLE payout_destinations
    ADD COLUMN account_ciphertext bytea,
    ADD COLUMN account_nonce bytea,
    ADD COLUMN account_key_id text;

ALTER TABLE payout_destinations
    ADD CONSTRAINT payout_destinations_account_is_whole CHECK (
        (account_ciphertext IS NULL) = (account_nonce IS NULL)
            AND (account_ciphertext IS NULL) = (account_key_id IS NULL)
            AND (account_ciphertext IS NULL OR length(account_ciphertext) > 0)),
    ADD CONSTRAINT payout_destinations_account_nonce_length CHECK (
        account_nonce IS NULL OR length(account_nonce) = 12),
    ADD CONSTRAINT payout_destinations_account_key_id_shape CHECK (
        account_key_id IS NULL OR account_key_id ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
    ADD CONSTRAINT payout_destinations_account_only_for_bank_transfer CHECK (
        (provider = 'BANK_TRANSFER') = (account_ciphertext IS NOT NULL));

CREATE INDEX payout_destinations_bank_fingerprint_idx
    ON payout_destinations (reference)
    WHERE provider = 'BANK_TRANSFER';

COMMENT ON TABLE payout_destinations IS
    'Where a creator is paid (#432): a provider token, or since #394 a bank account held encrypted. Supplied by the creator and verified by COMPLIANCE, never a reference typed by whoever sends the money.';
COMMENT ON COLUMN payout_destinations.reference IS
    'A provider''s opaque token for the account, like stored_cards.token; for BANK_TRANSFER, the IBAN''s keyed fingerprint (<keyId>:<hmac>), never the IBAN. Never logged.';
COMMENT ON COLUMN payout_destinations.account_ciphertext IS
    'BANK_TRANSFER only (#394): the IBAN, AES-256-GCM under the bank-details keyring, with payout_destinations:<user_id> as additional data.';
COMMENT ON COLUMN payout_destinations.display_hint IS
    'How a person recognises the account: the provider''s mask, or for a bank account the IBAN''s country, check digits and last four (AZ21…1944).';
