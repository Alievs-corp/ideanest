-- Pledges, and the money that followed them.
--
-- HOW MANY BACKERS EACH CAMPAIGN GETS IS DERIVED, NOT TYPED. A funding
-- percentage is the number a visitor actually reads, so this file states the
-- percentage it wants and works backwards to a headcount through the weighted
-- average of that campaign's own reward tiers. Typing "620 backers" instead
-- would mean re-deriving the percentage by hand every time a tier price
-- changed, and the two would drift apart the first time nobody bothered.
--
-- The weights are the shape of a real tier list: the second-cheapest tier takes
-- the largest share, the top tier takes almost none.

-- ONE TRANSACTION, AND IT HAS TO BE. ledger_entries carries a deferred
-- constraint trigger that checks each transaction's postings sum to zero at
-- COMMIT. Under psql's autocommit every INSERT would be its own transaction,
-- and the first one -- the escrow debits, with no matching credits yet -- would
-- fail on its own. The temp tables want the same scope.
BEGIN;

CREATE TEMP TABLE seed_targets (project_key text, pct numeric, pledge_state text) ON COMMIT DROP;
INSERT INTO seed_targets VALUES
  ('tumar',    1.42, 'CONFIRMED'),
  ('qala',     0.78, 'CONFIRMED'),
  ('qehve',    0.96, 'CONFIRMED'),
  ('naringi',  1.18, 'CONFIRMED'),
  ('tar',      0.41, 'CONFIRMED'),
  ('ipek',     0.63, 'CONFIRMED'),
  ('kelagayi', 0.34, 'CONFIRMED'),
  ('usta',     1.12, 'COLLECTED'),
  ('foto',     1.25, 'COLLECTED'),
  ('komiks',   0.22, 'EXPIRED'),
  ('albom',    1.13, 'COLLECTED'),
  ('qab',      1.30, 'FULFILLED'),
  ('lampa',    1.20, 'FULFILLED'),
  ('masa',     1.18, 'COLLECTED'),
  ('saxta',    0.04, 'CONFIRMED'),
  ('legv',     0.19, 'CANCELED_BY_PROJECT'),
  -- The six 02b adds. A campaign three days old should not be at 90%.
  ('torpaq',   0.58, 'CONFIRMED'),
  ('divar',    0.71, 'CONFIRMED'),
  ('gece',     0.29, 'CONFIRMED'),
  ('seyyah',   1.06, 'CONFIRMED'),
  ('sebeke',   0.11, 'CONFIRMED'),
  ('yalli',    0.44, 'CONFIRMED');

