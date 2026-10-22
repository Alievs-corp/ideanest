package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.support.Campaigns;
import az.ideanest.support.Curations;
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
 * {@code market}: a reader browsing for one country sees the campaigns for it (#533).
 *
 * <p>Three campaigns: one for Azerbaijan, one for Georgia, one for both. Every public list
 * narrows the same way, and leaving the parameter out is every country.
 */
class DiscoveryMarketApiTests extends DiscoveryTestSupport {

    private UUID azerbaijan;
    private UUID georgia;
    private UUID both;

    @BeforeEach
    void seed() {
        Campaigns.clear(dataSource);
        UUID creator = Campaigns.creator(dataSource, "market-creator");
        Instant launched = Instant.now().minus(3, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        azerbaijan = campaign(creator, "lamp-for-baku", launched, "AZ");
        georgia = campaign(creator, "lamp-for-tbilisi", launched.minus(1, ChronoUnit.HOURS), "GE");
        both = campaign(creator, "lamp-for-both", launched.minus(2, ChronoUnit.HOURS), "AZ", "GE");
    }

    private UUID campaign(UUID creator, String slug, Instant launched, String... countries) {
        return Campaigns.seed(dataSource, creator, slug)
                .state("LIVE")
                .category("games")
                .goal("1000.00")
                .launchedAt(launched)
                .deadline(launched.plus(30, ChronoUnit.DAYS))
                .countries(countries)
                .insert();
    }

    @Test
    @DisplayName("the feed holds the campaigns for the market, and every campaign without one")
    void theFeedNarrowsToTheMarket() {
        assertThat(slugs(feed("?sort=newest"))).containsExactly("lamp-for-baku", "lamp-for-tbilisi", "lamp-for-both");
        assertThat(slugs(feed("?sort=newest&market=AZ"))).containsExactly("lamp-for-baku", "lamp-for-both");
        assertThat(slugs(feed("?sort=newest&market=ge"))).containsExactly("lamp-for-tbilisi", "lamp-for-both");
        assertThat(slugs(feed("?market=DE"))).isEmpty();
    }

    @Test
    @DisplayName("the facets count only the campaigns for the market")
    void theFacetsCountTheMarket() {
        assertThat(count(facets(""), "categories", "games")).isEqualTo(3);
        assertThat(count(facets("?market=GE"), "categories", "games")).isEqualTo(2);
    }

    @Test
    @DisplayName("search and the suggestions narrow to the market too")
    void searchAndSuggestionsNarrow() {
        assertThat(slugs(search("?q=lamp&market=GE"))).containsExactlyInAnyOrder("lamp-for-tbilisi", "lamp-for-both");
        List<Object> suggested = suggestions("?q=lamp&market=AZ").stream()
                .filter(item -> "campaign".equals(item.get("kind")))
                .map(item -> item.get("slug"))
                .toList();
        assertThat(suggested).containsExactlyInAnyOrder("lamp-for-baku", "lamp-for-both");
    }

    @Test
    @DisplayName("a collection lists and counts only the campaigns for the market")
    void aCollectionNarrows() {
        UUID collection = Curations.collection(dataSource, "lamps").published().insert();
        Curations.members(dataSource, collection, azerbaijan, georgia, both);

        Map<String, Object> page = get("/v1/collections/lamps?market=GE", new HttpHeaders()).getBody();
        assertThat(slugs(page)).containsExactly("lamp-for-tbilisi", "lamp-for-both");
        assertThat(((Map<?, ?>) page.get("collection")).get("projectCount")).isEqualTo(2);

        Map<String, Object> index = get("/v1/collections?market=DE", new HttpHeaders()).getBody();
        assertThat(((Map<?, ?>) items(index).get(0)).get("projectCount")).isEqualTo(0);
    }

    @Test
    @DisplayName("a cursor from one market does not resume another")
    void aCursorIsBoundToItsMarket() {
        String cursor = nextCursor(feed("?sort=newest&limit=1&market=AZ"));
        assertThat(cursor).isNotNull();

        ResponseEntity<Map<String, Object>> moved =
                get("/v1/discover?sort=newest&limit=1&market=GE&cursor={cursor}", new HttpHeaders(), cursor);
        assertThat(moved.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(moved.getBody()).containsEntry("code", "DISCOVERY_CURSOR_MISMATCH");
    }

    @Test
    @DisplayName("a market that is not a country is refused rather than read as every country")
    void anUnknownMarketIsRefused() {
        for (String path : List.of("/v1/discover?market=XX", "/v1/search/suggest?q=lamp&market=AZE", "/v1/collections?market=1")) {
            assertThat(get(path, new HttpHeaders()).getStatusCode()).as(path).isEqualTo(HttpStatus.BAD_REQUEST);
        }
    }
}
