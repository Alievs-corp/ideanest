-- Everything the administration console reads: curation, taxonomy tags, fees,
-- flags, support, moderation, refunds, disputes, payouts, the audit trail and
-- the analytics rollups.
--
-- The console is nine screens of tables. Seeded empty it demonstrates nothing —
-- an empty queue and a broken queue look identical.

BEGIN;

-- ── Editorial collections ───────────────────────────────────────────────────

INSERT INTO collections (id, slug, kind, published_at, opens_at, closes_at, grants_badge, sort_order,
                         cover_image_url, cover_image_width, cover_image_height, created_by, created_at, updated_at) VALUES
  (seed_id('collection:staff'), 'redaksiya-secimi', 'STAFF_SELECTION', now() - interval '60 days',
   NULL, NULL, true, 0,
   seed_photo('photo-1522202176988-66273c2fd55f', 1600, 900), 1600, 900,
   seed_id('user:curator'), now() - interval '60 days', now() - interval '3 days'),
  (seed_id('collection:sənətkarlıq'), 'yasayan-senetkarliq', 'THEMED', now() - interval '45 days',
   NULL, NULL, false, 1,
   seed_photo('photo-1503676260728-1c00da094a0b', 1600, 900), 1600, 900,
   seed_id('user:curator'), now() - interval '45 days', now() - interval '10 days'),
  (seed_id('collection:regionlar'), 'regionlardan', 'THEMED', now() - interval '30 days',
   NULL, NULL, false, 2,
   seed_photo('photo-1470071459604-3b5ec3a7fe05', 1600, 900), 1600, 900,
   seed_id('user:curator'), now() - interval '30 days', now() - interval '5 days'),
  (seed_id('collection:qis'), 'qis-cagirisi', 'OPEN_CALL', now() - interval '20 days',
   now() - interval '20 days', now() + interval '25 days', true, 3,
   seed_photo('photo-1519389950473-47ba0277781c', 1600, 900), 1600, 900,
   seed_id('user:curator'), now() - interval '22 days', now() - interval '20 days'),
  (seed_id('collection:qaralama'), 'yaz-cagirisi', 'OPEN_CALL', NULL,
   now() + interval '30 days', now() + interval '75 days', true, 4,
   NULL, NULL, NULL,
   seed_id('user:curator'), now() - interval '2 days', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO collection_translations (collection_id, locale, title, description) VALUES
  (seed_id('collection:staff'), 'az', 'Redaksiya seçimi',
   'Komandamızın diqqətlə seçdiyi kampaniyalar. Hər həftə yenilənir.'),
  (seed_id('collection:staff'), 'en', 'Editorial picks',
   'Campaigns our team is watching. Updated weekly.'),
  (seed_id('collection:sənətkarlıq'), 'az', 'Yaşayan sənətkarlıq',
   'Ənənəvi sənətləri bugünə gətirən layihələr.'),
  (seed_id('collection:sənətkarlıq'), 'en', 'Living crafts',
   'Projects bringing traditional craft into the present.'),
  (seed_id('collection:regionlar'), 'az', 'Regionlardan',
   'Bakıdan kənarda qurulan kampaniyalar.'),
  (seed_id('collection:regionlar'), 'en', 'Outside the capital',
   'Campaigns built beyond Baku.'),
  (seed_id('collection:qis'), 'az', 'Qış çağırışı',
   'Qış mövsümü üçün açıq çağırış. Seçilən layihələr ana səhifədə yer alır.'),
  (seed_id('collection:qis'), 'en', 'Winter open call',
   'An open call for the winter season. Selected campaigns are featured on the home page.'),
  (seed_id('collection:qaralama'), 'az', 'Yaz çağırışı',
   'Hələ dərc olunmayıb.')
ON CONFLICT (collection_id, locale) DO NOTHING;

INSERT INTO collection_projects (collection_id, project_id, position, added_by, created_at) VALUES
  (seed_id('collection:staff'), seed_id('project:tumar'),    0, seed_id('user:curator'), now() - interval '40 days'),
  (seed_id('collection:staff'), seed_id('project:qala'),     1, seed_id('user:curator'), now() - interval '30 days'),
  (seed_id('collection:staff'), seed_id('project:ipek'),     2, seed_id('user:curator'), now() - interval '21 days'),
  (seed_id('collection:staff'), seed_id('project:naringi'),  3, seed_id('user:curator'), now() - interval '18 days'),
  (seed_id('collection:staff'), seed_id('project:qehve'),    4, seed_id('user:curator'), now() - interval '12 days'),
  (seed_id('collection:sənətkarlıq'), seed_id('project:usta'),     0, seed_id('user:curator'), now() - interval '44 days'),
  (seed_id('collection:sənətkarlıq'), seed_id('project:kelagayi'), 1, seed_id('user:curator'), now() - interval '5 days'),
  (seed_id('collection:sənətkarlıq'), seed_id('project:tumar'),    2, seed_id('user:curator'), now() - interval '40 days'),
  (seed_id('collection:sənətkarlıq'), seed_id('project:lampa'),    3, seed_id('user:curator'), now() - interval '44 days'),
  (seed_id('collection:regionlar'), seed_id('project:ipek'),   0, seed_id('user:curator'), now() - interval '21 days'),
  (seed_id('collection:regionlar'), seed_id('project:usta'),   1, seed_id('user:curator'), now() - interval '29 days'),
  (seed_id('collection:regionlar'), seed_id('project:tar'),    2, seed_id('user:curator'), now() - interval '17 days'),
  (seed_id('collection:regionlar'), seed_id('project:naringi'),3, seed_id('user:curator'), now() - interval '25 days'),
  (seed_id('collection:regionlar'), seed_id('project:arxiv'),  4, seed_id('user:curator'), now() - interval '9 days'),
  (seed_id('collection:qis'), seed_id('project:qehve'), 0, seed_id('user:curator'), now() - interval '19 days'),
  (seed_id('collection:qis'), seed_id('project:bazar'), 1, seed_id('user:curator'), now() - interval '17 days'),
  -- The six campaigns 02b adds.
  (seed_id('collection:staff'),       seed_id('project:torpaq'), 5, seed_id('user:curator'), now() - interval '10 days'),
  (seed_id('collection:staff'),       seed_id('project:divar'),  6, seed_id('user:curator'), now() - interval '16 days'),
  (seed_id('collection:sənətkarlıq'), seed_id('project:sebeke'), 4, seed_id('user:curator'), now() - interval '2 days'),
  (seed_id('collection:regionlar'),   seed_id('project:yalli'),  5, seed_id('user:curator'), now() - interval '8 days'),
  (seed_id('collection:regionlar'),   seed_id('project:torpaq'), 6, seed_id('user:curator'), now() - interval '10 days')
ON CONFLICT (collection_id, project_id) DO NOTHING;

INSERT INTO curation_events (id, collection_id, project_id, action, actor_id, actor_role, note, created_at) VALUES
  (seed_id('curation:1'), seed_id('collection:staff'), NULL, 'COLLECTION_CREATED', seed_id('user:curator'), 'MODERATOR', NULL, now() - interval '60 days'),
  (seed_id('curation:2'), seed_id('collection:staff'), NULL, 'COLLECTION_PUBLISHED', seed_id('user:curator'), 'MODERATOR', NULL, now() - interval '60 days'),
  (seed_id('curation:3'), seed_id('collection:staff'), seed_id('project:tumar'), 'PROJECT_ADDED', seed_id('user:curator'), 'MODERATOR', 'Naxış arxivi işi güclüdür.', now() - interval '40 days'),
  (seed_id('curation:4'), seed_id('collection:staff'), seed_id('project:qala'), 'PROJECT_ADDED', seed_id('user:curator'), 'MODERATOR', NULL, now() - interval '30 days'),
  (seed_id('curation:5'), seed_id('collection:staff'), NULL, 'PROJECTS_REORDERED', seed_id('user:curator'), 'MODERATOR', NULL, now() - interval '3 days'),
  (seed_id('curation:6'), seed_id('collection:qis'), NULL, 'COLLECTION_CREATED', seed_id('user:curator'), 'MODERATOR', NULL, now() - interval '22 days'),
  (seed_id('curation:7'), seed_id('collection:qis'), NULL, 'COLLECTION_PUBLISHED', seed_id('user:admin'), 'ADMIN', NULL, now() - interval '20 days'),
  (seed_id('curation:8'), seed_id('collection:regionlar'), seed_id('project:arxiv'), 'PROJECT_ADDED', seed_id('user:curator'), 'MODERATOR', 'Hələ başlamayıb, amma çağırışa uyğundur.', now() - interval '9 days')
ON CONFLICT (id) DO NOTHING;

-- ── Tags ────────────────────────────────────────────────────────────────────

INSERT INTO tags (id, slug, label, usage_count, created_at) VALUES
  (seed_id('tag:xalca'),      'xalca',      'Xalça',           4, now() - interval '200 days'),
  (seed_id('tag:enene'),      'enene',      'Ənənə',           7, now() - interval '200 days'),
  (seed_id('tag:baki'),       'baki',       'Bakı',            9, now() - interval '200 days'),
  (seed_id('tag:senetkarliq'),'senetkarliq','Sənətkarlıq',     5, now() - interval '190 days'),
  (seed_id('tag:oyun'),       'oyun',       'Oyun',            3, now() - interval '180 days'),
  (seed_id('tag:kitab'),      'kitab',      'Kitab',           4, now() - interval '180 days'),
  (seed_id('tag:musiqi'),     'musiqi',     'Musiqi',          3, now() - interval '170 days'),
  (seed_id('tag:qehve'),      'qehve',      'Qəhvə',           2, now() - interval '160 days'),
  (seed_id('tag:sened'),      'sened',      'Sənədli',         3, now() - interval '150 days'),
  (seed_id('tag:region'),     'region',     'Region',          6, now() - interval '150 days'),
  (seed_id('tag:usaq'),       'usaq',       'Uşaq',            2, now() - interval '140 days'),
  (seed_id('tag:dizayn'),     'dizayn',     'Dizayn',          5, now() - interval '140 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_tags (project_id, tag_id, created_at) VALUES
  (seed_id('project:tumar'),    seed_id('tag:xalca'),      now() - interval '52 days'),
  (seed_id('project:tumar'),    seed_id('tag:dizayn'),     now() - interval '52 days'),
  (seed_id('project:tumar'),    seed_id('tag:baki'),       now() - interval '52 days'),
  (seed_id('project:qala'),     seed_id('tag:oyun'),       now() - interval '44 days'),
  (seed_id('project:qala'),     seed_id('tag:enene'),      now() - interval '44 days'),
  (seed_id('project:qehve'),    seed_id('tag:qehve'),      now() - interval '35 days'),
  (seed_id('project:qehve'),    seed_id('tag:baki'),       now() - interval '35 days'),
  (seed_id('project:naringi'),  seed_id('tag:kitab'),      now() - interval '40 days'),
  (seed_id('project:naringi'),  seed_id('tag:usaq'),       now() - interval '40 days'),
  (seed_id('project:tar'),      seed_id('tag:musiqi'),     now() - interval '30 days'),
  (seed_id('project:tar'),      seed_id('tag:enene'),      now() - interval '30 days'),
  (seed_id('project:ipek'),     seed_id('tag:sened'),      now() - interval '33 days'),
  (seed_id('project:ipek'),     seed_id('tag:region'),     now() - interval '33 days'),
  (seed_id('project:ipek'),     seed_id('tag:senetkarliq'),now() - interval '33 days'),
  (seed_id('project:kelagayi'), seed_id('tag:enene'),      now() - interval '20 days'),
  (seed_id('project:kelagayi'), seed_id('tag:senetkarliq'),now() - interval '20 days'),
  (seed_id('project:usta'),     seed_id('tag:senetkarliq'),now() - interval '140 days'),
  (seed_id('project:usta'),     seed_id('tag:region'),     now() - interval '140 days'),
  (seed_id('project:albom'),    seed_id('tag:musiqi'),     now() - interval '60 days'),
  (seed_id('project:masa'),     seed_id('tag:oyun'),       now() - interval '90 days'),
  (seed_id('project:lampa'),    seed_id('tag:dizayn'),     now() - interval '320 days'),
  (seed_id('project:lampa'),    seed_id('tag:xalca'),      now() - interval '320 days'),
  (seed_id('project:arxiv'),    seed_id('tag:musiqi'),     now() - interval '14 days'),
  (seed_id('project:arxiv'),    seed_id('tag:region'),     now() - interval '14 days'),
  -- The six campaigns 02b adds.
  (seed_id('project:torpaq'),   seed_id('tag:region'),      now() - interval '25 days'),
  (seed_id('project:divar'),    seed_id('tag:baki'),        now() - interval '30 days'),
  (seed_id('project:gece'),     seed_id('tag:baki'),        now() - interval '18 days'),
  (seed_id('project:seyyah'),   seed_id('tag:kitab'),       now() - interval '40 days'),
  (seed_id('project:sebeke'),   seed_id('tag:senetkarliq'), now() - interval '12 days'),
  (seed_id('project:sebeke'),   seed_id('tag:enene'),       now() - interval '12 days'),
  (seed_id('project:yalli'),    seed_id('tag:sened'),       now() - interval '22 days'),
  (seed_id('project:yalli'),    seed_id('tag:region'),      now() - interval '22 days')
ON CONFLICT (project_id, tag_id) DO NOTHING;

-- ── Fee schedules ───────────────────────────────────────────────────────────
--
-- Terms are validity-windowed, not edited in place: the closed row is what a
-- payout calculated last year is still entitled to be checked against.

INSERT INTO fee_schedules (id, scope, scope_ref, platform_rate, processing_rate, processing_fixed,
                           currency, effective_from, effective_to, note, created_at, created_by) VALUES
  (seed_id('fee:platform:old'), 'PLATFORM', NULL, 0.0600, 0.0290, 0.30, 'AZN',
   now() - interval '400 days', now() - interval '120 days',
   'İlkin dərəcə. Emitent komissiyaları dəyişdiyi üçün yenilənib.',
   now() - interval '400 days', seed_id('user:admin')),
  (seed_id('fee:platform:now'), 'PLATFORM', NULL, 0.0500, 0.0290, 0.30, 'AZN',
   now() - interval '120 days', NULL,
   'Cari platforma dərəcəsi: 5% platforma, 2,9% + 0,30 AZN emal.',
   now() - interval '120 days', seed_id('user:admin')),
  (seed_id('fee:cat:journalism'), 'CATEGORY', seed_category('journalism'), 0.0300, 0.0290, 0.30, 'AZN',
   now() - interval '90 days', NULL,
   'Jurnalistika üçün endirimli platforma dərəcəsi.',
   now() - interval '90 days', seed_id('user:finance')),
  (seed_id('fee:proj:usta'), 'PROJECT', seed_id('project:usta'), 0.0000, 0.0290, 0.30, 'AZN',
   now() - interval '130 days', NULL,
   'Açıq arxiv layihəsi: platforma komissiyası tətbiq edilmir.',
   now() - interval '130 days', seed_id('user:admin'))
ON CONFLICT (id) DO NOTHING;

-- ── Subscriptions ───────────────────────────────────────────────────────────

-- One row per state the console has to render. An operator looking at an empty
-- queue cannot tell it from a broken one, and the revenue report has nothing to
-- add up.
--
-- THE PLANS ARE NOT SEEDED HERE. V62 ships the catalogue with the migration that
-- opens the gate, for the reason its own header gives: a gate with nothing behind
-- it is a platform nobody can publish on. These rows reference those by `code`,
-- so an operator who reprices or renames a plan does not break the seed, and a
-- seed that invented a fourth plan would be a catalogue the product does not have.

INSERT INTO subscriptions (id, account_id, plan_id, state, price, currency, billing_period,
                           started_at, current_period_end, cancel_at_period_end, canceled_at,
                           activated_by, note, created_at)
VALUES
  -- Paid and running. The creator who owns most of the seeded campaigns.
  (seed_id('sub:creator'), seed_id('user:creator'), (SELECT id FROM subscription_plans WHERE code = 'GROWTH'), 'ACTIVE',
   49.00, 'AZN', 'MONTHLY', now() - interval '40 days', now() + interval '20 days',
   false, NULL, seed_id('user:finance'), 'Bank köçürməsi, 12.08 tarixli çıxarış.',
   now() - interval '40 days'),

  (seed_id('sub:gunel'), seed_id('user:gunel'), (SELECT id FROM subscription_plans WHERE code = 'PRO'), 'ACTIVE',
   149.00, 'AZN', 'MONTHLY', now() - interval '12 days', now() + interval '48 days',
   false, NULL, seed_id('user:finance'), 'Bank köçürməsi.',
   now() - interval '12 days'),

  (seed_id('sub:orxan'), seed_id('user:orxan'), (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'ACTIVE',
   19.00, 'AZN', 'MONTHLY', now() - interval '5 days', now() + interval '25 days',
   false, NULL, seed_id('user:admin'), NULL,
   now() - interval '5 days'),

  -- Waiting on a transfer. This is the queue AD-11's second screen exists for.
  (seed_id('sub:tural'), seed_id('user:tural'), (SELECT id FROM subscription_plans WHERE code = 'GROWTH'), 'PENDING_PAYMENT',
   49.00, 'AZN', 'MONTHLY', NULL, NULL, false, NULL, NULL, NULL,
   now() - interval '2 days'),

  -- Ended by staff: the payment was reversed. Immediate, not at period end.
  (seed_id('sub:spam'), seed_id('user:spammer'), (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'CANCELED',
   19.00, 'AZN', 'MONTHLY', now() - interval '90 days', now() - interval '60 days',
   false, now() - interval '61 days', seed_id('user:admin'),
   'Ödəniş geri qaytarıldı, hesab dayandırıldı.',
   now() - interval '90 days'),

  -- Ran its course and was not renewed. What the report counts as past revenue.
  (seed_id('sub:sevinc'), seed_id('user:sevinc'), (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'EXPIRED',
   19.00, 'AZN', 'MONTHLY', now() - interval '75 days', now() - interval '45 days',
   false, NULL, seed_id('user:finance'), 'Bank köçürməsi.',
   now() - interval '75 days')
ON CONFLICT DO NOTHING;

-- ── Subscription payments ───────────────────────────────────────────────────

-- V73's journal: what the platform was actually paid, which is what the revenue
-- report adds up. Not derivable from the rows above -- a subscription carries a
-- price, not a receipt -- and the distinction is the point of the table.
--
-- Six rows against five subscriptions, chosen so that every shape the report has
-- to render appears at least once:
--
--   * three months of the same account, so a period filter has something to
--     exclude and a per-account history has something to list;
--   * one currency, AZN, on every row: that is what the platform charges in, and
--     the column exists so that a total is never a figure with two currencies
--     silently added together;
--   * two methods, because a transfer and cash are both how the platform is paid
--     while #60 is unanswered;
--   * a payment and its reversal, which is how a correction is made on a table
--     that refuses UPDATE. The pair nets to zero, so an operator who sums the
--     journal gets what the platform kept rather than what passed through it.
--
-- The plan is written onto each row rather than referred to. An operator who
-- reprices GROWTH tomorrow must not find that last month's report has changed,
-- which is the argument V73's header makes at length.
--
-- `sub:tural` has no row at all: it is the queue, and nobody has paid yet.

INSERT INTO subscription_payments (id, subscription_id, account_id, plan_id, plan_code, plan_name,
                                   amount, currency, billing_period, method, reference, note,
                                   received_at, recorded_by, reverses)
VALUES
  -- Three months from the creator who owns most of the seeded campaigns, so the
  -- report has a history rather than a single figure.
  (seed_id('pay:creator:1'), seed_id('sub:creator'), seed_id('user:creator'),
   (SELECT id FROM subscription_plans WHERE code = 'GROWTH'), 'GROWTH', 'Growth',
   49.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0431', 'Bank köçürməsi, 12.08 tarixli çıxarış.',
   now() - interval '100 days', seed_id('user:finance'), NULL),

  (seed_id('pay:creator:2'), seed_id('sub:creator'), seed_id('user:creator'),
   (SELECT id FROM subscription_plans WHERE code = 'GROWTH'), 'GROWTH', 'Growth',
   49.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0512', NULL,
   now() - interval '70 days', seed_id('user:finance'), NULL),

  (seed_id('pay:creator:3'), seed_id('sub:creator'), seed_id('user:creator'),
   (SELECT id FROM subscription_plans WHERE code = 'GROWTH'), 'GROWTH', 'Growth',
   49.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0588', NULL,
   now() - interval '40 days', seed_id('user:finance'), NULL),

  (seed_id('pay:gunel'), seed_id('sub:gunel'), seed_id('user:gunel'),
   (SELECT id FROM subscription_plans WHERE code = 'PRO'), 'PRO', 'Pro',
   149.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0644', NULL,
   now() - interval '12 days', seed_id('user:finance'), NULL),

  -- Handed over at the office. The method column exists because the platform is
  -- paid in more than one way while #60 is unanswered.
  (seed_id('pay:orxan'), seed_id('sub:orxan'), seed_id('user:orxan'),
   (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'STARTER', 'Starter',
   19.00, 'AZN', 'MONTHLY', 'CASH', 'QEB-114', 'Ofisdə nağd ödəniş.',
   now() - interval '5 days', seed_id('user:admin'), NULL),

  -- Ran its course. Past revenue, and the report must keep counting it.
  (seed_id('pay:sevinc'), seed_id('sub:sevinc'), seed_id('user:sevinc'),
   (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'STARTER', 'Starter',
   19.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0203', NULL,
   now() - interval '75 days', seed_id('user:finance'), NULL),

  -- The reversed one, in two rows. `sub:spam` was ended by staff because the
  -- payment was taken back; the row that recorded it cannot be edited, so the
  -- correction is this negative beside it.
  (seed_id('pay:spam'), seed_id('sub:spam'), seed_id('user:spammer'),
   (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'STARTER', 'Starter',
   19.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0161', NULL,
   now() - interval '90 days', seed_id('user:finance'), NULL)
ON CONFLICT DO NOTHING;

-- Second statement, because `reverses` points at a row the statement above
-- inserts and a single VALUES list has no ordering between its rows.
INSERT INTO subscription_payments (id, subscription_id, account_id, plan_id, plan_code, plan_name,
                                   amount, currency, billing_period, method, reference, note,
                                   received_at, recorded_by, reverses)
VALUES
  (seed_id('pay:spam:reversal'), seed_id('sub:spam'), seed_id('user:spammer'),
   (SELECT id FROM subscription_plans WHERE code = 'STARTER'), 'STARTER', 'Starter',
   -19.00, 'AZN', 'MONTHLY', 'BANK_TRANSFER', 'KOC-2026-0161', 'Ödəniş geri qaytarıldı.',
   now() - interval '61 days', seed_id('user:admin'), seed_id('pay:spam'))
ON CONFLICT DO NOTHING;

-- ── Feature flags ───────────────────────────────────────────────────────────

INSERT INTO feature_flags (key, description, enabled, rollout_percentage, enabled_accounts, updated_at, updated_by) VALUES
  ('late-pledge', 'Kampaniya bitdikdən sonra gec dəstək pəncərəsi.', true, 100, ARRAY[]::uuid[], now() - interval '30 days', seed_id('user:admin')),
  ('pledge-supplements', 'Mövcud dəstəyi yüksəltmək və əlavə almaq.', true, 60, ARRAY[]::uuid[], now() - interval '14 days', seed_id('user:admin')),
  ('creator-analytics-cohorts', 'Yaradıcı panelində kohort analitikası.', false, 0,
   ARRAY[seed_id('user:creator'), seed_id('user:orxan')], now() - interval '7 days', seed_id('user:admin')),
  ('realtime-counters', 'Kampaniya səhifəsində canlı sayğac.', true, 25, ARRAY[]::uuid[], now() - interval '4 days', seed_id('user:admin')),
  ('collection-badges', 'Redaksiya kolleksiyası nişanları.', true, 100, ARRAY[]::uuid[], now() - interval '55 days', seed_id('user:curator')),
  ('survey-nudges', 'Cavablandırılmamış sorğular üçün xatırlatma.', true, 100, ARRAY[]::uuid[], now() - interval '40 days', seed_id('user:admin')),
  ('maintenance-banner', 'Bütün səhifələrdə texniki iş bildirişi.', false, 0, ARRAY[]::uuid[], now() - interval '2 days', seed_id('user:admin'))
ON CONFLICT (key) DO NOTHING;

-- ── Support ─────────────────────────────────────────────────────────────────

INSERT INTO support_tickets (id, requester_id, subject, subject_type, subject_ref, state, priority,
                             assignee_id, created_at, updated_at, resolved_at) VALUES
  -- A ticket about "my parcel" has to point at the requester's own pledge. An
  -- arbitrary pledge on the right campaign looks correct in the list and falls
  -- apart the moment anyone opens it next to the backer it names.
  (seed_id('ticket:1'), seed_id('user:ferid'), 'Bağlamam iki həftədir çatmır', 'PLEDGE',
   seed_id('pledge:demo:ferid:qab'),
   'OPEN', 'HIGH', seed_id('user:moderator'), now() - interval '4 days', now() - interval '1 day', NULL),
  (seed_id('ticket:2'), seed_id('user:aygun'), 'Kartımdan iki dəfə pul çıxdı', 'PLEDGE',
   seed_id('pledge:demo:aygun:albom'),
   'PENDING', 'URGENT', seed_id('user:finance'), now() - interval '2 days', now() - interval '6 hours', NULL),
  (seed_id('ticket:3'), seed_id('user:backer'), 'Sorğu linki işləmir', 'PROJECT', seed_id('project:albom'),
   'RESOLVED', 'NORMAL', seed_id('user:moderator'), now() - interval '12 days', now() - interval '10 days', now() - interval '10 days'),
  (seed_id('ticket:4'), seed_id('user:lale'), 'Hesabımın e-poçtunu dəyişə bilmirəm', 'ACCOUNT', seed_id('user:lale'),
   'RESOLVED', 'NORMAL', seed_id('user:admin'), now() - interval '20 days', now() - interval '19 days', now() - interval '19 days'),
  (seed_id('ticket:5'), seed_id('user:emin'), 'How do I change my shipping address?', 'NONE', NULL,
   'CLOSED', 'LOW', seed_id('user:moderator'), now() - interval '35 days', now() - interval '33 days', now() - interval '33 days'),
  (seed_id('ticket:6'), seed_id('user:nezrin'), 'Kampaniya ləğv olundu, pulum qayıdacaqmı?', 'PROJECT', seed_id('project:legv'),
   'OPEN', 'NORMAL', NULL, now() - interval '1 day', now() - interval '1 day', NULL),
  (seed_id('ticket:7'), seed_id('user:samir'), 'Yaradıcı hesabı açmaq istəyirəm', 'NONE', NULL,
   'OPEN', 'LOW', NULL, now() - interval '8 hours', now() - interval '8 hours', NULL),
  (seed_id('ticket:8'), seed_id('user:zaur'), 'Двойное списание при оплате', 'NONE', NULL,
   'PENDING', 'HIGH', seed_id('user:finance'), now() - interval '3 days', now() - interval '2 days', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_side, body, internal, created_at) VALUES
  (seed_id('tmsg:1:1'), seed_id('ticket:1'), seed_id('user:ferid'), 'REQUESTER',
   'İzləmə nömrəsi iki həftədir "qəbul edildi" statusundadır və dəyişmir. Bağlama harada?', false, now() - interval '4 days'),
  (seed_id('tmsg:1:2'), seed_id('ticket:1'), seed_id('user:moderator'), 'STAFF',
   'Yaradıcı ilə əlaqə saxladıq. Poçtdan sorğu göndərilib, cavabı gözləyirik.', false, now() - interval '2 days'),
  (seed_id('tmsg:1:3'), seed_id('ticket:1'), seed_id('user:moderator'), 'STAFF',
   'Daxili qeyd: bu marşrutda bu həftə üçüncü şikayətdir. Yaradıcıya toplu sorğu göndərilməlidir.', true, now() - interval '1 day'),
  (seed_id('tmsg:2:1'), seed_id('ticket:2'), seed_id('user:aygun'), 'REQUESTER',
   'Bank çıxarışında eyni məbləğ iki dəfə görünür. Ekran şəklini əlavə edirəm.', false, now() - interval '2 days'),
  (seed_id('tmsg:2:2'), seed_id('ticket:2'), seed_id('user:finance'), 'STAFF',
   'Yoxlayırıq. Provayder loqlarında yalnız bir uğurlu əməliyyat görünür — ikincisi ehtimal ki, bloklanmış məbləğdir və 3-5 gün ərzində açılacaq.', false, now() - interval '6 hours'),
  (seed_id('tmsg:3:1'), seed_id('ticket:3'), seed_id('user:backer'), 'REQUESTER',
   'E-poçtdakı sorğu linki 404 verir.', false, now() - interval '12 days'),
  (seed_id('tmsg:3:2'), seed_id('ticket:3'), seed_id('user:moderator'), 'STAFF',
   'Link müddəti bitmişdi. Yenisini göndərdik, indi işləyir.', false, now() - interval '10 days'),
  (seed_id('tmsg:4:1'), seed_id('ticket:4'), seed_id('user:lale'), 'REQUESTER',
   'Yeni e-poçt ünvanı təsdiq məktubu gəlmir.', false, now() - interval '20 days'),
  (seed_id('tmsg:4:2'), seed_id('ticket:4'), seed_id('user:admin'), 'STAFF',
   'Məktub spam qovluğuna düşürdü. Göndərən ünvanı dəyişdirildi və yenidən göndərildi.', false, now() - interval '19 days'),
  (seed_id('tmsg:6:1'), seed_id('ticket:6'), seed_id('user:nezrin'), 'REQUESTER',
   'Dəstək olduğum kampaniya ləğv edildi. Pul kartımdan çıxmışdımı, bilmirəm.', false, now() - interval '1 day'),
  (seed_id('tmsg:8:1'), seed_id('ticket:8'), seed_id('user:zaur'), 'REQUESTER',
   'С карты списали дважды одну и ту же сумму.', false, now() - interval '3 days'),
  (seed_id('tmsg:8:2'), seed_id('ticket:8'), seed_id('user:finance'), 'STAFF',
   'Проверяем в логах провайдера. Ответим в течение суток.', false, now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

-- ── Moderation ──────────────────────────────────────────────────────────────

INSERT INTO content_reports (id, target_type, target_id, reporter_id, reason, detail, state,
                             resolved_by, resolved_at, resolution_note, created_at, updated_at) VALUES
  (seed_id('report:1'), 'COMMENT', seed_id('comment:spam:2'), seed_id('user:lale'), 'SPAM',
   'Şərhdə pulsuz yükləmə linki var.', 'OPEN', NULL, NULL, NULL, now() - interval '5 days', now() - interval '5 days'),
  (seed_id('report:2'), 'PROJECT', seed_id('project:saxta'), seed_id('user:backer'), 'MISREPRESENTATION',
   'Məhsulun mövcud olduğuna dair heç bir sübut yoxdur.', 'UPHELD',
   seed_id('user:moderator'), now() - interval '11 days',
   'Yaradıcıdan sənəd tələb olundu, cavab gəlmədi. Kampaniya dayandırıldı.',
   now() - interval '13 days', now() - interval '11 days'),
  (seed_id('report:3'), 'USER', seed_id('user:spammer'), seed_id('user:aygun'), 'SPAM',
   'Bir neçə kampaniyada eyni reklam şərhini yazır.', 'UPHELD',
   seed_id('user:moderator'), now() - interval '12 days',
   'Hesab dayandırıldı, şərhlər silindi.', now() - interval '14 days', now() - interval '12 days'),
  (seed_id('report:4'), 'COMMENT', seed_id('comment:qala:2'), seed_id('user:samir'), 'OFFENSIVE',
   NULL, 'DISMISSED', seed_id('user:moderator'), now() - interval '18 days',
   'Şərhdə qaydaları pozan heç nə yoxdur.', now() - interval '19 days', now() - interval '18 days'),
  (seed_id('report:5'), 'PROJECT_UPDATE', seed_id('update:qab:2'), seed_id('user:ferid'), 'OTHER',
   'Gecikmə barədə məlumat kifayət deyil, konkret tarix yoxdur.', 'OPEN',
   NULL, NULL, NULL, now() - interval '2 days', now() - interval '2 days'),
  (seed_id('report:6'), 'PROJECT', seed_id('project:komiks'), seed_id('user:emin'), 'INTELLECTUAL_PROPERTY',
   'Illustrations look derived from an existing published edition.', 'DISMISSED',
   seed_id('user:moderator'), now() - interval '130 days',
   'Yaradıcı orijinal eskizləri təqdim etdi.', now() - interval '132 days', now() - interval '130 days'),
  (seed_id('report:7'), 'USER', seed_id('user:samir'), seed_id('user:spammer'), 'DISCRIMINATION',
   'Retaliatory report filed by a suspended account.', 'OPEN',
   NULL, NULL, NULL, now() - interval '10 days', now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

-- ── Refunds ─────────────────────────────────────────────────────────────────
--
-- A refund that succeeded has a refund transaction behind it, and that
-- transaction has ledger postings that balance. Anything less and the finance
-- console shows money leaving without anywhere for it to have gone.

INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency, provider,
                          provider_transaction_id, attempt_number, idempotency_key, created_at)
SELECT seed_id('txn:refund:' || p.id::text), p.id, p.project_id, 'REFUND', 'SUCCEEDED',
       p.total_amount, p.currency, 'PAYRIFF',
       're_' || substr(md5(p.id::text), 1, 24), 1,
       'refund-' || substr(md5(p.id::text), 1, 24), now() - interval '6 days'
FROM pledges p
WHERE p.project_id = seed_id('project:qab') AND p.state = 'FULFILLED'
  -- Only the generated crowd. Picking by row order means a pledge added
  -- later would otherwise shift which four get refunded.
  AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id LIMIT 4
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'refunds', 'DEBIT', t.amount, t.currency, t.project_id, t.created_at
FROM transactions t WHERE t.type = 'REFUND' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.transaction_id = t.id);

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'escrow', 'CREDIT', t.amount, t.currency, t.project_id, t.created_at
FROM transactions t WHERE t.type = 'REFUND' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                  WHERE le.transaction_id = t.id AND le.account = 'escrow');

INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, refund_transaction_id,
                     amount, currency, full_refund, reason, detail, state,
                     requested_by, requested_at, settled_at, idempotency_key)
SELECT seed_id('refund:' || t.pledge_id::text), t.pledge_id, t.project_id,
       seed_id('txn:charge:' || t.pledge_id::text), t.id,
       t.amount, t.currency, true, 'FULFILMENT_FAILURE',
       'Bağlama çatdırılmadı və izləmə yenilənmədi. Dəstəkçinin xahişi ilə tam geri qaytarma.',
       'SUCCEEDED', seed_id('user:finance'), now() - interval '7 days', now() - interval '6 days',
       'refund-req-' || substr(md5(t.pledge_id::text), 1, 20)
FROM transactions t WHERE t.type = 'REFUND' AND t.status = 'SUCCEEDED'
ON CONFLICT (id) DO NOTHING;

-- One still waiting on a decision, and one the provider declined.
INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, refund_transaction_id,
                     amount, currency, full_refund, reason, detail, state,
                     failure_code, failure_message,
                     requested_by, requested_at, settled_at, idempotency_key)
SELECT seed_id('refund:pending'), p.id, p.project_id, seed_id('txn:charge:' || p.id::text), NULL,
       p.total_amount, p.currency, true, 'BACKER_REQUEST',
       'Dəstəkçi fikrini dəyişdi və kampaniya bitmədən geri qaytarma istədi.',
       'REQUESTED', NULL, NULL,
       seed_id('user:finance'), now() - interval '1 day', NULL,
       'refund-req-pending-0001'
FROM pledges p WHERE p.project_id = seed_id('project:albom') AND p.state = 'COLLECTED'
AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id OFFSET 3 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO refunds (id, pledge_id, project_id, charge_transaction_id, refund_transaction_id,
                     amount, currency, full_refund, reason, detail, state,
                     failure_code, failure_message,
                     requested_by, requested_at, settled_at, idempotency_key)
SELECT seed_id('refund:failed'), p.id, p.project_id, seed_id('txn:charge:' || p.id::text), NULL,
       round(p.total_amount / 2, 2), p.currency, false, 'DUPLICATE_CHARGE',
       'İkiqat ödəniş şikayəti. Qismən geri qaytarma cəhdi provayder tərəfindən rədd edildi.',
       'FAILED', 'card_expired', 'Kartın müddəti bitib, geri qaytarma mümkün deyil.',
       seed_id('user:finance'), now() - interval '9 days', now() - interval '8 days',
       'refund-req-failed-0001'
FROM pledges p WHERE p.project_id = seed_id('project:lampa') AND p.state = 'FULFILLED'
AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id OFFSET 5 LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- ── Disputes ────────────────────────────────────────────────────────────────

INSERT INTO disputes (id, charge_transaction_id, pledge_id, project_id, provider, provider_dispute_id,
                      amount, currency, fee, reason_code, state, evidence_due_at, opened_at,
                      resolved_at, handled_by, updated_at)
SELECT seed_id('dispute:open'), seed_id('txn:charge:' || p.id::text), p.id, p.project_id,
       'PAYRIFF', 'dp_' || substr(md5('o' || p.id::text), 1, 20),
       p.total_amount, p.currency, 25.00, 'product_not_received', 'OPEN',
       now() + interval '5 days', now() - interval '3 days', NULL, seed_id('user:finance'), now() - interval '3 days'
FROM pledges p WHERE p.project_id = seed_id('project:qab') AND p.state = 'FULFILLED'
AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id OFFSET 10 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO disputes (id, charge_transaction_id, pledge_id, project_id, provider, provider_dispute_id,
                      amount, currency, fee, reason_code, state, evidence_due_at, opened_at,
                      resolved_at, handled_by, updated_at)
SELECT seed_id('dispute:review'), seed_id('txn:charge:' || p.id::text), p.id, p.project_id,
       'PAYRIFF', 'dp_' || substr(md5('r' || p.id::text), 1, 20),
       p.total_amount, p.currency, 25.00, 'fraudulent', 'UNDER_REVIEW',
       now() + interval '2 days', now() - interval '9 days', NULL, seed_id('user:finance'), now() - interval '2 days'
FROM pledges p WHERE p.project_id = seed_id('project:lampa') AND p.state = 'FULFILLED'
AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id OFFSET 12 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO disputes (id, charge_transaction_id, pledge_id, project_id, provider, provider_dispute_id,
                      amount, currency, fee, reason_code, state, evidence_due_at, opened_at,
                      resolved_at, handled_by, updated_at)
SELECT seed_id('dispute:won'), seed_id('txn:charge:' || p.id::text), p.id, p.project_id,
       'PAYRIFF', 'dp_' || substr(md5('w' || p.id::text), 1, 20),
       p.total_amount, p.currency, 25.00, 'product_not_received', 'WON',
       now() - interval '30 days', now() - interval '45 days', now() - interval '28 days',
       seed_id('user:finance'), now() - interval '28 days'
FROM pledges p WHERE p.project_id = seed_id('project:qab') AND p.state = 'FULFILLED'
AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id OFFSET 20 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO disputes (id, charge_transaction_id, pledge_id, project_id, provider, provider_dispute_id,
                      amount, currency, fee, reason_code, state, evidence_due_at, opened_at,
                      resolved_at, handled_by, updated_at)
SELECT seed_id('dispute:lost'), seed_id('txn:charge:' || p.id::text), p.id, p.project_id,
       'PAYRIFF', 'dp_' || substr(md5('l' || p.id::text), 1, 20),
       p.total_amount, p.currency, 25.00, 'unrecognised', 'LOST',
       now() - interval '60 days', now() - interval '75 days', now() - interval '58 days',
       seed_id('user:finance'), now() - interval '58 days'
FROM pledges p WHERE p.project_id = seed_id('project:lampa') AND p.state = 'FULFILLED'
AND p.idempotency_key NOT LIKE 'seed-demo-%'
ORDER BY p.id OFFSET 30 LIMIT 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO dispute_evidence (id, dispute_id, kind, description, media_id, submitted_at,
                              provider_evidence_id, created_at, created_by) VALUES
  (seed_id('evidence:open:1'), seed_id('dispute:open'), 'SHIPPING_PROOF',
   'Azərpoçt izləmə çıxarışı, çatdırılma təsdiqi ilə.', NULL, NULL, NULL,
   now() - interval '2 days', seed_id('user:finance')),
  (seed_id('evidence:open:2'), seed_id('dispute:open'), 'COMMUNICATION',
   'Yaradıcı ilə dəstəkçi arasında yazışma.', NULL, NULL, NULL,
   now() - interval '2 days', seed_id('user:finance')),
  (seed_id('evidence:won:1'), seed_id('dispute:won'), 'SHIPPING_PROOF',
   'İmzalanmış çatdırılma qəbzi.', NULL, now() - interval '40 days', 'ev_demo_won_0001',
   now() - interval '43 days', seed_id('user:finance')),
  (seed_id('evidence:won:2'), seed_id('dispute:won'), 'TERMS_ACCEPTANCE',
   'Dəstək anında qəbul edilmiş şərtlərin surəti.', NULL, now() - interval '40 days', 'ev_demo_won_0002',
   now() - interval '43 days', seed_id('user:finance')),
  (seed_id('evidence:review:1'), seed_id('dispute:review'), 'ACTIVITY_LOG',
   'Hesabın giriş və dəstək tarixçəsi.', NULL, NULL, NULL,
   now() - interval '4 days', seed_id('user:finance'))
ON CONFLICT (id) DO NOTHING;

-- ── Payouts ─────────────────────────────────────────────────────────────────

INSERT INTO transactions (id, pledge_id, project_id, type, status, amount, currency, provider,
                          provider_transaction_id, attempt_number, idempotency_key, created_at) VALUES
  (seed_id('txn:payout:lampa'), NULL, seed_id('project:lampa'), 'PAYOUT', 'SUCCEEDED',
   17800.00, 'AZN', 'AZERICARD', 'po_demo_lampa_0001', 1, 'payout-lampa-0001', now() - interval '190 days'),
  (seed_id('txn:payout:usta'), NULL, seed_id('project:usta'), 'PAYOUT', 'SUCCEEDED',
   36500.00, 'AZN', 'AZERICARD', 'po_demo_usta_0001', 1, 'payout-usta-0001', now() - interval '55 days'),
  (seed_id('txn:payout:foto'), NULL, seed_id('project:foto'), 'PAYOUT', 'SUCCEEDED',
   11100.00, 'AZN', 'AZERICARD', 'po_demo_foto_0001', 1, 'payout-foto-0001', now() - interval '150 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'creator:' || p.creator_id::text, 'DEBIT', t.amount, t.currency, t.project_id, t.created_at
FROM transactions t JOIN projects p ON p.id = t.project_id
WHERE t.type = 'PAYOUT' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le WHERE le.transaction_id = t.id);

INSERT INTO ledger_entries (transaction_id, account, direction, amount, currency, project_id, created_at)
SELECT t.id, 'escrow', 'CREDIT', t.amount, t.currency, t.project_id, t.created_at
FROM transactions t
WHERE t.type = 'PAYOUT' AND t.status = 'SUCCEEDED'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries le
                  WHERE le.transaction_id = t.id AND le.account = 'escrow');

INSERT INTO payouts (id, project_id, creator_id, gross_amount, platform_fee, processing_fee,
                     tax_withheld, refunded_amount, net_amount, currency, fee_schedule_id, state,
                     payable_at, approvals_required, payout_transaction_id,
                     failure_code, failure_message, calculated_at, sent_at, idempotency_key) VALUES
  -- Paid, and long settled.
  (seed_id('payout:lampa'), seed_id('project:lampa'), seed_id('user:creator'),
   19200.00, 960.00, 585.00, 0.00, 0.00, 17655.00, 'AZN', seed_id('fee:platform:old'), 'PAID',
   now() - interval '195 days', 2, seed_id('txn:payout:lampa'), NULL, NULL,
   now() - interval '198 days', now() - interval '190 days', 'payout-key-lampa-0001'),
  (seed_id('payout:foto'), seed_id('project:foto'), seed_id('user:creator'),
   11250.00, 675.00, 356.25, 0.00, 0.00, 10218.75, 'AZN', seed_id('fee:platform:old'), 'PAID',
   now() - interval '155 days', 2, seed_id('txn:payout:foto'), NULL, NULL,
   now() - interval '158 days', now() - interval '150 days', 'payout-key-foto-0001'),
  (seed_id('payout:usta'), seed_id('project:usta'), seed_id('user:gunel'),
   38439.00, 0.00, 1144.73, 0.00, 0.00, 37294.27, 'AZN', seed_id('fee:proj:usta'), 'PAID',
   now() - interval '60 days', 2, seed_id('txn:payout:usta'), NULL, NULL,
   now() - interval '62 days', now() - interval '55 days', 'payout-key-usta-0001'),
  -- Waiting on a second approver: the state the finance queue exists for.
  (seed_id('payout:qab'), seed_id('project:qab'), seed_id('user:orxan'),
   69395.00, 3469.75, 2158.46, 0.00, 480.00, 63286.79, 'AZN', seed_id('fee:platform:now'), 'PENDING_APPROVAL',
   now() - interval '2 days', 2, NULL, NULL, NULL,
   now() - interval '3 days', NULL, 'payout-key-qab-0001'),
  -- Declined by the bank, and it says why.
  (seed_id('payout:masa'), seed_id('project:masa'), seed_id('user:orxan'),
   41833.00, 2091.65, 1305.16, 0.00, 0.00, 38436.19, 'AZN', seed_id('fee:platform:now'), 'FAILED',
   now() - interval '20 days', 2, NULL, 'account_closed', 'Benefisiar hesabı bağlıdır.',
   now() - interval '22 days', now() - interval '19 days', 'payout-key-masa-0001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payout_approvals (payout_id, approver_id, approved_at, note) VALUES
  (seed_id('payout:lampa'), seed_id('user:finance'), now() - interval '194 days', 'Hesablama yoxlanıldı.'),
  (seed_id('payout:lampa'), seed_id('user:admin'),   now() - interval '193 days', NULL),
  (seed_id('payout:foto'),  seed_id('user:finance'), now() - interval '154 days', NULL),
  (seed_id('payout:foto'),  seed_id('user:admin'),   now() - interval '153 days', NULL),
  (seed_id('payout:usta'),  seed_id('user:finance'), now() - interval '59 days', 'Sıfır platforma komissiyası təsdiqləndi.'),
  (seed_id('payout:usta'),  seed_id('user:admin'),   now() - interval '58 days', NULL),
  -- #405: a signature's note says why that person signed, and this one used to narrate the
  -- file's state instead -- "first approval, awaiting the second" -- so it sat unchanged
  -- under "2 of 2 signatures" as soon as anybody added one. A note about the payout is a
  -- note that goes stale; a note about the reason does not.
  (seed_id('payout:qab'),   seed_id('user:finance'), now() - interval '2 days', 'Hesablama yoxlanıldı, komissiyalar uyğundur.'),
  (seed_id('payout:masa'),  seed_id('user:finance'), now() - interval '21 days', NULL),
  (seed_id('payout:masa'),  seed_id('user:admin'),   now() - interval '20 days', NULL)
ON CONFLICT (payout_id, approver_id) DO NOTHING;

-- ── Collaborators ───────────────────────────────────────────────────────────

INSERT INTO collaborators (id, project_id, account_id, invited_email, invitation_token_hash, invited_by,
                           created_at, updated_at, expires_at, accepted_at, revoked_at, revoked_by) VALUES
  (seed_id('collab:tumar:accepted'), seed_id('project:tumar'), seed_id('user:collab'),
   'collab@ideanest.az', sha256(convert_to('collab-tumar', 'UTF8')), seed_id('user:creator'),
   now() - interval '45 days', now() - interval '44 days', now() - interval '31 days',
   now() - interval '44 days', NULL, NULL),
  (seed_id('collab:qala:accepted'), seed_id('project:qala'), seed_id('user:collab'),
   'collab@ideanest.az', sha256(convert_to('collab-qala', 'UTF8')), seed_id('user:orxan'),
   now() - interval '38 days', now() - interval '37 days', now() - interval '24 days',
   now() - interval '37 days', NULL, NULL),
  (seed_id('collab:tumar:pending'), seed_id('project:tumar'), NULL,
   'redaktor@example.az', sha256(convert_to('collab-pending', 'UTF8')), seed_id('user:creator'),
   now() - interval '3 days', now() - interval '3 days', now() + interval '11 days',
   NULL, NULL, NULL),
  (seed_id('collab:ipek:revoked'), seed_id('project:ipek'), NULL,
   'kohne@example.az', sha256(convert_to('collab-revoked', 'UTF8')), seed_id('user:gunel'),
   now() - interval '60 days', now() - interval '30 days', now() - interval '46 days',
   NULL, now() - interval '30 days', seed_id('user:gunel'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO collaborator_capabilities (collaborator_id, capability) VALUES
  (seed_id('collab:tumar:accepted'), 'EDIT_BASICS'),
  (seed_id('collab:tumar:accepted'), 'EDIT_REWARDS'),
  (seed_id('collab:tumar:accepted'), 'PUBLISH_UPDATES'),
  (seed_id('collab:tumar:accepted'), 'RESPOND_TO_COMMENTS'),
  (seed_id('collab:tumar:accepted'), 'MANAGE_FAQ'),
  (seed_id('collab:qala:accepted'), 'PUBLISH_UPDATES'),
  (seed_id('collab:qala:accepted'), 'RESPOND_TO_COMMENTS'),
  (seed_id('collab:tumar:pending'), 'EDIT_STORY'),
  (seed_id('collab:tumar:pending'), 'MANAGE_FAQ')
ON CONFLICT (collaborator_id, capability) DO NOTHING;

-- ── Backer segments and the messages sent to them ───────────────────────────

INSERT INTO backer_segments (id, project_id, name, states, reward_tier_ids, countries, term,
                             created_by, created_at, updated_at) VALUES
  (seed_id('segment:tumar:all'), seed_id('project:tumar'), 'Bütün dəstəkçilər',
   ARRAY['CONFIRMED', 'COLLECTED'], NULL, NULL, NULL,
   seed_id('user:creator'), now() - interval '20 days', now() - interval '20 days'),
  (seed_id('segment:tumar:ucluk'), seed_id('project:tumar'), 'Üçlük dəst alanlar',
   ARRAY['CONFIRMED'], ARRAY[seed_id('tier:tumar:ucluk')], NULL, NULL,
   seed_id('user:creator'), now() - interval '12 days', now() - interval '12 days'),
  (seed_id('segment:qab:xarici'), seed_id('project:qab'), 'Xaricə göndərilənlər',
   ARRAY['FULFILLED'], NULL, ARRAY['TR', 'GE', 'DE'], NULL,
   seed_id('user:orxan'), now() - interval '40 days', now() - interval '40 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaign_messages (id, project_id, segment_id, segment_name, sent_by, subject, body,
                               recipient_count, truncated, created_at) VALUES
  (seed_id('message:tumar:1'), seed_id('project:tumar'), seed_id('segment:tumar:all'), 'Bütün dəstəkçilər',
   seed_id('user:creator'), 'Naxış seçimi üçün sorğu göndərildi',
   'Salam! Sorğu linkini e-poçtunuza göndərdik. Xahiş edirik bir həftə ərzində naxışınızı seçin — cavab verməyənlərə standart naxış göndərilir.',
   612, false, now() - interval '4 days'),
  (seed_id('message:qab:1'), seed_id('project:qab'), seed_id('segment:qab:xarici'), 'Xaricə göndərilənlər',
   seed_id('user:orxan'), 'Xarici göndərişlər üçün gömrük sənədləri',
   'Xaricə göndərilən bağlamalar üçün gömrük bəyannaməsi tələb olunur. Sənəd bağlamaya əlavə edilib.',
   38, false, now() - interval '30 days'),
  (seed_id('message:tumar:2'), seed_id('project:tumar'), NULL, NULL,
   seed_id('user:creator'), 'Son 48 saat',
   'Kampaniyanın bitməsinə iki gün qalıb. Erkən quş mükafatı artıq bitib, qalan mükafatlar hələ mövcuddur.',
   612, false, now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── Surveys ─────────────────────────────────────────────────────────────────

INSERT INTO surveys (id, project_id, title, message, respond_by, sent_at, sent_to, created_by, created_at, updated_at) VALUES
  (seed_id('survey:albom'), seed_id('project:albom'), 'Vinil və çatdırılma məlumatı',
   'Albom hazırlanır. Vinil ölçüsü və çatdırılma ünvanınızı təsdiqləyin.',
   now() + interval '14 days', now() - interval '4 days', 166,
   seed_id('user:ramin'), now() - interval '6 days', now() - interval '4 days'),
  (seed_id('survey:qab'), seed_id('project:qab'), 'Rəng seçimi və ünvan',
   'Göndərişdən əvvəl rəng seçiminizi və ünvanınızı təsdiqləyin.',
   now() - interval '40 days', now() - interval '70 days', 145,
   seed_id('user:orxan'), now() - interval '72 days', now() - interval '70 days'),
  (seed_id('survey:masa'), seed_id('project:masa'), 'Dil seçimi',
   'Oyunun qaydalar kitabçasını hansı dildə istəyirsiniz?',
   NULL, NULL, NULL,
   seed_id('user:orxan'), now() - interval '10 days', now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO survey_questions (id, survey_id, project_id, position, prompt, help_text, type, required, choices, reward_tier_id, created_at) VALUES
  (seed_id('sq:albom:1'), seed_id('survey:albom'), seed_id('project:albom'), 0,
   'Vinil rəngini seçin', 'Qara standartdır və əlavə ödəniş tələb etmir.', 'CHOICE', true,
   ARRAY['Qara', 'Şəffaf', 'Mavi'], seed_id('tier:albom:vinil'), now() - interval '6 days'),
  (seed_id('sq:albom:2'), seed_id('survey:albom'), seed_id('project:albom'), 1,
   'Çatdırılma ünvanınız', NULL, 'ADDRESS', false, NULL, NULL, now() - interval '6 days'),
  (seed_id('sq:albom:3'), seed_id('survey:albom'), seed_id('project:albom'), 2,
   'İmzalı nüsxə istəyirsinizmi?', NULL, 'CHOICE', true, ARRAY['Bəli', 'Xeyr'], NULL, now() - interval '6 days'),
  (seed_id('sq:qab:1'), seed_id('survey:qab'), seed_id('project:qab'), 0,
   'Qabın rəngi', NULL, 'CHOICE', true, ARRAY['Ağ', 'Qara', 'Yaşıl'], NULL, now() - interval '72 days'),
  (seed_id('sq:qab:2'), seed_id('survey:qab'), seed_id('project:qab'), 1,
   'Çatdırılma ünvanınız', NULL, 'ADDRESS', false, NULL, NULL, now() - interval '72 days'),
  (seed_id('sq:masa:1'), seed_id('survey:masa'), seed_id('project:masa'), 0,
   'Qaydalar kitabçasının dili', NULL, 'MULTI_CHOICE', true,
   ARRAY['Azərbaycan', 'İngilis', 'Rus'], NULL, now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

-- Roughly two thirds of the backers on the sent surveys answered.
INSERT INTO survey_responses (id, survey_id, pledge_id, backer_id, submitted_at, created_at)
SELECT seed_id('sr:' || s.id::text || ':' || p.id::text), s.id, p.id, p.backer_id,
       s.sent_at + interval '2 days', s.sent_at + interval '2 days'
FROM surveys s
JOIN pledges p ON p.project_id = s.project_id AND p.state IN ('COLLECTED', 'FULFILLED')
WHERE s.sent_at IS NOT NULL
  AND seed_rand('survey:' || s.id::text || p.id::text) < 0.66
ON CONFLICT (id) DO NOTHING;

INSERT INTO survey_answers (response_id, question_id, survey_id, value, created_at, updated_at)
SELECT r.id, q.id, q.survey_id,
       CASE WHEN q.type = 'ADDRESS'
            THEN ARRAY['Bakı', 'Nizami küç. 12', 'AZ1000']
            ELSE ARRAY[q.choices[1 + (seed_rand('ans:' || r.id::text || q.id::text)
                                      * cardinality(q.choices))::int % cardinality(q.choices)]] END,
       r.submitted_at, r.submitted_at
FROM survey_responses r
JOIN survey_questions q ON q.survey_id = r.survey_id
ON CONFLICT (response_id, question_id) DO NOTHING;

-- ── Referral attribution ────────────────────────────────────────────────────

INSERT INTO referral_touches (id, project_id, visitor_hash, backer_id, channel, source, campaign,
                              referrer_code, occurred_at, expires_at)
SELECT seed_id('touch:' || p.id::text), p.project_id,
       sha256(convert_to('visitor' || p.id::text, 'UTF8')), p.backer_id,
       CASE p.referrer_code
            WHEN 'instagram' THEN 'SOCIAL' WHEN 'telegram' THEN 'SOCIAL'
            WHEN 'newsletter' THEN 'EMAIL' ELSE 'REFERRAL_LINK' END,
       p.referrer_code, 'launch', p.referrer_code,
       p.created_at - interval '2 hours', p.created_at + interval '30 days'
FROM pledges p WHERE p.referrer_code IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO referral_attributions (id, pledge_id, project_id, touch_id, channel, source, campaign,
                                   referrer_code, amount, currency, pledged_at, attributed_at, event_id)
SELECT seed_id('attr:' || p.id::text), p.id, p.project_id, seed_id('touch:' || p.id::text),
       CASE p.referrer_code
            WHEN 'instagram' THEN 'SOCIAL' WHEN 'telegram' THEN 'SOCIAL'
            WHEN 'newsletter' THEN 'EMAIL' ELSE 'REFERRAL_LINK' END,
       p.referrer_code, 'launch', p.referrer_code,
       p.total_amount, p.currency, p.created_at, p.created_at, seed_id('attrevent:' || p.id::text)
FROM pledges p WHERE p.referrer_code IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- ── Analytics rollups ───────────────────────────────────────────────────────
--
-- Derived from the pledges rather than invented, so the daily chart on a
-- creator dashboard adds up to the total on the campaign page.

INSERT INTO project_analytics_daily (project_id, day, time_zone, currency, pledge_count, amount,
                                     cumulative_pledge_count, cumulative_amount, computed_at)
SELECT d.project_id, d.day, 'Asia/Baku', 'AZN', d.pledge_count, d.amount,
       sum(d.pledge_count) OVER (PARTITION BY d.project_id ORDER BY d.day),
       sum(d.amount) OVER (PARTITION BY d.project_id ORDER BY d.day),
       now()
FROM (
    SELECT p.project_id, (p.created_at AT TIME ZONE 'Asia/Baku')::date AS day,
           count(*) AS pledge_count, sum(p.total_amount) AS amount
    FROM pledges p
    WHERE p.state NOT IN ('DRAFT', 'EXPIRED')
    GROUP BY p.project_id, (p.created_at AT TIME ZONE 'Asia/Baku')::date
) d
ON CONFLICT (project_id, day) DO NOTHING;

INSERT INTO project_analytics_daily_channels (project_id, day, channel, pledge_count, amount)
SELECT p.project_id, (p.created_at AT TIME ZONE 'Asia/Baku')::date,
       CASE p.referrer_code
            WHEN 'instagram' THEN 'SOCIAL' WHEN 'telegram' THEN 'SOCIAL'
            WHEN 'newsletter' THEN 'EMAIL' WHEN 'friend' THEN 'REFERRAL_LINK'
            ELSE 'DIRECT' END,
       count(*), sum(p.total_amount)
FROM pledges p
WHERE p.state NOT IN ('DRAFT', 'EXPIRED')
GROUP BY p.project_id, (p.created_at AT TIME ZONE 'Asia/Baku')::date,
         CASE p.referrer_code
              WHEN 'instagram' THEN 'SOCIAL' WHEN 'telegram' THEN 'SOCIAL'
              WHEN 'newsletter' THEN 'EMAIL' WHEN 'friend' THEN 'REFERRAL_LINK'
              ELSE 'DIRECT' END
ON CONFLICT (project_id, day, channel) DO NOTHING;

-- ── Audit trail ─────────────────────────────────────────────────────────────
--
-- The action codes and entity types below are the ones `AuditAction` actually writes,
-- lower-cased exactly as the enum spells them -- issue #403. They were invented here
-- (`project.suspend`, `PROJECT`) and the console's catalogue could not name a single one,
-- so every row on `/admin/audit` read as a machine code under a translated heading.
--
-- Five keep an invented code deliberately: the platform audits neither the finalisation of
-- a campaign nor the publication of a collection nor a sign-in, so there is no real action
-- to use and borrowing one would describe a different event. `AuditTrailView` draws an
-- action it has no sentence for as itself, and these five are what that looks like.

INSERT INTO audit_logs (id, occurred_at, actor_type, actor_id, on_behalf_of_id, action, entity_type,
                        entity_id, outcome, source_address, user_agent, request_id, trace_id, detail) VALUES
  (seed_id('audit:1'), now() - interval '11 days', 'MODERATOR', seed_id('user:moderator'), NULL,
   'project.suspended', 'project', seed_id('project:saxta'), 'SUCCEEDED', '10.0.0.14',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 'req-a1f2', 'trace-9d1', 'Şikayət #2 üzrə.'),
  (seed_id('audit:2'), now() - interval '12 days', 'MODERATOR', seed_id('user:moderator'), NULL,
   'account.suspended', 'account', seed_id('user:spammer'), 'SUCCEEDED', '10.0.0.14',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 'req-a1f3', 'trace-9d2', 'Təkrarlanan spam.'),
  (seed_id('audit:3'), now() - interval '13 days', 'MODERATOR', seed_id('user:moderator'), NULL,
   'project.comment_removed', 'project', seed_id('project:tumar'), 'SUCCEEDED', '10.0.0.14',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 'req-a1f4', 'trace-9d3', NULL),
  (seed_id('audit:4'), now() - interval '2 days', 'USER', seed_id('user:finance'), NULL,
   'payout.approved', 'payout', seed_id('payout:qab'), 'SUCCEEDED', '10.0.0.21',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/18.0', 'req-b220', 'trace-c11', 'Birinci təsdiq.'),
  (seed_id('audit:5'), now() - interval '2 days', 'USER', seed_id('user:finance'), NULL,
   'payout.approved', 'payout', seed_id('payout:qab'), 'REFUSED', '10.0.0.21',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/18.0', 'req-b221', 'trace-c12',
   'Eyni istifadəçi ikinci təsdiqi verə bilməz.'),
  (seed_id('audit:6'), now() - interval '6 days', 'USER', seed_id('user:finance'), NULL,
   'refund.issued', 'refund', seed_id('refund:pending'), 'SUCCEEDED', '10.0.0.21',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/18.0', 'req-b230', 'trace-c20', NULL),
  (seed_id('audit:7'), now() - interval '20 days', 'USER', seed_id('user:admin'), NULL,
   'fee.schedule_changed', 'fee_schedule', seed_id('fee:cat:journalism'), 'SUCCEEDED', '10.0.0.9',
   'Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0', 'req-c001', 'trace-e01',
   'Jurnalistika kateqoriyası üçün endirimli dərəcə.'),
  (seed_id('audit:8'), now() - interval '7 days', 'USER', seed_id('user:admin'), NULL,
   'feature.flag_changed', 'feature_flag', seed_id('flag:cohorts'), 'SUCCEEDED', '10.0.0.9',
   'Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0', 'req-c002', 'trace-e02',
   'creator-analytics-cohorts: yalnız iki hesab üçün.'),
  (seed_id('audit:9'), now() - interval '20 days', 'USER', seed_id('user:curator'), NULL,
   'collection.publish', 'collection', seed_id('collection:qis'), 'SUCCEEDED', '10.0.0.33',
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/141.0', 'req-d100', 'trace-f10', NULL),
  (seed_id('audit:10'), now() - interval '30 minutes', 'SYSTEM', NULL, NULL,
   'campaign.finalize', 'project', seed_id('project:usta'), 'SUCCEEDED', NULL, NULL,
   'job-campaign-finalizer', 'trace-sys-1', 'Kampaniya müddəti bitdi, hədəfə çatıldı.'),
  (seed_id('audit:11'), now() - interval '30 minutes', 'SYSTEM', NULL, NULL,
   'campaign.finalize', 'project', seed_id('project:komiks'), 'SUCCEEDED', NULL, NULL,
   'job-campaign-finalizer', 'trace-sys-2', 'Kampaniya müddəti bitdi, hədəfə çatılmadı.'),
  (seed_id('audit:12'), now() - interval '3 days', 'USER', seed_id('user:admin'), NULL,
   'staff.role_granted', 'account', seed_id('user:curator'), 'SUCCEEDED', '10.0.0.9',
   'Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0', 'req-c010', 'trace-e10', 'CURATOR rolu verildi.'),
  (seed_id('audit:13'), now() - interval '5 days', 'USER', seed_id('user:zaur'), NULL,
   'auth.login', 'account', seed_id('user:zaur'), 'FAILED', '95.85.10.4',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2) Safari/18.2', 'req-x900', 'trace-x90',
   'Yanlış parol, üçüncü cəhd.'),
  (seed_id('audit:14'), now() - interval '5 days', 'USER', seed_id('user:zaur'), NULL,
   'auth.login', 'account', seed_id('user:zaur'), 'SUCCEEDED', '95.85.10.4',
   'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2) Safari/18.2', 'req-x901', 'trace-x91', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── Email delivery log ──────────────────────────────────────────────────────

INSERT INTO email_deliveries (id, notification_id, digest_id, member_count, recipient_id, type,
                              outcome, attempt, subject, message_id, detail, accepted_at, created_at)
SELECT seed_id('delivery:' || n.id::text), n.id, NULL, 1, n.recipient_id, n.type,
       'ACCEPTED', 1,
       'IdeaNest: ' || (n.params ->> 'projectTitle'),
       '<' || substr(md5(n.id::text), 1, 20) || '@ideanest.az>',
       NULL, n.sent_at, n.sent_at
FROM notifications n
WHERE n.state = 'SENT' AND n.sent_at IS NOT NULL AND n.params ? 'projectTitle'
  AND seed_rand('mail:' || n.id::text) < 0.30
ON CONFLICT (id) DO NOTHING;

INSERT INTO email_deliveries (id, notification_id, digest_id, member_count, recipient_id, type,
                              outcome, attempt, subject, message_id, detail, accepted_at, created_at)
SELECT seed_id('delivery:dead:' || n.id::text), n.id, NULL, 1, n.recipient_id, n.type,
       'REFUSED', 5, NULL, NULL, n.last_error, NULL, n.created_at
FROM notifications n WHERE n.state = 'DEAD'
ON CONFLICT (id) DO NOTHING;

COMMIT;