CREATE TEMP TABLE seed_pledge_plan ON COMMIT DROP AS
WITH targets AS (
    SELECT t.pct, t.pledge_state, p.id AS project_id, p.slug, p.goal_amount,
           p.launched_at, p.deadline, p.state AS project_state
    FROM seed_targets t
    JOIN projects p ON p.id = seed_id('project:' || t.project_key)
),
-- Add-ons and secret tiers are not what a backer picks as their pledge, so they
-- are not in the pool the weighted choice draws from.
pool AS (
    SELECT rt.project_id, rt.id AS tier_id, rt.amount, rt.shipping_type,
           row_number() OVER (PARTITION BY rt.project_id ORDER BY rt.amount, rt.id) - 1 AS pos
    FROM reward_tiers rt
    WHERE NOT rt.is_addon AND NOT rt.is_secret
),
weighted AS (
    SELECT pool.*, (ARRAY[26, 38, 22, 9, 4, 1])[LEAST(pool.pos, 5) + 1]::numeric AS w FROM pool
),
cumulative AS (
    SELECT w.*,
           sum(w.w) OVER (PARTITION BY w.project_id ORDER BY w.pos, w.tier_id) AS cw,
           sum(w.w) OVER (PARTITION BY w.project_id) AS tw
    FROM weighted w
),
expected AS (
    SELECT project_id, sum(w * amount) / sum(w) AS avg_amount FROM weighted GROUP BY project_id
),
headcount AS (
    SELECT t.*, e.avg_amount,
           LEAST(900, GREATEST(6, ceil(t.goal_amount * t.pct / e.avg_amount)::int)) AS backers
    FROM targets t JOIN expected e ON e.project_id = t.project_id
),
-- Every backer account is a candidate for every campaign; the ordering is a
-- hash of the pair, so campaign A and campaign B draw different crowds and both
-- draw the same crowd on the next machine.
candidates AS (
    SELECT h.project_id, h.slug, h.pledge_state, h.project_state, h.launched_at, h.deadline,
           u.id AS backer_id,
           row_number() OVER (PARTITION BY h.project_id
                              ORDER BY seed_rand(h.slug || ':' || u.id::text)) AS rn,
           h.backers
    FROM headcount h
    CROSS JOIN (SELECT id FROM users WHERE email LIKE 'backer%@example.az') u
),
chosen AS (
    SELECT c.*, seed_rand('tier:' || c.slug || ':' || c.backer_id::text) AS r
    FROM candidates c WHERE c.rn <= c.backers
)
SELECT DISTINCT ON (ch.project_id, ch.backer_id)
    ch.project_id, ch.backer_id, ch.slug, ch.pledge_state, ch.project_state,
    ch.launched_at, ch.deadline, ch.rn,
    cu.tier_id, cu.amount, cu.shipping_type
FROM chosen ch
JOIN cumulative cu ON cu.project_id = ch.project_id AND cu.cw / cu.tw > ch.r
ORDER BY ch.project_id, ch.backer_id, cu.cw;

-- ── The pledges themselves ──────────────────────────────────────────────────

INSERT INTO pledges (
    id, project_id, backer_id, reward_tier_id, state,
    base_amount, addons_amount, bonus_amount, shipping_amount, tax_amount, currency,
    shipping_country, is_anonymous, is_late_pledge, referrer_code, idempotency_key,
    reservation_expires_at, confirmed_at, collected_at, canceled_at,
    next_charge_attempt_at, charge_window_ends_at, charge_attempts,
    version, created_at, updated_at)
