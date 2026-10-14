-- Reward tiers, the physical items behind them, and the FAQ each campaign page
-- shows under the story.
--
-- claimed_quantity is left at zero. 05 sets it from the pledges that actually
-- reference each tier, because a stock figure that disagrees with the pledge
-- table is the one bug this schema is shaped to make impossible.

INSERT INTO reward_tiers (
    id, project_id, title, description, amount, currency, estimated_delivery,
    limit_quantity, claimed_quantity, reserved_quantity, shipping_type,
    is_early_bird, is_featured, is_secret, secret_token, is_addon, sort_order,
    available_from, available_until, created_at)
VALUES

-- Tumar (design, LIVE)
(seed_id('tier:tumar:tesekkur'), seed_id('project:tumar'), 'Təşəkkür',
 'Adınız kitabın sonundakı dəstəkçilər siyahısında yer alır.',
 15, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '38 days'),
(seed_id('tier:tumar:erkenqus'), seed_id('project:tumar'), 'Erkən quş: bir dəftər',
 'İlk 150 dəstəkçi üçün endirimli qiymətə bir Tumar dəftəri.',
 32, 'AZN', (now() + interval '4 months')::date, 150, 0, 0, 'DOMESTIC', true, false, false, NULL, false, 1, NULL, now() - interval '24 days', now() - interval '38 days'),
