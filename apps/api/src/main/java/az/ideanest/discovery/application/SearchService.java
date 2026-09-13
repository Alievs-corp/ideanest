package az.ideanest.discovery.application;

import az.ideanest.discovery.domain.DiscoveryCapability;
import az.ideanest.discovery.domain.Suggestion;
import java.util.List;
import java.util.Set;

/**
 * Finding campaigns. <strong>The substitution seam of §11.1.</strong>
 *
 * <p>§11.1 puts the platform on PostgreSQL — {@code tsvector}, GIN, {@code pg_trgm} —
 * up to roughly ten thousand campaigns, and on a dedicated search engine after that
 * "or when faceting becomes complex", and says to start behind this interface "so the
 * migration is a substitution rather than a rewrite".
 *
 * <p><strong>What that costs, and what it buys.</strong> Nothing in these signatures
 * is a SQL fragment, a JDBC type, a Spring Data {@code Pageable} or {@code Page}, a
 * column name, or an entity. {@link DiscoveryQuery} in, {@link DiscoveryPage} and
 * {@link FacetCounts} out, all three of them plain values. A caller therefore cannot
 * come to depend on the storage, and swapping the implementation is a bean definition
 * rather than an edit to a controller.
 *
 * <h2>What a tier-2 implementation has to satisfy</h2>
 *
 * <p>The interface is not the whole contract. An engine-backed implementation is a
 * drop-in replacement only if it also holds these, each of which the tier-1
 * implementation holds and each of which something visible depends on:
 *
 * <ol>
 *   <li><strong>It returns only publicly visible campaigns.</strong>
 *       {@code DiscoveryStatus.LISTED_STATES}, always, before any caller filter. For
 *       an external index this is harder than it is for a query, because a campaign
 *       that is suspended after it was indexed stays in the index until something
 *       removes it — so tier 2 needs an eviction path on every state transition, and
 *       an index rebuild is not one. This is the requirement whose failure is a
 *       suspended campaign in a public feed.
 *   <li><strong>Its ordering is total and its cursor is a keyset.</strong> Sort key
 *       plus {@code id}, never an offset and never a page number, or a scroll
 *       duplicates and drops cards whenever {@code pledged_amount} changes underneath
 *       it — which is continuously. An engine's native "search after" is the right
 *       primitive; its {@code from}/{@code size} is not.
 *   <li><strong>A cursor is refused by the query it does not belong to.</strong>
 *       {@code DiscoveryCursor} carries a fingerprint of the query and the sort, and
 *       {@code requireMatches} is what makes replaying one across a filter change a
 *       loud failure rather than a page of nonsense.
 *   <li><strong>Money is exact.</strong> Amounts are {@code BigDecimal} end to end and
 *       reach the client as strings. An engine that stores amounts as doubles will
 *       put a campaign in the wrong band at the boundary and will report a
 *       completion of 99.99999%; if that is the storage, the band predicates have to
 *       be evaluated somewhere that is not the engine.
 *   <li><strong>Facets exclude their own dimension.</strong> See {@link FacetCounts}.
 *       Most engines default to the opposite, and it is one line of configuration
 *       and a bad filter panel.
 *   <li><strong>The bands are these bands.</strong> {@code CompletionBand} and
 *       {@code AmountBand} are closed below and open above, and the boundary values
 *       are tested. An engine's own range aggregation must be configured to agree, or
 *       a campaign at exactly its goal moves between facets when the tier changes.
 *   <li><strong>It folds §11.3's characters, in the index and in the query.</strong>
 *       A query folded on one side only matches nothing, and the failure is silent:
 *       the endpoint answers 200 with an empty list. Tier 1 folds in the database
 *       so that the index and the query cannot disagree; an engine has to be
 *       configured with an analyser that folds all seven pairs including
 *       {@code ə}, which no stock ASCII-folding analyser does.
 *   <li><strong>It declares what it cannot do.</strong> See {@link #capabilities()}.
 * </ol>
 *
 * <p>Both methods are read-only and take no transaction of their own beyond what the
 * implementation needs; nothing in discovery writes.
 */
public interface SearchService {

    /**
     * The optional parts of a query this implementation can actually honour.
     *
     * <p><strong>On the interface rather than in a comment, and this is the point.</strong>
     * §4.3 describes more filters than any first implementation will have — full text,
     * relevance, proximity, saved, featured — and there are exactly two honest ways to
     * answer a query that asks for one of them: refuse it, or serve it. Accepting the
     * parameter and quietly dropping it is the third way, and it produces a feed that
     * looks like it worked. A backer who typed a search term and was handed every
     * campaign on the platform has been told the search works.
     *
     * <p>So the query declares what it needs, the implementation declares what it has,
     * and the caller turns the difference into an RFC 9457 problem detail naming the
     * issue that owns the gap. Adding a capability here is how #43, #44, #47 and #48
     * each switch their feature on, and it is a claim the tests hold them to.
     *
     * @return possibly empty, never null
     */
    Set<DiscoveryCapability> capabilities();

    /**
     * One page of cards.
     *
     * @param query already validated; {@link DiscoveryQuery#requiredCapabilities()} is
     *     a subset of {@link #capabilities()} by the time this is called
     * @throws az.ideanest.discovery.domain.InvalidCursorException when the query
     *     carries a cursor that was issued for a different query or sort
     */
    DiscoveryPage search(DiscoveryQuery query);

    /**
     * The counts for the panel beside those cards.
     *
     * <p>{@code query.limit()} and {@code query.cursor()} are ignored: a facet count
     * is over everything the filter matches, not over one page of it.
     *
     * <p>Free text is <strong>not</strong> a facet dimension and is therefore not
     * excluded from any of them: it narrows the base set every count is taken over,
     * exactly as the visibility predicate does. A facet excludes its own dimension so
     * that ticking one value does not zero the rest of that control; there is no
     * control for the search box, and counts that ignored what was typed would
     * describe a different result set from the one on screen.
     */
    FacetCounts facets(DiscoveryQuery query);

    /**
     * What the reader might mean, from what they have typed so far. D-02.
     *
     * <p>Not a search: it answers a prefix rather than a query, it ranks nothing, and
     * it is called on every keystroke — so an implementation that served it by running
     * {@link #search} and taking the titles would be issuing a ranked, faceted,
     * paginated query per character typed.
     *
     * <p>Debouncing, keyboard navigation, and what happens when a suggestion is
     * chosen belong to the client (#46). What this owes it is a bounded list whose
     * rows say what kind of thing they are — see {@link Suggestion}.
     *
     * @param query see {@link SuggestQuery#isAnswerable()}: a blank or one-character
     *     fragment is answered with an empty list rather than with everything
     * @return at most {@link SuggestQuery#limit()} suggestions, never null
     */
    List<Suggestion> suggest(SuggestQuery query);
}