SELECT
    seed_id('pledge:' || pp.slug || ':' || pp.backer_id::text),
    pp.project_id,
    pp.backer_id,
    pp.tier_id,
    -- The stored-card collection at close, and its CHARGE_PENDING and CHARGE_FAILED
    -- pledges, went with #45: a pledge is paid when it is made.
    pp.pledge_state,
    pp.amount,
    0,
    -- A seventh of backers round their pledge up.
    CASE WHEN pp.rn % 7 = 0 THEN (5 + (pp.rn % 4) * 5)::numeric ELSE 0 END,
    CASE WHEN pp.shipping_type IN ('NONE', 'DIGITAL') THEN 0
         WHEN pp.shipping_type = 'LOCAL_PICKUP' THEN 0
         WHEN pp.shipping_type = 'INTERNATIONAL' AND pp.rn % 11 = 0 THEN 26
         ELSE 6 END,
    0,
    'AZN',
    CASE WHEN pp.shipping_type IN ('NONE', 'DIGITAL') THEN NULL
         WHEN pp.shipping_type = 'INTERNATIONAL' AND pp.rn % 11 = 0
              THEN (ARRAY['TR', 'GE', 'DE'])[1 + (pp.rn % 3)]
         ELSE 'AZ' END,
    pp.rn % 12 = 0,
    -- No late pledges (IDN-EXT-01, #45).
    false,
    CASE WHEN pp.rn % 5 = 0
         THEN (ARRAY['instagram', 'telegram', 'newsletter', 'friend'])[1 + (pp.rn % 4)]
         ELSE NULL END,
    'seed-' || substr(md5(pp.slug || pp.backer_id::text), 1, 24),
    NULL,
    pp.launched_at + (pp.deadline - pp.launched_at) * seed_rand('when:' || pp.slug || pp.backer_id::text),
    CASE WHEN pp.pledge_state IN ('COLLECTED', 'FULFILLED')
         THEN pp.deadline + interval '2 days' ELSE NULL END,
    CASE WHEN pp.pledge_state = 'CANCELED_BY_PROJECT' THEN pp.deadline ELSE NULL END,
    NULL,
    NULL,
    0,
    1,
    pp.launched_at + (pp.deadline - pp.launched_at) * seed_rand('when:' || pp.slug || pp.backer_id::text),
    now()
FROM seed_pledge_plan pp
ON CONFLICT (id) DO NOTHING;

-- Add-ons, on the campaigns that sell one.
INSERT INTO pledge_addons (pledge_id, reward_tier_id, project_id, quantity)
SELECT p.id, seed_id('tier:tumar:qelem'), p.project_id, 1 + (seed_rand('addon:' || p.id::text) * 2)::int
FROM pledges p
WHERE p.project_id = seed_id('project:tumar')
  AND p.reward_tier_id IN (seed_id('tier:tumar:bir'), seed_id('tier:tumar:ucluk'))
  AND seed_rand('addon:' || p.id::text) < 0.28
ON CONFLICT (pledge_id, reward_tier_id) DO NOTHING;

UPDATE pledges p SET addons_amount = a.total
FROM (SELECT pa.pledge_id, sum(rt.amount * pa.quantity) AS total
      FROM pledge_addons pa JOIN reward_tiers rt ON rt.id = pa.reward_tier_id
      GROUP BY pa.pledge_id) a
WHERE a.pledge_id = p.id AND p.addons_amount <> a.total;

-- ── The named accounts pledge too ───────────────────────────────────────────
--
-- The generated crowd above is drawn only from backer%@example.az, so without
-- this block `backer@ideanest.az` -- the account the README sends people to --
-- signs in to an empty /pledges, an empty /account/deliveries and an empty
-- survey list. Saves and follows alone are not what that account is for.
--
-- Amounts and shipping are read from the tier rather than typed beside it, so a
-- price change cannot leave a pledge disagreeing with the reward it bought.

INSERT INTO pledges (
    id, project_id, backer_id, reward_tier_id, state,
    base_amount, addons_amount, bonus_amount, shipping_amount, tax_amount, currency,
    shipping_country, is_anonymous, is_late_pledge, referrer_code, idempotency_key,
    reservation_expires_at, confirmed_at, collected_at, canceled_at,
    next_charge_attempt_at, charge_window_ends_at, charge_attempts,
    version, created_at, updated_at)
SELECT
    seed_id('pledge:demo:' || d.account || ':' || d.campaign),
    p.id,
    seed_id('user:' || d.account),
    rt.id,
    d.state,
    rt.amount,
    0,
    d.bonus,
    CASE WHEN rt.shipping_type IN ('NONE', 'DIGITAL', 'LOCAL_PICKUP') THEN 0 ELSE 6 END,
    0,
    'AZN',
    CASE WHEN rt.shipping_type IN ('NONE', 'DIGITAL') THEN NULL ELSE 'AZ' END,
    false,
    d.state = 'COLLECTED' AND d.campaign = 'masa',
    d.referrer,
    'seed-demo-' || d.account || '-' || d.campaign,
    NULL,
    p.launched_at + (p.deadline - p.launched_at) * 0.4,
    CASE WHEN d.state IN ('COLLECTED', 'FULFILLED') THEN p.deadline + interval '2 days' END,
    NULL,
    NULL, NULL, 0,
    1,
    p.launched_at + (p.deadline - p.launched_at) * 0.4,
    now()
FROM (VALUES
    -- Nurlan is the demo backer: six pledges spread so that every account
    -- screen has something on it -- live pledges, a delivery, a survey.
    ('backer',  'tumar',   'tier:tumar:bir',        'CONFIRMED', 10, 'instagram'),
    ('backer',  'qala',    'tier:qala:kolleksiya',  'CONFIRMED',  0, NULL),
    ('backer',  'qab',     'tier:qab:bir',          'FULFILLED',  0, NULL),
    ('backer',  'albom',   'tier:albom:vinil',      'COLLECTED',  5, 'telegram'),
    ('backer',  'lampa',   'tier:lampa:bir',        'FULFILLED',  0, NULL),
    ('backer',  'masa',    'tier:masa:oyun',        'COLLECTED',  0, NULL),
    -- Aygün's support ticket is about a double charge on the album, so she has
    -- to have backed the album.
    ('aygun',   'naringi', 'tier:naringi:ikilik',   'CONFIRMED',  0, NULL),
    ('aygun',   'albom',   'tier:albom:vinil',      'COLLECTED',  0, NULL),
    ('aygun',   'usta',    'tier:usta:usb',         'COLLECTED',  0, 'newsletter'),
    ('lale',    'qala',    'tier:qala:reqemsal',    'CONFIRMED',  0, NULL),
    ('lale',    'masa',    'tier:masa:deluxe',      'COLLECTED',  0, NULL),
    ('lale',    'seyyah',  'tier:seyyah:cap',       'CONFIRMED',  0, NULL),
    -- Fərid's ticket is about an undelivered Ağ Qab parcel. Same reason.
    ('ferid',   'qab',     'tier:qab:bir',          'FULFILLED',  0, NULL),
    ('ferid',   'qehve',   'tier:qehve:abune3',     'CONFIRMED',  0, NULL),
    ('nezrin',  'tar',     'tier:tar:adapter',      'CONFIRMED',  0, NULL),
    ('nezrin',  'albom',   'tier:albom:konsert',    'COLLECTED',  0, NULL),
    ('emin',    'qala',    'tier:qala:beta',        'CONFIRMED',  0, NULL),
    ('emin',    'torpaq',  'tier:torpaq:bir',       'CONFIRMED',  0, NULL),
    ('zaur',    'qehve',   'tier:qehve:torba',      'CONFIRMED',  0, NULL),
    ('zaur',    'foto',    'tier:foto:albom',       'COLLECTED',  0, NULL),
    ('samir',   'qala',    'tier:qala:reqemsal',    'CONFIRMED',  0, NULL),
    ('samir',   'divar',   'tier:divar:cap',        'CONFIRMED',  0, NULL),
    ('collab',  'tumar',   'tier:tumar:ucluk',      'CONFIRMED',  0, NULL)
) AS d(account, campaign, tier, state, bonus, referrer)
JOIN projects p ON p.id = seed_id('project:' || d.campaign)
JOIN reward_tiers rt ON rt.id = seed_id(d.tier)
ON CONFLICT (id) DO NOTHING;

-- ── Charges ─────────────────────────────────────────────────────────────────
--
-- One succeeded charge per pledge whose money actually moved, plus the failed
-- attempts sitting behind every CHARGE_FAILED pledge. The payments console
-- reads this table directly, and a console with only successes in it is a
-- console nobody has ever debugged with.

INSERT INTO transactions (
    id, pledge_id, project_id, type, status, amount, currency, provider,
    provider_transaction_id, attempt_number, idempotency_key, created_at)
SELECT
    seed_id('txn:charge:' || p.id::text), p.id, p.project_id, 'CHARGE', 'SUCCEEDED',
    p.total_amount, p.currency, CASE WHEN seed_rand('psp:' || p.id::text) < 0.75 THEN 'PAYRIFF' ELSE 'EPOINT' END,
    'ch_' || substr(md5(p.id::text), 1, 24), 1,
    'charge-' || substr(md5(p.id::text), 1, 24),
    coalesce(p.collected_at, p.created_at + interval '1 hour')
FROM pledges p
WHERE p.state IN ('COLLECTED', 'FULFILLED')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (
    id, pledge_id, project_id, type, status, amount, currency, provider,
    provider_transaction_id, failure_code, failure_message, attempt_number,
    idempotency_key, created_at)
SELECT
    seed_id('txn:failed:' || p.id::text), p.id, p.project_id, 'CHARGE', 'FAILED',
    p.total_amount, p.currency, 'PAYRIFF',
    'ch_' || substr(md5('f' || p.id::text), 1, 24),
    'insufficient_funds', 'Kartda kifayət qədər vəsait yoxdur.', 2,
    'charge-failed-' || substr(md5(p.id::text), 1, 24),
    now() - interval '2 days'
FROM pledges p
WHERE p.state = 'CHARGE_FAILED'
ON CONFLICT (id) DO NOTHING;

-- ── Double entry ────────────────────────────────────────────────────────────
--
-- Four postings per charge, and they sum to zero because a deferred constraint
-- trigger checks that at COMMIT. Rates are the platform's own 5% and the
-- provider's 2.9% + 0.30, so the creator line is what is actually owed rather
-- than a plausible-looking number.

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'escrow', 'DEBIT', t.amount, t.currency, t.project_id, t.created_at
FROM transactions t
WHERE t.type = 'CHARGE' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.transaction_id = t.id);

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'platform_fee', 'CREDIT', round(t.amount * 0.05, 2), t.currency, t.project_id, t.created_at
FROM transactions t
WHERE t.type = 'CHARGE' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                  WHERE le.transaction_id = t.id AND le.account = 'platform_fee');

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'psp_fee', 'CREDIT', round(t.amount * 0.029, 2) + 0.30, t.currency, t.project_id, t.created_at
FROM transactions t
WHERE t.type = 'CHARGE' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                  WHERE le.transaction_id = t.id AND le.account = 'psp_fee');

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'creator:' || p.creator_id::text, 'CREDIT',
       t.amount - round(t.amount * 0.05, 2) - (round(t.amount * 0.029, 2) + 0.30),
       t.currency, t.project_id, t.created_at
