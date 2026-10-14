-- Updates, comments, saves, follows and the notification inbox.
--
-- The comment tree is two levels deep because the schema says it is: depth is
-- constrained to 0 or 1, a root comment heads its own thread, and a reply
-- carries its parent's thread. Anything written here that broke that rule would
-- be rejected by a check constraint rather than by review, which is the point
-- of having written it as a constraint.

BEGIN;

-- ── Campaign updates ────────────────────────────────────────────────────────

INSERT INTO project_updates (id, project_id, number, title, body, visibility, author_id, published_at, created_at) VALUES
  (seed_id('update:tumar:1'), seed_id('project:tumar'), 1, 'Başladıq və ilk gündə 40%',
   'İlk 24 saatda 312 nəfər dəstək oldu. Bunu gözləmirdik. Çap üçün razılaşdığımız mətbəə ilə yenidən danışdıq və indi daha böyük partiya sifariş edə bilərik — yəni gözləmə müddəti qısalır.

Sualı ən çox verilən şey naxış seçimi oldu. Kampaniya bitəndən sonra hər dəstəkçiyə sorğu göndəririk və on iki naxışdan birini seçirsiniz. Seçim etmək məcburi deyil — cavab verməyənlərə "Bərdə 4" naxışı göndərilir.',
   'PUBLIC', seed_id('user:creator'), now() - interval '36 days', now() - interval '36 days'),

  (seed_id('update:tumar:2'), seed_id('project:tumar'), 2, 'Kağız gəldi, nümunələr hazırdır',
   'Kağız keçən həftə gömrükdən çıxdı və mətbəəyə çatdı. İlk cild nümunəsini çəkdik — səhifə açılışı düz durur, bu bizim üçün ən vacib məsələ idi.

Bir dəyişiklik: üzlüyün küncləri ilkin dizayndakından bir az daha yumşaq olacaq. Sərt künc daşınmada əzilir və bunu nümunədə gördük.',
   'PUBLIC', seed_id('user:creator'), now() - interval '19 days', now() - interval '19 days'),

  (seed_id('update:tumar:3'), seed_id('project:tumar'), 3, 'Dəstəkçilər üçün: göndərmə cədvəli',
   'Bu yeniləmə yalnız dəstəkçilər üçündür.

Cədvəl belədir: kampaniya bitdikdən 3 gün sonra sorğu, 10 gün sonra istehsal başlayır, 6 həftə sonra ilk göndərişlər. Bakı daxilində çatdırılma 2-3 gün, region 4-6 gün çəkir.

Sorğuya cavab verməsəniz göndərmə gecikir. Xahiş edirik ilk həftə ərzində cavablandırın.',
   'BACKERS_ONLY', seed_id('user:creator'), now() - interval '5 days', now() - interval '5 days'),

  (seed_id('update:qala:1'), seed_id('project:qala'), 1, 'Demo yeniləndi: saxlama sistemi',
   'Demoda ən çox şikayət saxlama sistemi haqqında idi — oyunu bağlayanda irəliləyiş itirdi. Düzəltdik. Yeni demo eyni linkdədir.

Beta test qrupu üçün: ilk dəvətlər üç ay sonra göndəriləcək, oyunun ikinci fəsli hazır olanda.',
   'PUBLIC', seed_id('user:orxan'), now() - interval '24 days', now() - interval '24 days'),

  (seed_id('update:qala:2'), seed_id('project:qala'), 2, 'Səsləndirmə başladı',
   'Bu həftə studiyada dörd aktyorla işlədik. Baş qəhrəmanın səsi üçün uzun müddət axtardıq və nəhayət tapdıq.

Səs nümunəsini növbəti yeniləmədə paylaşacağıq.',
   'PUBLIC', seed_id('user:orxan'), now() - interval '9 days', now() - interval '9 days'),

  (seed_id('update:qehve:1'), seed_id('project:qehve'), 1, 'Qovurma maşını sifariş edildi',
   'Hədəfin 80%-inə çatdıq və maşını sifariş etdik. Altı həftəyə gəlir.

Bu arada mövcud kiçik maşınla qovurmağa davam edirik, ona görə də ilk göndərişlər gecikməyəcək.',
   'PUBLIC', seed_id('user:tural'), now() - interval '12 days', now() - interval '12 days'),

  (seed_id('update:naringi:1'), seed_id('project:naringi'), 1, 'Bütün illüstrasiyalar hazırdır',
   'Qalan on iki illüstrasiya da bitdi. İndi səhifə düzümü mərhələsindəyik.

Ən çox vaxt "Cırtdan" nağılının açılış səhifəsinə getdi — meşəni yeddi dəfə yenidən çəkdim.',
   'PUBLIC', seed_id('user:sevinc'), now() - interval '14 days', now() - interval '14 days'),

  (seed_id('update:naringi:2'), seed_id('project:naringi'), 2, 'Məktəbə bağış: ilk beş məktəb',
   'Məktəbə bağış mükafatını seçən dəstəkçilər üçün ilk beş məktəbin siyahısı hazırdır. Hamısı Qəbələ və Oğuz rayonundadır.

Siyahını dəstəkçilərə ayrıca göndəririk — seçim sizindir.',
   'BACKERS_ONLY', seed_id('user:sevinc'), now() - interval '3 days', now() - interval '3 days'),

  (seed_id('update:ipek:1'), seed_id('project:ipek'), 1, 'Montajın ilk yarısı bitdi',
   'Filmin ilk 40 dəqiqəsi montaj olundu. Quruluş dəyişdi: əvvəlcə xronoloji planlaşdırmışdıq, indi üç ustanın hekayəsi paralel gedir.

Bu dəyişiklik filmi 8 dəqiqə qısaltdı və daha yaxşı oldu.',
   'PUBLIC', seed_id('user:gunel'), now() - interval '11 days', now() - interval '11 days'),

  (seed_id('update:qab:1'), seed_id('project:qab'), 1, 'İstehsal başladı',
   'Kalıp hazırdır və ilk 500 ədəd istehsala getdi. Sertifikatlaşdırma sənədləri də tamamlandı.',
   'PUBLIC', seed_id('user:orxan'), now() - interval '80 days', now() - interval '80 days'),

  (seed_id('update:qab:2'), seed_id('project:qab'), 2, 'Göndərmə bir ay gecikir',
   'Yaxşı xəbər deyil və birbaşa deyirik: kalıp istehsalında qüsur aşkarlandı və düzəliş bir ay apardı.

Yeni cədvəl: göndərişlər gələn ayın əvvəlində başlayır. Gözləmək istəməyən dəstəkçilər üçün tam geri qaytarma mümkündür — bizə yazın.',
   'PUBLIC', seed_id('user:orxan'), now() - interval '52 days', now() - interval '52 days'),

  (seed_id('update:qab:3'), seed_id('project:qab'), 3, 'Göndərişlər başladı',
   'İlk 300 bağlama yola düşdü. İzləmə nömrələri hesabınızdakı "Çatdırılmalar" bölməsindədir.',
   'PUBLIC', seed_id('user:orxan'), now() - interval '25 days', now() - interval '25 days'),

  (seed_id('update:masa:1'), seed_id('project:masa'), 1, 'Gec dəstək pəncərəsi açıqdır',
   'Kampaniya bitdi, amma istehsal hələ başlamayıb — yəni bir neçə həftə də sifariş qəbul edə bilərik. Gec dəstək qiyməti kampaniya qiyməti ilə eynidir.',
   'PUBLIC', seed_id('user:orxan'), now() - interval '28 days', now() - interval '28 days'),

  (seed_id('update:usta:1'), seed_id('project:usta'), 1, 'Arxiv onlayndır',
   'On iki sənətkarlıq növü, 46 video və 1200 fotoşəkil. Hamısı açıq lisenziya ilə, pulsuz.

Dəstək olan hər kəsə təşəkkür edirik. Bu arxiv sizin sayənizdə var.',
   'PUBLIC', seed_id('user:gunel'), now() - interval '40 days', now() - interval '40 days'),

  (seed_id('update:albom:1'), seed_id('project:albom'), 1, 'Yazı bitdi, miksləmə başlayır',
   'Doqquz mahnının hamısı yazıldı. Üç gün studiyada qaldıq və hər şeyi canlı yazdıq — planlaşdırdığımız kimi.',
   'PUBLIC', seed_id('user:ramin'), now() - interval '2 days', now() - interval '2 days'),

  (seed_id('update:lampa:1'), seed_id('project:lampa'), 1, 'Hamısı göndərildi',
   'Sonuncu bağlama da yola düşdü. Layihə tamamlandı.

Dəstək olduğunuz üçün təşəkkür edirik. Növbəti layihə üzərində işləyirik.',
   'PUBLIC', seed_id('user:creator'), now() - interval '210 days', now() - interval '210 days')
