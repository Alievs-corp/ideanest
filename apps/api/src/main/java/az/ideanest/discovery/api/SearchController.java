package az.ideanest.discovery.api;

import az.ideanest.discovery.application.DiscoveryQuery;
import az.ideanest.discovery.application.SearchService;
import az.ideanest.discovery.application.SuggestQuery;
import az.ideanest.discovery.application.UnknownFilterValueException;
import az.ideanest.discovery.application.UnsupportedDiscoveryOptionException;
import az.ideanest.discovery.domain.Suggestion;
import az.ideanest.project.application.Taxonomy;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;

/**
 * Searching campaigns, and completing what is being typed. §10.2's
 * {@code GET /v1/search} and {@code GET /v1/search/suggest}.
 *
 * <h2>Why {@code /v1/search} is an alias over the discovery query and not its own
 * thing</h2>
 *
 * <p>§10.2 lists it as a separate route, so it exists as one. What it is
 * <em>not</em> is a separate implementation: it takes the same parameters, binds
 * them with the same binder, runs the same {@link SearchService#search}, and
 * answers with the same {@code Feed}. That is deliberate, and the alternative is
 * the bug. Every filter, every sort, the keyset cursor, and the facet counts have
 * to compose with free text — §4.3 offers all of them on the search results page
 * too — so a second endpoint with a query object of its own would be a second
 * implementation of the whole of discovery, differing from the first by whichever
 * filter somebody forgot. It would also mean two cursor encodings, and a client
 * that paged from one endpoint into the other would be told its cursor was forged.
 *
 * <p><strong>The one difference is that {@code q} is required.</strong>
 * {@code /v1/discover} without {@code q} is the browse feed, which is the whole
 * point of it; {@code /v1/search} without {@code q} is a search for nothing, which
 * no interface produces and which — answered with a page of arbitrary campaigns —
 * would look exactly like a search that had worked. It is refused with the same
 * RFC 9457 shape as any other bad parameter.
 *
 * <p>The second, quieter difference is the default order: {@code DiscoveryQuery}
 * resolves an unstated sort to {@code best_match} when there is text, so this
 * endpoint opens on relevance and {@code /v1/discover} opens on newest, without
 * either of them having to say so.
 *
 * <p><strong>There is no {@code /v1/search/facets}.</strong> §10.2 does not list one
 * and none is needed: {@code /v1/discover/facets} takes {@code q} like every other
 * parameter and counts the same narrowed set, so the search page's filter panel is
 * one request to an endpoint that already exists rather than a second copy of the
 * facet query maintained beside the first.
 *
 * <h2>Caching</h2>
 *
 * <p>Same conventions as {@code /v1/discover} (§10.3), same reasoning, same code —
 * see {@link PublicReads}. A search response holds nothing belonging to a person,
 * so it is {@code Cache-Control: public}; it varies with {@code Accept-Language}
 * because the facet labels and the suggestion labels do.
 *
 * <h2>Rate limiting</h2>
 *
 * <p>§17.3's "search 60/min", per address. {@code /v1/search} spends the same budget
 * as {@code /v1/discover} and autocomplete spends a larger one of its own; {@link
 * PublicReadLimits} says why.
 */
@RestController
public class SearchController {

    /**
     * How long a suggestion list may be stale, in seconds.
     *
     * <p>Five minutes rather than the feed's one. The feed's minute is set by
     * {@code pledged_amount} moving on every card; a suggestion list holds a title, a
     * category name and a tag, and changes only when somebody creates a campaign or
     * coins a tag. It is also the most-requested thing here — one request per
     * keystroke, per visitor — so the cache is worth more and there is less for it to
     * get wrong.
     */
    private static final long SUGGEST_MAX_AGE_SECONDS = 300;

    private final SearchService search;
    private final PublicReadLimits limits;

    public SearchController(SearchService search, PublicReadLimits limits) {
        this.search = search;
        this.limits = limits;
    }

