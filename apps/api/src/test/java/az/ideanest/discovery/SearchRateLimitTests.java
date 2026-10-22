package az.ideanest.discovery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.discovery.api.DiscoveryController;
import az.ideanest.discovery.api.PublicReadLimits;
import az.ideanest.discovery.api.SearchController;
import az.ideanest.discovery.application.DiscoveryPage;
import az.ideanest.discovery.application.DiscoveryQuery;
import az.ideanest.discovery.application.FacetCounts;
import az.ideanest.discovery.application.SearchService;
import az.ideanest.discovery.application.SuggestQuery;
import az.ideanest.discovery.domain.DiscoveryCapability;
import az.ideanest.discovery.domain.Suggestion;
import az.ideanest.shared.ratelimit.AbuseProperties;
import az.ideanest.shared.ratelimit.InMemoryRateLimiter;
import az.ideanest.shared.ratelimit.RateLimitExceededException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.context.request.ServletWebRequest;

/**
 * §17.3's "search 60/min", at the boundary.
 *
 * <p>Not an integration test, and deliberately not one. The suite shares a single
 * Spring context, and with it a single limiter, and every request in it comes from
 * {@code 127.0.0.1} — so a per-address budget small enough to exhaust in a test is
 * a budget the other discovery suites would exhaust for it. The same reasoning is
 * already written into {@code application-test.yml} for the sign-in limits. Driving
 * the controller directly keeps the assertion exact: sixty are served, the
 * sixty-first is not, and it is not the fifty-ninth.
 */
class SearchRateLimitTests {

    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-08-18T12:00:00Z"), ZoneOffset.UTC);

    private InMemoryRateLimiter limiter;
    private SearchController searches;
    private DiscoveryController discovery;
    private MockHttpServletResponse response;

    @BeforeEach
    void buildTheEndpoints() {
        limiter = new InMemoryRateLimiter(FIXED);
        PublicReadLimits limits = new PublicReadLimits(limiter, AbuseProperties.defaults());
        searches = new SearchController(new EmptySearchService(), limits);
        discovery = new DiscoveryController(new EmptySearchService(), limits);
        bindARequest();
    }

    @AfterEach
    void unbindTheRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("the sixtieth search in a minute is served and the sixty-first is refused")
    void refusesPastSixtyAMinute() {
        for (int attempt = 0; attempt < 60; attempt++) {
            int served = attempt;
            assertThatCode(() -> search("robot" + served)).doesNotThrowAnyException();
        }

        assertThatThrownBy(() -> search("robot")).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("the browse feed spends the same budget as the search box")
    void discoverAndSearchShareOneBudget() {
        for (int attempt = 0; attempt < 60; attempt++) {
            discover();
        }

        // One bucket, because the two endpoints run the same query against the
        // same tables: a script that alternates between them would otherwise
        // have twice the allowance for exactly the work the limit is bounding.
        assertThatThrownBy(() -> search("robot")).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("autocomplete has its own, larger budget")
    void suggestionsAreCountedSeparately() {
        for (int attempt = 0; attempt < 60; attempt++) {
            discover();
        }

        // A suggestion is one request per keystroke. Sharing the feed's sixty
        // would refuse a reader who typed a ten-letter query six times.
        assertThatCode(this::suggest).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a served search says what is left of the allowance")
    void reportsTheAllowanceOnTheWayOut() {
        search("robot");

        assertThat(response.getHeader("X-RateLimit-Limit")).isEqualTo("60");
        assertThat(response.getHeader("X-RateLimit-Remaining")).isEqualTo("59");
        assertThat(response.getHeader("RateLimit-Policy")).isEqualTo("\"default\";q=60;w=60");
    }

    private void search(String text) {
        MockHttpServletRequest request = bindARequest();
        MultiValueMap<String, String> parameters = new LinkedMultiValueMap<>();
        parameters.add("q", text);
        searches.search(new ServletWebRequest(request, response), request, response, "az", parameters);
    }

    private void suggest() {
        MockHttpServletRequest request = bindARequest();
        searches.suggest(new ServletWebRequest(request, response), request, response, "az", "rob", null, null);
    }

    private void discover() {
        MockHttpServletRequest request = bindARequest();
        discovery.discover(
                new ServletWebRequest(request, response), request, response, "az", new LinkedMultiValueMap<>());
    }

    /**
     * A fresh request and response, bound to the thread the way Spring MVC binds
     * them around a handler.
     *
     * <p>Fresh per call, because a response carries the headers of the request that
     * wrote them and this suite asserts on which request wrote what.
     */
    private MockHttpServletRequest bindARequest() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader(HttpHeaders.ACCEPT_LANGUAGE, "az");
        response = new MockHttpServletResponse();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request, response));
        return request;
    }

    /** Answers everything with nothing: this suite is about the counter, not the query. */
    private static final class EmptySearchService implements SearchService {

        @Override
        public Set<DiscoveryCapability> capabilities() {
            return EnumSet.allOf(DiscoveryCapability.class);
        }

        @Override
        public DiscoveryPage search(DiscoveryQuery query) {
            return DiscoveryPage.empty();
        }

        @Override
        public FacetCounts facets(DiscoveryQuery query) {
            return new FacetCounts(
                    List.of(), List.of(), List.of(), List.of(), List.of(),
                    List.of(), List.of(), List.of(), List.of(), List.of());
        }

        @Override
        public List<Suggestion> suggest(SuggestQuery query) {
            return List.of();
        }
    }
}
