-- A payout destination may name the local SANDBOX provider. Issue #243.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DELETE FROM payout_destinations WHERE provider = 'SANDBOX';
--   ALTER TABLE payout_destinations DROP CONSTRAINT payout_destinations_provider_known;
--   ALTER TABLE payout_destinations ADD CONSTRAINT payout_destinations_provider_known
--       CHECK (provider IN ('PAYRIFF', 'EPOINT', 'AZERICARD'));
--
--   Lossy only for sandbox rows, which exist on a developer's machine and nowhere else.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none in the expand-then-contract sense. The constraint is replaced by a wider
-- one -- every row the old one accepted, the new one accepts -- so nothing a running
-- release writes is refused. No deployed environment can write SANDBOX: the adapter
-- refuses to start outside the local and test profiles.
-- ---------------------------------------------------------------------------
--
-- WHY
-- ---------------------------------------------------------------------------
--
-- V72 repeats `ProviderName` in the schema and a test keeps the two in step. #243 adds a
-- local-only provider so that a payout card can be registered on a developer's machine
-- before Epoint's keys exist, and the card it registers is filed here like any other.
-- When Epoint is configured and the sandbox is removed, the reverse above is the
-- migration that takes it back out.

ALTER TABLE payout_destinations DROP CONSTRAINT payout_destinations_provider_known;

ALTER TABLE payout_destinations ADD CONSTRAINT payout_destinations_provider_known
    CHECK (provider IN ('PAYRIFF', 'EPOINT', 'AZERICARD', 'SANDBOX'));