ON CONFLICT (id) DO NOTHING;

-- ── Comments ────────────────────────────────────────────────────────────────
-- Roots first: a root comment heads its own thread, so thread_id = id.

INSERT INTO comments (id, project_id, parent_id, thread_id, depth, author_id, body, by_creator, created_at) VALUES
  (seed_id('comment:tumar:1'), seed_id('project:tumar'), NULL, seed_id('comment:tumar:1'), 0,
   seed_id('user:backer'), 'Naxışların siyahısını harada görmək olar? Şəkillərdə yalnız dördünü görürəm.', false, now() - interval '30 days'),
  (seed_id('comment:tumar:2'), seed_id('project:tumar'), NULL, seed_id('comment:tumar:2'), 0,
   seed_id('user:aygun'), 'Kağız nə qədər qalındır? Mürəkkəbli qələmlə yazanda arxaya keçirmi?', false, now() - interval '26 days'),
  (seed_id('comment:tumar:3'), seed_id('project:tumar'), NULL, seed_id('comment:tumar:3'), 0,
   seed_id('user:lale'), 'Üçlük dəsti aldım. Çantanın ölçüsü nə qədərdir?', false, now() - interval '15 days'),
  (seed_id('comment:tumar:4'), seed_id('project:tumar'), NULL, seed_id('comment:tumar:4'), 0,
   seed_id('user:ferid'), 'Gürcüstana göndərmə varmı? Tbilisidə yaşayıram.', false, now() - interval '8 days'),

  (seed_id('comment:qala:1'), seed_id('project:qala'), NULL, seed_id('comment:qala:1'), 0,
   seed_id('user:lale'), 'Demonu oynadım, çox xoşuma gəldi. Saxlama problemi məndə də oldu.', false, now() - interval '27 days'),
  (seed_id('comment:qala:2'), seed_id('project:qala'), NULL, seed_id('comment:qala:2'), 0,
   seed_id('user:emin'), 'Will there be a Steam Deck build?', false, now() - interval '20 days'),
  (seed_id('comment:qala:3'), seed_id('project:qala'), NULL, seed_id('comment:qala:3'), 0,
   seed_id('user:samir'), 'Kolleksiya qutusundakı xəritə hansı ölçüdədir?', false, now() - interval '12 days'),

  (seed_id('comment:qehve:1'), seed_id('project:qehve'), NULL, seed_id('comment:qehve:1'), 0,
   seed_id('user:backer'), 'Abunəni hədiyyə kimi ala bilərəmmi?', false, now() - interval '18 days'),
  (seed_id('comment:qehve:2'), seed_id('project:qehve'), NULL, seed_id('comment:qehve:2'), 0,
   seed_id('user:zaur'), 'Регионы Азербайджана тоже обслуживаете?', false, now() - interval '10 days'),

  (seed_id('comment:naringi:1'), seed_id('project:naringi'), NULL, seed_id('comment:naringi:1'), 0,
   seed_id('user:nezrin'), 'Kitabı üç yaşlı uşağa oxumaq olar? Yoxsa çox uzundur?', false, now() - interval '22 days'),
  (seed_id('comment:naringi:2'), seed_id('project:naringi'), NULL, seed_id('comment:naringi:2'), 0,
   seed_id('user:aygun'), 'İllüstrasiyalar möhtəşəmdir. Ayrıca poster kimi satacaqsınızmı?', false, now() - interval '13 days'),

  (seed_id('comment:ipek:1'), seed_id('project:ipek'), NULL, seed_id('comment:ipek:1'), 0,
   seed_id('user:backer'), 'Basqalda çəkiliş oldumu? Orada da ipək toxuyurlar.', false, now() - interval '16 days'),

  (seed_id('comment:qab:1'), seed_id('project:qab'), NULL, seed_id('comment:qab:1'), 0,
   seed_id('user:ferid'), 'Bağlamam iki həftədir yoldadır, izləmə yenilənmir. Nə etməliyəm?', false, now() - interval '14 days'),
  (seed_id('comment:qab:2'), seed_id('project:qab'), NULL, seed_id('comment:qab:2'), 0,
   seed_id('user:backer'), 'Gecikməni belə açıq izah etdiyiniz üçün təşəkkür. Nadir hallarda olur.', false, now() - interval '50 days'),

  (seed_id('comment:masa:1'), seed_id('project:masa'), NULL, seed_id('comment:masa:1'), 0,
   seed_id('user:lale'), 'Gec dəstəklə deluxe qutu almaq mümkündürmü?', false, now() - interval '20 days'),

  (seed_id('comment:tar:1'), seed_id('project:tar'), NULL, seed_id('comment:tar:1'), 0,
   seed_id('user:nezrin'), 'Sazda sınamısınızmı? Sazın kasası daha böyükdür.', false, now() - interval '11 days')
