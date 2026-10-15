-- Six more live campaigns.
--
-- Seven was enough to prove the campaign card renders and not enough to fill
-- two six-card rails on the home page without repeating itself — and a home
-- page showing the same five campaigns twice reads as an empty platform, which
-- is the one thing a seed exists to avoid. These six also reach the categories
-- the first twenty left with nothing live in them: technology, art,
-- photography, comics, crafts and dance.

INSERT INTO projects (
    id, creator_id, slug, title, blurb, category_id, subcategory_id, location_id,
    state, goal_amount, currency, duration_days, scheduled_launch_at, launched_at, deadline,
    story, risks, cover_image_url, cover_image_width, cover_image_height,
    finalized_at, outcome_goal_amount, outcome_pledged_amount, outcome_backers_count,
    created_at)
VALUES

(seed_id('project:torpaq'), seed_id('user:elnur'), 'torpaq-sensor', 'Torpaq: fermerlər üçün ucuz sensor',
 'Torpaq rütubətini və temperaturunu ölçən, batareyası bir mövsüm dözən sensor.',
 seed_category('technology'), seed_subcategory('technology', 2), seed_location('quba'),
 'LIVE', 32000, 'AZN', 45, NULL, now() - interval '14 days', now() + interval '31 days',
 seed_story(
   'Quba və Xaçmazda alma bağları var, torpaq sensoru yoxdur. Çünki mövcud sensorlar bir bağın illik gəlirinin yarısına başa gəlir.',
   'Layihə haqqında',
   'Sensor torpağın rütubətini, temperaturunu və duzluluğunu ölçür və məlumatı telefona göndərir. Bir batareya ilə bütün mövsüm işləyir. Sxemlər və proqram təminatı açıq paylaşılacaq.',
   'photo-1625246333195-78d9c38ad449', 'Kənd təsərrüfatı sahəsində quraşdırılmış sensor',
   'Plan və büdcə',
   'Vəsait ilk 600 ədədin istehsalını və on fermerlə birgə sahə sınağını qarşılayır.',
   ARRAY['İstehsal — 18 000 AZN',
         'Sahə sınağı — 6 000 AZN',
         'Proqram təminatı — 5 000 AZN',
         'Göndərmə və komissiyalar — 3 000 AZN']),
 'Radio modulunun tədarükü ən zəif nöqtədir. İki alternativ modul sınaqdan keçirilib və hər ikisi işləyir.',
 seed_photo('photo-1625246333195-78d9c38ad449', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '25 days'),

(seed_id('project:divar'), seed_id('user:aysu'), 'divar-arxivi', 'Divar: Bakı küçə sənəti arxivi',
 'On ildə çəkilmiş 4000 fotoşəkil, xəritələnmiş və açıq lisenziya ilə paylaşılan arxiv.',
 seed_category('art'), seed_subcategory('art', 1), seed_location('baki'),
 'LIVE', 16000, 'AZN', 40, NULL, now() - interval '20 days', now() + interval '20 days',
 seed_story(
   'Bakının divarlarındakı rəsmlərin çoxu artıq yoxdur. Fotolar var.',
   'Layihə haqqında',
   'On il ərzində 4000-dən çox fotoşəkil çəkmişəm. Bu kampaniya onları xəritəyə bağlamağı, tarixləndirməyi və hamıya açıq bir arxivə çevirməyi maliyyələşdirir.',
   'photo-1533174072545-7a4b6ad7a6c3', 'Şəhər divarında rəngli qraffiti',
   'Plan və büdcə',
   'Arxiv sayt kimi qurulacaq, çap albomu isə ayrıca mükafat olacaq.',
   ARRAY['Skan və kataloqlaşdırma — 6 000 AZN',
         'Arxiv saytı — 5 000 AZN',
         'Çap albomu — 3 500 AZN',
         'Komissiyalar — 1 500 AZN']),
 'Bəzi rəsmlərin müəllifləri naməlumdur. Müəllif tapılmadıqda foto arxivdə qeydlə saxlanılır və çap albomuna daxil edilmir.',
 seed_photo('photo-1533174072545-7a4b6ad7a6c3', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '30 days'),

(seed_id('project:gece'), seed_id('user:aysu'), 'gece-baki', 'Gecə Bakı: uzun ekspozisiya albomu',
 'İki il boyunca gecələr çəkilmiş 90 fotoşəkil. Böyük format çap albomu.',
 seed_category('photography'), seed_subcategory('photography', 2), seed_location('baki'),
 'LIVE', 11000, 'AZN', 35, NULL, now() - interval '9 days', now() + interval '26 days',
 seed_story(
   'Gecə şəhəri gündüz şəhərindən başqa bir yerdir. Bu albom o yer haqqındadır.',
   'Layihə haqqında',
   'İki il boyunca gecə saatlarında, uzun ekspozisiya ilə çəkilmiş 90 fotoşəkil. Hamısı Bakı və ətrafında.',
   'photo-1470813740244-df37b8c1edcb', 'Gecə səması altında uzun ekspozisiya ilə çəkilmiş mənzərə',
   'Plan və büdcə',
   'Albom 28×28 sm formatda, sərt üzlüklə çap olunur.',
   ARRAY['Çap — 6 000 AZN',
         'Rəng korreksiyası — 2 000 AZN',
         'Qablaşdırma və göndərmə — 3 000 AZN']),
 'Böyük format çapda rəng uyğunluğu risklidir. İki mətbəədən nümunə alınıb və biri seçilib.',
 seed_photo('photo-1470813740244-df37b8c1edcb', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '18 days'),

(seed_id('project:seyyah'), seed_id('user:sevinc'), 'seyyah-komiks', 'Səyyah: qrafik novella',
 'İpək Yolu boyunca səyahət edən bir xəritəçinin hekayəsi. 120 səhifə, tam rəngli.',
 seed_category('comics'), seed_subcategory('comics', 1), seed_location('baki'),
 'LIVE', 24000, 'AZN', 45, NULL, now() - interval '27 days', now() + interval '18 days',
 seed_story(
   'Qorqud kampaniyası hədəfə çatmadı. Bu dəfə kitab artıq yarıya qədər hazırdır.',
   'Layihə haqqında',
   '120 səhifənin 70-i çəkilib və rənglənib. Hekayə on birinci əsrdə İpək Yolu boyunca səyahət edən bir xəritəçini izləyir.',
   'photo-1595535873420-a599195b3f4a', 'Rəngli komiks səhifələri',
   'Plan və büdcə',
   'Qalan 50 səhifə çəkilir və kitab çap olunur.',
   ARRAY['Rəsm və rəngləmə — 13 000 AZN',
         'Çap — 7 000 AZN',
         'Göndərmə — 4 000 AZN']),
 'Keçən kampaniya hədəfə çatmadı. Bu dəfə hədəf aşağıdır və işin yarısı artıq görülüb.',
 seed_photo('photo-1595535873420-a599195b3f4a', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '40 days'),

(seed_id('project:sebeke'), seed_id('user:elnur'), 'sebeke-desti', 'Şəbəkə: pəncərə sənəti dəsti',
 'Şəkidəki şəbəkə ustaları ilə hazırlanan, yapışqansız yığılan pəncərə dəsti.',
 seed_category('crafts'), seed_subcategory('crafts', 3), seed_location('seki'),
 'LIVE', 14000, 'AZN', 40, NULL, now() - interval '3 days', now() + interval '37 days',
 seed_story(
   'Şəbəkə mismarsız və yapışqansız yığılır. Bu dəst də elə.',
   'Layihə haqqında',
   'Şəkidəki emalatxana ilə birlikdə 260 parçadan ibarət kiçik bir şəbəkə paneli dəsti hazırladıq. Rəngli şüşə dəstə daxildir.',
   'photo-1504609773096-104ff2c73ba4', 'Taxta emalatxanasında alətlər və material',
   'Plan və büdcə',
   'İlk 300 dəst istehsal olunur.',
   ARRAY['Taxta və şüşə — 6 000 AZN',
         'Emalatxana işi — 5 000 AZN',
         'Qablaşdırma və göndərmə — 3 000 AZN']),
 'Rəngli şüşə xaricdən gətirilir və qırılma faizi yüksəkdir. Hər dəstə ehtiyat parçalar əlavə edilir.',
 seed_photo('photo-1504609773096-104ff2c73ba4', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '12 days'),

(seed_id('project:yalli'), seed_id('user:gunel'), 'yalli-sened', 'Yallı: rəqsin sənədli filmi',
 'Naxçıvan və Şərur yallılarının 50 dəqiqəlik sənədli filmi və hərəkət arxivi.',
 seed_category('dance'), seed_subcategory('dance', 0), seed_location('naxcivan'),
 'LIVE', 26000, 'AZN', 45, NULL, now() - interval '11 days', now() + interval '34 days',
 seed_story(
   'Yallının yüzdən çox variantı var və çoxu heç vaxt yazıya alınmayıb.',
   'Layihə haqqında',
   'Şərur və Naxçıvanda on iki yallı variantını çəkirik. Filmdən əlavə hər hərəkətin ayrıca, yavaşladılmış video arxivi hazırlanır.',
   'photo-1508700115892-45ecd05ae2ad', 'Səhnədə çıxış edən rəqs kollektivi',
   'Plan və büdcə',
   'Çəkiliş yaz aylarında, toy və bayram mövsümündə aparılır.',
   ARRAY['Çəkiliş — 12 000 AZN',
         'Montaj və səs — 8 000 AZN',
         'Arxiv və subtitr — 6 000 AZN']),
 'Çəkiliş mövsümdən asılıdır. Yallı əsasən yaz bayramlarında və toylarda ifa olunur.',
 seed_photo('photo-1508700115892-45ecd05ae2ad', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '22 days')

ON CONFLICT (id) DO NOTHING;

-- ── Reward tiers ────────────────────────────────────────────────────────────

INSERT INTO reward_tiers (
    id, project_id, title, description, amount, currency, estimated_delivery,
    limit_quantity, claimed_quantity, reserved_quantity, shipping_type,
    is_early_bird, is_featured, is_secret, secret_token, is_addon, sort_order,
    available_from, available_until, created_at)
VALUES
  (seed_id('tier:torpaq:destek'), seed_id('project:torpaq'), 'Dəstəkçi',
   'Adınız layihə saytında və sxem sənədində.',
   20, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '14 days'),
  (seed_id('tier:torpaq:bir'), seed_id('project:torpaq'), 'Bir sensor',
   'Bir sensor, quraşdırma dirəyi və telefon tətbiqi.',
   95, 'AZN', (now() + interval '6 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '14 days'),
  (seed_id('tier:torpaq:erken'), seed_id('project:torpaq'), 'Erkən quş: bir sensor',
   'İlk 200 ədəd, endirimli qiymətə.',
   75, 'AZN', (now() + interval '6 months')::date, 200, 0, 0, 'DOMESTIC', true, false, false, NULL, false, 2, NULL, now() + interval '9 days', now() - interval '14 days'),
  (seed_id('tier:torpaq:bag'), seed_id('project:torpaq'), 'Bağ dəsti',
   'Beş sensor və mərkəzi qəbuledici.',
   450, 'AZN', (now() + interval '7 months')::date, 150, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '14 days'),

  (seed_id('tier:divar:destek'), seed_id('project:divar'), 'Dəstəkçi',
   'Adınız arxiv saytında.',
   15, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '20 days'),
  (seed_id('tier:divar:cap'), seed_id('project:divar'), 'Bir çap',
   'Seçdiyiniz fotonun 30×40 sm çapı, imzalı.',
   70, 'AZN', (now() + interval '4 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '20 days'),
  (seed_id('tier:divar:albom'), seed_id('project:divar'), 'Çap albomu',
   '200 səhifə, sərt üzlük, xəritə ilə.',
   130, 'AZN', (now() + interval '5 months')::date, 400, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '20 days'),
  (seed_id('tier:divar:tur'), seed_id('project:divar'), 'Divar turu',
   'Albom və Bakıda iki saatlıq küçə sənəti turu.',
   280, 'AZN', (now() + interval '5 months')::date, 30, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '20 days'),

  (seed_id('tier:gece:albom'), seed_id('project:gece'), 'Bir albom',
   '90 fotoşəkil, 28×28 sm, sərt üzlük.',
   85, 'AZN', (now() + interval '4 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '9 days'),
  (seed_id('tier:gece:cap'), seed_id('project:gece'), 'Albom və çap',
   'Albom və seçdiyiniz fotonun 40×40 sm çapı.',
   190, 'AZN', (now() + interval '5 months')::date, 200, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '9 days'),
  (seed_id('tier:gece:gezinti'), seed_id('project:gece'), 'Gecə çəkilişi',
   'Albom və bir gecəlik birgə çəkiliş gəzintisi.',
   380, 'AZN', (now() + interval '5 months')::date, 20, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '9 days'),

  (seed_id('tier:seyyah:reqemsal'), seed_id('project:seyyah'), 'Rəqəmsal nüsxə',
   'PDF və ePub.',
   22, 'AZN', (now() + interval '5 months')::date, NULL, 0, 0, 'DIGITAL', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '27 days'),
  (seed_id('tier:seyyah:cap'), seed_id('project:seyyah'), 'Çap nüsxəsi',
   '120 səhifə, tam rəngli, sərt üzlük.',
   65, 'AZN', (now() + interval '6 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '27 days'),
  (seed_id('tier:seyyah:imzali'), seed_id('project:seyyah'), 'İmzalı və eskizli',
   'Çap nüsxəsi, imza və ilk səhifədə əl ilə eskiz.',
   160, 'AZN', (now() + interval '7 months')::date, 100, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '27 days'),

  (seed_id('tier:sebeke:kicik'), seed_id('project:sebeke'), 'Kiçik panel',
   '120 parça, 30×30 sm.',
   90, 'AZN', (now() + interval '5 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '3 days'),
  (seed_id('tier:sebeke:boyuk'), seed_id('project:sebeke'), 'Böyük panel',
   '260 parça, 50×50 sm, rəngli şüşə ilə.',
   180, 'AZN', (now() + interval '6 months')::date, 300, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '3 days'),
  (seed_id('tier:sebeke:kurs'), seed_id('project:sebeke'), 'Şəkidə emalatxana günü',
   'Böyük panel və ustalarla bir günlük emalatxana.',
   420, 'AZN', (now() + interval '7 months')::date, 25, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '3 days'),

  (seed_id('tier:yalli:destek'), seed_id('project:yalli'), 'Dəstəkçi',
   'Adınız filmin titrlərində.',
   20, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '11 days'),
  (seed_id('tier:yalli:onlayn'), seed_id('project:yalli'), 'Onlayn baxış',
   'Film və hərəkət arxivinə tam giriş.',
   40, 'AZN', (now() + interval '9 months')::date, NULL, 0, 0, 'DIGITAL', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '11 days'),
  (seed_id('tier:yalli:premyera'), seed_id('project:yalli'), 'Premyera bileti',
   'Naxçıvanda premyeraya iki bilet və onlayn baxış.',
   110, 'AZN', (now() + interval '10 months')::date, 150, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '11 days'),
  (seed_id('tier:yalli:sponsor'), seed_id('project:yalli'), 'Sponsor',
   'Adınız və ya loqonuz filmin sponsorlar bölməsində.',
   1800, 'AZN', (now() + interval '10 months')::date, 10, 0, 0, 'NONE', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '11 days')
ON CONFLICT (id) DO NOTHING;

-- ── FAQ, an update apiece, and the transitions behind the state ─────────────

INSERT INTO project_faqs (id, project_id, question, answer, sort_order, created_at) VALUES
  (seed_id('faq:torpaq:1'), seed_id('project:torpaq'), 'Sensor internetsiz işləyirmi?',
   'Bəli. Sensor məlumatı yaddaşda saxlayır və telefon yaxınlaşanda Bluetooth ilə ötürür. İnternet yalnız buludla sinxronizasiya üçün lazımdır.', 0, now() - interval '12 days'),
  (seed_id('faq:torpaq:2'), seed_id('project:torpaq'), 'Sxemlər həqiqətən açıq olacaqmı?',
   'Bəli, göndərişdən sonra sxem, lövhə faylları və proqram təminatı açıq lisenziya ilə paylaşılacaq.', 1, now() - interval '12 days'),
  (seed_id('faq:divar:1'), seed_id('project:divar'), 'Arxivdən istifadə pulsuz olacaqmı?',
   'Bəli. Bütün arxiv açıq lisenziya ilə paylaşılır. Çap albomu isə ayrıca mükafatdır.', 0, now() - interval '18 days'),
  (seed_id('faq:gece:1'), seed_id('project:gece'), 'Çapları özüm seçə bilərəmmi?',
   'Bəli. Kampaniya bitdikdən sonra sorğu göndərilir və 90 fotodan birini seçirsiniz.', 0, now() - interval '7 days'),
  (seed_id('faq:seyyah:1'), seed_id('project:seyyah'), 'Nümunə səhifələri harada oxumaq olar?',
   'İlk 24 səhifə kampaniya səhifəsindəki linkdə pulsuz oxunur.', 0, now() - interval '25 days'),
  (seed_id('faq:sebeke:1'), seed_id('project:sebeke'), 'Yığmaq nə qədər çətindir?',
   'Təxminən üç saat. Alət lazım deyil, təlimat şəkillidir.', 0, now() - interval '2 days'),
  (seed_id('faq:yalli:1'), seed_id('project:yalli'), 'Hərəkət arxivi nə deməkdir?',
   'Hər yallı hərəkəti ayrıca, yavaşladılmış və müxtəlif bucaqlardan çəkilir — rəqs öyrənənlər üçün.', 0, now() - interval '9 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_updates (id, project_id, number, title, body, visibility, author_id, published_at, created_at) VALUES
  (seed_id('update:torpaq:1'), seed_id('project:torpaq'), 1, 'Sahə sınağı üçün on fermer tapıldı',
   'Quba və Xaçmazda on bağ sahibi sınağa qoşulmağa razılıq verdi. Sensorlar mart ayında quraşdırılacaq və bütün mövsüm ölçü aparacaq.

Nəticələr açıq paylaşılacaq — həm işlədiyi, həm də işləmədiyi hallar.',
   'PUBLIC', seed_id('user:elnur'), now() - interval '6 days', now() - interval '6 days'),
  (seed_id('update:divar:1'), seed_id('project:divar'), 1, 'İlk 500 foto xəritəyə bağlandı',
   'Kataloqlaşdırma başladı. İlk 500 foto tarixləndirildi və xəritəyə bağlandı. Onlardan 60-ının çəkildiyi divar artıq mövcud deyil.',
   'PUBLIC', seed_id('user:aysu'), now() - interval '10 days', now() - interval '10 days'),
  (seed_id('update:seyyah:1'), seed_id('project:seyyah'), 1, '70-ci səhifə bitdi',
   'Yetmişinci səhifə rəngləndi. Qalan 50 səhifənin eskizləri hazırdır.',
   'PUBLIC', seed_id('user:sevinc'), now() - interval '8 days', now() - interval '8 days'),
  (seed_id('update:yalli:1'), seed_id('project:yalli'), 1, 'Şərurda ilk çəkiliş',
   'Şərurda iki gün çəkiliş apardıq və dörd yallı variantını yazdıq. Ən yaşlı iştirakçı 84 yaşındadır və hələ də ön sırada durur.',
   'PUBLIC', seed_id('user:gunel'), now() - interval '4 days', now() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':create'), p.id, NULL, 'DRAFT', p.creator_id, 'CREATOR', NULL, p.created_at
FROM projects p WHERE p.id IN (
    seed_id('project:torpaq'), seed_id('project:divar'), seed_id('project:gece'),
    seed_id('project:seyyah'), seed_id('project:sebeke'), seed_id('project:yalli'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':approve'), p.id, 'SUBMITTED', 'APPROVED',
       seed_id('user:moderator'), 'MODERATOR', 'Yoxlanıldı və təsdiqləndi.', p.created_at + interval '2 days'
FROM projects p WHERE p.state NOT IN ('DRAFT', 'SUBMITTED', 'PRELAUNCH')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':live'), p.id, 'APPROVED', 'LIVE', p.creator_id, 'CREATOR', NULL, p.launched_at
FROM projects p WHERE p.launched_at IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_story_versions (id, project_id, version_number, document, author_id, created_at)
SELECT seed_id('story:' || p.slug || ':1'), p.id, 1, p.story, p.creator_id, p.created_at + interval '1 day'
FROM projects p WHERE p.story IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- The tags and editorial placements for these six live in 07 with the rest of
-- the taxonomy and curation, because the rows they reference are created there.
