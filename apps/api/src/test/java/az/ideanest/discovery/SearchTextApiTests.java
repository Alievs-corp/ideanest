package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.Campaigns;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Free-text search over HTTP: what it finds, in what order, and what it composes
 * with. D-01, D-03, and §11.3.
 *
 * <p>The fixture is built around two words. <strong>{@code layihə}</strong>
 * ("project") appears once, in the story, of every campaign but one — so it is the
 * word that tests paging, filtering, sorting and facets, all against a set where
 * every row scores identically and the keyset has nothing but the tiebreaker to
 * work with. <strong>{@code robot}</strong> appears in a title, a blurb, and a
 * story, in three different campaigns — so it is the word that tests the weights.
 *
 * <p>Two campaigns are in states the public may never see and both mention both
 * words. They are the reason this suite exists at all: a text predicate is a
 * second way into the table, and a second way into the table is a second place to
 * forget the visibility clause.
 */
class SearchTextApiTests extends DiscoveryTestSupport {

    /** Every campaign the public may see and that mentions "layihə". */
    private static final List<String> MATCHES_LAYIHE =
            List.of("alpha", "bravo", "charlie", "delta", "echo", "foxtrot");

    private Instant now;

    @BeforeEach
    void seedTheFixture() {
        Campaigns.clear(dataSource);
        now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        UUID creator = Campaigns.creator(dataSource, "search-creator", "Aygün Məmmədova");

        Campaigns.seed(dataSource, creator, "alpha")
                .state("LIVE")
                .title("Robot dostum")
                .blurb("Kiçik bir robot dostu")
                .story("Bu layihə uşaqlar üçün oyuncaq robot düzəldir")
                .subcategory("games", "tabletop")
                .goal("1000.00")
                .pledged("100.00")
                .backers(1)
                .launchedAt(now.minus(5, ChronoUnit.DAYS))
                .deadline(now.plus(25, ChronoUnit.DAYS))
                .tags("handmade")
                .insert();
        Campaigns.seed(dataSource, creator, "bravo")
                .state("LIVE")
                .title("Masa oyunu dəsti")
                .blurb("Robot mövzusunda kart oyunu")
                .story("Bu layihə masa oyunudur")
                .subcategory("games", "video")
                .goal("1000.00")
                .pledged("250.00")
                .backers(2)
                .launchedAt(now.minus(4, ChronoUnit.DAYS))
                .deadline(now.plus(10, ChronoUnit.DAYS))
                .tags("handmade", "ceramics")
                .insert();
        Campaigns.seed(dataSource, creator, "charlie")
                .state("LIVE")
                .title("Işıqlı şəhər")
                .blurb("Gecə fotoları")
                .story("Bu layihə haqqında: sərgidə robot fiquru olacaq")
                .subcategory("art", "painting")
                .goal("5000.00")
                .pledged("2500.00")
                .backers(3)
                .launchedAt(now.minus(3, ChronoUnit.DAYS))
                .deadline(now.plus(20, ChronoUnit.DAYS))
                .tags("ceramics")
                .insert();
        Campaigns.seed(dataSource, creator, "delta")
                .state("SUCCESSFUL")
                .title("Seçənək kartları")
                .blurb("Kart dəsti")
                .story("Bu layihə kartlar haqqındadır")
                .subcategory("music", "albums")
                .goal("20000.00")
                .pledged("20000.00")
                .backers(4)
                .launchedAt(now.minus(40, ChronoUnit.DAYS))
                .deadline(now.minus(1, ChronoUnit.DAYS))
                .insert();
        // CANCELED since IDN-EXT-01 (#37), which stopped listing an unsuccessful campaign.
        Campaigns.seed(dataSource, creator, "echo")
                .state("CANCELED")
                .title("Üzüm bağı")
                .blurb("Bağçılıq təcrübəsi")
                .story("Bu layihə üzümlük salır")
                .subcategory("film", "short")
                .goal("50000.00")
                .pledged("37500.00")
                .backers(5)
                .launchedAt(now.minus(60, ChronoUnit.DAYS))
                .deadline(now.minus(2, ChronoUnit.DAYS))
                .insert();
        Campaigns.seed(dataSource, creator, "foxtrot")
                .state("PRELAUNCH")
                .title("Çörək sobası")
                .blurb("Ev çörəyi")
                .story("Bu layihə soba qurur")
                .category("comics")
                .withoutCover()
                .insert();
        // The control: publicly visible, in the same category as two of the matches,
        // carrying the same tag, and mentioning neither word. Without it, every facet
        // count would be the same with and without the search term and the facet test
        // would pass whatever the implementation did.
        Campaigns.seed(dataSource, creator, "golf")
                .state("LIVE")
                .title("Bağ evi")
                .blurb("Yay üçün kiçik ev")
                .story("Burada heç bir uyğun söz yoxdur")
                .subcategory("games", "tabletop")
                .goal("1000.00")
                .pledged("900.00")
                .backers(9)
                .launchedAt(now.minus(2, ChronoUnit.DAYS))
                .deadline(now.plus(15, ChronoUnit.DAYS))
                .tags("handmade")
                .insert();

        // The two the public may never see, mentioning both search words in their
        // title and their story so that any failure of the visibility clause shows up
        // as a hit rather than as a near miss.
        Campaigns.seed(dataSource, creator, "hidden-draft")
                .state("DRAFT")
                .title("Gizli robot")
                .blurb("Hazırlanan robot layihə")
                .story("Bu layihə hələ qaralamadır")
                .category("games")
                .insert();
        Campaigns.seed(dataSource, creator, "hidden-suspended")
                .state("SUSPENDED")
                .title("Dayandırılmış robot")
                .blurb("Araşdırılan robot layihə")
                .story("Bu layihə dayandırılıb")
                .category("games")
                .insert();
    }