ON CONFLICT (id) DO NOTHING;

-- Replies. depth 1, parent named, thread carried from the parent.
INSERT INTO comments (id, project_id, parent_id, thread_id, depth, author_id, body, by_creator, created_at) VALUES
  (seed_id('reply:tumar:1'), seed_id('project:tumar'), seed_id('comment:tumar:1'), seed_id('comment:tumar:1'), 1,
   seed_id('user:creator'), 'Hamısını yeniləmədə paylaşdıq — səhifənin "Yeniləmələr" bölməsində birinci yeniləməyə baxın. On iki naxış var.', true, now() - interval '30 days'),
  (seed_id('reply:tumar:2'), seed_id('project:tumar'), seed_id('comment:tumar:2'), seed_id('comment:tumar:2'), 1,
   seed_id('user:creator'), '100 qram. Adi mürəkkəbli qələmlə arxaya keçmir, sınadıq. Marker keçir.', true, now() - interval '26 days'),
  (seed_id('reply:tumar:3'), seed_id('project:tumar'), seed_id('comment:tumar:3'), seed_id('comment:tumar:3'), 1,
   seed_id('user:creator'), '38×42 sm, uzun qulplu. A4 sənəd rahat yerləşir.', true, now() - interval '15 days'),
  (seed_id('reply:tumar:4'), seed_id('project:tumar'), seed_id('comment:tumar:4'), seed_id('comment:tumar:4'), 1,
   seed_id('user:creator'), 'Bəli, üçlük dəst üçün Gürcüstana göndəririk. Çatdırılma haqqı 18 AZN.', true, now() - interval '8 days'),
  (seed_id('reply:tumar:5'), seed_id('project:tumar'), seed_id('comment:tumar:4'), seed_id('comment:tumar:4'), 1,
   seed_id('user:backer'), 'Mən də Tbilisidən aldım, problem olmadı.', false, now() - interval '7 days'),

  (seed_id('reply:qala:1'), seed_id('project:qala'), seed_id('comment:qala:1'), seed_id('comment:qala:1'), 1,
   seed_id('user:orxan'), 'Düzəltdik, yeni demo eyni linkdədir. Xəbər verdiyiniz üçün təşəkkür.', true, now() - interval '24 days'),
  (seed_id('reply:qala:2'), seed_id('project:qala'), seed_id('comment:qala:2'), seed_id('comment:qala:2'), 1,
   seed_id('user:orxan'), 'Not at launch. We will test it after release and patch in support if it runs well.', true, now() - interval '20 days'),
  (seed_id('reply:qala:3'), seed_id('project:qala'), seed_id('comment:qala:3'), seed_id('comment:qala:3'), 1,
   seed_id('user:orxan'), '60×80 sm, qatlanmış halda göndərilir.', true, now() - interval '12 days'),

  (seed_id('reply:qehve:1'), seed_id('project:qehve'), seed_id('comment:qehve:1'), seed_id('comment:qehve:1'), 1,
   seed_id('user:tural'), 'Bəli. Sorğuda çatdırılma ünvanını başqa adamın adına yaza bilərsiniz, qutuya da qeyd əlavə edirik.', true, now() - interval '18 days'),
  (seed_id('reply:qehve:2'), seed_id('project:qehve'), seed_id('comment:qehve:2'), seed_id('comment:qehve:2'), 1,
   seed_id('user:tural'), 'Hazırda yalnız Bakı və Sumqayıt. Regionlar üçün növbəti mərhələdə poçtla göndərməni planlaşdırırıq.', true, now() - interval '10 days'),

  (seed_id('reply:naringi:1'), seed_id('project:naringi'), seed_id('comment:naringi:1'), seed_id('comment:naringi:1'), 1,
   seed_id('user:sevinc'), 'Üç yaşlıya valideyn oxuya bilər — hər nağıl 8-10 dəqiqədir. Uşağın özü oxuması üçün beş yaş münasibdir.', true, now() - interval '22 days'),
  (seed_id('reply:naringi:2'), seed_id('project:naringi'), seed_id('comment:naringi:2'), seed_id('comment:naringi:2'), 1,
   seed_id('user:sevinc'), 'Bu kampaniyada yox, amma kitab çıxandan sonra düşünürük. Maraq göstərdiyiniz üçün təşəkkür.', true, now() - interval '13 days'),

  (seed_id('reply:ipek:1'), seed_id('project:ipek'), seed_id('comment:ipek:1'), seed_id('comment:ipek:1'), 1,
   seed_id('user:gunel'), 'Bəli, Basqalda iki gün çəkdik. Filmdə ayrıca bölmə var.', true, now() - interval '16 days'),

  (seed_id('reply:qab:1'), seed_id('project:qab'), seed_id('comment:qab:1'), seed_id('comment:qab:1'), 1,
   seed_id('user:orxan'), 'Bizə yazın, izləmə nömrəsini poçtla yoxlayaq. Lazım olarsa yenidən göndərəcəyik.', true, now() - interval '13 days'),

  (seed_id('reply:masa:1'), seed_id('project:masa'), seed_id('comment:masa:1'), seed_id('comment:masa:1'), 1,
   seed_id('user:orxan'), 'Bəli, gec dəstək səhifəsində deluxe qutu da var.', true, now() - interval '20 days'),

  (seed_id('reply:tar:1'), seed_id('project:tar'), seed_id('comment:tar:1'), seed_id('comment:tar:1'), 1,
   seed_id('user:ramin'), 'Sazda sınadıq və işləyir, amma bu kampaniyada göndərdiyimiz ölçü yalnız tar üçündür.', true, now() - interval '11 days')