FROM transactions t
JOIN projects p ON p.id = t.project_id
WHERE t.type = 'CHARGE' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                  WHERE le.transaction_id = t.id AND le.account LIKE 'creator:%');

-- ── Delivery ────────────────────────────────────────────────────────────────

INSERT INTO fulfilments (pledge_id, project_id, status, carrier, tracking_number, tracking_url,
                         shipped_at, delivered_at, updated_by, created_at, updated_at)
SELECT p.id, p.project_id,
       CASE WHEN seed_rand('ship:' || p.id::text) < 0.12 THEN 'PREPARING'
            WHEN seed_rand('ship:' || p.id::text) < 0.40 THEN 'SHIPPED'
            WHEN seed_rand('ship:' || p.id::text) < 0.97 THEN 'DELIVERED'
            ELSE 'RETURNED' END,
       CASE WHEN seed_rand('ship:' || p.id::text) < 0.12 THEN NULL ELSE 'Azərpoçt' END,
       CASE WHEN seed_rand('ship:' || p.id::text) < 0.12 THEN NULL
            ELSE 'AZ' || upper(substr(md5(p.id::text), 1, 9)) END,
       CASE WHEN seed_rand('ship:' || p.id::text) < 0.12 THEN NULL
            ELSE 'https://azerpost.az/track/AZ' || upper(substr(md5(p.id::text), 1, 9)) END,
       CASE WHEN seed_rand('ship:' || p.id::text) < 0.12 THEN NULL
            ELSE now() - interval '25 days' END,
       CASE WHEN seed_rand('ship:' || p.id::text) >= 0.40 AND seed_rand('ship:' || p.id::text) < 0.97
            THEN now() - interval '18 days' ELSE NULL END,
       (SELECT creator_id FROM projects WHERE id = p.project_id),
       now() - interval '30 days', now() - interval '18 days'
FROM pledges p
WHERE p.state = 'FULFILLED'
ON CONFLICT (pledge_id) DO NOTHING;

COMMIT;