    // -----------------------------------------------------------------------
    // Finding things
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a search finds every campaign whose text holds the word, and nothing else")
    void aSearchFindsTheMatchingCampaigns() {
        assertThat(slugs(search("?q={q}&limit=100", "robot")))
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie");
        assertThat(slugs(search("?q={q}&limit=100", "layihe")))
                .containsExactlyInAnyOrderElementsOf(MATCHES_LAYIHE);
        // golf is publicly visible, in the same category, with the same tag, and says
        // neither word. A predicate that had been dropped would return it.
        assertThat(slugs(search("?q={q}&limit=100", "layihe"))).doesNotContain("golf");
    }

    @Test
    @DisplayName("the same term on /v1/discover returns the same campaigns")
    void discoverTakesTheSameTerm() {
        // §10.2 lists both routes and they are one query object. If they could differ,
        // the search page and the browse page would be two implementations of D-01.
        assertThat(slugs(feed("?q={q}&limit=100", "robot")))
                .isEqualTo(slugs(search("?q={q}&limit=100", "robot")));
    }

    @Test
    @DisplayName("a match in the title outranks one in the blurb, which outranks one in the story")
    void theWeightsDecideTheOrder() {
        // The measured ratio is ten to one between weight A and weight D, which is
        // what setweight in V13 is for. Without it a campaign that mentions "robot"
        // once in its ninth paragraph would sit above the campaign called Robot, and
        // every reader would conclude the search does not work.
        //
        // alpha has "robot" in its title, bravo in its blurb, charlie in its story.
        assertThat(slugs(search("?q={q}&limit=100", "robot")))
                .containsExactly("alpha", "bravo", "charlie");
    }

    @Test
    @DisplayName("best match is the order when a query is present and no sort is named")
    void bestMatchIsTheDefaultForASearch() {
        // Newest would put charlie first — it launched three days ago and alpha five —
        // so the two orders are distinguishable, which is what makes this an assertion
        // rather than a coincidence.
        assertThat(slugs(search("?q={q}&limit=100", "robot"))).startsWith("alpha");
        assertThat(slugs(search("?q={q}&sort=newest&limit=100", "robot"))).startsWith("charlie");
        assertThat(slugs(search("?q={q}&sort=best_match&limit=100", "robot")))
                .isEqualTo(slugs(search("?q={q}&limit=100", "robot")));
    }

    @Test
    @DisplayName("best match with nothing to match is the browsing default, not an error")
    void bestMatchWithoutAQueryFallsBackToNewest() {
        // A text score over no text is zero for every campaign, so the order would
        // collapse to the tiebreaker and the response would be arbitrary. Nothing is
        // dropped and nothing is refused: the request is underspecified and has one
        // sensible reading. See DiscoveryQuery.
        assertThat(slugs(feed("?sort=best_match&limit=100"))).isEqualTo(slugs(feed("?sort=newest&limit=100")));
    }