ON CONFLICT (id) DO NOTHING;

-- Spam, and the moderator's deletion of it. A moderation queue with nothing
-- deleted in it never shows what a deleted comment looks like in a thread.
INSERT INTO comments (id, project_id, parent_id, thread_id, depth, author_id, body, by_creator,
                      deleted_at, deleted_by, created_at) VALUES
  (seed_id('comment:spam:1'), seed_id('project:tumar'), NULL, seed_id('comment:spam:1'), 0,
   seed_id('user:spammer'), 'Ən ucuz qiymətlər burada. Profilimə baxın.', false,
   now() - interval '13 days', seed_id('user:moderator'), now() - interval '14 days'),
  (seed_id('comment:spam:2'), seed_id('project:qala'), NULL, seed_id('comment:spam:2'), 0,
   seed_id('user:spammer'), 'Bu oyunu pulsuz yükləmək üçün linkə keçin.', false,
   NULL, NULL, now() - interval '6 days')
ON CONFLICT (id) DO NOTHING;

-- ── Saves, follows, launch reminders ────────────────────────────────────────
--
-- Generated over the backer population rather than listed, because a "saved"
-- count of four does not exercise anything.

INSERT INTO saves (id, project_id, user_id, created_at)
SELECT seed_id('save:' || p.slug || ':' || u.id::text), p.id, u.id,
       now() - ((1 + (seed_rand('save:' || p.slug || u.id::text) * 60)::int) || ' days')::interval
