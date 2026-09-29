-- Accounts: one per role the platform recognises, plus the creators and backers
-- the rest of the seed hangs off. Every one signs in with the same password
-- (see 00_helpers.sql); the demo is about what each role can see, not about
-- credential handling.

INSERT INTO users (id, email, email_verified_at, name, slug, avatar_url, bio, locale, currency,
                   profile_visibility, website_url, location_id, created_at)
VALUES
  -- Staff
  (seed_id('user:admin'), 'admin@ideanest.az', now() - interval '400 days',
   'Aysel Məmmədova', 'aysel-mammadova', 'https://i.pravatar.cc/300?img=47',
   'IdeyaNest platformasının administratoru. Məhsul, etibar və təhlükəsizlik komandalarının işini əlaqələndirir.',
   'az', 'AZN', 'PUBLIC', 'https://ideanest.az/about', seed_location('baki'), now() - interval '400 days'),

  (seed_id('user:moderator'), 'moderator@ideanest.az', now() - interval '380 days',
   'Rəşad Quliyev', 'rashad-quliyev', 'https://i.pravatar.cc/300?img=12',
   'Moderasiya komandası. Kampaniya təqdimatlarını və şikayətləri nəzərdən keçirir.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('baki'), now() - interval '380 days'),

  (seed_id('user:curator'), 'curator@ideanest.az', now() - interval '360 days',
   'Nigar Həsənova', 'nigar-hasanova', 'https://i.pravatar.cc/300?img=32',
   'Kurator. Redaksiya kolleksiyalarını və açıq çağırışları hazırlayır.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('gence'), now() - interval '360 days'),

  (seed_id('user:finance'), 'finance@ideanest.az', now() - interval '350 days',
   'Elvin Abbasov', 'elvin-abbasov', 'https://i.pravatar.cc/300?img=60',
   'Maliyyə əməliyyatları. Ödənişlər, geri qaytarmalar və mübahisələr.',
   'az', 'AZN', 'PRIVATE', NULL, seed_location('baki'), now() - interval '350 days'),

  (seed_id('user:superadmin'), 'superadmin@ideanest.az', now() - interval '420 days',
   'Kamran Əliyev', 'kamran-aliyev', 'https://i.pravatar.cc/300?img=68',
   'Bütün konsol rollarına sahib demo hesabı. Yalnız lokal mühit üçün.',
   'az', 'AZN', 'PRIVATE', NULL, seed_location('baki'), now() - interval '420 days'),

  -- Creators
  (seed_id('user:creator'), 'creator@ideanest.az', now() - interval '300 days',
   'Leyla Səfərova', 'leyla-safarova', 'https://i.pravatar.cc/300?img=5',
   'Sənaye dizayneri və məhsul qurucusu. Bakıda kiçik bir emalatxana idarə edirəm — Azərbaycan xalçaçılığının naxışlarını gündəlik əşyalara gətirməyə çalışıram. IdeyaNest-də üç kampaniya keçirmişəm.',
   'az', 'AZN', 'PUBLIC', 'https://tumar.studio', seed_location('baki'), now() - interval '300 days'),

  (seed_id('user:orxan'), 'orxan@ideanest.az', now() - interval '280 days',
   'Orxan Nəbiyev', 'orxan-nabiyev', 'https://i.pravatar.cc/300?img=52',
   'Oyun tərtibatçısı. Kiçik komanda, böyük xəritələr. Qafqaz mifologiyası üzərində işləyirəm.',
   'az', 'AZN', 'PUBLIC', 'https://qalastudio.az', seed_location('sumqayit'), now() - interval '280 days'),

  (seed_id('user:gunel'), 'gunel@ideanest.az', now() - interval '260 days',
   'Günel Rzayeva', 'gunel-rzayeva', 'https://i.pravatar.cc/300?img=20',
   'Sənədli film rejissoru. Kəndlərdə itməkdə olan sənətkarlıqları çəkirəm.',
   'az', 'AZN', 'PUBLIC', 'https://gunelfilms.az', seed_location('seki'), now() - interval '260 days'),

  (seed_id('user:tural'), 'tural@ideanest.az', now() - interval '240 days',
   'Tural İsmayılov', 'tural-ismayilov', 'https://i.pravatar.cc/300?img=33',
   'Qəhvə qovurucusu. Bakıda kiçik bir qovurma sexi və çox uzun bir səhər növbəsi.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('baki'), now() - interval '240 days'),

  (seed_id('user:sevinc'), 'sevinc@ideanest.az', now() - interval '220 days',
   'Sevinc Bayramova', 'sevinc-bayramova', 'https://i.pravatar.cc/300?img=45',
   'Nəşriyyatçı və illüstrator. Uşaqlar üçün Azərbaycan dilində kitablar hazırlayıram.',
   'az', 'AZN', 'PUBLIC', 'https://naringitab.az', seed_location('qebele'), now() - interval '220 days'),

  (seed_id('user:ramin'), 'ramin@ideanest.az', now() - interval '200 days',
   'Ramin Cəfərov', 'ramin-jafarov', 'https://i.pravatar.cc/300?img=59',
   'Musiqiçi. Tar, sintezator və aralarındakı hər şey.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('lenkeran'), now() - interval '200 days'),

  -- Backers
  (seed_id('user:backer'), 'backer@ideanest.az', now() - interval '180 days',
   'Nurlan Əhmədov', 'nurlan-ahmadov', 'https://i.pravatar.cc/300?img=13',
   'Yeni başlayan layihələri dəstəkləməyi sevirəm.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('baki'), now() - interval '180 days'),

  (seed_id('user:aygun'), 'aygun@ideanest.az', now() - interval '170 days',
   'Aygün Vəliyeva', 'aygun-valiyeva', 'https://i.pravatar.cc/300?img=25',
   'Dizayn və nəşriyyat layihələrinin daimi dəstəkçisi.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('gence'), now() - interval '170 days'),

  (seed_id('user:emin'), 'emin@ideanest.az', now() - interval '160 days',
   'Emin Salmanov', 'emin-salmanov', 'https://i.pravatar.cc/300?img=51', NULL,
   'en', 'AZN', 'PUBLIC', NULL, seed_location('baki'), now() - interval '160 days'),

  (seed_id('user:lale'), 'lale@ideanest.az', now() - interval '150 days',
   'Lalə Muradova', 'lala-muradova', 'https://i.pravatar.cc/300?img=41',
   'Oyunlar, komikslər və bir az da qəhvə.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('sumqayit'), now() - interval '150 days'),

  (seed_id('user:ferid'), 'ferid@ideanest.az', now() - interval '140 days',
   'Fərid Həsənli', 'farid-hasanli', 'https://i.pravatar.cc/300?img=15', NULL,
   'az', 'AZN', 'PUBLIC', NULL, seed_location('quba'), now() - interval '140 days'),

  (seed_id('user:zaur'), 'zaur@ideanest.az', now() - interval '130 days',
   'Zaur Qasımov', 'zaur-qasimov', 'https://i.pravatar.cc/300?img=8', NULL,
   'ru', 'AZN', 'PRIVATE', NULL, seed_location('baki'), now() - interval '130 days'),

  (seed_id('user:nezrin'), 'nezrin@ideanest.az', now() - interval '120 days',
   'Nəzrin Əliyeva', 'nazrin-aliyeva', 'https://i.pravatar.cc/300?img=28',
   'Musiqi və teatr layihələrini izləyirəm.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('naxcivan'), now() - interval '120 days'),

  (seed_id('user:samir'), 'samir@ideanest.az', now() - interval '110 days',
   'Samir Bağırov', 'samir-bagirov', 'https://i.pravatar.cc/300?img=57', NULL,
   'tr', 'AZN', 'PUBLIC', NULL, seed_location('xacmaz'), now() - interval '110 days'),

  -- A collaborator, and an account trust and safety has suspended
  (seed_id('user:collab'), 'collab@ideanest.az', now() - interval '190 days',
   'Vüsal Məmmədli', 'vusal-mammadli', 'https://i.pravatar.cc/300?img=64',
   'Kampaniya menecerliyi. Başqalarının layihələrində əməkdaşlıq edirəm.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('baki'), now() - interval '190 days'),

  (seed_id('user:spammer'), 'spam@ideanest.az', now() - interval '40 days',
   'Faked Deals', 'faked-deals', NULL,
   'Ən ucuz qiymətlər. Link profildə.',
   'en', 'AZN', 'PUBLIC', NULL, NULL, now() - interval '40 days')
ON CONFLICT (id) DO NOTHING;

-- The suspension is a separate statement because the constraint requires a
-- moderator who is not the suspended account, and that row has to exist first.
UPDATE users SET
    suspended_at = now() - interval '12 days',
    suspended_by = seed_id('user:moderator'),
    suspension_reason = 'Təkrarlanan spam şərhləri və saxta endirim linkləri.'
WHERE id = seed_id('user:spammer');

-- Everybody signs in with the same password.
INSERT INTO user_credentials (user_id, password_hash, password_changed_at, created_at)
SELECT u.id, seed_password(), u.created_at, u.created_at
FROM users u
ON CONFLICT (user_id) DO NOTHING;

-- Console roles.
INSERT INTO staff_role_grants (account_id, role, granted_at, granted_by, note) VALUES
  (seed_id('user:admin'),      'ADMINISTRATOR', now() - interval '400 days', seed_id('user:superadmin'), 'Platforma administratoru.'),
  (seed_id('user:moderator'),  'MODERATOR',     now() - interval '380 days', seed_id('user:admin'),      'Etibar və təhlükəsizlik.'),
  (seed_id('user:curator'),    'CURATOR',       now() - interval '360 days', seed_id('user:admin'),      'Redaksiya kurasiyası.'),
  (seed_id('user:finance'),    'FINANCE',       now() - interval '350 days', seed_id('user:admin'),      'Maliyyə əməliyyatları.'),
  (seed_id('user:superadmin'), 'ADMINISTRATOR', now() - interval '420 days', seed_id('user:superadmin'), 'Lokal demo: bütün rollar.'),
  (seed_id('user:superadmin'), 'MODERATOR',     now() - interval '420 days', seed_id('user:superadmin'), 'Lokal demo: bütün rollar.'),
  (seed_id('user:superadmin'), 'CURATOR',       now() - interval '420 days', seed_id('user:superadmin'), 'Lokal demo: bütün rollar.'),
  (seed_id('user:superadmin'), 'FINANCE',       now() - interval '420 days', seed_id('user:superadmin'), 'Lokal demo: bütün rollar.')
ON CONFLICT (account_id, role) DO NOTHING;

-- Public profile links.
INSERT INTO user_social_links (id, user_id, platform, url, position) VALUES
  (seed_id('social:creator:instagram'), seed_id('user:creator'), 'INSTAGRAM', 'https://instagram.com/tumar.studio', 0),
  (seed_id('social:creator:behance'),   seed_id('user:creator'), 'BEHANCE',   'https://behance.net/tumarstudio',   1),
  (seed_id('social:orxan:github'),      seed_id('user:orxan'),   'GITHUB',    'https://github.com/qalastudio',     0),
  (seed_id('social:orxan:x'),           seed_id('user:orxan'),   'X',         'https://x.com/qalastudio',          1),
  (seed_id('social:gunel:youtube'),     seed_id('user:gunel'),   'YOUTUBE',   'https://youtube.com/@gunelfilms',   0),
  (seed_id('social:tural:instagram'),   seed_id('user:tural'),   'INSTAGRAM', 'https://instagram.com/qovurma.baku',0),
  (seed_id('social:sevinc:facebook'),   seed_id('user:sevinc'),  'FACEBOOK',  'https://facebook.com/naringitab',   0),
  (seed_id('social:sevinc:telegram'),   seed_id('user:sevinc'),  'TELEGRAM',  'https://t.me/naringitab',           1),
  (seed_id('social:ramin:youtube'),     seed_id('user:ramin'),   'YOUTUBE',   'https://youtube.com/@ramincafarov', 0),
  (seed_id('social:ramin:tiktok'),      seed_id('user:ramin'),   'TIKTOK',    'https://tiktok.com/@ramincafarov',  1)
ON CONFLICT (id) DO NOTHING;

-- Two more creators, so that thirteen live campaigns are not all run by six
-- people. A discovery feed where every third card carries the same byline reads
-- as a seeded database rather than a marketplace.
INSERT INTO users (id, email, email_verified_at, name, slug, avatar_url, bio, locale, currency,
                   profile_visibility, website_url, location_id, created_at)
VALUES
  (seed_id('user:aysu'), 'aysu@ideanest.az', now() - interval '270 days',
   'Aysu Kərimova', 'aysu-karimova', 'https://i.pravatar.cc/300?img=36',
   'Fotoqraf və küçə sənəti arxivçisi. Bakının divarlarını on ildir çəkirəm.',
   'az', 'AZN', 'PUBLIC', 'https://divararxiv.az', seed_location('baki'), now() - interval '270 days'),
  (seed_id('user:elnur'), 'elnur@ideanest.az', now() - interval '250 days',
   'Elnur Şirinov', 'elnur-shirinov', 'https://i.pravatar.cc/300?img=11',
   'Mühəndis. Kənd təsərrüfatı üçün ucuz sensorlar qururam və sxemləri açıq paylaşıram.',
   'az', 'AZN', 'PUBLIC', NULL, seed_location('quba'), now() - interval '250 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_credentials (user_id, password_hash, password_changed_at, created_at)
SELECT u.id, seed_password(), u.created_at, u.created_at FROM users u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_social_links (id, user_id, platform, url, position) VALUES
  (seed_id('social:aysu:instagram'), seed_id('user:aysu'),  'INSTAGRAM', 'https://instagram.com/divararxiv', 0),
  (seed_id('social:elnur:github'),   seed_id('user:elnur'), 'GITHUB',    'https://github.com/elnursensor',  0)
ON CONFLICT (id) DO NOTHING;
