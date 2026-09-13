package az.ideanest.discovery.application;

import az.ideanest.discovery.domain.CollectionKind;
import az.ideanest.discovery.domain.CuratedCollection;
import az.ideanest.discovery.domain.DiscoveryCursor;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Reading curated collections. D-08's landing pages, and §4.3's Programmes control.
 *
 * <p><strong>A second interface beside {@link SearchService} rather than four more
 * methods on it.</strong> The two answer different questions. {@code SearchService}
 * is §11.1's substitution seam: everything on it is a query a dedicated search engine
 * would take over. Nothing here is. A collection is a short, curated, editorially
 * maintained list that lives in PostgreSQL whatever serves the feed, and folding it
 * into the seam would oblige a tier-2 implementer to reimplement the curation reads
 * in order to replace the search.
 *
 * <p><strong>Every method here answers only about collections the public may
 * see</strong> — published, and inside their display window. There is no argument for
 * "include the unpublished ones", so no caller can pass one by mistake; the admin
 * surface reads its own rows through its own repository. The consequence a caller has
 * to know about is that {@link #find} answers empty for a collection that exists and
 * is not published yet, which is what makes the endpoint answer 404 rather than 403 —
 * a 403 would confirm that a list somebody is still assembling exists.
 *
 * <p><strong>Membership is filtered again on read.</strong> A curator may add a
 * campaign that is later suspended, and the membership row stays — removing it would
 * rewrite the editorial history to say the campaign was never chosen. What changes is
 * that it stops being returned and stops being counted, by the same
 * {@code DiscoveryStatus.LISTED_STATES} predicate every other read in this module
 * applies.
 */
public interface CuratedCollections {

    /**
     * Every collection the public may see, in the platform's display order.
     *
     * <p>Not paged. §10.2 gives {@code GET /v1/collections} no cursor, and a curated
     * list of lists is tens of rows rather than thousands — if it ever stops being,
     * the fix is a cursor here and not a silent truncation.
     *
     * @param locale the negotiated language; titles are resolved through the
     *     taxonomy's chain — requested locale, then {@code az}, then the slug
     */
    List<CuratedCollection> index(String locale);

    /**
     * One collection, by the slug in its URL.
     *
     * @return empty when there is no such collection, when it is not published, and
     *     when it is outside its display window. The three are deliberately
     *     indistinguishable to a caller
     */
    Optional<CuratedCollection> find(String slug, String locale);

    /**
     * One page of a collection's campaigns, in the curator's order.
     *
     * <p>{@code position} ascending with {@code project_id} as the tiebreaker, over a
     * keyset cursor bound to the collection — the same conventions as
     * {@code /v1/discover} (§10.3), and the same cursor type, so a client that can
     * page one can page the other.
     *
     * @param collection from {@link #find}, so that a page can only ever be produced
     *     for a collection the caller was already allowed to see
     * @param cursor null for the first page
     * @throws az.ideanest.discovery.domain.InvalidCursorException when the cursor was
     *     issued for a different collection
     */
    DiscoveryPage projects(CuratedCollection collection, int limit, DiscoveryCursor cursor);

    /**
     * The slug and translated title of every publicly visible collection of one kind,
     * in display order.
     *
     * <p>For the facet panel, which needs a label per programme and no counts of its
     * own — the counts come from the same query as every other facet, so that they are
     * taken over the same base set under the same exclude-own-dimension rule.
     *
     * @return an ordered map; empty when the platform is running no collections of
     *     that kind
     */
    Map<String, String> visibleTitles(CollectionKind kind, String locale);
}
