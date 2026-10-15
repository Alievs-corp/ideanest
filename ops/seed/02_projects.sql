-- Twenty campaigns, chosen so that every state in the project lifecycle has at
-- least one row behind it. A demo where everything is LIVE hides exactly the
-- screens that are hardest to reason about: the finance console, the moderation
-- queue, the collecting and fulfilling dashboards.
--
-- pledged_amount and backers_count are deliberately left at zero here. 05
-- recomputes both from the pledge rows, so the figure on a card is the sum of
-- the pledges behind it rather than a number typed twice.

INSERT INTO projects (
    id, creator_id, slug, title, blurb, category_id, subcategory_id, location_id,
    state, goal_amount, currency, duration_days, scheduled_launch_at, launched_at, deadline,
    story, risks, cover_image_url, cover_image_width, cover_image_height,
    finalized_at, outcome_goal_amount, outcome_pledged_amount, outcome_backers_count,
    created_at)
VALUES

-- ── LIVE ────────────────────────────────────────────────────────────────────

(seed_id('project:tumar'), seed_id('user:creator'), 'tumar-defter', 'Tumar: xalça naxışlı gündəlik dəftər',
 'Qarabağ xalçalarının naxışları ilə bəzədilmiş, Bakıda tikilən sərt üzlü dəftər.',
 seed_category('design'), seed_subcategory('design', 0), seed_location('baki'),
 'LIVE', 25000, 'AZN', 45, NULL, now() - interval '38 days', now() + interval '7 days',
 seed_story(
   'Tumar bir dəftərdir, amma üzərindəki hər naxış Qarabağ xalçalarının arxivindən götürülüb.',
   'Layihə haqqında',
   'İki il ərzində Bakı, Şuşa və Bərdə arxivlərində 140-dan çox xalça naxışını sənədləşdirdik. Onlardan on ikisini seçdik və dəftər üzlüyünə köçürdük. Kağız Avropadan gətirilir, tikiş Bakıdakı emalatxanamızda əl ilə edilir.',
   'photo-1531297484001-80022131f5a1', 'Açıq dəftər və üzərində xalça naxışlı üzlük',
   'Plan və büdcə',
   'Toplanan vəsait ilk 3000 nüsxənin istehsalını, qablaşdırmanı və göndərməni qarşılayır. Kalıp xərcləri artıq ödənilib.',
   ARRAY['Kağız və üzlük materialı — 11 000 AZN',
         'Tikiş və istehsal — 7 000 AZN',
         'Qablaşdırma və göndərmə — 4 500 AZN',
         'Platforma və ödəniş komissiyaları — 2 500 AZN']),
 'Ən böyük risk gömrükdür: kağız idxalı gecikərsə istehsal iki-üç həftə sürüşə bilər. Ehtiyat tədarükçü ilə də danışıqlar aparılıb.',
 seed_photo('photo-1531297484001-80022131f5a1', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '52 days'),

(seed_id('project:qala'), seed_id('user:orxan'), 'qala-oyunu', 'Qala: Qafqaz mifologiyası əsasında strategiya',
 'Şəhər qururuq, əjdaha ilə danışırıq. Azərbaycan nağıllarından bəhrələnən növbəli strategiya.',
 seed_category('games'), seed_subcategory('games', 0), seed_location('sumqayit'),
 'LIVE', 60000, 'AZN', 50, NULL, now() - interval '31 days', now() + interval '19 days',
 seed_story(
   'Qala — dörd nəfərlik komandanın üç ildir üzərində işlədiyi növbəli strategiya oyunudur.',
   'Layihə haqqında',
   'Oyunçu Qafqazın xəyali bir bölgəsində qala qurur, qonşularla danışır və mifoloji varlıqlarla razılığa gəlir. Hər kampaniya təxminən on saat çəkir və dörd fərqli sonluğu var. Oyunun demo versiyası hazırdır.',
   'photo-1511512578047-dfb367046420', 'Oyun idarəetmə pultu və ekranda strategiya xəritəsi',
   'Plan və büdcə',
   'Vəsait qalan on ay ərzində komandanın maaşını, səsləndirməni və Azərbaycan dilinə tam lokalizasiyanı qarşılayır.',
   ARRAY['Proqramlaşdırma və dizayn — 32 000 AZN',
         'Musiqi və səsləndirmə — 12 000 AZN',
         'Lokalizasiya (AZ / EN / RU) — 8 000 AZN',
         'Test və nəşr — 8 000 AZN']),
 'Oyun tərtibatı proqnozlaşdırılması çətin işdir. Buraxılış tarixini altı ay ehtiyatla göstərmişik, lakin gecikmə ehtimalı realdır.',
 seed_photo('photo-1511512578047-dfb367046420', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '44 days'),

(seed_id('project:qehve'), seed_id('user:tural'), 'sirdas-qehve', 'Sirdaş: Bakıda qovrulan tək mənşəli qəhvə',
 'Efiopiya və Kolumbiyadan gətirilən dənələr, Bakıda həftəlik kiçik partiyalarla qovrulur.',
 seed_category('food'), seed_subcategory('food', 0), seed_location('baki'),
 'LIVE', 15000, 'AZN', 30, NULL, now() - interval '26 days', now() + interval '4 days',
 seed_story(
   'Sirdaş kiçik bir qovurma sexidir. Həftədə bir dəfə qovururuq və elə həmin həftə göndəririk.',
   'Layihə haqqında',
   'İki ildir dostlar üçün qovururuq. İndi 12 kiloqramlıq qovurma maşını almaq və Bakının içində abunə çatdırılması qurmaq istəyirik. Hər partiyanın qovurma profili və tarixi qutunun üzərində yazılır.',
   'photo-1524758631624-e2822e304c36', 'Qəhvə qovurma sexində taxta rəflər və qəhvə kisələri',
   'Plan və büdcə',
   'Toplanan vəsaitin yarısı maşına, qalanı ilk altı ayın dənə tədarükünə və qablaşdırmaya gedir.',
   ARRAY['Qovurma maşını — 8 000 AZN',
         'İlk dənə tədarükü — 3 500 AZN',
         'Qablaşdırma və etiket — 2 000 AZN',
         'Komissiyalar — 1 500 AZN']),
 'Dünya qəhvə qiymətləri dəyişkəndir. Kəskin artım olarsa porsiya çəkisini deyil, abunə qiymətini yenidən nəzərdən keçirəcəyik və dəstəkçilərə əvvəlcədən bildirəcəyik.',
 seed_photo('photo-1524758631624-e2822e304c36', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '35 days'),

(seed_id('project:naringi'), seed_id('user:sevinc'), 'naringi-kitab', 'Narıncı: uşaqlar üçün Azərbaycan nağılları',
 'Yeddi klassik nağıl, yenidən danışılıb və əl ilə çəkilmiş 60 illüstrasiya ilə nəşr olunur.',
 seed_category('publishing'), seed_subcategory('publishing', 0), seed_location('qebele'),
 'LIVE', 12000, 'AZN', 40, NULL, now() - interval '29 days', now() + interval '11 days',
 seed_story(
   'Uşaq kitablarının çoxu tərcümədir. Bu kitab tərcümə deyil.',
   'Layihə haqqında',
   'Yeddi nağılı beş-səkkiz yaş üçün yenidən yazdıq və hər birinə səkkiz-on illüstrasiya çəkdik. Kitab sərt üzlüklü, 96 səhifə, iri şriftlə — uşağın özünün oxuya biləcəyi ölçüdə.',
   'photo-1481627834876-b7833e8f5570', 'Rəfdə düzülmüş rəngli uşaq kitabları',
   'Plan və büdcə',
   'Çap Bakıda, 2000 nüsxə ilə başlayır. İllüstrasiyaların 48-i hazırdır.',
   ARRAY['Çap və cildləmə — 6 500 AZN',
         'Qalan illüstrasiyalar — 2 500 AZN',
         'Redaktə və korrektə — 1 500 AZN',
         'Göndərmə — 1 500 AZN']),
 'Çap keyfiyyəti üçün iki mətbəədən nümunə alınıb. Rəng uyğunsuzluğu olarsa çap gecikə bilər — bu halda dəstəkçilərə yeni tarix bildiriləcək.',
 seed_photo('photo-1481627834876-b7833e8f5570', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '40 days'),

(seed_id('project:tar'), seed_id('user:ramin'), 'elektro-tar', 'Elektro tar: klassik alət, yeni səs',
 'Tarın səsini itirmədən onu gücləndirici və effektlərlə işləyə bilən hala gətirən adapter.',
 seed_category('music'), seed_subcategory('music', 0), seed_location('lenkeran'),
 'LIVE', 20000, 'AZN', 45, NULL, now() - interval '18 days', now() + interval '27 days',
 seed_story(
   'Tar mikrofonla yazılanda otağın səsini də yazır. Bu adapter yalnız alətin özünü yazır.',
   'Layihə haqqında',
   'Üç ildir müxtəlif adapter konstruksiyaları sınayırıq. Sonuncu prototip tarın kasasına heç bir dəyişiklik etmədən quraşdırılır və çıxarılır. Səs nümunələri kampaniya səhifəsindəki videoda var.',
   'photo-1452587925148-ce544e77e70d', 'Simli alət və yaxınlıqda studiya avadanlığı',
   'Plan və büdcə',
   'Vəsait ilk 400 ədədin istehsalını və sertifikatlaşdırmanı qarşılayır.',
   ARRAY['Kalıp və istehsal — 11 000 AZN',
         'Elektron komponentlər — 4 000 AZN',
         'Sertifikatlaşdırma — 2 500 AZN',
         'Qablaşdırma və göndərmə — 2 500 AZN']),
 'Komponent tədarükü qlobal çatışmazlıqdan asılıdır. Əsas mikroçip üçün iki alternativ tədarükçü təsdiqlənib.',
 seed_photo('photo-1452587925148-ce544e77e70d', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '30 days'),

(seed_id('project:ipek'), seed_id('user:gunel'), 'ipek-yolu-film', 'İpək Yolu: sənədli film',
 'Şəki, Basqal və Ordubadda ipəkçiliyin son ustaları haqqında 80 dəqiqəlik sənədli film.',
 seed_category('film'), seed_subcategory('film', 0), seed_location('seki'),
 'LIVE', 45000, 'AZN', 50, NULL, now() - interval '22 days', now() + interval '28 days',
 seed_story(
   'Şəkidə ipək toxuyan yeddi usta qalıb. Beşinin yaşı yetmişi keçib.',
   'Layihə haqqında',
   'İki ildir onlarla söhbət edirik və 40 saatlıq material çəkmişik. Filmin quruluşu hazırdır, montaj başlayıb. Kampaniya montajın tamamlanmasını, səs işini və festival təqdimatını maliyyələşdirir.',
   'photo-1470071459604-3b5ec3a7fe05', 'Dağ kəndində səhər dumanı',
   'Plan və büdcə',
   'Çəkilişin böyük hissəsi bitib. Qalan iş post-produksiyadır.',
   ARRAY['Montaj — 16 000 AZN',
         'Səs və musiqi — 12 000 AZN',
         'Rəng korreksiyası — 7 000 AZN',
         'Festival və subtitr — 10 000 AZN']),
 'İştirakçılardan biri səhhəti səbəbindən əlavə çəkilişə razı olmaya bilər. Bu halda mövcud materialdan istifadə ediləcək.',
 seed_photo('photo-1470071459604-3b5ec3a7fe05', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '33 days'),

(seed_id('project:kelagayi'), seed_id('user:creator'), 'kelagayi-kolleksiya', 'Kəlağayı: gündəlik geyim kolleksiyası',
 'Basqal kəlağayısının naxışları ilə hazırlanan ipək köynək və şərf kolleksiyası.',
 seed_category('fashion'), seed_subcategory('fashion', 0), seed_location('samaxi'),
 'LIVE', 18000, 'AZN', 35, NULL, now() - interval '6 days', now() + interval '29 days',
 seed_story(
   'Kəlağayı muzey əşyası deyil. Onu gündəlik geyinmək olar — sadəcə forması dəyişməlidir.',
   'Layihə haqqında',
   'Basqaldakı emalatxana ilə birlikdə altı naxış seçdik və onları köynək, şərf və çanta astarına köçürdük. Boyama ənənəvi üsulla, təbii boyalarla aparılır.',
   'photo-1523381210434-271e8be1f52b', 'Askıda asılmış rəngli parça və köynəklər',
   'Plan və büdcə',
   'İlk kolleksiya 250 ədəddir. Nümunələr hazırdır və ölçü cədvəli sınaqdan keçirilib.',
   ARRAY['Parça və boyama — 8 000 AZN',
         'Tikiş — 5 000 AZN',
         'Foto və katalog — 2 500 AZN',
         'Göndərmə və komissiyalar — 2 500 AZN']),
 'Təbii boyama partiyadan partiyaya kiçik rəng fərqi yaradır. Bunu qüsur deyil, xüsusiyyət kimi göstəririk və hər məhsulun fotosu ayrıca çəkilir.',
 seed_photo('photo-1523381210434-271e8be1f52b', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '20 days'),

-- ── Ended, and finalised ────────────────────────────────────────────────────

(seed_id('project:usta'), seed_id('user:gunel'), 'seki-usta-arxivi', 'Şəki ustaları: rəqəmsal arxiv',
 'On iki sənətkarlıq növü, video təlimatlar və açıq lisenziya ilə paylaşılan foto arxiv.',
 seed_category('crafts'), seed_subcategory('crafts', 0), seed_location('seki'),
 'SUCCESSFUL', 30000, 'AZN', 45, NULL, now() - interval '120 days', now() - interval '75 days',
 seed_story(
   'Bir ustanın bildiyi şey yazılmayıbsa, o usta ilə birlikdə itir.',
   'Layihə haqqında',
   'Şəkidə on iki sənətkarlıq növünü — şəbəkə, misgərlik, təkəlduz və başqalarını — video ilə sənədləşdirdik. Bütün material açıq lisenziya ilə paylaşılır.',
   'photo-1503676260728-1c00da094a0b', 'Emalatxanada alətlər və iş masası',
   'Plan və büdcə',
   'Kampaniya bitib, çəkilişlər tamamlanıb və arxiv onlayn yerləşdirilib.',
   ARRAY['Çəkiliş və montaj — 18 000 AZN',
         'Arxiv saytı — 6 000 AZN',
         'Tərcümə və subtitr — 6 000 AZN']),
 'Bəzi ustalar çəkilişdən imtina edə bilər. On beş nəfərlə danışılıb, on ikisi razılıq verib.',
 seed_photo('photo-1503676260728-1c00da094a0b', 1600, 1000), 1600, 1000,
 now() - interval '75 days', 30000, 33600, 214, now() - interval '140 days'),

(seed_id('project:foto'), seed_id('user:creator'), 'baki-foto-albom', 'Bakı 1990: foto albom',
 'Şəxsi arxivlərdən toplanmış 180 fotoşəkil, ilk dəfə çap olunur.',
 seed_category('photography'), seed_subcategory('photography', 0), seed_location('baki'),
 'SUCCESSFUL', 9000, 'AZN', 30, NULL, now() - interval '200 days', now() - interval '170 days',
 seed_story(
   'Bu fotoların heç biri peşəkar tərəfindən çəkilməyib. Elə buna görə də qiymətlidir.',
   'Layihə haqqında',
   'İki il ərzində ailə arxivlərindən 4000-dən çox foto topladıq və onlardan 180-ni seçdik. Hər fotonun yanında onu çəkən adamın qısa qeydi var.',
   'photo-1516035069371-29a1b244cc32', 'Köhnə foto aparatı və çap olunmuş fotolar',
   'Plan və büdcə',
   'Kitab çap olundu və dəstəkçilərə göndərildi.',
   ARRAY['Skan və rəqəmsallaşdırma — 3 000 AZN',
         'Çap — 4 000 AZN',
         'Göndərmə — 2 000 AZN']),
 'Bəzi fotoların müəllif hüquqları aydın deyil. Hüquq sahibi tapılmayan fotolar albomdan çıxarılıb.',
 seed_photo('photo-1516035069371-29a1b244cc32', 1600, 1000), 1600, 1000,
 now() - interval '170 days', 9000, 11250, 143, now() - interval '215 days'),

(seed_id('project:komiks'), seed_id('user:sevinc'), 'qorqud-komiks', 'Qorqud: qrafik roman',
 'Dədə Qorqud boylarının müasir qrafik roman uyğunlaşması. İlk cild, 140 səhifə.',
 seed_category('comics'), seed_subcategory('comics', 0), seed_location('baki'),
 'UNSUCCESSFUL', 40000, 'AZN', 45, NULL, now() - interval '160 days', now() - interval '115 days',
 seed_story(
   'Dədə Qorqud məktəb proqramında var. Amma heç kim onu həvəslə oxumur.',
   'Layihə haqqında',
   'Üç boyu qrafik roman formatına uyğunlaşdırdıq. Otuz səhifəlik nümunə hazırdır və kampaniya səhifəsində oxumaq olar.',
   'photo-1516450360452-9312f5e86fc7', 'Rəsm masası üzərində eskizlər',
   'Plan və büdcə',
   'Kampaniya hədəfə çatmadı və heç bir dəstəkçidən ödəniş alınmadı.',
   ARRAY['Rəsm — 24 000 AZN',
         'Rəngləmə — 9 000 AZN',
         'Çap — 7 000 AZN']),
 'Hədəf məbləğ yüksək idi. Növbəti cəhddə daha kiçik hədəflə və hazır materialla qayıdacağıq.',
 seed_photo('photo-1516450360452-9312f5e86fc7', 1600, 1000), 1600, 1000,
 now() - interval '115 days', 40000, 8940, 61, now() - interval '175 days'),

-- ── Money in motion ─────────────────────────────────────────────────────────

(seed_id('project:albom'), seed_id('user:ramin'), 'akustik-albom', 'Kür: akustik albom',
 'Muğam və müasir akustik aranjimanların birləşdiyi doqquz mahnılıq albom.',
 seed_category('music'), seed_subcategory('music', 1), seed_location('lenkeran'),
 'WITHDRAWN', 22000, 'AZN', 40, NULL, now() - interval '46 days', now() - interval '6 days',
 seed_story(
   'Doqquz mahnı, üç musiqiçi, bir otaq və heç bir elektron alət.',
   'Layihə haqqında',
   'Albom canlı yazılır — hamı eyni otaqda, eyni anda. Beş mahnının demo yazısı hazırdır.',
   'photo-1513364776144-60967b0f800f', 'Səhnədə çıxış edən musiqiçilər',
   'Plan və büdcə',
   'Kampaniya uğurla başa çatdı və ödənişlər toplanır.',
   ARRAY['Studiya — 9 000 AZN',
         'Miksləmə və masterinq — 6 000 AZN',
         'Vinil çapı — 5 000 AZN',
         'Göndərmə — 2 000 AZN']),
 'Vinil çapı Avropada növbə ilə aparılır və altı aya qədər gözləmə mümkündür.',
 seed_photo('photo-1513364776144-60967b0f800f', 1600, 1000), 1600, 1000,
 now() - interval '6 days', 22000, 24860, 178, now() - interval '60 days'),

(seed_id('project:qab'), seed_id('user:orxan'), 'ag-qab', 'Ağ Qab: ağıllı su qabı',
 'İçdiyiniz suyu ölçən, telefona ehtiyac duymayan və bataryası altı ay dözən su qabı.',
 seed_category('technology'), seed_subcategory('technology', 0), seed_location('baki'),
 'FULFILLING', 55000, 'AZN', 45, NULL, now() - interval '150 days', now() - interval '105 days',
 seed_story(
   'Ağıllı su qablarının çoxu tətbiq tələb edir. Bu tələb etmir.',
   'Layihə haqqında',
   'Qabın qapağındakı ekran gün ərzində nə qədər su içdiyinizi göstərir. Bluetooth var, amma məcburi deyil. Batareya altı ay davam edir.',
   'photo-1518770660439-4636190af475', 'Elektron lövhə və komponentlər',
   'Plan və büdcə',
   'İstehsal tamamlandı, göndərmə davam edir.',
   ARRAY['Kalıp — 22 000 AZN',
         'Elektronika — 18 000 AZN',
         'Sertifikatlaşdırma — 8 000 AZN',
         'Göndərmə — 7 000 AZN']),
 'Kalıp istehsalı bir dəfəlik xərcdir və gecikməsi bütün cədvəli sürüşdürür. Bu risk gerçəkləşdi və göndərmə bir ay gecikdi.',
 seed_photo('photo-1518770660439-4636190af475', 1600, 1000), 1600, 1000,
 now() - interval '105 days', 55000, 71400, 486, now() - interval '170 days'),

(seed_id('project:lampa'), seed_id('user:creator'), 'xalca-lampa', 'Xalça lampa',
 'Xalça naxışını divara işıqla salan, əl ilə yığılan masa lampası.',
 seed_category('design'), seed_subcategory('design', 1), seed_location('baki'),
 'COMPLETED', 16000, 'AZN', 30, NULL, now() - interval '300 days', now() - interval '270 days',
 seed_story(
   'Lampanın kölgəsi divara xalça naxışı salır.',
   'Layihə haqqında',
   'Metal gövdə lazerlə kəsilir, içərisindəki işıq mənbəyi isti ağ LED-dir. Hər lampa Bakıda əl ilə yığılır.',
   'photo-1558618666-fcd25c85cd64', 'Masa üzərində lampa və dəftər',
   'Plan və büdcə',
   'Kampaniya tamamlandı, bütün mükafatlar göndərildi.',
   ARRAY['Lazer kəsimi — 7 000 AZN',
         'Yığım — 4 000 AZN',
         'Qablaşdırma və göndərmə — 5 000 AZN']),
 'Metal qiymətləri artdı, lakin ehtiyat büdcə bunu qarşıladı.',
 seed_photo('photo-1558618666-fcd25c85cd64', 1600, 1000), 1600, 1000,
 now() - interval '270 days', 16000, 19200, 152, now() - interval '320 days'),

(seed_id('project:masa'), seed_id('user:orxan'), 'oyun-masasi', 'Novruz: masaüstü oyun',
 'İki-dörd nəfər üçün, qırx dəqiqəlik, Novruz adətləri üzərində qurulan masaüstü oyun.',
 seed_category('games'), seed_subcategory('games', 1), seed_location('sumqayit'),
 'FULFILLING', 35000, 'AZN', 40, NULL, now() - interval '70 days', now() - interval '30 days',
 seed_story(
   'Novruz oyunu tonqal, səməni və papaqatdı üzərində qurulub.',
   'Layihə haqqında',
   'Oyun qırx dəqiqə çəkir və qaydaları bir səhifəyə sığır. İki il boyunca yüzdən çox test partiyası keçirilib.',
   'photo-1550745165-9bc0b252726f', 'Masaüstü oyun komponentləri və kartlar',
   'Plan və büdcə',
   'Kampaniya uğurla bitdi. Mükafatlar hazırlanır.',
   ARRAY['İstehsal — 20 000 AZN',
         'İllüstrasiya — 8 000 AZN',
         'Göndərmə — 7 000 AZN']),
 'Karton komponentlərin istehsalı Çindədir və nəqliyyat müddəti dəyişkəndir.',
 seed_photo('photo-1550745165-9bc0b252726f', 1600, 1000), 1600, 1000,
 now() - interval '30 days', 35000, 41300, 297, now() - interval '90 days'),

-- ── Before launch ───────────────────────────────────────────────────────────

(seed_id('project:teatr'), seed_id('user:gunel'), 'yeni-teatr', 'Kiçik Səhnə: müstəqil teatr mövsümü',
 'Bakıda müstəqil teatr üçün bir mövsüm: üç tamaşa, on iki göstəriş.',
 seed_category('theatre'), seed_subcategory('theatre', 0), seed_location('baki'),
 'SUBMITTED', 28000, 'AZN', 40, NULL, NULL, NULL,
 seed_story(
   'Bakıda müstəqil teatr üçün daimi səhnə yoxdur. Bir mövsümlük kirayə ilə başlayırıq.',
   'Layihə haqqında',
   'Üç tamaşa hazırlanır və hər biri dörd dəfə göstərilir. Aktyorların hamısı ilə müqavilə imzalanıb.',
   'photo-1493225457124-a3eb161ffa5f', 'Teatr səhnəsi və işıqlar',
   'Plan və büdcə',
   'Kampaniya moderasiya baxışındadır.',
   ARRAY['Zal kirayəsi — 12 000 AZN',
         'Aktyor haqları — 10 000 AZN',
         'Dekor və işıq — 6 000 AZN']),
 'Zal kirayəsi ilkin razılaşma əsasındadır və müqavilə hələ imzalanmayıb.',
 seed_photo('photo-1493225457124-a3eb161ffa5f', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '9 days'),

(seed_id('project:kurs'), seed_id('user:creator'), 'dizayn-kurs', 'Naxış: onlayn dizayn kursu',
 NULL,
 seed_category('art'), NULL, seed_location('baki'),
 'DRAFT', 10000, 'AZN', 30, NULL, NULL, NULL,
 NULL,
 NULL,
 NULL, NULL, NULL,
 NULL, NULL, NULL, NULL, now() - interval '4 days'),

(seed_id('project:arxiv'), seed_id('user:ramin'), 'ses-arxivi', 'Səs arxivi: kənd toylarının musiqisi',
 'Otuz kənddə toy musiqisinin sahə yazıları. Açıq arxiv, pulsuz yüklənə bilən.',
 seed_category('journalism'), seed_subcategory('journalism', 0), seed_location('lenkeran'),
 'PRELAUNCH', 14000, 'AZN', 35, NULL, NULL, NULL,
 seed_story(
   'Toy musiqisi yazılmır. Ona görə də hər il bir az daha az qalır.',
   'Layihə haqqında',
   'Otuz kənddə sahə yazıları aparacağıq. Bütün material açıq lisenziya ilə paylaşılacaq.',
   'photo-1524678606370-a47ad25cb82a', 'Səs yazı avadanlığı və mikrofon',
   'Plan və büdcə',
   'Kampaniya hazırlıq mərhələsindədir və tezliklə başlayacaq.',
   ARRAY['Səyahət və yazı — 7 000 AZN',
         'Avadanlıq — 4 000 AZN',
         'Arxiv və hostinq — 3 000 AZN']),
 'Sahə yazıları hava və mövsümdən asılıdır. Toy mövsümü yaz və payıza düşür.',
 seed_photo('photo-1524678606370-a47ad25cb82a', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '14 days'),

(seed_id('project:bazar'), seed_id('user:tural'), 'qis-bazari', 'Qış Bazarı: yerli istehsalçılar üçün meydança',
 'Bakıda üç həftəlik qış bazarı: qırx yerli istehsalçı, bir dam altında.',
 seed_category('food'), seed_subcategory('food', 1), seed_location('baki'),
 'SCHEDULED', 21000, 'AZN', 30, now() + interval '5 days', NULL, NULL,
 seed_story(
   'Kiçik istehsalçıların çoxu yalnız instaqramda satır. Bir həftə sonuna bir meydança lazımdır.',
   'Layihə haqqında',
   'Qırx istehsalçı üçün üç həftəlik bazar qururuq. Yer razılaşdırılıb, iştirakçı siyahısı bağlanıb.',
   'photo-1414235077428-338989a2e8c0', 'Bazar tezgahında yerli məhsullar',
   'Plan və büdcə',
   'Kampaniya beş gün sonra başlayır.',
   ARRAY['Yer kirayəsi — 9 000 AZN',
         'Quraşdırma — 6 000 AZN',
         'Tanıtım — 6 000 AZN']),
 'Qış havası açıq sahə üçün risklidir. Ehtiyat olaraq örtülü variant da razılaşdırılıb.',
 seed_photo('photo-1414235077428-338989a2e8c0', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '18 days'),

-- ── What the console has to deal with ───────────────────────────────────────

(seed_id('project:saxta'), seed_id('user:spammer'), 'ucuz-telefon', 'Ən ucuz telefonlar - məhdud say',
 'Endirim. Ən yaxşı qiymət. Tez ol.',
 seed_category('technology'), seed_subcategory('technology', 1), seed_location('baki'),
 'SUSPENDED', 50000, 'AZN', 60, NULL, now() - interval '30 days', now() + interval '30 days',
 seed_story(
   'Ən yaxşı qiymət. Məhdud say. İndi sifariş edin.',
   'Layihə haqqında',
   'Telefonlar birbaşa fabrikdən. Zəmanət yoxdur.',
   'photo-1511707171634-5f897ff02aa9', 'Masa üzərində mobil telefon',
   'Plan və büdcə',
   'Kampaniya moderasiya tərəfindən dayandırılıb.',
   ARRAY['Sifariş — 50 000 AZN']),
 'Yoxdur.',
 seed_photo('photo-1511707171634-5f897ff02aa9', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '32 days'),

(seed_id('project:legv'), seed_id('user:tural'), 'kend-suexanasi', 'Kənd südxanası',
 'Quba rayonunda kiçik pendir istehsalı. Yaradıcı tərəfindən ləğv edilib.',
 seed_category('food'), seed_subcategory('food', 2), seed_location('quba'),
 'CANCELED', 25000, 'AZN', 40, NULL, now() - interval '95 days', now() - interval '55 days',
 seed_story(
   'Quba rayonunda kiçik pendir sexi qurmaq istəyirdik.',
   'Layihə haqqında',
   'Tikili üçün razılaşdığımız yer başqasına satıldı və layihəni davam etdirmək mümkün olmadı.',
   'photo-1550009158-9ebf69173e03', 'Kənd təsərrüfatı məhsulları',
   'Plan və büdcə',
   'Kampaniya yaradıcı tərəfindən ləğv edildi və heç bir ödəniş alınmadı.',
   ARRAY['Avadanlıq — 15 000 AZN',
         'Tikili — 10 000 AZN']),
 'Tikili üçün müqavilə imzalanmamışdı. Bu, layihənin dayandırılmasının səbəbi oldu.',
 seed_photo('photo-1550009158-9ebf69173e03', 1600, 1000), 1600, 1000,
 NULL, NULL, NULL, NULL, now() - interval '110 days')

ON CONFLICT (id) DO NOTHING;

-- The history behind each state, so the campaign timeline and the moderation
-- audit trail are not blank.
INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':create'), p.id, NULL, 'DRAFT', p.creator_id, 'CREATOR', NULL, p.created_at
FROM projects p WHERE p.id IN (SELECT seed_id('project:' || k) FROM unnest(ARRAY[
    'tumar','qala','qehve','naringi','tar','ipek','kelagayi','usta','foto','komiks',
    'albom','qab','lampa','masa','teatr','kurs','arxiv','bazar','saxta','legv']) AS k)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':approve'), p.id, 'SUBMITTED', 'APPROVED',
       seed_id('user:moderator'), 'MODERATOR', 'Yoxlanıldı və təsdiqləndi.', p.created_at + interval '2 days'
FROM projects p WHERE p.state NOT IN ('DRAFT', 'SUBMITTED', 'PRELAUNCH')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':live'), p.id, 'APPROVED', 'LIVE',
       p.creator_id, 'CREATOR', NULL, p.launched_at
FROM projects p WHERE p.launched_at IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
SELECT seed_id('transition:' || p.slug || ':final'), p.id, 'LIVE', p.state,
       NULL, 'SYSTEM', 'Kampaniya müddəti başa çatdı.', p.finalized_at
FROM projects p WHERE p.finalized_at IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_state_transitions (id, project_id, from_state, to_state, actor_id, actor_role, note, created_at)
VALUES (seed_id('transition:ucuz-telefon:suspend'), seed_id('project:saxta'), 'LIVE', 'SUSPENDED',
        seed_id('user:moderator'), 'MODERATOR',
        'Məhsulun mövcudluğu təsdiqlənmədi və yaradıcı sənəd təqdim etmədi.', now() - interval '11 days'),
       (seed_id('transition:kend-suexanasi:cancel'), seed_id('project:legv'), 'LIVE', 'CANCELED',
        seed_id('user:tural'), 'CREATOR',
        'Tikili üçün razılaşdırılmış yer əlçatmaz oldu.', now() - interval '55 days')
ON CONFLICT (id) DO NOTHING;

-- One story revision per campaign that has a story, so the editor's version
-- history is not an empty list on every project.
INSERT INTO project_story_versions (id, project_id, version_number, document, author_id, created_at)
SELECT seed_id('story:' || p.slug || ':1'), p.id, 1, p.story, p.creator_id, p.created_at + interval '1 day'
FROM projects p WHERE p.story IS NOT NULL
ON CONFLICT (id) DO NOTHING;
