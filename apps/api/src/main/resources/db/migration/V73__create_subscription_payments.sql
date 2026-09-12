-- What the platform has actually been paid for a subscription: one row per
-- payment received, append-only, with the plan it was for written onto it.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TRIGGER IF EXISTS subscription_payments_is_append_only ON subscription_payments;
--   DROP FUNCTION IF EXISTS subscription_payments_refuse_change();
--   DROP TABLE IF EXISTS subscription_payments;
--
--   Lossy, and worse than V62's reversal. V62 at least leaves the subscription
--   rows behind; this table is the only place the platform records that money
--   arrived for one, how much, in what, and on whose word. Nothing reconstructs
--   it: there is no provider-side record while #60 is unanswered, and
--   `subscriptions` holds a price but not a receipt. Export it before
--   reversing, and keep the export -- §22.1's seven years applies to a record
--   of money received whether or not this table survives.
--
--   Reversing is safe for the platform's behaviour. Nothing reads this table to
--   decide anything: the entitlement gate reads `subscriptions`, and the
--   revenue report is a screen that would simply be empty.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE JOURNAL AND NOT `transactions` AND `ledger_entries`
-- ---------------------------------------------------------------------------
--
-- V41's tables are about a backer's money moving through the platform, and the
-- shape says so: `transactions.project_id` is NOT NULL, and `ledger_entries`
-- may only post to the accounts its CHECK names -- escrow, platform_fee,
-- psp_fee, tax_payable, refunds, and a creator's own. A subscription payment
-- has no campaign and belongs to none of those accounts. Making it fit would
-- mean relaxing a NOT NULL and widening a CHECK on the two tables that hold
-- every pledge on the platform, to admit rows that are not pledges.
--
-- So this is its own journal, and the properties that matter are copied rather
-- than shared: append-only by trigger, numeric money, no floating point, and a
-- correction that is a new row rather than an edit.
--
-- ---------------------------------------------------------------------------
-- WHY THE PLAN IS WRITTEN ONTO THE ROW
-- ---------------------------------------------------------------------------
--
-- V62 makes a plan an ordinary editable row on purpose: an operator reprices,
-- renames or unlists one from the console without a deployment. That argument
-- holds, and it is exactly what makes a report that joins to
-- `subscription_plans` wrong. Rename Growth to Studio in November and every
-- March total is retitled; reprice it and a reader cannot tell which figure the
-- report meant. A report about the past must not change when the catalogue
-- changes.
--
-- `plan_id` is kept as well, so the report can still offer "this plan" as a
-- filter. But what it *displays* comes from the snapshot: `plan_code`,
-- `plan_name`, `amount`, `currency`, `billing_period`, all as they stood at the
-- moment somebody paid.
--
-- ---------------------------------------------------------------------------
-- WHY THERE ARE NO FOREIGN KEYS
-- ---------------------------------------------------------------------------
--
-- V21 takes this decision for `audit_logs` and states it as a preference for
-- outliving what it refers to. Here it is not a preference, it is the only
-- consistent choice, and it is worth writing down because the alternative looks
-- more correct:
--
--   * V62's `subscriptions.account_id` is ON DELETE CASCADE. A closed account
--     takes its subscription with it. A payment row with an ON DELETE CASCADE
--     key to that subscription would take the receipt as well -- money the
--     platform was paid, deleted because the payer closed their account.
--   * NO ACTION or RESTRICT instead would make account closure fail, so closing
--     an account would need a record of payment removed first. Same hole, with
--     an extra step and a member of staff standing in it.
--   * And either of them collides with the append-only trigger: a cascade
--     arrives as a DELETE on this table, the trigger refuses it, and the
--     account closure fails with an error about a table nobody was touching.
--
-- Identifiers without references, then. `account_id` and `subscription_id` are
-- what they say they are, and may point at rows that are gone -- which for a
-- record of money received is the correct behaviour, not a defect. The
-- application never dereferences them to render a total; it joins only when it
-- has something to join to, and shows the snapshot otherwise.
-- ---------------------------------------------------------------------------