(seed_id('tier:tumar:bir'), seed_id('project:tumar'), 'Bir dəftər',
 'Seçdiyiniz naxışla bir Tumar dəftəri, hədiyyə qutusunda.',
 42, 'AZN', (now() + interval '4 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 2, NULL, NULL, now() - interval '38 days'),
(seed_id('tier:tumar:ucluk'), seed_id('project:tumar'), 'Üçlük dəst',
 'Üç fərqli naxışlı dəftər və parça çanta.',
 110, 'AZN', (now() + interval '4 months')::date, 400, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '38 days'),
(seed_id('tier:tumar:studiya'), seed_id('project:tumar'), 'Studiya səfəri',
 'On iki dəftər, emalatxanaya səfər və naxış seçimində iştirak.',
 450, 'AZN', (now() + interval '5 months')::date, 20, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 4, NULL, NULL, now() - interval '38 days'),
(seed_id('tier:tumar:qelem'), seed_id('project:tumar'), 'Əlavə: qələm dəsti',
 'İki qələm və bir silgi. Yalnız əsas mükafatla birlikdə.',
 18, 'AZN', (now() + interval '4 months')::date, NULL, 0, 0, 'DOMESTIC', false, false, false, NULL, true, 5, NULL, NULL, now() - interval '38 days'),

-- Qala (games, LIVE)
(seed_id('tier:qala:destek'), seed_id('project:qala'), 'Dəstəkçi',
 'Adınız oyunun titrlərində.',
 20, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '31 days'),
(seed_id('tier:qala:reqemsal'), seed_id('project:qala'), 'Rəqəmsal nüsxə',
 'Oyunun rəqəmsal açarı və saundtrek.',
 55, 'AZN', (now() + interval '10 months')::date, NULL, 0, 0, 'DIGITAL', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '31 days'),
(seed_id('tier:qala:erken'), seed_id('project:qala'), 'Erkən quş: rəqəmsal',
 'İlk 300 dəstəkçi üçün endirimli rəqəmsal nüsxə.',
 40, 'AZN', (now() + interval '10 months')::date, 300, 0, 0, 'DIGITAL', true, false, false, NULL, false, 2, NULL, now() - interval '17 days', now() - interval '31 days'),
(seed_id('tier:qala:kolleksiya'), seed_id('project:qala'), 'Kolleksiya qutusu',
 'Rəqəmsal nüsxə, çap olunmuş xəritə, sənət kitabı və nişan.',
 180, 'AZN', (now() + interval '11 months')::date, 500, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '31 days'),
(seed_id('tier:qala:beta'), seed_id('project:qala'), 'Beta test qrupu',
 'Kolleksiya qutusu, qapalı beta girişi və tərtibatçı söhbətlərinə dəvət.',
 350, 'AZN', (now() + interval '8 months')::date, 100, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 4, NULL, NULL, now() - interval '31 days'),
(seed_id('tier:qala:gizli'), seed_id('project:qala'), 'Gizli: adınız oyunda',
 'Oyundakı bir qalaya sizin adınız verilir. Yalnız dəvətlə.',
 1200, 'AZN', (now() + interval '11 months')::date, 10, 0, 0, 'INTERNATIONAL', false, false, true, 'qala-gizli-tier-2026-az', false, 5, NULL, NULL, now() - interval '31 days'),

-- Sirdaş qəhvə (food, LIVE)
(seed_id('tier:qehve:torba'), seed_id('project:qehve'), 'Bir torba',
 '250 qram, seçdiyiniz qovurma profili ilə.',
 24, 'AZN', (now() + interval '2 months')::date, NULL, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '26 days'),
(seed_id('tier:qehve:abune3'), seed_id('project:qehve'), 'Üç aylıq abunə',
 'Hər ay bir torba, üç ay ərzində. Bakı daxilində çatdırılma.',
 65, 'AZN', (now() + interval '2 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '26 days'),
(seed_id('tier:qehve:abune12'), seed_id('project:qehve'), 'İllik abunə',
 'On iki ay, hər ay bir torba və qovurma qeydləri.',
 240, 'AZN', (now() + interval '2 months')::date, 200, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '26 days'),
(seed_id('tier:qehve:dersler'), seed_id('project:qehve'), 'Dequstasiya dərsi',
 'İllik abunə və iki nəfərlik dequstasiya dərsi.',
 380, 'AZN', (now() + interval '3 months')::date, 40, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '26 days'),

-- Narıncı (publishing, LIVE)
(seed_id('tier:naringi:tesekkur'), seed_id('project:naringi'), 'Təşəkkür',
 'Adınız kitabın sonunda.',
 10, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '29 days'),
(seed_id('tier:naringi:kitab'), seed_id('project:naringi'), 'Bir kitab',
 'Sərt üzlüklü nüsxə, imzalı.',
 28, 'AZN', (now() + interval '3 months')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '29 days'),
(seed_id('tier:naringi:ikilik'), seed_id('project:naringi'), 'İki kitab',
 'Biri sizə, biri hədiyyə üçün.',
 52, 'AZN', (now() + interval '3 months')::date, NULL, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '29 days'),
(seed_id('tier:naringi:mekteb'), seed_id('project:naringi'), 'Məktəbə bağış',
 'Seçdiyiniz kənd məktəbinə on nüsxə göndərilir.',
 250, 'AZN', (now() + interval '4 months')::date, 60, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '29 days'),

-- Elektro tar (music, LIVE)
(seed_id('tier:tar:tesekkur'), seed_id('project:tar'), 'Dəstəkçi',
 'Adınız layihə saytında.',
 15, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '18 days'),
(seed_id('tier:tar:adapter'), seed_id('project:tar'), 'Bir adapter',
 'Elektro tar adapteri, kabel və daşıma çantası.',
 195, 'AZN', (now() + interval '6 months')::date, NULL, 0, 0, 'INTERNATIONAL', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '18 days'),
(seed_id('tier:tar:erken'), seed_id('project:tar'), 'Erkən quş: adapter',
 'İlk 80 ədəd, endirimli qiymətə.',
 155, 'AZN', (now() + interval '6 months')::date, 80, 0, 0, 'INTERNATIONAL', true, false, false, NULL, false, 2, NULL, now() + interval '10 days', now() - interval '18 days'),
(seed_id('tier:tar:studiya'), seed_id('project:tar'), 'Studiya dəsti',
 'İki adapter, gücləndirici və bir günlük studiya sessiyası.',
 950, 'AZN', (now() + interval '7 months')::date, 15, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '18 days'),

-- İpək Yolu (film, LIVE)
(seed_id('tier:ipek:tesekkur'), seed_id('project:ipek'), 'Təşəkkür',
 'Adınız filmin titrlərində.',
 25, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '22 days'),
(seed_id('tier:ipek:onlayn'), seed_id('project:ipek'), 'Onlayn baxış',
 'Premyeradan bir həftə əvvəl onlayn baxış linki.',
 45, 'AZN', (now() + interval '8 months')::date, NULL, 0, 0, 'DIGITAL', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '22 days'),
(seed_id('tier:ipek:premyera'), seed_id('project:ipek'), 'Premyera bileti',
 'Bakıdakı premyeraya iki bilet və onlayn baxış.',
 120, 'AZN', (now() + interval '9 months')::date, 200, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '22 days'),
(seed_id('tier:ipek:sponsor'), seed_id('project:ipek'), 'Sponsor',
 'Adınız və ya loqonuz filmin sonunda sponsorlar bölməsində.',
 2500, 'AZN', (now() + interval '9 months')::date, 12, 0, 0, 'NONE', false, false, false, NULL, false, 3, NULL, NULL, now() - interval '22 days'),

-- Kəlağayı (fashion, LIVE)
(seed_id('tier:kelagayi:serf'), seed_id('project:kelagayi'), 'Bir şərf',
 'Təbii ipək, altı naxışdan biri.',
 85, 'AZN', (now() + interval '5 months')::date, NULL, 0, 0, 'INTERNATIONAL', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '6 days'),
(seed_id('tier:kelagayi:koynek'), seed_id('project:kelagayi'), 'Bir köynək',
 'Ölçü cədvəlindən seçim, əl ilə tikilir.',
 190, 'AZN', (now() + interval '5 months')::date, 250, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '6 days'),
(seed_id('tier:kelagayi:dest'), seed_id('project:kelagayi'), 'Tam dəst',
 'Köynək, şərf və astarlı çanta.',
 320, 'AZN', (now() + interval '6 months')::date, 120, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '6 days'),

-- Şəki ustaları (crafts, SUCCESSFUL)
(seed_id('tier:usta:tesekkur'), seed_id('project:usta'), 'Təşəkkür',
 'Adınız arxiv saytında.',
 20, 'AZN', NULL, NULL, 0, 0, 'NONE', false, false, false, NULL, false, 0, NULL, NULL, now() - interval '120 days'),
(seed_id('tier:usta:usb'), seed_id('project:usta'), 'Arxiv diski',
 'Bütün videolar və fotolar bir USB diskdə.',
 75, 'AZN', (now() - interval '30 days')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 1, NULL, NULL, now() - interval '120 days'),
(seed_id('tier:usta:sefer'), seed_id('project:usta'), 'Şəkiyə səfər',
 'Arxiv diski və bir günlük emalatxana turu.',
 340, 'AZN', (now() - interval '20 days')::date, 50, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '120 days'),

-- Bakı 1990 (photography, SUCCESSFUL)
(seed_id('tier:foto:albom'), seed_id('project:foto'), 'Bir albom',
 '180 fotoşəkil, sərt üzlük.',
 60, 'AZN', (now() - interval '120 days')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '200 days'),
(seed_id('tier:foto:cap'), seed_id('project:foto'), 'Albom və çap',
 'Albom və seçdiyiniz fotonun 30×40 çapı.',
 150, 'AZN', (now() - interval '110 days')::date, 150, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '200 days'),

-- Qorqud (comics, UNSUCCESSFUL)
(seed_id('tier:komiks:reqemsal'), seed_id('project:komiks'), 'Rəqəmsal nüsxə',
 'PDF və ePub formatında.',
 25, 'AZN', NULL, NULL, 0, 0, 'DIGITAL', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '160 days'),
(seed_id('tier:komiks:cap'), seed_id('project:komiks'), 'Çap nüsxəsi',
 'Sərt üzlüklü, 140 səhifə.',
 70, 'AZN', NULL, NULL, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '160 days'),

-- Kür albom (music, WITHDRAWN)
(seed_id('tier:albom:reqemsal'), seed_id('project:albom'), 'Rəqəmsal albom',
 'Buraxılışdan bir həftə əvvəl yüklənə bilər.',
 20, 'AZN', (now() + interval '2 months')::date, NULL, 0, 0, 'DIGITAL', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '46 days'),
(seed_id('tier:albom:vinil'), seed_id('project:albom'), 'Vinil',
 'İmzalı vinil və rəqəmsal nüsxə.',
 95, 'AZN', (now() + interval '7 months')::date, 500, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '46 days'),
(seed_id('tier:albom:konsert'), seed_id('project:albom'), 'Ev konserti',
 'Vinil və Bakıda kiçik ev konsertinə dəvət.',
 400, 'AZN', (now() + interval '5 months')::date, 30, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '46 days'),

-- Ağ Qab (technology, FULFILLING)
(seed_id('tier:qab:bir'), seed_id('project:qab'), 'Bir qab',
 'Ağ Qab, seçdiyiniz rəngdə.',
 145, 'AZN', (now() - interval '30 days')::date, NULL, 0, 0, 'INTERNATIONAL', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '150 days'),
(seed_id('tier:qab:iki'), seed_id('project:qab'), 'İki qab',
 'İki ədəd, fərqli rənglərdə.',
 270, 'AZN', (now() - interval '30 days')::date, NULL, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '150 days'),
(seed_id('tier:qab:ofis'), seed_id('project:qab'), 'Ofis dəsti',
 'On ədəd, korporativ qablaşdırma ilə.',
 1300, 'AZN', (now() - interval '15 days')::date, 60, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '150 days'),

-- Xalça lampa (design, COMPLETED)
(seed_id('tier:lampa:bir'), seed_id('project:lampa'), 'Bir lampa',
 'Masa lampası, iki naxışdan biri.',
 120, 'AZN', (now() - interval '200 days')::date, NULL, 0, 0, 'DOMESTIC', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '300 days'),
(seed_id('tier:lampa:cut'), seed_id('project:lampa'), 'Cüt lampa',
 'İki lampa, fərqli naxışlarla.',
 220, 'AZN', (now() - interval '200 days')::date, 200, 0, 0, 'DOMESTIC', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '300 days'),

-- Novruz (games, FULFILLING)
(seed_id('tier:masa:oyun'), seed_id('project:masa'), 'Bir oyun',
 'Qutu, kartlar və qaydalar kitabçası.',
 78, 'AZN', (now() + interval '3 months')::date, NULL, 0, 0, 'INTERNATIONAL', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '70 days'),
(seed_id('tier:masa:deluxe'), seed_id('project:masa'), 'Deluxe qutu',
 'Taxta komponentlər, parça torba və əlavə ssenari.',
 145, 'AZN', (now() + interval '4 months')::date, 400, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '70 days'),
(seed_id('tier:masa:magaza'), seed_id('project:masa'), 'Mağaza dəsti',
 'Altı ədəd, pərakəndə satış üçün.',
 400, 'AZN', (now() + interval '4 months')::date, 80, 0, 0, 'INTERNATIONAL', false, false, false, NULL, false, 2, NULL, NULL, now() - interval '70 days'),

-- The ones that never took money still show a tier list in the editor.
(seed_id('tier:teatr:bilet'), seed_id('project:teatr'), 'Bir bilet',
 'Seçdiyiniz tamaşaya bir bilet.',
 30, 'AZN', (now() + interval '6 months')::date, NULL, 0, 0, 'LOCAL_PICKUP', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '9 days'),
(seed_id('tier:teatr:mövsüm'), seed_id('project:teatr'), 'Mövsüm abunəsi',
 'Üç tamaşanın hamısına bilet.',
 80, 'AZN', (now() + interval '6 months')::date, 150, 0, 0, 'LOCAL_PICKUP', false, false, false, NULL, false, 1, NULL, NULL, now() - interval '9 days'),
(seed_id('tier:arxiv:destek'), seed_id('project:arxiv'), 'Dəstəkçi',
 'Adınız arxiv saytında.',
 20, 'AZN', NULL, NULL, 0, 0, 'NONE', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '14 days'),
(seed_id('tier:bazar:stend'), seed_id('project:bazar'), 'İstehsalçı stendi',
 'Üç həftə boyunca bir stend.',
 350, 'AZN', (now() + interval '2 months')::date, 40, 0, 0, 'LOCAL_PICKUP', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '18 days'),
(seed_id('tier:kurs:giris'), seed_id('project:kurs'), 'Kursa giriş',
 'Səkkiz həftəlik onlayn kurs.',
 180, 'AZN', NULL, NULL, 0, 0, 'DIGITAL', false, true, false, NULL, false, 0, NULL, NULL, now() - interval '4 days')

ON CONFLICT (id) DO NOTHING;

-- ── The physical things inside the tiers ────────────────────────────────────

INSERT INTO items (id, project_id, name, description, image_url, weight_grams, is_digital, sku, created_at) VALUES
  (seed_id('item:tumar:defter'), seed_id('project:tumar'), 'Tumar dəftəri',
   'A5, 192 səhifə, sərt üzlük, tikilmiş cild.',
   seed_photo('photo-1531297484001-80022131f5a1', 800, 800), 420, false, 'TUMAR-A5', now() - interval '38 days'),
  (seed_id('item:tumar:canta'), seed_id('project:tumar'), 'Parça çanta',
   'Pambıq, çap olunmuş naxışla.',
   seed_photo('photo-1523381210434-271e8be1f52b', 800, 800), 140, false, 'TUMAR-BAG', now() - interval '38 days'),
  (seed_id('item:tumar:qelem'), seed_id('project:tumar'), 'Qələm dəsti',
   'İki qələm və bir silgi.', NULL, 60, false, 'TUMAR-PEN', now() - interval '38 days'),
  (seed_id('item:qala:acar'), seed_id('project:qala'), 'Oyun açarı',
   'Steam açarı.', NULL, NULL, true, 'QALA-KEY', now() - interval '31 days'),
  (seed_id('item:qala:xerite'), seed_id('project:qala'), 'Çap olunmuş xəritə',
   '60×80 sm, qalın kağız.', NULL, 220, false, 'QALA-MAP', now() - interval '31 days'),
  (seed_id('item:qala:kitab'), seed_id('project:qala'), 'Sənət kitabı',
   '120 səhifə, konsept rəsmlər.', NULL, 900, false, 'QALA-ART', now() - interval '31 days'),
  (seed_id('item:qehve:torba'), seed_id('project:qehve'), 'Qəhvə torbası',
   '250 qram, klapanlı torba.',
   seed_photo('photo-1524758631624-e2822e304c36', 800, 800), 280, false, 'SIRDAS-250', now() - interval '26 days'),
  (seed_id('item:naringi:kitab'), seed_id('project:naringi'), 'Narıncı kitabı',
   '96 səhifə, sərt üzlük.',
   seed_photo('photo-1481627834876-b7833e8f5570', 800, 800), 640, false, 'NARINGI-HC', now() - interval '29 days'),
  (seed_id('item:tar:adapter'), seed_id('project:tar'), 'Adapter',
   'Elektro tar adapteri, kabel daxil.', NULL, 310, false, 'TAR-ADP', now() - interval '18 days'),
  (seed_id('item:qab:qab'), seed_id('project:qab'), 'Ağ Qab',
   '750 ml, paslanmayan polad, ekranlı qapaq.',
   seed_photo('photo-1518770660439-4636190af475', 800, 800), 480, false, 'AQ-750', now() - interval '150 days'),
  (seed_id('item:albom:vinil'), seed_id('project:albom'), 'Vinil disk',
   '180 qram, qara.', NULL, 340, false, 'KUR-LP', now() - interval '46 days'),
  (seed_id('item:masa:qutu'), seed_id('project:masa'), 'Oyun qutusu',
   'Kartlar, taxta fiqurlar və qaydalar.', NULL, 1200, false, 'NOVRUZ-BOX', now() - interval '70 days'),
  (seed_id('item:lampa:lampa'), seed_id('project:lampa'), 'Xalça lampa',
   'Metal gövdə, isti ağ LED.',
   seed_photo('photo-1558618666-fcd25c85cd64', 800, 800), 760, false, 'XL-01', now() - interval '300 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO reward_tier_items (reward_tier_id, item_id, project_id, quantity) VALUES
  (seed_id('tier:tumar:erkenqus'),  seed_id('item:tumar:defter'), seed_id('project:tumar'), 1),
  (seed_id('tier:tumar:bir'),       seed_id('item:tumar:defter'), seed_id('project:tumar'), 1),
  (seed_id('tier:tumar:ucluk'),     seed_id('item:tumar:defter'), seed_id('project:tumar'), 3),
  (seed_id('tier:tumar:ucluk'),     seed_id('item:tumar:canta'),  seed_id('project:tumar'), 1),
  (seed_id('tier:tumar:studiya'),   seed_id('item:tumar:defter'), seed_id('project:tumar'), 12),
  (seed_id('tier:tumar:qelem'),     seed_id('item:tumar:qelem'),  seed_id('project:tumar'), 1),
  (seed_id('tier:qala:reqemsal'),   seed_id('item:qala:acar'),    seed_id('project:qala'), 1),
  (seed_id('tier:qala:erken'),      seed_id('item:qala:acar'),    seed_id('project:qala'), 1),
  (seed_id('tier:qala:kolleksiya'), seed_id('item:qala:acar'),    seed_id('project:qala'), 1),
  (seed_id('tier:qala:kolleksiya'), seed_id('item:qala:xerite'),  seed_id('project:qala'), 1),
  (seed_id('tier:qala:kolleksiya'), seed_id('item:qala:kitab'),   seed_id('project:qala'), 1),
  (seed_id('tier:qala:beta'),       seed_id('item:qala:acar'),    seed_id('project:qala'), 1),
  (seed_id('tier:qala:beta'),       seed_id('item:qala:kitab'),   seed_id('project:qala'), 1),
  (seed_id('tier:qehve:torba'),     seed_id('item:qehve:torba'),  seed_id('project:qehve'), 1),
  (seed_id('tier:qehve:abune3'),    seed_id('item:qehve:torba'),  seed_id('project:qehve'), 3),
  (seed_id('tier:qehve:abune12'),   seed_id('item:qehve:torba'),  seed_id('project:qehve'), 12),
  (seed_id('tier:naringi:kitab'),   seed_id('item:naringi:kitab'),seed_id('project:naringi'), 1),
  (seed_id('tier:naringi:ikilik'),  seed_id('item:naringi:kitab'),seed_id('project:naringi'), 2),
  (seed_id('tier:naringi:mekteb'),  seed_id('item:naringi:kitab'),seed_id('project:naringi'), 10),
  (seed_id('tier:tar:adapter'),     seed_id('item:tar:adapter'),  seed_id('project:tar'), 1),
  (seed_id('tier:tar:erken'),       seed_id('item:tar:adapter'),  seed_id('project:tar'), 1),
  (seed_id('tier:tar:studiya'),     seed_id('item:tar:adapter'),  seed_id('project:tar'), 2),
  (seed_id('tier:qab:bir'),         seed_id('item:qab:qab'),      seed_id('project:qab'), 1),
  (seed_id('tier:qab:iki'),         seed_id('item:qab:qab'),      seed_id('project:qab'), 2),
  (seed_id('tier:qab:ofis'),        seed_id('item:qab:qab'),      seed_id('project:qab'), 10),
  (seed_id('tier:albom:vinil'),     seed_id('item:albom:vinil'),  seed_id('project:albom'), 1),
  (seed_id('tier:albom:konsert'),   seed_id('item:albom:vinil'),  seed_id('project:albom'), 1),
  (seed_id('tier:masa:oyun'),       seed_id('item:masa:qutu'),    seed_id('project:masa'), 1),
  (seed_id('tier:masa:deluxe'),     seed_id('item:masa:qutu'),    seed_id('project:masa'), 1),
  (seed_id('tier:masa:magaza'),     seed_id('item:masa:qutu'),    seed_id('project:masa'), 6),
  (seed_id('tier:lampa:bir'),       seed_id('item:lampa:lampa'),  seed_id('project:lampa'), 1),
  (seed_id('tier:lampa:cut'),       seed_id('item:lampa:lampa'),  seed_id('project:lampa'), 2)
ON CONFLICT (reward_tier_id, item_id) DO NOTHING;

-- ── Shipping ────────────────────────────────────────────────────────────────

INSERT INTO shipping_rules (reward_tier_id, country_code, amount, additional_item_amount, per_kilogram_amount) VALUES
  (seed_id('tier:tumar:erkenqus'), 'AZ', 5,  2, 0),
  (seed_id('tier:tumar:bir'),      'AZ', 5,  2, 0),
  (seed_id('tier:tumar:ucluk'),    'AZ', 7,  2, 0),
  (seed_id('tier:tumar:ucluk'),    'TR', 22, 6, 0),
  (seed_id('tier:tumar:ucluk'),    'GE', 18, 5, 0),
  (seed_id('tier:tumar:qelem'),    'AZ', 3,  1, 0),
  (seed_id('tier:qala:kolleksiya'),'AZ', 8,  3, 0),
  (seed_id('tier:qala:kolleksiya'),'TR', 28, 8, 0),
  (seed_id('tier:qala:kolleksiya'),'DE', 42, 12, 0),
  (seed_id('tier:qala:beta'),      'AZ', 8,  3, 0),
  (seed_id('tier:qala:beta'),      'DE', 42, 12, 0),
  (seed_id('tier:qehve:torba'),    'AZ', 4,  1, 0),
  (seed_id('tier:qehve:abune3'),   'AZ', 0,  0, 0),
  (seed_id('tier:qehve:abune12'),  'AZ', 0,  0, 0),
  (seed_id('tier:naringi:kitab'),  'AZ', 5,  2, 0),
  (seed_id('tier:naringi:ikilik'), 'AZ', 6,  2, 0),
  (seed_id('tier:naringi:mekteb'), 'AZ', 0,  0, 0),
  (seed_id('tier:tar:adapter'),    'AZ', 6,  2, 0),
  (seed_id('tier:tar:adapter'),    'TR', 26, 7, 0),
  (seed_id('tier:tar:erken'),      'AZ', 6,  2, 0),
  (seed_id('tier:kelagayi:serf'),  'AZ', 5,  2, 0),
  (seed_id('tier:kelagayi:serf'),  'TR', 20, 6, 0),
  (seed_id('tier:kelagayi:koynek'),'AZ', 6,  2, 0),
  (seed_id('tier:kelagayi:dest'),  'AZ', 8,  2, 0),
  (seed_id('tier:qab:bir'),        'AZ', 6,  2, 0),
  (seed_id('tier:qab:bir'),        'TR', 24, 7, 0),
  (seed_id('tier:qab:iki'),        'AZ', 7,  2, 0),
  (seed_id('tier:albom:vinil'),    'AZ', 7,  3, 0),
  (seed_id('tier:albom:vinil'),    'DE', 38, 10, 0),
  (seed_id('tier:masa:oyun'),      'AZ', 9,  4, 0),
  (seed_id('tier:masa:deluxe'),    'AZ', 9,  4, 0),
  (seed_id('tier:lampa:bir'),      'AZ', 8,  3, 0)
ON CONFLICT (reward_tier_id, country_code) DO NOTHING;

INSERT INTO shipping_zones (id, project_id, name, created_at) VALUES
  (seed_id('zone:qala:az'),     seed_id('project:qala'), 'Azərbaycan',      now() - interval '31 days'),
  (seed_id('zone:qala:qafqaz'), seed_id('project:qala'), 'Qafqaz və Türkiyə', now() - interval '31 days'),
  (seed_id('zone:qala:avropa'), seed_id('project:qala'), 'Avropa',          now() - interval '31 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shipping_zone_countries (zone_id, project_id, country_code) VALUES
  (seed_id('zone:qala:az'),     seed_id('project:qala'), 'AZ'),
  (seed_id('zone:qala:qafqaz'), seed_id('project:qala'), 'TR'),
  (seed_id('zone:qala:qafqaz'), seed_id('project:qala'), 'GE'),
  (seed_id('zone:qala:avropa'), seed_id('project:qala'), 'DE'),
  (seed_id('zone:qala:avropa'), seed_id('project:qala'), 'FR'),
  (seed_id('zone:qala:avropa'), seed_id('project:qala'), 'NL')
ON CONFLICT (project_id, country_code) DO NOTHING;

-- ── FAQ ─────────────────────────────────────────────────────────────────────

INSERT INTO project_faqs (id, project_id, question, answer, sort_order, created_at) VALUES
  (seed_id('faq:tumar:1'), seed_id('project:tumar'), 'Dəftər neçə səhifədir?',
   '192 səhifə, 100 qramlıq kağız. Səhifələr nöqtəli şəbəkəlidir.', 0, now() - interval '36 days'),
  (seed_id('faq:tumar:2'), seed_id('project:tumar'), 'Naxışı özüm seçə bilərəmmi?',
   'Bəli. Kampaniya bitdikdən sonra sorğu göndəririk və on iki naxışdan birini seçirsiniz.', 1, now() - interval '36 days'),
  (seed_id('faq:tumar:3'), seed_id('project:tumar'), 'Xaricə göndərirsiniz?',
   'Üçlük dəst və studiya səfəri istisna olmaqla, hazırda yalnız Azərbaycan daxilində. Üçlük dəst Türkiyə və Gürcüstana da göndərilir.', 2, now() - interval '30 days'),
  (seed_id('faq:qala:1'), seed_id('project:qala'), 'Oyun hansı platformalarda çıxacaq?',
   'İlk buraxılış Windows və macOS üçündür. Linux dəstəyi buraxılışdan sonra planlaşdırılır.', 0, now() - interval '29 days'),
  (seed_id('faq:qala:2'), seed_id('project:qala'), 'Azərbaycan dili olacaqmı?',
   'Bəli. Oyun Azərbaycan, ingilis və rus dillərində tam lokalizasiya olunur. Səsləndirmə yalnız Azərbaycan dilindədir.', 1, now() - interval '29 days'),
  (seed_id('faq:qala:3'), seed_id('project:qala'), 'Demo versiyanı harada oynaya bilərəm?',
   'Kampaniya səhifəsindəki linkdən yükləyə bilərsiniz. Demo təxminən qırx dəqiqəlik oyun təqdim edir.', 2, now() - interval '25 days'),
  (seed_id('faq:qehve:1'), seed_id('project:qehve'), 'Qəhvə nə vaxt qovrulur?',
   'Hər çərşənbə axşamı qovururuq və elə həmin gün göndəririk. Torbanın üzərində qovurma tarixi var.', 0, now() - interval '24 days'),
  (seed_id('faq:qehve:2'), seed_id('project:qehve'), 'Üyüdülmüş seçim varmı?',
   'Bəli. Sifariş sorğusunda dənə və ya üyüdülmüş seçimi edirsiniz. Üyüdülmüş variantda üyütmə növünü də göstərirsiniz.', 1, now() - interval '24 days'),
  (seed_id('faq:naringi:1'), seed_id('project:naringi'), 'Kitab hansı yaş üçündür?',
   'Beş-səkkiz yaş. Şrift iri seçilib ki, uşaq özü oxuya bilsin.', 0, now() - interval '27 days'),
  (seed_id('faq:naringi:2'), seed_id('project:naringi'), 'İkinci cild olacaqmı?',
   'Planlaşdırılır, amma bu kampaniyanın bir hissəsi deyil. Əvvəlcə birinci cildi çatdırırıq.', 1, now() - interval '27 days'),
  (seed_id('faq:tar:1'), seed_id('project:tar'), 'Adapter tarı zədələyirmi?',
   'Xeyr. Adapter kasaya sıxılaraq bərkidilir, heç bir deşik açılmır və istənilən vaxt çıxarılır.', 0, now() - interval '16 days'),
  (seed_id('faq:tar:2'), seed_id('project:tar'), 'Başqa simli alətlərdə işləyirmi?',
   'Saz və kamança ilə sınamışıq və işləyir, lakin bu kampaniya yalnız tar üçün ölçülərlə göndərilir.', 1, now() - interval '16 days'),
  (seed_id('faq:ipek:1'), seed_id('project:ipek'), 'Film nə vaxt hazır olacaq?',
   'Montajın gələn ilin yazında bitməsi planlaşdırılır. Premyera payıza nəzərdə tutulub.', 0, now() - interval '20 days'),
  (seed_id('faq:ipek:2'), seed_id('project:ipek'), 'Subtitr olacaqmı?',
   'Azərbaycan, ingilis və rus dillərində subtitr hazırlanır.', 1, now() - interval '20 days'),
  (seed_id('faq:qab:1'), seed_id('project:qab'), 'Batareyanı necə dəyişirəm?',
   'Qapağın altındakı vidanı açıb standart CR2032 batareyanı dəyişirsiniz. Alət tələb olunmur.', 0, now() - interval '140 days'),
  (seed_id('faq:masa:1'), seed_id('project:masa'), 'Neçə nəfər oynaya bilər?',
   'İki-dörd nəfər. Tək oyunçu üçün variant qaydalar kitabçasında var.', 0, now() - interval '65 days')
ON CONFLICT (id) DO NOTHING;