FROM projects p
CROSS JOIN (SELECT id FROM users WHERE email LIKE 'backer%@example.az') u
WHERE p.state IN ('LIVE', 'PRELAUNCH', 'SCHEDULED')
  AND seed_rand('save:' || p.slug || u.id::text) < 0.09
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO saves (id, project_id, user_id, created_at) VALUES
  (seed_id('save:demo:1'), seed_id('project:qala'),     seed_id('user:backer'), now() - interval '20 days'),
  (seed_id('save:demo:2'), seed_id('project:ipek'),     seed_id('user:backer'), now() - interval '12 days'),
  (seed_id('save:demo:3'), seed_id('project:kelagayi'), seed_id('user:backer'), now() - interval '4 days'),
  (seed_id('save:demo:4'), seed_id('project:arxiv'),    seed_id('user:backer'), now() - interval '9 days'),
  (seed_id('save:demo:5'), seed_id('project:bazar'),    seed_id('user:aygun'),  now() - interval '6 days')
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO follows (id, creator_id, follower_id, created_at)
SELECT seed_id('follow:' || c.id::text || ':' || u.id::text), c.id, u.id,
       now() - ((1 + (seed_rand('follow:' || c.id::text || u.id::text) * 150)::int) || ' days')::interval
FROM (SELECT DISTINCT creator_id AS id FROM projects
      WHERE creator_id <> seed_id('user:spammer')) c
