package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.Campaigns;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * {@code GET /v1/discover/facets}: D-10's live faceted counts.
 *
 * <p>The property this suite exists for is the one that decides whether the filter
 * panel is usable at all — <strong>a facet excludes its own dimension and applies
 * every other</strong>. Count the category facet under the category filter the caller
 * already selected and every other category reads zero; the panel then offers exactly
 * one move, which is to clear the filter, and a backer who picked Games can never
 * learn that there are also four campaigns in Comics matching everything else they
 * chose.
 *
 * <p>The second property is the one that makes the numbers trustworthy: a facet's
 * count is exactly the number of cards the feed returns when that value is selected.
 * A panel whose numbers disagree with the results is worse than a panel with no
 * numbers.
 */
class DiscoveryFacetsApiTests extends DiscoveryTestSupport {

    /**
     * Five campaigns across three categories, three statuses, two tags, and four
     * completion bands — chosen so that no two dimensions are collinear. If category
     * and status always agreed, a facet that wrongly applied the status filter to the
     * category counts would produce the same numbers as one that correctly did not.
     */
    @BeforeEach
    void seedTheFixture() {
        Campaigns.clear(dataSource);
        UUID creator = Campaigns.creator(dataSource, "facets-creator");
        Instant launched = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);

        seed(creator, "games-one", "games", "tabletop", "LIVE", "100.00", launched, "handmade");
        seed(creator, "games-two", "games", "video", "LIVE", "300.00", launched, "ceramics");
        seed(creator, "comics-one", "comics", "manga", "LIVE", "600.00", launched, "handmade");
        seed(creator, "comics-two", "comics", "manga", "SUCCESSFUL", "1000.00", launched);
        // CANCELED since IDN-EXT-01 (#37): listed, in no status grouping, as UNSUCCESSFUL used
        // to be — an unsuccessful campaign is no longer listed or counted at all.
        seed(creator, "art-one", "art", "painting", "CANCELED", "800.00", launched);
    }

    private void seed(
            UUID creator,
            String slug,
            String category,
            String subcategory,
            String state,
            String pledged,
            Instant launched,
            String... tags) {
        Campaigns.seed(dataSource, creator, slug)
                .subcategory(category, subcategory)
                .state(state)
                // One goal for every campaign, so completion is decided by the amount
                // raised alone and a percentage is easy to read off the fixture.
                .goal("1000.00")
                .pledged(pledged)
                .launchedAt(launched)
                .deadline(launched.plus(30, ChronoUnit.DAYS))
                .tags(tags)
                .insert();
    }

    @Test
    @DisplayName("with no filters, every facet counts every publicly visible campaign")
    void unfilteredCountsAreTheWholeFeed() {
        Map<String, Object> facets = facets("");

        assertThat(count(facets, "categories", "games")).isEqualTo(2);
        assertThat(count(facets, "categories", "comics")).isEqualTo(2);
        assertThat(count(facets, "categories", "art")).isEqualTo(1);
        assertThat(count(facets, "status", "live")).isEqualTo(3);
        assertThat(count(facets, "status", "successful")).isEqualTo(1);
        assertThat(count(facets, "completion", "under_25")).isEqualTo(1);
        assertThat(count(facets, "completion", "25_to_50")).isEqualTo(1);
        assertThat(count(facets, "completion", "50_to_75")).isEqualTo(1);
        assertThat(count(facets, "completion", "75_to_100")).isEqualTo(1);
        assertThat(count(facets, "completion", "over_100")).isEqualTo(1);
    }

    @Test
    @DisplayName("a category facet is not narrowed by the category filter")
    void theCategoryFacetExcludesItsOwnDimension() {
        Map<String, Object> facets = facets("?category=games");

        // The whole point. Without this every other category reads zero and the
        // filter becomes a dead end.
        assertThat(count(facets, "categories", "games")).isEqualTo(2);
        assertThat(count(facets, "categories", "comics")).isEqualTo(2);
        assertThat(count(facets, "categories", "art")).isEqualTo(1);
    }

    @Test
    @DisplayName("a status facet is not narrowed by the status filter")
    void theStatusFacetExcludesItsOwnDimension() {
        Map<String, Object> facets = facets("?status=live");

        assertThat(count(facets, "status", "live")).isEqualTo(3);
        assertThat(count(facets, "status", "successful")).isEqualTo(1);
    }

    @Test
    @DisplayName("every other active filter still narrows a facet")
    void otherFiltersStillApply() {
        // The category counts under `status=live`: three of the five campaigns are
        // live, and they are two games and one comics. Art drops to zero, and is
        // still present as a value so the control does not move under the cursor.
        Map<String, Object> facets = facets("?status=live");

        assertThat(count(facets, "categories", "games")).isEqualTo(2);
        assertThat(count(facets, "categories", "comics")).isEqualTo(1);
        assertThat(count(facets, "categories", "art")).isZero();
    }

    @Test
    @DisplayName("the status facet is narrowed by the category filter")
    void theStatusFacetIsNarrowedByOtherDimensions() {
        Map<String, Object> facets = facets("?category=comics");

        assertThat(count(facets, "status", "live")).isEqualTo(1);
        assertThat(count(facets, "status", "successful")).isEqualTo(1);
        assertThat(count(facets, "status", "extended")).isZero();
    }

    @Test
    @DisplayName("subcategory is part of the category dimension, not a dimension of its own")
    void subcategoryIsExcludedWithCategory() {
        // If it were separate, the category counts under `subcategory=manga` would
        // read zero for Games and Art — no campaign outside Comics is filed under
        // Manga — which is the same dead end arriving through the back door.
        Map<String, Object> facets = facets("?subcategory=manga");

        assertThat(count(facets, "categories", "games")).isEqualTo(2);
        assertThat(count(facets, "categories", "comics")).isEqualTo(2);
        assertThat(count(facets, "categories", "art")).isEqualTo(1);
    }

    @Test
    @DisplayName("a facet count is exactly what the feed returns when that value is selected")
    void countsAgreeWithTheFeed() {
        // The invariant that makes the numbers worth printing. Checked under a filter
        // set that is already narrowing, because a facet that ignored the other
        // filters would still agree with the feed on an unfiltered query.
        String filters = "?status=live";
        Map<String, Object> facets = facets(filters);

        for (String category : List.of("games", "comics", "art")) {
            assertThat(count(facets, "categories", category))
                    .withFailMessage("the '%s' facet disagrees with the feed", category)
                    .isEqualTo(items(feed(filters + "&category=" + category + "&limit=100")).size());
        }
        for (String band : List.of("under_25", "25_to_50", "50_to_75", "75_to_100", "over_100")) {
            assertThat(count(facets, "completion", band))
                    .withFailMessage("the '%s' facet disagrees with the feed", band)
                    .isEqualTo(items(feed(filters + "&completion=" + band + "&limit=100")).size());
        }
    }

    @Test
    @DisplayName("a status facet count is what the feed returns for that status")
    void statusCountsAgreeWithTheFeed() {
        String filters = "?category=comics";
        Map<String, Object> facets = facets(filters);

        for (String status : List.of("upcoming", "live", "extended", "successful")) {
            assertThat(count(facets, "status", status))
                    .withFailMessage("the '%s' facet disagrees with the feed", status)
                    .isEqualTo(items(feed(filters + "&status=" + status + "&limit=100")).size());
        }
    }

    @Test
    @DisplayName("a fixed vocabulary answers for all of its values, including the empty ones")
    void zeroCountsArePresent() {
        Map<String, Object> facets = facets("?category=art");

        // A control that disappears when its count reaches zero is a control that
        // moves under the reader's cursor. §4.3 also asks for a live count on every
        // category, which means on all fifteen.
        // Four status words since IDN-EXT-01 (#37): upcoming, live, extended, successful.
        assertThat(counts(facets, "status")).hasSize(4);
        assertThat(counts(facets, "completion")).hasSize(5);
        assertThat(counts(facets, "goalAmount")).hasSize(5);
        assertThat(counts(facets, "amountRaised")).hasSize(5);
        assertThat(counts(facets, "categories")).hasSize(15);
        assertThat(count(facets, "status", "upcoming")).isZero();
    }

    @Test
    @DisplayName("the tag facet lists only tags with campaigns behind them")
    void tagsAreNotAFixedVocabulary() {
        // §4.3 calls tags a free vocabulary. It is unbounded, so the whole list is
        // not a thing that can be rendered or transferred, and a tag with nothing
        // behind it is not a filter.
        Map<String, Object> facets = facets("");

        assertThat(counts(facets, "tags")).hasSize(2);
        assertThat(count(facets, "tags", "handmade")).isEqualTo(2);
        assertThat(count(facets, "tags", "ceramics")).isEqualTo(1);
    }

    @Test
    @DisplayName("the tag facet is not narrowed by the tag filter, and is by the others")
    void theTagFacetExcludesItsOwnDimension() {
        assertThat(count(facets("?tag=handmade"), "tags", "ceramics")).isEqualTo(1);
        // And the other filters still apply: only one of the two handmade campaigns
        // is in Comics.
        assertThat(count(facets("?category=comics"), "tags", "handmade")).isEqualTo(1);
        assertThat(counts(facets("?category=comics"), "tags")).hasSize(1);
    }

    @Test
    @DisplayName("a category carries the name in the language that was asked for")
    void categoriesAreNamed() {
        HttpHeaders english = new HttpHeaders();
        english.set(HttpHeaders.ACCEPT_LANGUAGE, "en");
        Map<String, Object> facets = get("/v1/discover/facets", english).getBody();

        Map<String, Object> games = counts(facets, "categories").stream()
                .filter(entry -> "games".equals(entry.get("slug")))
                .findFirst()
                .orElseThrow();

        assertThat(games.get("name")).isEqualTo("Games");
        // Nested rather than a second request, for the reason CategoryController
        // gives: a dependent control that waits for another round trip appears empty
        // for a moment.
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> subcategories = (List<Map<String, Object>>) games.get("subcategories");
        assertThat(subcategories).isNotEmpty();
        assertThat(subcategories).anySatisfy(subcategory -> {
            assertThat(subcategory.get("slug")).isEqualTo("tabletop");
            assertThat(subcategory.get("name")).isEqualTo("Tabletop games");
            assertThat(((Number) subcategory.get("count")).longValue()).isEqualTo(1);
        });
    }

    @Test
    @DisplayName("a category's count includes campaigns filed under any of its subcategories")
    void aCategoryCountIsAtLeastTheSumOfItsChildren() {
        Map<String, Object> facets = facets("");

        Map<String, Object> comics = counts(facets, "categories").stream()
                .filter(entry -> "comics".equals(entry.get("slug")))
                .findFirst()
                .orElseThrow();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> subcategories = (List<Map<String, Object>>) comics.get("subcategories");
        long children = subcategories.stream()
                .mapToLong(entry -> ((Number) entry.get("count")).longValue())
                .sum();

        assertThat(((Number) comics.get("count")).longValue()).isEqualTo(2);
        assertThat(children).isEqualTo(2);
    }

    @Test
    @DisplayName("two languages of one panel do not share a tag")
    void theTagVariesWithTheLanguage() {
        HttpHeaders azerbaijani = new HttpHeaders();
        azerbaijani.set(HttpHeaders.ACCEPT_LANGUAGE, "az");
        HttpHeaders english = new HttpHeaders();
        english.set(HttpHeaders.ACCEPT_LANGUAGE, "en");

        String azTag = get("/v1/discover/facets", azerbaijani).getHeaders().getETag();
        String enTag = get("/v1/discover/facets", english).getHeaders().getETag();

        // A shared tag means a client that asked for English revalidates an
        // Azerbaijani panel, is told 304, and renders the wrong language for a
        // minute. This panel genuinely carries translated names, so it is the
        // endpoint where getting this wrong is visible.
        assertThat(azTag).isNotBlank();
        assertThat(enTag).isNotEqualTo(azTag);
    }

    @Test
    @DisplayName("a client holding the current panel is told nothing changed")
    void aConditionalRequestIsAnswered304() {
        ResponseEntity<Map<String, Object>> first = get("/v1/discover/facets", new HttpHeaders());
        String etag = first.getHeaders().getETag();

        assertThat(etag).isNotBlank();
        assertThat(first.getHeaders().getCacheControl()).contains("max-age=60");
        assertThat(first.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);

        HttpHeaders conditional = new HttpHeaders();
        conditional.setIfNoneMatch(etag);
        ResponseEntity<Map<String, Object>> second = get("/v1/discover/facets", conditional);

        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.NOT_MODIFIED);
        assertThat(second.getHeaders().getVary()).contains(HttpHeaders.ACCEPT_LANGUAGE);
    }

    @Test
    @DisplayName("the panel refuses the same options the feed refuses")
    void facetsRefuseWhatTheFeedRefuses() {
        // The two endpoints take one query object, so a filter that is unimplemented
        // has to be unimplemented on both — a panel that counted by a filter the feed
        // cannot apply would print numbers nothing can reproduce.
        //
        // The same holds in the other direction, which is what #43 changed: `q` is
        // implemented on both now, and the panel counts the narrowed set rather than
        // refusing it. SearchTextApiTests is what holds the counts to it.
        assertThat(get("/v1/discover/facets?q=robot", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(get("/v1/discover/facets?showOnly=saved", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(get("/v1/discover/facets?status=finished", new HttpHeaders()).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