    /**
     * A page of results for a query. D-01, D-03, D-04.
     *
     * @return {@code 304} when the caller already holds this page in this language
     */
    @GetMapping("/v1/search")
    public ResponseEntity<DiscoveryResponses.Feed> search(
            WebRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse response,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage,
            @RequestParam MultiValueMap<String, String> parameters) {

        limits.countRead(httpRequest);

        String locale = Taxonomy.localeFor(acceptLanguage);
        DiscoveryQuery query = DiscoveryQueryBinder.bind(parameters, locale);
        requireQuery(query);
        UnsupportedDiscoveryOptionException.requireSupported(query.requiredCapabilities(), search.capabilities());

        DiscoveryResponses.Feed feed = DiscoveryResponses.feed(search.search(query));

        // On the raw response, because the 304 below is written by checkNotModified
        // and never passes through a ResponseEntity.
        response.setHeader(HttpHeaders.VARY, HttpHeaders.ACCEPT_LANGUAGE);
        String etag = PublicReads.etagOf(locale, PublicReads.canonical(feed));
        if (request.checkNotModified(etag)) {
            return null;
        }
        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.maxAge(DiscoveryController.MAX_AGE_SECONDS, TimeUnit.SECONDS).cachePublic())
                .body(feed);
    }

    /**
     * What the reader might mean. D-02, and the endpoint #46's autocomplete reads.
     *
     * <p>{@code q} is <strong>not</strong> required here, and that is the difference
     * from the two above: this is called on every keystroke including the ones that
     * empty the box, and answering an empty box with a 400 would put an error in the
     * console of a client that is behaving correctly. An unanswerable fragment is an
     * empty list — see {@link SuggestQuery#isAnswerable()} — which is also what a
     * client renders as "no dropdown".
     *
     * <p>Debouncing and keyboard navigation are #46's. This endpoint owes it a bounded
     * list, a kind per row, and a cache header.
     */
    @GetMapping("/v1/search/suggest")
    public ResponseEntity<DiscoveryResponses.Suggestions> suggest(
            WebRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse response,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage,
            @RequestParam(value = "q", required = false) String text,
            @RequestParam(value = "limit", required = false) String limit,
            @RequestParam(value = "market", required = false) String market) {

        limits.countSuggestion(httpRequest);

        String locale = Taxonomy.localeFor(acceptLanguage);
        SuggestQuery query = new SuggestQuery(
                DiscoveryQueryBinder.text(text), suggestLimit(limit), locale, DiscoveryQueryBinder.market(market));

        List<Suggestion> suggestions = search.suggest(query);
        DiscoveryResponses.Suggestions body = DiscoveryResponses.suggestions(suggestions);

        response.setHeader(HttpHeaders.VARY, HttpHeaders.ACCEPT_LANGUAGE);
        String etag = PublicReads.etagOf(locale, PublicReads.canonical(body));
        if (request.checkNotModified(etag)) {
            return null;
        }
        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.maxAge(SUGGEST_MAX_AGE_SECONDS, TimeUnit.SECONDS).cachePublic())
                .body(body);
    }

    /**
     * Refuses a search with nothing to search for.
     *
     * <p>Reported against {@code q} with an empty vocabulary, which is what
     * {@link UnknownFilterValueException} means by "rejected for its shape rather than
     * against a list" — there is no list of acceptable search terms.
     */
    private static void requireQuery(DiscoveryQuery query) {
        if (query.text() == null) {
            throw new UnknownFilterValueException("q", "", List.of());
        }
    }

    /**
     * The page size, clamped by {@link SuggestQuery} and refused when it is not a
     * number.
     *
     * <p>The same rule as the feed's {@code limit}, for the same reason: a client
     * asking for fifty suggestions wants a list and gets twenty, which is more useful
     * than an error; a client sending {@code limit=lots} has a bug.
     */
    private static int suggestLimit(String limit) {
        if (limit == null || limit.isBlank()) {
            return SuggestQuery.DEFAULT_LIMIT;
        }
        try {
            return Integer.parseInt(limit.trim());
        } catch (NumberFormatException e) {
            throw new UnknownFilterValueException("limit", limit, List.of());
        }
    }
}