CREATE TABLE subscription_payments (
    id uuid PRIMARY KEY,

    -- Which subscription it was paid against. Not a foreign key; see above.
    subscription_id uuid NOT NULL,

    -- Who paid. Denormalised from the subscription deliberately: this is the
    -- column "what has this account paid us" is asked on, and the subscription
    -- it would otherwise be read through is the row most likely to be gone.
    account_id uuid NOT NULL,

    -- ---------------------------------------------------------------------
    -- THE PLAN, AS IT STOOD
    -- ---------------------------------------------------------------------

    plan_id uuid NOT NULL,

    plan_code text NOT NULL
        CONSTRAINT subscription_payments_plan_code_shape CHECK (plan_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),

    plan_name text NOT NULL
        CONSTRAINT subscription_payments_plan_name_present CHECK (length(btrim(plan_name)) BETWEEN 1 AND 120),

    -- ---------------------------------------------------------------------
    -- THE MONEY
    -- ---------------------------------------------------------------------

    -- numeric(14,2), §7.2's shape for every money column here, and never double
    -- precision -- CLAUDE.md, and this is somebody's receipt.
    --
    -- Signed, and not as a convenience: a correction on an append-only table is
    -- a reversing row, so a refunded or mis-recorded payment is a second row
    -- carrying the negative. Which means every total on this table is a SUM
    -- that nets, and a report that filtered to positives would report revenue
    -- the platform has given back.
    --
    -- Zero is refused. A row saying nothing arrived is not a payment, and it
    -- would sit in the account's history as one.
    amount numeric(14, 2) NOT NULL
        CONSTRAINT subscription_payments_amount_not_zero CHECK (amount <> 0),

    currency text NOT NULL
        CONSTRAINT subscription_payments_currency_shape CHECK (currency ~ '^[A-Z]{3}$'),

    -- What was bought, monthly or yearly. Snapshotted with the rest of the plan
    -- because a total is not readable without it: 49 and 490 in the same column
    -- are not comparable figures, and the report separates them rather than
    -- adding them up.
    billing_period text NOT NULL
        CONSTRAINT subscription_payments_billing_period_known CHECK (billing_period IN ('MONTHLY', 'YEARLY')),

    -- How it arrived. Text with a CHECK rather than an enum type, for V19's
    -- reason: adding a value to an enum type cannot run in the same transaction
    -- as the statements using it.
    --
    -- A closed list, unlike `subscription_plans.code`, and the difference is who
    -- decides. An operator adds a plan; nobody adds a way of being paid without
    -- the platform learning to reconcile it. BANK_TRANSFER is the one that
    -- happens today -- an invoice and a transfer, which is what §9.2 leaves as
    -- the only mechanism while #60 is unanswered. CARD is here for when a
    -- provider lands, so that the row a callback writes needs no migration.
    method text NOT NULL
        CONSTRAINT subscription_payments_method_known CHECK (method IN ('BANK_TRANSFER', 'CARD', 'CASH', 'OTHER')),

    -- The transfer reference, the invoice number -- whatever makes this
    -- checkable against a bank statement. Optional, for the reason
    -- `Subscriptions.activate` gives: refusing an activation over a missing
    -- reference leaves a creator who has paid waiting while somebody looks one
    -- up.
    reference text
        CONSTRAINT subscription_payments_reference_length CHECK (
            reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 200),

    note text
        CONSTRAINT subscription_payments_note_length CHECK (note IS NULL OR length(note) <= 2000),

    -- ---------------------------------------------------------------------
    -- THE TWO INSTANTS, WHICH ARE NOT THE SAME
    -- ---------------------------------------------------------------------

    -- When the money arrived, which is the one every total is grouped by. Given
    -- by the caller and therefore backdatable: a transfer that cleared on the
    -- 31st and was recorded on the 3rd belongs in the month it cleared, or the
    -- report disagrees with the bank statement it is checked against.
    received_at timestamptz NOT NULL,

    -- When this row was written, assigned by the database. V21's argument, and
    -- it is the pair that makes backdating safe rather than silent: a row
    -- received on the 31st and recorded in March is visible as exactly that.
    recorded_at timestamptz NOT NULL DEFAULT now(),

    -- Who recorded it. Null means nobody did -- a provider callback, when #60
    -- lands. Not a foreign key, as above, so a former colleague's closed
    -- account does not blank the only name on a receipt.
    recorded_by uuid,

    -- ---------------------------------------------------------------------
    -- CORRECTIONS
    -- ---------------------------------------------------------------------
    --
    -- A row nothing may UPDATE is corrected by a row that reverses it, which is
    -- V41's convention for the ledger and the same convention here. This column
    -- is what makes a reversal identifiable as one rather than a second payment
    -- that happens to be negative.
    --
    -- **Nothing writes it in this release**, and the column ships anyway --
    -- V21's `on_behalf_of_id` argument, which applies exactly. Adding a column
    -- to a table nothing may UPDATE is the cheapest migration there is; adding a
    -- *meaning* to rows already written is not, because every row inserted
    -- before it would be indistinguishable from a genuine original payment, for
    -- ever. The totals already net, so the reversal path is a service method and
    -- an endpoint, with no schema change and no report change behind it.
    --
    -- A self-reference is a foreign key, which the section above argues against
    -- for every other column here. It is safe on this one and only this one:
    -- both rows are in this table, and nothing may delete from this table.
    reverses uuid REFERENCES subscription_payments (id) ON DELETE NO ACTION,

    -- A payment is reversed once. A second reversal of the same row would net to
    -- the negative of a payment nobody made.
    CONSTRAINT subscription_payments_reverses_once UNIQUE (reverses),

    -- A reversal of itself is a row that nets to zero and refers to nothing.
    CONSTRAINT subscription_payments_reverses_another CHECK (reverses IS NULL OR reverses <> id)
);

