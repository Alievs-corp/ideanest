-- IDN-EXT-01 (#43): a chargeback that arrives after the creator was paid.
--
-- §9.8: nothing is refunded through the platform after payout, but a bank chargeback does not ask. When
-- one is lost on a campaign that has already been paid out, the platform has returned the money and the
-- creator has kept it; the amount is the creator's debt, withheld from their future payouts, and their
-- account is blocked until it is repaid. If they never have another payout, the loss is the platform's
-- (§5.1's accepted risk).
--
-- Reverse: ALTER TABLE payouts DROP COLUMN debt_withheld; DROP TABLE creator_debts; -- once nothing
-- recorded is worth keeping.
--
-- -- Contract: none. A new table and a new column with a default; nothing the previous release reads
-- -- goes away.

CREATE TABLE creator_debts (
    id uuid PRIMARY KEY,

    creator_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE NO ACTION,

    -- The chargeback that created it. One debt per lost dispute.
    dispute_id uuid NOT NULL REFERENCES disputes (id) ON DELETE NO ACTION,

    -- The chargeback and its fee.
    amount numeric(14, 2) NOT NULL
        CONSTRAINT creator_debts_amount_is_positive CHECK (amount > 0),
    currency text NOT NULL
        CONSTRAINT creator_debts_currency_is_iso CHECK (currency ~ '^[A-Z]{3}$'),

    -- What later payouts have withheld towards it.
    recovered numeric(14, 2) NOT NULL DEFAULT 0
        CONSTRAINT creator_debts_recovered_is_not_negative CHECK (recovered >= 0),
    CONSTRAINT creator_debts_recovered_within_amount CHECK (recovered <= amount),

    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    CONSTRAINT creator_debts_settled_when_recovered CHECK ((settled_at IS NOT NULL) = (recovered = amount))
);

CREATE UNIQUE INDEX creator_debts_one_per_dispute ON creator_debts (dispute_id);

-- What a creator still owes, oldest first: the order debts are recovered in.
CREATE INDEX creator_debts_outstanding ON creator_debts (creator_id, created_at) WHERE settled_at IS NULL;

-- What a payout withheld towards the creator's debts. Stored beside the other deductions for their reason:
-- the creator is shown what was collected and each thing that came off it.
ALTER TABLE payouts
    ADD COLUMN debt_withheld numeric(14, 2) NOT NULL DEFAULT 0
        CONSTRAINT payouts_debt_withheld_is_not_negative CHECK (debt_withheld >= 0);
