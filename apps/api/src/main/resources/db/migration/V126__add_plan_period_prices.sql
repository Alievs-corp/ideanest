-- Every plan sold for one, six or twelve months, each at a price of its own (#655).
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   DROP TABLE subscription_plan_prices;
--   -- Only once no row holds SEMIANNUAL, which the three constraints below then refuse:
--   ALTER TABLE subscription_plans
--       DROP CONSTRAINT subscription_plans_billing_period_known,
--       ADD CONSTRAINT subscription_plans_billing_period_known
--           CHECK (billing_period IN ('MONTHLY', 'YEARLY'));
--   ALTER TABLE subscriptions
--       DROP CONSTRAINT subscriptions_billing_period_known,
--       ADD CONSTRAINT subscriptions_billing_period_known
--           CHECK (billing_period IN ('MONTHLY', 'YEARLY'));
--   ALTER TABLE subscription_payments
--       DROP CONSTRAINT subscription_payments_billing_period_known,
--       ADD CONSTRAINT subscription_payments_billing_period_known
--           CHECK (billing_period IN ('MONTHLY', 'YEARLY'));
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. The three DROP CONSTRAINTs below are not the contract half of
-- anything: each is dropped and re-added in the same statement, wider, so no
-- value the previous release writes is refused and no moment exists without a
-- check. The previous release does not map `subscription_plan_prices` and keeps
-- writing `subscription_plans.price` and `billing_period`, which still mean the
-- shortest period on sale -- the meaning this release keeps them to.
--
-- During a rolling deployment the previous release cannot read a SEMIANNUAL row
-- (its enum has no such value). None exists until this release sells one, and a
-- creator choosing six months is served by an instance that can.
-- ---------------------------------------------------------------------------
--
-- WHY A TABLE, AND WHY THE OLD COLUMNS STAY. A plan now has up to three prices.
-- `subscription_plans.price` and `billing_period` keep describing the shortest
-- period the plan is sold for, so every reader written before this change -- the
-- revenue report, the reminder e-mail, an older client reading `price` -- still
-- reads a true sentence about the plan. The application keeps the two in step:
-- `SubscriptionPlan.reprice` is the only writer of either.
--
-- What a creator agreed to pay is still copied onto their own `subscriptions`
-- row at purchase (V62), with the period they chose. Editing a row here reaches
-- nobody who has already bought.
--
-- The currency is the plan's, deliberately not repeated per row: a plan with two
-- currencies in it is a comparison nobody can make honestly.

ALTER TABLE subscription_plans
    DROP CONSTRAINT subscription_plans_billing_period_known,
    ADD CONSTRAINT subscription_plans_billing_period_known
        CHECK (billing_period IN ('MONTHLY', 'SEMIANNUAL', 'YEARLY'));

ALTER TABLE subscriptions
    DROP CONSTRAINT subscriptions_billing_period_known,
    ADD CONSTRAINT subscriptions_billing_period_known
        CHECK (billing_period IN ('MONTHLY', 'SEMIANNUAL', 'YEARLY'));

ALTER TABLE subscription_payments
    DROP CONSTRAINT subscription_payments_billing_period_known,
    ADD CONSTRAINT subscription_payments_billing_period_known
        CHECK (billing_period IN ('MONTHLY', 'SEMIANNUAL', 'YEARLY'));

CREATE TABLE subscription_plan_prices (
    -- Cascades, unlike V62's subscriptions -> plans. A plan is never deleted by
    -- the application (it is unlisted instead); a fixture or support script that
    -- deletes one it added means its prices too.
    plan_id uuid NOT NULL REFERENCES subscription_plans (id) ON DELETE CASCADE,

    billing_period text NOT NULL
        CONSTRAINT subscription_plan_prices_period_known
            CHECK (billing_period IN ('MONTHLY', 'SEMIANNUAL', 'YEARLY')),

    -- numeric(14,2), V62's shape for every money column. Zero is a free period.
    price numeric(14, 2) NOT NULL
        CONSTRAINT subscription_plan_prices_price_sane CHECK (price >= 0),

    PRIMARY KEY (plan_id, billing_period)
);

-- Every plan's own price, for its own period.
INSERT INTO subscription_plan_prices (plan_id, billing_period, price)
SELECT id, billing_period, price
  FROM subscription_plans;

-- Six and twelve months for every monthly plan, at six and twelve times the
-- monthly price. No discount: that is the owner's to set from the console.
INSERT INTO subscription_plan_prices (plan_id, billing_period, price)
SELECT id, 'SEMIANNUAL', price * 6
  FROM subscription_plans
 WHERE billing_period = 'MONTHLY';

INSERT INTO subscription_plan_prices (plan_id, billing_period, price)
SELECT id, 'YEARLY', price * 12
  FROM subscription_plans
 WHERE billing_period = 'MONTHLY';