CROSS JOIN (SELECT id FROM users WHERE email LIKE 'backer%@example.az') u
WHERE seed_rand('follow:' || c.id::text || u.id::text) < 0.11
ON CONFLICT (creator_id, follower_id) DO NOTHING;

INSERT INTO follows (id, creator_id, follower_id, created_at) VALUES
  (seed_id('follow:demo:1'), seed_id('user:creator'), seed_id('user:backer'), now() - interval '60 days'),
  (seed_id('follow:demo:2'), seed_id('user:orxan'),   seed_id('user:backer'), now() - interval '40 days'),
  (seed_id('follow:demo:3'), seed_id('user:gunel'),   seed_id('user:backer'), now() - interval '25 days'),
  (seed_id('follow:demo:4'), seed_id('user:sevinc'),  seed_id('user:aygun'),  now() - interval '30 days'),
  (seed_id('follow:demo:5'), seed_id('user:ramin'),   seed_id('user:nezrin'), now() - interval '18 days')
ON CONFLICT (creator_id, follower_id) DO NOTHING;

-- Launch reminders on the two campaigns that have not opened yet.
INSERT INTO reminders (id, project_id, user_id, created_at, updated_at)
SELECT seed_id('reminder:' || p.slug || ':' || u.id::text), p.id, u.id,
       now() - ((1 + (seed_rand('rem:' || p.slug || u.id::text) * 12)::int) || ' days')::interval,
       now()
FROM projects p
CROSS JOIN (SELECT id FROM users WHERE email LIKE 'backer%@example.az') u
WHERE p.state IN ('PRELAUNCH', 'SCHEDULED')
  AND seed_rand('rem:' || p.slug || u.id::text) < 0.07
ON CONFLICT (id) DO NOTHING;

-- ── Notification inbox ──────────────────────────────────────────────────────
--
-- Every pledge that was confirmed produced one in-app notification, and that is
-- what makes the bell icon and /notifications worth opening. read_at is only
-- ever set on an in-app notification that was sent, because a check constraint
-- says so.

INSERT INTO notifications (id, recipient_id, type, category, channel, event_id, subject_type, subject_id,
                           params, state, attempts, next_attempt_at, occurred_at, created_at, sent_at, read_at)
SELECT
    seed_id('notif:pledge:' || p.id::text), p.backer_id, 'PLEDGE_CONFIRMED', 'PLEDGES', 'IN_APP',
    seed_id('event:pledge:' || p.id::text), 'PLEDGE', p.id,
    jsonb_build_object('projectTitle', pr.title, 'projectSlug', pr.slug,
                       'amount', p.total_amount::text, 'currency', p.currency),
    'SENT', 1, p.created_at, p.created_at, p.created_at, p.created_at + interval '2 minutes',
    CASE WHEN seed_rand('read:' || p.id::text) < 0.62
         THEN p.created_at + interval '3 hours' ELSE NULL END
FROM pledges p
JOIN projects pr ON pr.id = p.project_id
WHERE p.state IN ('CONFIRMED', 'COLLECTED', 'FULFILLED')
ON CONFLICT (id) DO NOTHING;

INSERT INTO notifications (id, recipient_id, type, category, channel, event_id, subject_type, subject_id,
                           params, state, attempts, next_attempt_at, occurred_at, created_at, sent_at, read_at)
