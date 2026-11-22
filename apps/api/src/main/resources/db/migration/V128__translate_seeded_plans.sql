-- The three plans V62 seeded, in every language the platform speaks (#655).
--
-- ---------------------------------------------------------------------------
-- Reverse:
--   Only the rows this migration wrote, still exactly as it wrote them.
--   UPDATE subscription_plans
--      SET name = 'Starter',
--          description = 'One campaign at a time, up to a 10,000 AZN goal. For a first project.',
--          translations = '{}'::jsonb
--    WHERE code = 'STARTER' AND name = 'Başlanğıc';
--   UPDATE subscription_plans
--      SET name = 'Growth',
--          description = 'Three campaigns at a time, up to a 100,000 AZN goal.',
--          translations = '{}'::jsonb
--    WHERE code = 'GROWTH' AND name = 'İnkişaf';
--   UPDATE subscription_plans
--      SET name = 'Pro',
--          description = 'As many campaigns as you can run, with no goal ceiling.',
--          translations = '{}'::jsonb
--    WHERE code = 'PRO' AND name = 'Pro'
--      AND description = 'İstədiyiniz qədər kampaniya, hədəf tavanı yoxdur.';
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- Contract: none. Data only; the previous release reads the same columns.
-- ---------------------------------------------------------------------------
--
-- V62 wrote English into `name` and `description`, which V113 then defined as
-- the Azerbaijani primary text, and left `translations` empty -- so every reader,
-- in every language, was shown English. This puts Azerbaijani where V113 says it
-- belongs and the English V62 wrote into `translations.en`, beside Russian and
-- Turkish.
--
-- ONLY A ROW STILL HOLDING V62'S SEED IS TOUCHED. Each UPDATE is guarded on the
-- code, the seeded name and description, and an empty `translations`: a plan an
-- operator has renamed, re-described or translated from the console is theirs,
-- and a migration overwriting it would silently undo a decision somebody made.

UPDATE subscription_plans
   SET name = 'Başlanğıc',
       description = 'Eyni anda bir kampaniya, hədəf 10 000 AZN-ə qədər. İlk layihə üçün.',
       translations = '{"en": {"name": "Starter", "description": "One campaign at a time, up to a 10,000 AZN goal. For a first project."},
                        "ru": {"name": "Старт", "description": "Одна кампания одновременно, цель до 10 000 AZN. Для первого проекта."},
                        "tr": {"name": "Başlangıç", "description": "Aynı anda bir kampanya, 10.000 AZN''ye kadar hedef. İlk proje için."}}'::jsonb,
       updated_at = now()
 WHERE code = 'STARTER'
   AND name = 'Starter'
   AND description = 'One campaign at a time, up to a 10,000 AZN goal. For a first project.'
   AND translations = '{}'::jsonb;

UPDATE subscription_plans
   SET name = 'İnkişaf',
       description = 'Eyni anda üç kampaniya, hədəf 100 000 AZN-ə qədər.',
       translations = '{"en": {"name": "Growth", "description": "Three campaigns at a time, up to a 100,000 AZN goal."},
                        "ru": {"name": "Рост", "description": "Три кампании одновременно, цель до 100 000 AZN."},
                        "tr": {"name": "Büyüme", "description": "Aynı anda üç kampanya, 100.000 AZN''ye kadar hedef."}}'::jsonb,
       updated_at = now()
 WHERE code = 'GROWTH'
   AND name = 'Growth'
   AND description = 'Three campaigns at a time, up to a 100,000 AZN goal.'
   AND translations = '{}'::jsonb;

UPDATE subscription_plans
   SET name = 'Pro',
       description = 'İstədiyiniz qədər kampaniya, hədəf tavanı yoxdur.',
       translations = '{"en": {"name": "Pro", "description": "As many campaigns as you can run, with no goal ceiling."},
                        "ru": {"name": "Про", "description": "Сколько угодно кампаний, без ограничения цели."},
                        "tr": {"name": "Pro", "description": "İstediğiniz kadar kampanya, hedef sınırı yok."}}'::jsonb,
       updated_at = now()
 WHERE code = 'PRO'
   AND name = 'Pro'
   AND description = 'As many campaigns as you can run, with no goal ceiling.'
   AND translations = '{}'::jsonb;