    // -----------------------------------------------------------------------
    // D-03, misspelling tolerance
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a one-character typo still finds the campaign")
    void aTypoStillFinds() {
        // Each of these is one edit away from "robot" and matches no lexeme at all, so
        // the exact tier finds nothing and the trigram tier takes over — over the
        // title, which is why alpha is found and bravo and charlie are not.
        // Measured against this fixture at 0.500, 0.800 and 0.714 respectively, against
        // a threshold of 0.4. Deliberately none of them sits on the boundary: a test
        // that passed by a thousandth would be a test about float comparison.
        for (String typo : List.of("robto", "robo", "robott")) {
            assertThat(slugs(search("?q={q}&limit=100", typo)))
                    .withFailMessage("'%s' did not find the campaign called 'Robot dostum'", typo)
                    .contains("alpha");
        }
    }

    @Test
    @DisplayName("a typo in a word carrying diacritics is folded before it is compared")
    void theFuzzyTierFoldsToo() {
        // "Çörək sobası" with one letter dropped, typed without diacritics. Both tiers
        // go through ideanest_fold, so the fold is not something the exact tier has
        // and the fallback lacks.
        assertThat(slugs(search("?q={q}&limit=100", "corek"))).contains("foxtrot");
        assertThat(slugs(search("?q={q}&limit=100", "corak"))).contains("foxtrot");
    }

    @Test
    @DisplayName("a query that resembles nothing is empty, not everything")
    void gibberishFindsNothing() {
        // The failure this threshold exists to prevent. A search box that answers
        // nonsense with a page of unrelated campaigns has told the reader it
        // understood, and there is nothing on the screen to say otherwise — which is
        // strictly worse than an empty result.
        for (String nonsense : List.of("xyzzy", "qwertyuiop", "velosiped", "zzzzzzzz")) {
            assertThat(items(search("?q={q}&limit=100", nonsense)))
                    .withFailMessage("'%s' returned campaigns", nonsense)
                    .isEmpty();
        }
    }

    @Test
    @DisplayName("an exact match is never displaced by a fuzzy one")
    void theExactTierWins() {
        // The two tiers are mutually exclusive: the fallback engages only when the
        // exact tier matches nothing at all. So "robot" cannot return a campaign that
        // merely looks like it says robot, and the ordering question between the two
        // never arises.
        assertThat(slugs(search("?q={q}&limit=100", "robot")))
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie");
    }

    // -----------------------------------------------------------------------
    // Visibility
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("no text search returns a campaign the public may not see")
    void hiddenCampaignsAreNeverFound() {
        // Both hidden campaigns say both search words, in their title and their story,
        // so every one of these queries would return one if the visibility clause were
        // missing from the text path.
        for (String query : List.of("robot", "layihe", "gizli", "dayandirilmis", "qaralama", "robto")) {
            assertThat(slugs(search("?q={q}&limit=100", query)))
                    .withFailMessage("searching '%s' returned a hidden campaign", query)
                    .doesNotContain("hidden-draft", "hidden-suspended");
            assertThat(slugs(feed("?q={q}&limit=100", query)))
                    .withFailMessage("browsing with q=%s returned a hidden campaign", query)
                    .doesNotContain("hidden-draft", "hidden-suspended");
        }
    }

    @Test
    @DisplayName("a word only a hidden campaign uses returns nothing rather than that campaign")
    void aHiddenOnlyWordFindsNothing() {
        // And it must not fall through to the fuzzy tier and return something else
        // either: the exact tier finds nothing because the only campaign holding the
        // word is invisible, so the trigram tier runs — over visible titles only,
        // which resemble it not at all.
        assertThat(items(search("?q={q}&limit=100", "gizli"))).isEmpty();
    }

