-- #171: raising a paid pledge while its campaign is taking pledges, and charging the difference.
--
-- Since IDN-EXT-01 (#39) a pledge is charged when it is made and is COLLECTED from then on, so
-- §4.5's PL-09 edit -- which only moves DRAFT and CONFIRMED pledges -- no longer reaches the pledge
-- almost every backer holds. A raise is PL-09 for a paid pledge: a new selection, re-quoted, that
-- must cost more than the old one, with the difference charged on the provider's page exactly as
-- the confirmation charge is. The pledge changes only once the provider says the difference was
-- paid, so the raise has to be written down somewhere between the two requests. That is this table.
--
-- One row per attempt, never updated into a different attempt:
--
--   PENDING    the page was opened; the places the new selection needs are held as RESERVED
--   SUCCEEDED  paid for and applied: the pledge carries the new selection and total
--   FAILED     the provider said the payment failed; nothing changed, the held places went back
--   EXPIRED    nobody paid within the payment window; the held places went back. Not final: a
--              payment that arrives later is still applied if nothing has changed since
--   ABANDONED  the page could not be opened at all; nothing was charged
--   UNAPPLIED  the provider took the money and the raise could no longer be applied -- the pledge
--              was refunded, changed by a later raise, or the places are gone. The charge is owed
--              back, and the campaign-refunds job returns it (RAISE_NOT_APPLIED, below)
--
-- Reverse: DROP TABLE pledge_raise_lines; DROP TABLE pledge_raises; and restore the two refund
-- constraints below without RAISE_NOT_APPLIED -- once no row uses it.
--
-- -- Contract: none. Two new tables, and two CHECK constraints that accept one more value; nothing
-- -- the previous release reads or writes goes away, so this is safe under a rolling deployment.

CREATE TABLE pledge_raises (
    id                  uuid           PRIMARY KEY,
    pledge_id           uuid           NOT NULL,
    -- Denormalised from the pledge, and composite-keyed below so it cannot name another campaign.
    project_id          uuid           NOT NULL,
    state               text           NOT NULL DEFAULT 'PENDING',

    -- The idempotency key of the provider charge that pays for this raise:
    -- transactions.idempotency_key, and the order identifier the provider was given. Derived from
    -- this row's id by the service, never from a client, so a settled charge finds its raise.
    charge_key          text           NOT NULL,

    -- pledges.version when the raise was quoted. The raise is applied only to the pledge it was
    -- priced against: anything that moved the pledge since -- another raise, a refund, a
    -- post-campaign upgrade -- makes the difference that was charged a difference from something
    -- that no longer exists.
    base_version        bigint         NOT NULL,

    from_reward_tier_id uuid,
    to_reward_tier_id   uuid,
    shipping_country    text,

    -- The new selection, quoted: the five parts pledges stores, as they will be written.
    base_amount         numeric(14, 2) NOT NULL,
    addons_amount       numeric(14, 2) NOT NULL,
    bonus_amount        numeric(14, 2) NOT NULL,
    shipping_amount     numeric(14, 2) NOT NULL,
    tax_amount          numeric(14, 2) NOT NULL,

    -- The pledge's total before, the total after, and the difference charged.
    from_total          numeric(14, 2) NOT NULL,
    to_total            numeric(14, 2) NOT NULL,
    amount              numeric(14, 2) NOT NULL,
    currency            text           NOT NULL,

    -- Until when the held places are kept for this raise. The payment window the confirmation
    -- charge uses (ideanest.pledge.reservation.payment-window).
    hold_expires_at     timestamptz    NOT NULL,
    -- When the row last left PENDING. An EXPIRED raise that is paid for later moves again.
    ended_at            timestamptz,
    created_at          timestamptz    NOT NULL DEFAULT now(),

    CONSTRAINT pledge_raises_pledge_fkey
        FOREIGN KEY (pledge_id, project_id) REFERENCES pledges (id, project_id) ON DELETE CASCADE,
    CONSTRAINT pledge_raises_state_known CHECK (
        state IN ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'ABANDONED', 'UNAPPLIED')
    ),
    -- A raise raises. Equal is refused too: a charge for nothing is not a payment.
    CONSTRAINT pledge_raises_amount_is_positive CHECK (amount > 0),
    CONSTRAINT pledge_raises_amount_is_the_difference CHECK (to_total = from_total + amount),
    CONSTRAINT pledge_raises_parts_add_up CHECK (
        to_total = base_amount + addons_amount + bonus_amount + shipping_amount + tax_amount
    ),
    CONSTRAINT pledge_raises_parts_are_not_negative CHECK (
        base_amount >= 0 AND addons_amount >= 0 AND bonus_amount >= 0
            AND shipping_amount >= 0 AND tax_amount >= 0
    ),
    CONSTRAINT pledge_raises_currency_shape CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT pledge_raises_charge_key_length CHECK (length(btrim(charge_key)) BETWEEN 8 AND 255),
    CONSTRAINT pledge_raises_ended_matches_state CHECK ((state = 'PENDING') = (ended_at IS NULL))
);