SELECT
    seed_id('notif:update:' || u.id::text || ':' || p.backer_id::text), p.backer_id,
    'NEW_UPDATE_PUBLISHED', 'CAMPAIGN', 'IN_APP',
    seed_id('event:update:' || u.id::text || ':' || p.backer_id::text), 'PROJECT_UPDATE', u.id,
    jsonb_build_object('projectTitle', pr.title, 'projectSlug', pr.slug,
                       'updateTitle', u.title, 'updateNumber', u.number),
    'SENT', 1, u.published_at, u.published_at, u.published_at, u.published_at + interval '1 minute',
    CASE WHEN seed_rand('readu:' || u.id::text || p.backer_id::text) < 0.45
         THEN u.published_at + interval '5 hours' ELSE NULL END
FROM project_updates u
JOIN projects pr ON pr.id = u.project_id
JOIN pledges p ON p.project_id = u.project_id
                AND p.state IN ('CONFIRMED', 'COLLECTED', 'FULFILLED')
WHERE seed_rand('notifu:' || u.id::text || p.backer_id::text) < 0.35
ON CONFLICT (id) DO NOTHING;

-- A few for the demo accounts specifically, so signing in as backer@ideanest.az
-- shows an inbox with more than one kind of thing in it.
INSERT INTO notifications (id, recipient_id, type, category, channel, event_id, subject_type, subject_id,
                           params, state, attempts, next_attempt_at, occurred_at, created_at, sent_at, read_at) VALUES
  (seed_id('notif:demo:1'), seed_id('user:backer'), 'GOAL_REACHED', 'CAMPAIGN', 'IN_APP',
   seed_id('event:demo:1'), 'PROJECT', seed_id('project:tumar'),
   '{"projectTitle": "Tumar: xalça naxışlı gündəlik dəftər", "projectSlug": "tumar-defter"}'::jsonb,
   'SENT', 1, now() - interval '21 days', now() - interval '21 days', now() - interval '21 days',
   now() - interval '21 days', now() - interval '20 days'),
  (seed_id('notif:demo:2'), seed_id('user:backer'), 'SAVED_PROJECT_ENDING_SOON', 'DISCOVERY', 'IN_APP',
   seed_id('event:demo:2'), 'PROJECT', seed_id('project:qehve'),
   '{"projectTitle": "Sirdaş: Bakıda qovrulan tək mənşəli qəhvə", "projectSlug": "sirdas-qehve", "hoursLeft": 96}'::jsonb,
   'SENT', 1, now() - interval '1 day', now() - interval '1 day', now() - interval '1 day',
   now() - interval '1 day', NULL),
  (seed_id('notif:demo:3'), seed_id('user:backer'), 'REWARD_SHIPPED', 'REWARDS', 'IN_APP',
   seed_id('event:demo:3'), 'PROJECT', seed_id('project:qab'),
   '{"projectTitle": "Ağ Qab: ağıllı su qabı", "projectSlug": "ag-qab", "carrier": "Azərpoçt"}'::jsonb,
   'SENT', 1, now() - interval '24 days', now() - interval '24 days', now() - interval '24 days',
   now() - interval '24 days', now() - interval '23 days'),
  (seed_id('notif:demo:4'), seed_id('user:backer'), 'SURVEY_AVAILABLE', 'REWARDS', 'IN_APP',
   seed_id('event:demo:4'), 'PROJECT', seed_id('project:albom'),
   '{"projectTitle": "Kür: akustik albom", "projectSlug": "akustik-albom"}'::jsonb,
   'SENT', 1, now() - interval '4 days', now() - interval '4 days', now() - interval '4 days',
   now() - interval '4 days', NULL),
  (seed_id('notif:demo:5'), seed_id('user:backer'), 'FOLLOWED_CREATOR_LAUNCHED', 'DISCOVERY', 'IN_APP',
   seed_id('event:demo:5'), 'PROJECT', seed_id('project:kelagayi'),
   '{"projectTitle": "Kəlağayı: gündəlik geyim kolleksiyası", "projectSlug": "kelagayi-kolleksiya", "creatorName": "Leyla Səfərova"}'::jsonb,
   'SENT', 1, now() - interval '6 days', now() - interval '6 days', now() - interval '6 days',
   now() - interval '6 days', NULL),
  (seed_id('notif:demo:6'), seed_id('user:creator'), 'PLEDGE_CONFIRMED', 'PLEDGES', 'IN_APP',
   seed_id('event:demo:6'), 'PROJECT', seed_id('project:tumar'),
   '{"projectTitle": "Tumar: xalça naxışlı gündəlik dəftər", "projectSlug": "tumar-defter", "amount": "110.00", "currency": "AZN"}'::jsonb,
   'SENT', 1, now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours',
   now() - interval '2 hours', NULL),
  (seed_id('notif:demo:7'), seed_id('user:creator'), 'DEADLINE_48H', 'CAMPAIGN', 'IN_APP',
   seed_id('event:demo:7'), 'PROJECT', seed_id('project:tumar'),
   '{"projectTitle": "Tumar: xalça naxışlı gündəlik dəftər", "projectSlug": "tumar-defter"}'::jsonb,
   'PENDING', 0, now() + interval '5 days', now() - interval '10 minutes', now() - interval '10 minutes',
   NULL, NULL),
  (seed_id('notif:demo:8'), seed_id('user:backer'), 'NEW_DEVICE_SIGN_IN', 'SECURITY', 'IN_APP',
   seed_id('event:demo:8'), NULL, NULL,
   '{"deviceLabel": "Chrome, Windows", "city": "Bakı"}'::jsonb,
   'SENT', 1, now() - interval '3 days', now() - interval '3 days', now() - interval '3 days',
   now() - interval '3 days', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

-- A couple of dead letters, because the notification console is where a failing
-- transport is supposed to become visible.
INSERT INTO notifications (id, recipient_id, type, category, channel, event_id, subject_type, subject_id,
                           params, state, attempts, last_error, next_attempt_at, occurred_at, created_at) VALUES
  (seed_id('notif:dead:1'), seed_id('backer:412'), 'PAYMENT_FAILED', 'PAYMENTS', 'EMAIL',
   seed_id('event:dead:1'), 'PROJECT', seed_id('project:albom'),
   '{"projectTitle": "Kür: akustik albom", "projectSlug": "akustik-albom"}'::jsonb,
   'DEAD', 5, 'SMTP 550: mailbox unavailable', now() - interval '1 day',
   now() - interval '3 days', now() - interval '3 days'),
  (seed_id('notif:dead:2'), seed_id('backer:57'), 'SURVEY_OVERDUE', 'REWARDS', 'EMAIL',
   seed_id('event:dead:2'), 'PROJECT', seed_id('project:qab'),
   '{"projectTitle": "Ağ Qab: ağıllı su qabı", "projectSlug": "ag-qab"}'::jsonb,
   'DEAD', 5, 'SMTP 421: service not available', now() - interval '2 days',
   now() - interval '5 days', now() - interval '5 days')
ON CONFLICT (id) DO NOTHING;

-- Notification preferences the settings screen reads back.
INSERT INTO notification_preferences (id, user_id, category, channel, delivery_mode, created_at, updated_at) VALUES
  (seed_id('pref:backer:pledges:email'),   seed_id('user:backer'), 'PLEDGES',   'EMAIL',  'IMMEDIATE', now() - interval '60 days', now() - interval '60 days'),
  (seed_id('pref:backer:community:email'), seed_id('user:backer'), 'COMMUNITY', 'EMAIL',  'DIGEST',    now() - interval '60 days', now() - interval '20 days'),
  (seed_id('pref:backer:discovery:email'), seed_id('user:backer'), 'DISCOVERY', 'EMAIL',  'OFF',       now() - interval '60 days', now() - interval '20 days'),
  (seed_id('pref:backer:campaign:inapp'),  seed_id('user:backer'), 'CAMPAIGN',  'IN_APP', 'IMMEDIATE', now() - interval '60 days', now() - interval '60 days'),
  (seed_id('pref:creator:pledges:email'),  seed_id('user:creator'),'PLEDGES',   'EMAIL',  'DIGEST',    now() - interval '90 days', now() - interval '90 days'),
  (seed_id('pref:creator:community:inapp'),seed_id('user:creator'),'COMMUNITY', 'IN_APP', 'IMMEDIATE', now() - interval '90 days', now() - interval '90 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;