    // -----------------------------------------------------------------------
    // Composition
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("text composes with every filter")
    void textComposesWithFilters() {
        assertThat(slugs(search("?q={q}&category=games&limit=100", "layihe")))
                .containsExactlyInAnyOrder("alpha", "bravo");
        assertThat(slugs(search("?q={q}&subcategory=tabletop&limit=100", "layihe")))
                .containsExactly("alpha");
        assertThat(slugs(search("?q={q}&status=live&limit=100", "layihe")))
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie");
        assertThat(slugs(search("?q={q}&status=upcoming&limit=100", "layihe")))
                .containsExactly("foxtrot");
        assertThat(slugs(search("?q={q}&tag=handmade&limit=100", "layihe")))
                .containsExactlyInAnyOrder("alpha", "bravo");
        assertThat(slugs(search("?q={q}&tag=handmade,ceramics&limit=100", "layihe")))
                .containsExactly("bravo");
        assertThat(slugs(search("?q={q}&completion=under_25&limit=100", "layihe")))
                .containsExactly("alpha");
        assertThat(slugs(search("?q={q}&goalBand=over_50000&limit=100", "layihe")))
                .containsExactly("echo");
        assertThat(slugs(search("?q={q}&raisedMin=2500&raisedMax=20000&limit=100", "layihe")))
                .containsExactlyInAnyOrder("charlie", "delta");

        // Five filters and a search term. An empty result here is the honest answer
        // and is what "combinable" has to mean to be worth anything.
        assertThat(slugs(search(
                        "?q={q}&status=live&category=games&subcategory=tabletop&tag=handmade&completion=under_25",
                        "layihe")))
                .containsExactly("alpha");
        assertThat(slugs(search(
                        "?q={q}&status=live&category=games&subcategory=tabletop&tag=handmade&completion=over_100",
                        "layihe")))
                .isEmpty();
    }

    @Test
    @DisplayName("text composes with every sort")
    void textComposesWithSorts() {
        // The membership is the same under every order — the sort decides sequence,
        // never who is in the set — and the one order that is fully determined by the
        // fixture is asserted exactly.
        for (String sort : List.of("newest", "ending_soon", "most_funded", "most_backed", "popularity", "best_match")) {
            assertThat(slugs(search("?q={q}&limit=100&sort=" + sort, "layihe")))
                    .withFailMessage("sort=%s changed which campaigns matched", sort)
                    .containsExactlyInAnyOrderElementsOf(MATCHES_LAYIHE);
        }

        assertThat(slugs(search("?q={q}&limit=100&sort=newest", "layihe")))
                .containsExactly("charlie", "bravo", "alpha", "delta", "echo", "foxtrot");
        assertThat(slugs(search("?q={q}&limit=100&sort=most_funded", "layihe")))
                .containsExactly("echo", "delta", "charlie", "bravo", "alpha", "foxtrot");
        assertThat(slugs(search("?q={q}&limit=100&sort=most_backed", "layihe")))
                .containsExactly("echo", "delta", "charlie", "bravo", "alpha", "foxtrot");
    }

    @Test
    @DisplayName("a full multi-page walk of a search returns every match exactly once")
    void textComposesWithTheCursor() {
        // THE MOST LIKELY THING TO BREAK. Every one of these six campaigns matches
        // "layihə" once, in its story, with the same weight — so under best_match they
        // all carry an identical score and the keyset has nothing but `id ASC` to
        // separate them. A tiebreaker that had been dropped from the text path would
        // repeat some and lose others here, and nowhere else.
        for (String sort : List.of("newest", "ending_soon", "most_funded", "most_backed", "popularity", "best_match")) {
            List<String> seen = new ArrayList<>();
            String cursor = null;
            for (int page = 0; page < 20; page++) {
                Map<String, Object> body = search(
                        "?q={q}&limit=2&sort=" + sort + (cursor == null ? "" : "&cursor=" + cursor), "layihe");
                seen.addAll(slugs(body));
                cursor = nextCursor(body);
                if (cursor == null) {
                    break;
                }
            }

            assertThat(cursor).withFailMessage("sort=%s never reached the end of the results", sort).isNull();
            assertThat(seen)
                    .withFailMessage("sort=%s returned a campaign twice: %s", sort, seen)
                    .hasSize(new LinkedHashSet<>(seen).size());
            assertThat(seen)
                    .withFailMessage("sort=%s lost a campaign: %s", sort, seen)
                    .containsExactlyInAnyOrderElementsOf(MATCHES_LAYIHE);
            // And the paged order is the unpaged order, or the cursor resumed from
            // somewhere the sort did not put it.
            assertThat(seen).isEqualTo(slugs(search("?q={q}&limit=100&sort=" + sort, "layihe")));
        }
    }

    @Test
    @DisplayName("a cursor issued for one search term is refused by another")
    void aCursorFromAnotherTermIsRefused() {
        // The term is part of the fingerprint, so replaying a cursor across a change
        // of query is caught the same way a change of filter is. Without it the second
        // page of "layihə" would be served as the second page of "robot", from a key
        // that means something else.
        String cursor = nextCursor(search("?q={q}&limit=2", "layihe"));

        ResponseEntity<Map<String, Object>> response =
                get("/v1/search?q={q}&limit=2&cursor=" + cursor, new HttpHeaders(), "robot");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_CURSOR_MISMATCH");
    }