-- ---------------------------------------------------------------------------
-- APPEND-ONLY
-- ---------------------------------------------------------------------------
--
-- V21's mechanism, and its reasoning about why this is a trigger rather than a
-- revoked grant: a grant protects the table from a role, and the role that
-- writes here is the role that would do the editing.
--
-- Statement-level, so a single statement that would change a thousand rows is
-- refused once rather than a thousand times.
--
-- TRUNCATE is refused with the rest, which means **this table has no test
-- cleanup and cannot have one**. `SubscriptionPaymentSchemaTests` says so and
-- works the way every reader of this table has to: invent an identifier, assert
-- only about rows carrying it.
CREATE FUNCTION subscription_payments_refuse_change() RETURNS trigger
    LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'subscription_payments is append-only; % is refused', tg_op
        USING ERRCODE = 'restrict_violation',
              HINT = 'A payment is corrected by a reversing row, never by UPDATE or DELETE.';
END;
$$;

COMMENT ON FUNCTION subscription_payments_refuse_change() IS
    'Refuses any statement that would change or remove a record of money received. See V73.';

CREATE TRIGGER subscription_payments_is_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON subscription_payments
    FOR EACH STATEMENT EXECUTE FUNCTION subscription_payments_refuse_change();

-- ---------------------------------------------------------------------------
-- HOW IT IS READ
-- ---------------------------------------------------------------------------

-- The report: everything received between two instants. Leads on `received_at`
-- because the period is what is always known, and carries the grouping columns
-- so that the totals by plan and by currency are answered from the index rather
-- than from the heap.
CREATE INDEX subscription_payments_by_period
    ON subscription_payments (received_at, plan_code, currency);

-- "What has this account paid", which is the console's account page and the
-- creator's own receipts. Descending, because both start at the most recent.
CREATE INDEX subscription_payments_by_account
    ON subscription_payments (account_id, received_at DESC);

-- "What was paid against this subscription" -- one or two rows in the ordinary
-- case, and the question asked when somebody disputes a charge.
CREATE INDEX subscription_payments_by_subscription
    ON subscription_payments (subscription_id, received_at DESC);

COMMENT ON TABLE subscription_payments IS
    'Money received for subscriptions, append-only, with the plan as it stood when it was paid.';
