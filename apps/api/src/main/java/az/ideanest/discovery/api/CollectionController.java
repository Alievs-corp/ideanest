package az.ideanest.discovery.api;

import az.ideanest.discovery.application.CollectionNotFoundException;
import az.ideanest.discovery.application.CuratedCollections;
import az.ideanest.discovery.application.DiscoveryQuery;
import az.ideanest.discovery.application.UnknownFilterValueException;
import az.ideanest.discovery.domain.CuratedCollection;
import az.ideanest.discovery.domain.DiscoveryCursor;
import az.ideanest.project.application.Taxonomy;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;

/**
 * Curated collections and open-call landing pages. §10.2's {@code # Discovery}, D-08.
 *
 * <p>Public and unauthenticated, exactly as {@code /v1/discover} is and for the same
 * reason: a collections page is a front door, and a visitor who has not registered is
 * the audience it exists for. Nothing in either response belongs to a person.
 *
 * <h2>What is not here</h2>
 *
 * <p><strong>An unpublished collection answers 404, not 403.</strong> Which campaigns
 * the platform is about to put its name behind — and by implication which it passed
 * over — is a commercially interesting fact about its plans, and a 403 would confirm
 * that {@code /collections/spring-2027} exists to anybody who guesses. Same for one
 * whose window has closed. See {@code CollectionNotFoundException}.
 *
 * <h2>Caching</h2>
 *
 * <p>§10.3's {@code ETag} and {@code Cache-Control} through {@link PublicReads}, the
 * same content digest {@code CategoryController} established, and
 * {@code Vary: Accept-Language} on both the 200 and the 304 — the title and the
 * standfirst are translated, so a cache that replayed the Azerbaijani copy to a client
 * that asked for English would be worse than no cache.
 *
 * <p><strong>Sixty seconds, not an hour.</strong> The collection's own copy changes
 * about as often as the taxonomy does, but the cards inside it carry
 * {@code pledged_amount} and {@code backers_count}, which move whenever anybody
 * pledges. The window is therefore the feed's rather than the taxonomy's, and the index
 * shares it because {@code projectCount} moves whenever a campaign in a collection is
 * suspended or ends.
 */
@RestController
public class CollectionController {

    /** The same window {@code DiscoveryController} uses. See the class comment. */
    static final long MAX_AGE_SECONDS = DiscoveryController.MAX_AGE_SECONDS;

    private final CuratedCollections collections;

    public CollectionController(CuratedCollections collections) {
        this.collections = collections;
    }

    /**
     * Every collection the public may see.
     *
     * <p>Not paged, deliberately: §10.2 gives this endpoint no cursor, and a curated
     * list of lists is tens of rows. If it stops being, the answer is a cursor rather
     * than a silent truncation — which is why nothing here caps the result.
     */
    @GetMapping("/v1/collections")
    public ResponseEntity<CollectionResponses.CollectionIndex> index(
            WebRequest request,
            HttpServletResponse response,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage,
            @RequestParam(required = false) String market) {

        String locale = Taxonomy.localeFor(acceptLanguage);
        List<CuratedCollection> visible = collections.index(locale, DiscoveryQueryBinder.market(market));
        CollectionResponses.CollectionIndex body = CollectionResponses.index(visible);

        // On the raw response, because the 304 below is written by checkNotModified
        // and never passes through a ResponseEntity.
        response.setHeader(HttpHeaders.VARY, HttpHeaders.ACCEPT_LANGUAGE);
        String etag = PublicReads.etagOf(locale, PublicReads.canonical(body));
        if (request.checkNotModified(etag)) {
            return null;
        }
        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.maxAge(MAX_AGE_SECONDS, TimeUnit.SECONDS).cachePublic())
                .body(body);
    }

    /**
     * One collection and its campaigns, in the curator's order. D-08's landing page.
     *
     * <p>Cursor-paginated on {@code ?cursor=&limit=}, §10.3's conventions and the same
     * token type {@code /v1/discover} issues — a client that can page a feed can page
     * this without learning a second encoding.
     *
     * @return {@code 404} for a collection that does not exist, is not published, or is
     *     outside its window; {@code 304} when the caller already holds this page in
     *     this language
     */
    @GetMapping("/v1/collections/{slug}")
    public ResponseEntity<CollectionResponses.CollectionPage> collection(
            WebRequest request,
            HttpServletResponse response,
            @RequestHeader(value = HttpHeaders.ACCEPT_LANGUAGE, required = false) String acceptLanguage,
            @PathVariable String slug,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) String limit,
            @RequestParam(required = false) String market) {

        String locale = Taxonomy.localeFor(acceptLanguage);
        String country = DiscoveryQueryBinder.market(market);
        CuratedCollection collection =
                collections.find(slug, locale, country).orElseThrow(() -> new CollectionNotFoundException(slug));

        CollectionResponses.CollectionPage body = CollectionResponses.page(
                collection,
                collections.projects(
                        collection,
                        limitOf(limit),
                        // Decoded here so a malformed cursor fails before a query runs.
                        // Whether it belongs to *this* collection is checked by the
                        // service, which is the only thing that knows the fingerprint.
                        cursor == null || cursor.isBlank() ? null : DiscoveryCursor.decode(cursor),
                        country));

        response.setHeader(HttpHeaders.VARY, HttpHeaders.ACCEPT_LANGUAGE);
        String etag = PublicReads.etagOf(locale, PublicReads.canonical(body));
        if (request.checkNotModified(etag)) {
            return null;
        }
        return ResponseEntity.ok()
                .eTag(etag)
                .cacheControl(CacheControl.maxAge(MAX_AGE_SECONDS, TimeUnit.SECONDS).cachePublic())
                .body(body);
    }

    /**
     * The page size, clamped rather than refused.
     *
     * <p>The same bounds and the same reasoning as {@code DiscoveryQueryBinder}: a
     * client asking for two hundred cards wants a page, and a hundred is more useful
     * than an error. A limit that is not a number is a different thing and is refused,
     * through the same problem detail the feed uses so a client learns one shape.
     */
    private static int limitOf(String limit) {
        if (limit == null || limit.isBlank()) {
            return DiscoveryQuery.DEFAULT_LIMIT;
        }
        try {
            return Math.clamp(
                    Integer.parseInt(limit.trim()), DiscoveryQuery.MIN_LIMIT, DiscoveryQuery.MAX_LIMIT);
        } catch (NumberFormatException e) {
            throw new UnknownFilterValueException("limit", limit, List.of());
        }
    }
}
