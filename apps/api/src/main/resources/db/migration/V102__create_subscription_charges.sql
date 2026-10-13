-- A creator plan paid by card on the provider's page -- issue #449, epic #448.
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE IF EXISTS subscription_charges;
--
--   Nothing outside the payment module reads it. The money a settled row stands
--   for is also on `subscription_payments` (V73), which is the receipt; this
--   table is only the page that took it, so dropping it loses which provider
--   order paid which period, not what was paid.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. A new table the previous release neither writes nor reads.
-- ---------------------------------------------------------------------------
--
-- WHY NOT `transactions`. That table is a pledge's money: `pledge_id` and
-- `project_id` are required, the ledger reconciliation sums it against escrow,
-- and a plan's price is neither held in escrow nor owed to a creator. Putting a
-- subscription there would mean either a fake pledge or a reconciliation that
-- has to learn to skip rows.
--
-- WHY A ROW THAT CHANGES. Unlike `transactions`, nothing here is the record of
-- money: `subscription_payments` is, and it is append-only. This row is the
-- page's life -- opened, then paid, failed or paid for a subscription that could
-- no longer take it -- and the sweep's bookkeeping lives on it too.
--
-- `subscription_id` is not a foreign key, for V73's reason: an account closed
-- after paying cascades its subscriptions away, and the record of the page that
-- took its money must outlive that.

CREATE TABLE subscription_charges (
    id                      uuid        PRIMARY KEY,
    subscription_id         uuid        NOT NULL,
    account_id              uuid        NOT NULL,

    -- What the payment is for when it was opened. Settlement does not trust it:
    -- the subscription's state at that moment decides, so a first period paid
    -- twice becomes a first period and a renewal rather than a refusal.
    purpose                 text        NOT NULL
        CONSTRAINT subscription_charges_purpose_known CHECK (purpose IN ('FIRST_PERIOD', 'RENEWAL')),

    amount                  numeric(14, 2) NOT NULL
        CONSTRAINT subscription_charges_amount_positive CHECK (amount > 0),
    currency                text        NOT NULL
        CONSTRAINT subscription_charges_currency_shape CHECK (currency ~ '^[A-Z]{3}$'),

    provider                text        NOT NULL,
    provider_transaction_id text        NOT NULL,
    -- Where the creator was sent, so a second click while the page is still open
    -- returns them to it instead of opening a second order they could also pay.
    payment_url             text        NOT NULL,

    status                  text        NOT NULL
        CONSTRAINT subscription_charges_status_known
            CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'UNAPPLIED')),

    opened_at               timestamptz NOT NULL,
    settled_at              timestamptz,
    -- The sweep's stamp (#353's arrangement): when the provider was last asked
    -- about a page whose callback never came, so an abandoned page goes to the
    -- back of the queue.
    checked_at              timestamptz,
    -- The provider's answer that settled it, redacted by the adapter.
    raw_response            text,

    CONSTRAINT subscription_charges_order_once UNIQUE (provider, provider_transaction_id),
    CONSTRAINT subscription_charges_settled_has_a_time
        CHECK ((status = 'PENDING') = (settled_at IS NULL))
);

CREATE INDEX subscription_charges_pending
    ON subscription_charges (opened_at)
    WHERE status = 'PENDING';

CREATE INDEX subscription_charges_by_subscription
    ON subscription_charges (subscription_id, opened_at DESC);

COMMENT ON TABLE subscription_charges IS
    'Payment pages opened for creator plans, and how each one settled. The receipt is subscription_payments. See V102.';