    // -----------------------------------------------------------------------
    // Facets
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("the facet counts respect the text filter")
    void facetsCountOnlyWhatTheSearchMatched() {
        // golf is the control: publicly visible, filed under games/tabletop, tagged
        // handmade, and matching neither word. Every count below moves by exactly one
        // because of it, so a facet query that ignored the term would fail here rather
        // than pass by coincidence.
        assertThat(count(facets(""), "categories", "games")).isEqualTo(3);
        assertThat(count(facets("?q={q}", "layihe"), "categories", "games")).isEqualTo(2);

        assertThat(count(facets(""), "tags", "handmade")).isEqualTo(3);
        assertThat(count(facets("?q={q}", "layihe"), "tags", "handmade")).isEqualTo(2);

        assertThat(count(facets(""), "status", "live")).isEqualTo(4);
        assertThat(count(facets("?q={q}", "layihe"), "status", "live")).isEqualTo(3);

        // And a term that matches one campaign counts one, everywhere.
        Map<String, Object> narrow = facets("?q={q}", "robot");
        assertThat(count(narrow, "categories", "games")).isEqualTo(2);
        assertThat(count(narrow, "categories", "art")).isEqualTo(1);
        assertThat(count(narrow, "categories", "music")).isEqualTo(0);
    }

    @Test
    @DisplayName("the facet counts never count a campaign the public may not see, whatever was typed")
    void facetsStayInsideTheVisibleSet() {
        // Both hidden campaigns are filed under games and say both words. A facet is a
        // number, so a leak here is quieter than one in the feed — the suspended
        // campaign is not shown, only counted, and the count is what a reader uses to
        // decide the platform has more than it does.
        assertThat(count(facets("?q={q}", "robot"), "categories", "games")).isEqualTo(2);
        assertThat(count(facets("?q={q}", "layihe"), "categories", "games")).isEqualTo(2);
    }

    // -----------------------------------------------------------------------
    // Keeping the vector true
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("editing a title changes what the campaign is findable by")
    void theVectorFollowsTheTitle() {
        // "dostum" is in alpha's title and nowhere else in the fixture — not in its
        // blurb, which says "dostu", a different lexeme under a configuration that
        // does no stemming. So it asks about the title and about nothing else.
        assertThat(slugs(search("?q={q}&limit=100", "dostum"))).containsExactly("alpha");

        new JdbcTemplate(dataSource)
                .update("UPDATE projects SET title = 'Tamamilə başqa ad' WHERE slug = 'alpha'");

        assertThat(slugs(search("?q={q}&limit=100", "basqa"))).containsExactly("alpha");
        // And the old title is gone: a vector that was appended to rather than rebuilt
        // would keep answering to a name the campaign no longer has.
        assertThat(slugs(search("?q={q}&limit=100", "dostum"))).doesNotContain("alpha");
    }

    @Test
    @DisplayName("editing the story changes what the campaign is findable by")
    void theVectorFollowsTheStory() {
        new JdbcTemplate(dataSource)
                .update(
                        "UPDATE projects SET story = CAST(? AS jsonb) WHERE slug = 'delta'",
                        "{\"version\":1,\"blocks\":[{\"type\":\"paragraph\",\"spans\":"
                                + "[{\"text\":\"Qatar modelləri haqqında\",\"marks\":[]}]}]}");

        assertThat(slugs(search("?q={q}&limit=100", "qatar"))).containsExactly("delta");
        assertThat(slugs(search("?q={q}&limit=100", "layihe"))).doesNotContain("delta");
    }

    @Test
    @DisplayName("renaming a creator changes what all of their campaigns are findable by")
    void theVectorFollowsTheCreatorName() {
        // The half a generated column could never do, and the half §17.4 depends on:
        // anonymising a departing account rewrites users.name in place, and an index
        // that kept the old value would go on serving the name of somebody who asked
        // to be forgotten.
        assertThat(slugs(search("?q={q}&limit=100", "Aygun"))).contains("alpha", "golf");

        new JdbcTemplate(dataSource)
                .update("UPDATE users SET name = 'Silinmiş istifadəçi' WHERE slug = 'search-creator'");

        assertThat(items(search("?q={q}&limit=100", "Aygun"))).isEmpty();
        assertThat(slugs(search("?q={q}&limit=100", "silinmis"))).contains("alpha", "golf");
        // And nothing else about the campaigns moved.
        assertThat(slugs(search("?q={q}&limit=100", "robot")))
                .containsExactlyInAnyOrder("alpha", "bravo", "charlie");
    }

