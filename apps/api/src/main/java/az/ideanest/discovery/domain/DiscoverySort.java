package az.ideanest.discovery.domain;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The seven orders §4.3 offers, and what each one costs to serve.
 *
 * <p>All seven are declared now, and all seven are served: #44 brought
 * {@link #RELEVANCE} and #47 brought {@link #NEAR_ME}. Declaring them before they
 * worked is what stopped either issue from having to widen this enum, and what let a
 * client discover the vocabulary before the features landed — each of them switched
 * on by a constant appearing in {@code PostgresSearchService.capabilities()} and
 * nothing else changing here. See {@link DiscoveryCapability}.
 *
 * <p><strong>Every order is total.</strong> Each carries a tiebreaker of
 * {@code id ASC} on top of its sort key, and nothing else would be correct: a
 * keyset cursor over a non-total order duplicates and drops rows at every page
 * boundary where two campaigns share a key, and on this platform thousands of
 * campaigns share a {@code pledged_amount} of zero.
 */
public enum DiscoverySort {

    /**
     * {@code launched_at DESC}. <strong>The default.</strong>
     *
     * <p>Chosen as the default because it is the only order that is meaningful with
     * no filter applied. {@link #ENDING_SOON} sorts a campaign whose deadline passed
     * in 2024 above one ending tomorrow, so an unfiltered feed ordered by it opens
     * on the oldest finished campaigns on the platform; {@link #MOST_FUNDED} and
     * {@link #MOST_BACKED} open on the same handful of campaigns for everybody, for
     * ever. Newest changes, is comprehensible, and cannot be gamed by the size of
     * somebody's launch.
     *
     * <p>Nulls last: a campaign in {@code PRELAUNCH} has never launched, and an
     * unlaunched teaser is not the newest thing on the platform.
     *
     * <p><em>V6 calls ending-soon "the default discovery sort" in a comment beside
     * {@code projects_state_deadline_idx}. That aside is superseded here, for the
     * reason above. The index it describes is still exactly the right index for
     * {@link #ENDING_SOON}.</em>
     */
    NEWEST("newest"),

    /**
     * {@code deadline ASC}. Nulls last, for the campaigns that have no deadline yet.
     *
     * <p>Almost always sent with {@code status=live}; without it the order is
     * dominated by campaigns that ended long ago. That is the client's decision and
     * not this endpoint's — silently adding a status filter to a sort would make one
     * parameter change the meaning of another.
     */
    ENDING_SOON("ending_soon"),

    /** {@code pledged_amount DESC}. Never null; the column defaults to zero. */
    MOST_FUNDED("most_funded"),

    /** {@code backers_count DESC}. Never null; the column defaults to zero. */
    MOST_BACKED("most_backed"),

    /**
     * Pledge velocity with time decay (§4.3).
     *
     * <p>The score is money raised divided by a power of the campaign's age, which
     * is the gravity form used everywhere for this shape of ranking. What it is
     * <em>not</em> is §11.2's relevance: that composite needs pledge and backer
     * velocity over a 48-hour window, and there is no pledge ledger yet (epic #50) —
     * {@code projects.pledged_amount} is a running total with no history behind it.
     * So the decay approximates velocity from what exists: a campaign that raised
     * 10,000 in two days outranks one that raised 12,000 in fifty.
     *
     * <p><strong>The clock is pinned by the cursor.</strong> A score computed against
     * {@code now()} moves between page one and page two, which is exactly the
     * duplicate-and-drop failure a keyset cursor exists to prevent. The first page
     * chooses an instant, the cursor carries it, and every later page recomputes the
     * same scores. See {@code DiscoveryCursor}.
     *
     * <p><strong>This is the one order no index serves.</strong> The score is a
     * function of two columns and a parameter, so PostgreSQL sorts the matching rows.
     * At §11.1's tier-1 ceiling of roughly ten thousand campaigns that is a sort of a
     * few thousand rows and costs under a millisecond; past it, this is one of the
     * things that moves to the engine.
     */
    POPULARITY("popularity"),

    /**
     * How well the campaign's text matches the words that were typed (D-01).
     * <strong>The default when {@code q} is present and no sort is named.</strong>
     *
     * <p><strong>This is not {@link #RELEVANCE}, and the difference is the whole
     * reason it exists.</strong> §11.2's relevance is a composite of pledge
     * velocity, backer velocity, completion, curation, personalisation and decay —
     * seven terms, none of which is about what the reader typed — and it is #44's
     * to build. Text relevance is {@code ts_rank} over the folded search vector: a
     * title match outranks a blurb match outranks a story match, and that is all it
     * claims. Serving one under the other's name would mean that when #44 lands,
     * either {@code sort=relevance} changes meaning underneath every client or the
     * composite has to be given a different word.
     *
     * <p><strong>Why a sort of its own rather than "the order used when q is
     * present".</strong> They are the same thing here — {@code DiscoveryQuery}
     * resolves an unstated sort to this one exactly when there is text to rank by —
     * but the cursor carries the sort it was issued for and the fingerprint hashes
     * it, so the order a page was produced in has to have a name. It is also what
     * lets a client that filtered its way to text search and then chose
     * {@code sort=newest} switch back.
     *
     * <p><strong>What #44 layers on top.</strong> {@code RELEVANCE} becomes a
     * second scoring expression beside this one, not a replacement for it: the
     * §11.2 composite has a text term, and this is the text term. Nothing about
     * this constant, its cursor encoding, or its index has to change for that.
     *
     * <p>Requires {@link DiscoveryCapability#FULL_TEXT}, because a text score
     * needs a search vector. A query that names it without a {@code q} has nothing
     * to rank and is resolved back to {@link #DEFAULT} — see {@code DiscoveryQuery}.
     */
    BEST_MATCH("best_match"),

    /**
     * §11.2's composite (#44). <strong>Served.</strong>
     *
     * <p>A weighted sum of the terms §11.2 lists, over a fixed scale rather than over
     * the result set — see {@code RelevanceScore} for why the other reading of
     * "normalise" cannot be paged. The weights are rows in {@code ranking_weights} and
     * are changed without a deployment, which is what §11.2 asks for and what makes
     * ranking measurable rather than arguable.
     *
     * <p><strong>Three of §11.2's eight terms run; five are inert and say so.</strong>
     * Completion, the editorial badge and recency decay have data. Both 48-hour
     * velocities do not — {@code pledged_amount} and {@code backers_count} are running
     * totals with no history behind them (epic #50) — and neither do view-to-pledge
     * conversion (#95), personalisation (D-07), or the spam signal (#108). Their weight
     * rows exist, the moderator diagnostic reports them contributing nothing, and V15
     * refuses to let one be switched on until something computes it.
     *
     * <p><strong>It contains {@link #BEST_MATCH} rather than replacing it.</strong> The
     * composite's text term is the identical {@code ts_rank} expression, which is what
     * #43 said would happen. The two orders remain different orders and the difference
     * is which question is being asked: {@code best_match} is "how well does this match
     * the words I typed", and this is "what should I be shown", of which the text match
     * is one term among several.
     *
     * <p><strong>An unstated sort still resolves to {@link #DEFAULT} or
     * {@link #DEFAULT_WITH_TEXT}, and this is deliberately not either.</strong> A
     * merged web client (`packages/discovery/src/filters.ts`) resolves an absent
     * sort the same way and shows the reader which order is in force; making relevance
     * the default here would silently change what every existing link means and would
     * make that control lie. It is opt-in — {@code ?sort=relevance} — until somebody
     * has measured it against the two defaults, which is exactly what the tunable
     * weights and the diagnostic exist to make possible.
     *
     * <p><strong>The cursor pins more than #42's.</strong> #42 pinned the decay clock so
     * the score could not move on its own between pages; this additionally binds the
     * cursor to a digest of the weights, so a tuning change mid-scroll is refused and
     * restarted rather than silently reshuffling the feed under the reader. What no
     * cursor can pin is {@code pledged_amount}, so the surviving guarantee is the one
     * {@code DiscoveryCursor} states for every order over a mutable column: a row that
     * moves is seen once or not at all, and no row that stayed still is duplicated or
     * dropped.
     *
     * <p>Like {@link #POPULARITY}, <strong>no index serves it</strong> — the key is an
     * expression over several columns, a request parameter, and a configuration — so
     * PostgreSQL sorts the matching rows. At §11.1's tier-1 ceiling that is a sort of a
     * few thousand rows; past it, this is one of the things that moves to the engine.
     */
    RELEVANCE("relevance"),

    /**
     * Great-circle distance from an origin the caller supplies, nearest first.
     * <strong>#47, and served.</strong>
     *
     * <p><strong>The origin comes from the request and from nowhere else.</strong>
     * {@code ?near=lat,lon}. Not from a profile: {@code /v1/discover} is
     * unauthenticated and publicly cached — the same bytes for everybody is what makes
     * §20's thousand requests a second reachable — so there is no caller to read a
     * profile for, and giving it one would break the cache in exactly the way
     * {@code DiscoveryCapability.FILTER_RECOMMENDED} explains at length. The origin is
     * quantised to about a kilometre before it reaches anything; see
     * {@code LocationFilter.Proximity}, where the reasoning is privacy rather than
     * arithmetic.
     *
     * <p><strong>An unstated origin is refused, not resolved to another order.</strong>
     * {@link #BEST_MATCH} without {@code q} falls back to {@link #DEFAULT} because a
     * text score over no text is zero for every campaign and the request has exactly
     * one sensible reading. A distance from no origin is not zero, it is undefined, and
     * a "near me" control that quietly meant "newest" is the failure
     * {@link DiscoveryCapability} exists to prevent. {@code DiscoveryQueryBinder}
     * refuses it.
     *
     * <p><strong>A campaign with no location sorts last, and is not excluded.</strong>
     * §4.3 lists Near me under sorts and proximity under the Location <em>filter</em>:
     * they are two controls and this is the sort. A sort that dropped rows would take a
     * reader who switched from newest to near-me and silently remove most of the
     * platform from their feed, which is the same failure as a filter that is accepted
     * and ignored, wearing an order's clothes. Nulls last, like {@link #NEWEST} and
     * {@link #ENDING_SOON}, and the cursor has the null-tail branch those two have. A
     * <em>radius</em> is a filter and does exclude them — a campaign whose location is
     * unknown cannot be shown to be within any distance of anywhere.
     *
     * <p><strong>The key cannot move, which makes this the easiest cursor in the
     * module.</strong> Neither the origin (pinned in the fingerprint) nor a city
     * centroid changes while somebody scrolls, so unlike {@code most_funded},
     * {@code popularity} and {@code relevance} — all of which read {@code pledged_amount}
     * — a near-me feed has no rows moving underneath it at all. What the cursor still
     * has to pin is the origin itself, and it does: see
     * {@code LocationFilter.Proximity.canonical}.
     *
     * <p><strong>Like {@link #POPULARITY}, no index serves the order</strong>, and for a
     * better reason than that one. The key is an expression over a joined table and a
     * request parameter, so it is not indexable; but distance is a property of a
     * <em>location</em> rather than of a campaign, and there are eighteen of those, so
     * what PostgreSQL actually does is compute a handful of distances and sort the
     * matching campaigns by a hash-joined number. V16's comment has the measurement and
     * the reason no GiST index is shipped with it.
     */
    NEAR_ME("near_me"),

    /**
     * The curator's own sequence. <strong>Not selectable by a client.</strong>
     *
     * <p>D-08's landing page is an edited list — {@code collection_projects.position}
     * ascending, {@code project_id} as the tiebreaker that makes it total — and the
     * first card on a staff-picks page is a choice somebody made rather than whatever
     * launched most recently.
     *
     * <p><strong>Why it is in this enum at all.</strong> A cursor carries the order it
     * was issued for and refuses to be replayed against another one
     * ({@code DiscoveryCursor}), so every order this module produces has to have a
     * name. Giving the collection page a cursor type of its own instead would mean a
     * second encoding, a second version field, and a second set of the mistakes
     * {@code DiscoveryCursor}'s comments are about.
     *
     * <p><strong>Why it is not selectable.</strong> {@code ?sort=curated} on
     * {@code /v1/discover} would name an order that does not exist there: outside a
     * collection there is no curator and no position, so the honest answers are a
     * refusal or a silent fallback, and a silent fallback is the failure
     * {@link DiscoveryCapability} exists to prevent. {@link #isClientSelectable} is
     * how the binder says so, and it is left out of {@link #wireValues()} so it never
     * appears in the list of values a client is told it may send.
     */
    CURATED("curated");

    /** What a client sends when it sends nothing and is browsing. See {@link #NEWEST}. */
    public static final DiscoverySort DEFAULT = NEWEST;

    /**
     * What a client sends when it sends nothing and is searching.
     *
     * <p>A feed with no query has no relevance to order by; a feed with one has
     * nothing else worth opening on. Sorting search results by launch date puts the
     * campaign that mentions the word once in its ninth paragraph above the one
     * named after it, and every reader reads that as "the search does not work".
     */
    public static final DiscoverySort DEFAULT_WITH_TEXT = BEST_MATCH;

    private static final Map<String, DiscoverySort> BY_WIRE_VALUE = byWireValue();

    private final String wireValue;

    DiscoverySort(String wireValue) {
        this.wireValue = wireValue;
    }

    public String wireValue() {
        return wireValue;
    }

    /** The capability this order needs, or empty when PostgreSQL can serve it today. */
    public Optional<DiscoveryCapability> requiredCapability() {
        return switch (this) {
            case BEST_MATCH -> Optional.of(DiscoveryCapability.FULL_TEXT);
            case RELEVANCE -> Optional.of(DiscoveryCapability.SORT_RELEVANCE);
            case NEAR_ME -> Optional.of(DiscoveryCapability.SORT_NEAR_ME);
            case NEWEST, ENDING_SOON, MOST_FUNDED, MOST_BACKED, POPULARITY, CURATED -> Optional.empty();
        };
    }

    /**
     * Whether a client may ask for this order by name.
     *
     * <p>False only for {@link #CURATED}, which exists because a cursor names its
     * order and not because anybody may choose it. See that constant.
     */
    public boolean isClientSelectable() {
        return this != CURATED;
    }

    /**
     * The order named, whether or not a client may select it.
     *
     * <p>Deliberately does not filter: {@code DiscoveryCursor.decode} calls this to
     * read back an order this service issued, and a cursor for the collection page
     * has to decode. The binder is where selectability is enforced, because that is
     * where a client's input arrives.
     */
    public static Optional<DiscoverySort> fromWireValue(String value) {
        return Optional.ofNullable(value).map(BY_WIRE_VALUE::get);
    }

    /** Every order a client may ask for, in declaration order, for an error message. */
    public static List<String> wireValues() {
        return BY_WIRE_VALUE.values().stream()
                .filter(DiscoverySort::isClientSelectable)
                .map(DiscoverySort::wireValue)
                .toList();
    }

    private static Map<String, DiscoverySort> byWireValue() {
        Map<String, DiscoverySort> map = new LinkedHashMap<>();
        for (DiscoverySort sort : values()) {
            map.put(sort.wireValue, sort);
        }
        return Collections.unmodifiableMap(map);
    }
}
