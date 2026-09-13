-- IDN-EXT-01 (#42): the platform's own expense account.
--
-- §5.2: the cost of refunding backers is the platform's, "on its own expense account" rather than
-- netted against anybody's payout. This adds the account to V41's vocabulary so that a cost can be
-- posted to it. Nothing posts to it yet: Epoint's /reverse reports no fee, and a posting with no
-- matching transaction would put escrow and the record of what moved out of agreement.
--
-- -- Contract: none. The constraint is dropped and re-added to widen it; no column or table goes,
-- -- and every account the previous release writes is still admitted.
--
-- Reverse: check no entry names 'platform_expense', then restore V41's list.

ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_account_known;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_account_known CHECK (
    account IN ('escrow', 'platform_fee', 'psp_fee', 'tax_payable', 'refunds', 'platform_expense')
    OR account ~ '^creator:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);