    @Test
    @DisplayName("a campaign created after the migration is indexed without anybody asking")
    void newCampaignsAreIndexed() {
        UUID creator = Campaigns.creator(dataSource, "search-creator", "Aygün Məmmədova");
        Campaigns.seed(dataSource, creator, "hotel")
                .state("LIVE")
                .title("Dəniz kənarında düşərgə")
                .blurb("Yay düşərgəsi")
                .story("Bu layihə düşərgə qurur")
                .category("games")
                .launchedAt(now.minus(1, ChronoUnit.DAYS))
                .deadline(now.plus(9, ChronoUnit.DAYS))
                .insert();

        assertThat(slugs(search("?q={q}&limit=100", "deniz"))).containsExactly("hotel");
        assertThat(slugs(search("?q={q}&limit=100", "layihe"))).contains("hotel");
    }

    // -----------------------------------------------------------------------
    // The endpoint itself
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("a search with no query is refused rather than answered with arbitrary campaigns")
    void aSearchWithoutATermIsRefused() {
        // No interface produces this request, so it is a client bug — and answered
        // with a page of campaigns it would look exactly like a search that worked.
        ResponseEntity<Map<String, Object>> response = get("/v1/search", new HttpHeaders());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_VALUE_UNKNOWN");
        assertThat(response.getBody().get("meta").toString()).contains("q");

        // A blank one is the same request with more characters in it.
        assertThat(get("/v1/search?q=", new HttpHeaders()).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // But browsing without one is the whole point of the other endpoint.
        assertThat(get("/v1/discover", new HttpHeaders()).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("search is readable without signing in, and carries the same cache headers as the feed")
    void searchIsAPublicCacheableRead() {
        ResponseEntity<Map<String, Object>> first = get("/v1/search?q={q}", new HttpHeaders(), "robot");

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(first.getHeaders().getETag()).isNotBlank();
        assertThat(first.getHeaders().getCacheControl()).contains("max-age=60");
        assertThat(first.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(first.getHeaders().getETag());
        ResponseEntity<Map<String, Object>> second = get("/v1/search?q={q}", conditional, "robot");

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        assertThat(second.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);
    }

    @Test
    @DisplayName("two searches do not share a tag")
    void theTagVariesWithTheTerm() {
        assertThat(get("/v1/search?q={q}", new HttpHeaders(), "robot").getHeaders().getETag())
                .isNotEqualTo(get("/v1/search?q={q}", new HttpHeaders(), "layihe")
                        .getHeaders()
                        .getETag());
    }

    @Test
    @DisplayName("a search that asks for an unimplemented option is refused by name")
    void searchRefusesWhatDiscoveryRefuses() {
        // The same advice, over the same capability set. An endpoint that answered
        // showOnly=saved because its handler forgot the check would be the one place a
        // per-caller filter was silently already shipped.
        //
        // This used to be asserted with sort=relevance and then with sort=near_me, and
        // #44 and #47 landing are why it is neither: both are served on both endpoints
        // now, and both are asserted the other way round below — because a capability
        // declared once must reach /v1/search as well as /v1/discover, or a client
        // would find that its search results could not be ranked or ordered by
        // distance.
        ResponseEntity<Map<String, Object>> response =
                get("/v1/search?q={q}&showOnly=saved", new HttpHeaders(), "robot");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).containsEntry("code", "DISCOVERY_OPTION_UNSUPPORTED");
        assertThat(response.getBody().get("meta").toString()).contains("saved-projects table");

        assertThat(get("/v1/search?q={q}&sort=relevance", new HttpHeaders(), "robot")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(get("/v1/search?q={q}&sort=near_me&near={near}", new HttpHeaders(), "robot", "40.41,49.87")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(get("/v1/search?q={q}&country=AZ", new HttpHeaders(), "robot")
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a search term that is only punctuation matches nothing rather than everything")
    void punctuationIsNotAWildcard() {
        // websearch_to_tsquery reduces this to an empty query, which matches no row;
        // the fuzzy tier then finds no title resembling it either. The failure to avoid
        // is the opposite one, where an empty query matches every row.
        assertThat(items(search("?q={q}&limit=100", "!!!"))).isEmpty();
        assertThat(items(search("?q={q}&limit=100", "%"))).isEmpty();
        assertThat(items(search("?q={q}&limit=100", "_"))).isEmpty();
    }
}