-- One raise in flight per pledge. The service refuses a second while the first is held, and this
-- is what makes two simultaneous requests unable to both open a page.
CREATE UNIQUE INDEX pledge_raises_one_pending_per_pledge ON pledge_raises (pledge_id) WHERE state = 'PENDING';

CREATE UNIQUE INDEX pledge_raises_charge_key_key ON pledge_raises (charge_key);

CREATE INDEX pledge_raises_pledge_idx ON pledge_raises (pledge_id, created_at DESC);

-- What the reservation cleaner walks every minute.
CREATE INDEX pledge_raises_lapsed_idx ON pledge_raises (hold_expires_at) WHERE state = 'PENDING';

COMMENT ON TABLE pledge_raises IS
    '#171: raising a COLLECTED pledge while its campaign takes pledges. The difference is charged on the provider page; the pledge changes when it is paid.';

CREATE TABLE pledge_raise_lines (
    raise_id       uuid    NOT NULL REFERENCES pledge_raises (id) ON DELETE CASCADE,
    -- ADDON: an add-on line of the new selection, as pledge_addons will hold it.
    -- HOLD:  places reserved on a tier for this raise while it is PENDING -- what the new selection
    --        needs beyond what the pledge already holds. Stored rather than recomputed, because by
    --        the time a hold is given back the pledge may no longer be the one it was computed from.
    kind           text    NOT NULL,
    reward_tier_id uuid    NOT NULL,
    quantity       integer NOT NULL,
    CONSTRAINT pledge_raise_lines_pkey PRIMARY KEY (raise_id, kind, reward_tier_id),
    CONSTRAINT pledge_raise_lines_kind_known CHECK (kind IN ('ADDON', 'HOLD')),
    CONSTRAINT pledge_raise_lines_quantity_is_positive CHECK (quantity >= 1)
);

COMMENT ON TABLE pledge_raise_lines IS
    '#171: the add-on lines of a raise''s new selection, and the places it holds while it is pending.';

-- A raise the provider was paid for and that could not be applied is refunded by the platform, with
-- no member of staff behind it -- the same shape V76 allowed for a failed or halted campaign.
ALTER TABLE refunds DROP CONSTRAINT refunds_reason_known;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_known CHECK (reason IN (
    'BACKER_REQUEST', 'CAMPAIGN_HALTED', 'CAMPAIGN_FAILED', 'FULFILMENT_FAILURE', 'DUPLICATE_CHARGE',
    'PLATFORM_ERROR', 'DISPUTE_CONCEDED', 'FRAUD', 'RAISE_NOT_APPLIED'));

ALTER TABLE refunds DROP CONSTRAINT refunds_system_refunds_are_campaign_refunds;
ALTER TABLE refunds ADD CONSTRAINT refunds_system_refunds_are_campaign_refunds CHECK (
    requested_by IS NOT NULL OR reason IN ('CAMPAIGN_FAILED', 'CAMPAIGN_HALTED', 'RAISE_NOT_APPLIED')
);

-- A refund reverses one charge. A raised pledge has more than one, so "has this charge been
-- refunded" is now asked per charge.
CREATE INDEX refunds_by_charge ON refunds (charge_transaction_id) WHERE charge_transaction_id IS NOT NULL;
