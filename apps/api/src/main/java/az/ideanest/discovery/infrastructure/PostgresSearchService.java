package az.ideanest.discovery.infrastructure;

import az.ideanest.discovery.application.CuratedCollections;
import az.ideanest.discovery.application.DiscoveryPage;
import az.ideanest.discovery.application.DiscoveryQuery;
import az.ideanest.discovery.application.FacetCounts;
import az.ideanest.discovery.application.RankingDiagnostics;
import az.ideanest.discovery.application.RankingExplanation;
import az.ideanest.discovery.application.RankingWeight;
import az.ideanest.discovery.application.RankingWeightStore;
import az.ideanest.discovery.application.RankingWeights;
import az.ideanest.discovery.application.SearchService;
import az.ideanest.discovery.application.SuggestQuery;
import az.ideanest.discovery.domain.AmountBand;
import az.ideanest.discovery.domain.AmountRange;
import az.ideanest.discovery.domain.CollectionKind;
import az.ideanest.discovery.domain.CompletionBand;
import az.ideanest.discovery.domain.DiscoveryCapability;
import az.ideanest.discovery.domain.DiscoveryCursor;
import az.ideanest.discovery.domain.DiscoverySort;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.InvalidCursorException;
import az.ideanest.discovery.domain.LocationFilter;
import az.ideanest.discovery.domain.ProjectCard;
import az.ideanest.discovery.domain.RankingTerm;
import az.ideanest.discovery.domain.ShowOnly;
import az.ideanest.discovery.domain.Suggestion;
import az.ideanest.project.application.Taxonomy;
import az.ideanest.shared.Slugs;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Tier 1 of §11.1: discovery served by PostgreSQL.
 *
 * <p><strong>Raw SQL, not the project module's repositories.</strong> Two reasons,
 * and they agree. {@code ModuleBoundaryTests} forbids reaching into
 * {@code project.infrastructure}; and a feed of a hundred cards loaded as JPA
 * entities is a hundred managed objects with their associations, for a projection
 * that uses fourteen columns. §20 asks for a thousand requests a second at p99 under
 * 300ms, and a read model with its own query is the only shape that gets there.
 *
 * <h2>What this can and cannot do</h2>
 *
 * <p>{@link #capabilities()} holds free text (#43), curation (#48), the composite
 * ranking (#44), and location (#47). Every other option §4.3 describes that needs
 * something absent — a saved table, a per-caller signal — is refused by the caller with
 * a problem detail naming its issue, rather than accepted and dropped. See
 * {@link DiscoveryCapability}.
 *
 * <h2>Location, and where the arithmetic is not</h2>
 *
 * <p>§4.3's Location filter and its Near me sort are served from V16's
 * {@code locations} table, {@code projects.location_id}, and {@code earthdistance} —
 * <strong>not PostGIS</strong>, for reasons V16's comment gives at length. The shape
 * worth knowing here is that a location is shared reference data, so the number of
 * distinct points the platform measures distance to is the size of a city gazetteer and
 * not the number of campaigns. Every location question therefore resolves against a
 * table of eighteen rows and reaches {@code projects} as a membership test that V16's
 * partial index serves; the geographic arithmetic never touches the large side of the
 * query. That is also why no GiST index ships with the feature: measured, the planner
 * will not use one, and V16 says so with the plan.
 *
 * <h2>Relevance, in three live terms out of eight</h2>
 *
 * <p>§11.2's composite is served under {@link DiscoverySort#RELEVANCE}, and
 * <strong>five of its eight terms have no data source in this schema</strong>: both
 * velocities need a pledge ledger, conversion needs analytics, personalisation needs a
 * caller, and the spam signal needs fraud detection. Those terms are seeded inert in
 * V15 and say what is blocking them; what actually runs is completion, the editorial
 * badge, recency, and the text term #43 left for it. {@code RelevanceScore} holds the
 * arithmetic and the reasoning; the weights are rows in {@code ranking_weights} and are
 * changed without a deployment, which is what §11.2 requires and why they are not
 * constants in this file.
 *
 * <h2>Free text, in two tiers</h2>
 *
 * <p>D-01 is a {@code tsvector} match against {@code projects.search_vector} (V13),
 * over the title, blurb, creator name and story prose, all folded by §11.3 in the
 * database so that the index and the query cannot disagree about what
 * {@code seçənək} means. D-03 — misspelling tolerance — is a second tier over
 * trigram similarity of the title, and it engages <strong>only when the first tier
 * matches nothing at all</strong>: see {@link #exactTierMatches}. An exact match
 * therefore always outranks a fuzzy one, because a fuzzy result set is only ever
 * produced when there is no exact one.
 *
 * <p>Text composes with every filter, every sort, the keyset cursor, and the facet
 * counts, because it is one more AND'd predicate over the same table and nothing
 * else about the query changes. The one thing it adds is an order —
 * {@link DiscoverySort#BEST_MATCH} — whose key is a {@code numeric} rounded to six
 * places, for the reason {@link #POPULARITY_SCORE} is rounded.
 *
 * <h2>What tier 2 would have to satisfy</h2>
 *
 * <p>The list is on {@link SearchService}, where a second implementer will read it.
 * The two that this class earns rather than declares are worth repeating here:
 * visibility is a predicate on a live table, so a campaign suspended a second ago is
 * already invisible — an external index has to be told; and money is
 * {@code numeric} throughout, so a band boundary is exact rather than nearly.
 */
@Service
public class PostgresSearchService implements SearchService, RankingDiagnostics {

    /**
     * How coarse the instant that {@link DiscoverySort#POPULARITY} decays against is.
     *
     * <p>Sixty seconds, and deliberately the same as the {@code max-age} the
     * controller sets. A score computed against a continuously moving {@code now()}
     * would give a different response body to two requests a millisecond apart, which
     * defeats the ETag entirely: every conditional request would revalidate to a 200
     * and the cache would buy nothing on the one sort most likely to be a landing
     * page. Truncating to the cache window makes the first page byte-identical for
     * everybody inside it.
     *
     * <p>It also has to be truncated for a second reason. The cursor pins this instant
     * so that page two scores the same campaigns the same way as page one; an instant
     * with millisecond resolution would make every scroll a unique cache key.
     */
    private static final Duration POPULARITY_BUCKET = Duration.ofSeconds(60);

    /**
     * Pledge velocity with time decay, as {@code numeric}.
     *
     * <p>Money raised over a power of the campaign's age in hours. The {@code + 2}
     * stops a campaign that launched a moment ago from dividing by nothing, and the
     * exponent of 1.5 is the gravity constant this shape of ranking is usually written
     * with — steep enough that a month-old campaign does not sit on the front page for
     * ever, shallow enough that a campaign has more than a day to be noticed.
     *
     * <p>{@code numeric} rather than {@code double precision} at every step. The value
     * is compared for exact equality by the keyset predicate, and a float that two
     * evaluations of the same expression round differently would make a scroll skip a
     * row. Rounding to six places is what makes that equality reliable rather than
     * merely likely.
     *
     * <p><strong>{@code a * sqrt(a)} rather than {@code power(a, 1.5)}, and the age in
     * whole hours.</strong> They are the same number and they are not the same cost:
     * {@code numeric_power} with a fractional exponent goes through {@code ln} and
     * {@code exp} at full numeric precision, which measured at roughly sixteen
     * microseconds per row — and the score is projected for every matching row before
     * the sort, so at twenty thousand campaigns that alone was 230ms of a 300ms budget
     * (§20). {@code sqrt} is Newton's method on a numeric and is an order of magnitude
     * cheaper, and flooring the age to an hour keeps its input a small integer instead
     * of a fraction with fifteen decimal places. Both stay exact, which
     * {@code double precision} would not.
     *
     * <p>Flooring the age also makes the score change hourly rather than continuously,
     * which is the right granularity for something described as decay and is one less
     * reason for two requests in one cache window to differ.
     *
     * <p>A campaign that never launched scores zero rather than null, so the order has
     * no null branch to handle.
     */
    private static final String POPULARITY_SCORE =
            """
            CASE WHEN p.launched_at IS NULL THEN 0::numeric ELSE round(
                p.pledged_amount / (
                    (floor(greatest(extract(epoch FROM (:asOf - p.launched_at))::numeric, 0) / 3600) + 2)
                    * sqrt(floor(greatest(extract(epoch FROM (:asOf - p.launched_at))::numeric, 0) / 3600) + 2)
                ), 6)
            END
            """;

    /**
     * The reader's words, folded and parsed into a query. §11.3 and D-01.
     *
     * <p><strong>Folded here rather than in Java</strong> — {@code ideanest_fold} is
     * the same function the index was built with, so the two cannot drift. Folding
     * the query in the application and the document in the database is the failure
     * that produces an empty result set and a 200, which looks exactly like "nothing
     * matched".
     *
     * <p>{@code websearch_to_tsquery} rather than {@code plainto_} or
     * {@code to_tsquery}: it is the only one that takes what a person types into a
     * search box. Punctuation cannot make it throw, quoted phrases mean phrases,
     * {@code or} means or, and a leading {@code -} excludes. {@code to_tsquery} would
     * refuse "robot!" outright, and refusing a search because of an exclamation mark
     * is not a thing to explain to anybody.
     *
     * <p><strong>No prefix expansion.</strong> "robo" does not match "robot" through
     * this: {@code websearch_to_tsquery} produces whole lexemes. Partial words are
     * what {@code /v1/search/suggest} is for (D-02), and near-misses are what the
     * trigram tier below is for (D-03). Rewriting the last term as {@code lexeme:*}
     * would mean building a tsquery string out of user input by concatenation, which
     * is the one shape of this problem that has an injection in it.
     */
    private static final String TEXT_QUERY = "websearch_to_tsquery('simple', ideanest_fold(:text))";

    /**
     * How alike a title has to be to a misspelt query before it is offered. D-03.
     *
     * <p><strong>0.4, and it was measured rather than guessed.</strong>
     * {@code word_similarity(query, title)} rather than {@code similarity} because
     * the second compares whole strings: "robot" against "The Amazing Robot Factory
     * Kit" scores 0.19 as a whole string and 1.00 as a word inside one, and a
     * threshold set for the first would only ever match campaigns with one-word
     * titles.
     *
     * <p>Measured on postgres:16-alpine against realistic Azerbaijani titles, folded:
     *
     * <table>
     *   <caption>word_similarity of a query against a title</caption>
     *   <tr><th>query</th><th>title</th><th>what it is</th><th>score</th></tr>
     *   <tr><td>secenekk</td><td>Seçənək masa oyunu</td><td>one letter added</td><td>0.778</td></tr>
     *   <tr><td>secenk</td><td>Seçənək masa oyunu</td><td>one letter dropped</td><td>0.714</td></tr>
     *   <tr><td>bagce</td><td>Gözəl bağça</td><td>one letter substituted</td><td>0.667</td></tr>
     *   <tr><td>robto</td><td>Robot dostum</td><td>two letters transposed</td><td>0.500</td></tr>
     *   <tr><td>sesenek</td><td>Seçənək masa oyunu</td><td>one letter substituted</td><td>0.455</td></tr>
     *   <tr><td>musiqi</td><td>İşıqlı şəhər</td><td><em>unrelated word</em></td><td>0.143</td></tr>
     *   <tr><td>velosiped</td><td>Gözəl bağça</td><td><em>unrelated word</em></td><td>0.000</td></tr>
     * </table>
     *
     * <p>Every single-character error measured lands at 0.455 or above and every
     * unrelated word at 0.143 or below, so the honest threshold is anywhere in that
     * gap. 0.4 is chosen inside it and nearer the typo end: it is three times the
     * observed noise floor, so a query that resembles nothing returns nothing, which
     * is the failure this tier must not have — a search box that answers gibberish
     * with a page of unrelated campaigns is worse than one that answers it with
     * nothing, because the reader cannot tell that it did not understand.
     *
     * <p>It is not {@code pg_trgm}'s own 0.6 default, which is set for deduplication
     * rather than for typing, and which would reject four of the five errors above.
     */
    private static final String FUZZY_THRESHOLD = "0.4";

    /**
     * One flag per facet dimension, in the order the base CTE projects them.
     *
     * <p>The single list {@link #exceptFlag} subtracts from. Every dimension the facet
     * query knows about is here exactly once; adding one to the CTE without adding it
     * here is a dimension that is applied to its own counts.
     */
    private static final List<String> FACET_FLAGS = List.of(
            "b.m_status", "b.m_taxonomy", "b.m_tags", "b.m_completion",
            "b.m_goal", "b.m_raised", "b.m_location", "b.m_programme", "b.m_featured");

    /**
     * The distance from the origin to every place, computed once. #47.
     *
     * <p><strong>This is the whole performance story of {@link DiscoverySort#NEAR_ME},
     * and it comes straight out of the data model.</strong> Distance is a property of a
     * <em>location</em>, and there are eighteen of those, so the arithmetic belongs on
     * the eighteen-row side of the query rather than on the twenty-thousand-row side.
     * Written the obvious way — the {@code earth_distance} expression inline in the
     * {@code SELECT} list and repeated in the keyset predicate — PostgreSQL evaluates
     * it once per campaign per occurrence, which is four evaluations per row on page
     * two.
     *
     * <p>Measured on postgres:16-alpine against 20,000 publicly visible campaigns, warm:
     *
     * <table>
     *   <caption>near-me, inline expression against this CTE</caption>
     *   <tr><th></th><th>inline</th><th>this</th></tr>
     *   <tr><td>first page</td><td>118.7 ms</td><td><strong>19.7 ms</strong></td></tr>
     *   <tr><td>second page (keyset)</td><td>199.8 ms</td><td><strong>20.4 ms</strong></td></tr>
     *   <tr><td>first page, radius 100 km</td><td>26.5 ms</td><td><strong>10.3 ms</strong></td></tr>
     * </table>
     *
     * <p>The second effect is larger than the arithmetic saved. With the key a plain
     * column reference the planner can push the {@code LIMIT} into the sort — the plan
     * becomes a <em>top-N heapsort of 36 kB</em> rather than a full quicksort of 2.5 MB
     * across two parallel workers — because a sort key that is an expression over a
     * joined row is not something it will do that for.
     *
     * <p>{@code MATERIALIZED} is explicit for the same reason the facet query's base CTE
     * says it: without it the planner is free to inline the CTE, and inlining puts the
     * expression back where it started.
     */
    private static final String LOCATION_DISTANCE_CTE = "WITH location_distance AS MATERIALIZED ("
            + "SELECT l.id, " + distanceMetres("l") + " AS metres FROM locations l) ";

    /**
     * How the {@link DiscoverySort#NEAR_ME} feed reaches {@link #LOCATION_DISTANCE_CTE}.
     *
     * <p>A {@code LEFT} join, and only on the one order that needs it: a campaign with
     * no location has to survive to be sorted last (see {@link DiscoverySort#NEAR_ME}),
     * and adding the join to every feed would put a table nothing else reads into the
     * plan of the platform's hottest query.
     */
    private static final String LOCATION_JOIN =
            " LEFT JOIN location_distance ld ON ld.id = p.location_id";

    /** The projected distance, which is also the keyset's key. See {@link #LOCATION_DISTANCE_CTE}. */
    private static final String DISTANCE_COLUMN = "ld.metres";

    /**
     * Facet dimensions whose {@code extra} column is a display label, not a key part.
     *
     * <p>A subcategory's {@code extra} is the other half of its identity — slugs are
     * unique within a parent and not globally — and a tag's and a city's is the word to
     * render. Two meanings for one column, which is why the list is written down rather
     * than checked with an {@code ||} that the third such dimension would be left out
     * of.
     */
    private static final Set<String> LABEL_BEARING = Set.of("tag", "city", "country");

    private final NamedParameterJdbcTemplate jdbc;
    private final Taxonomy taxonomy;
    private final CuratedCollections collections;
    private final RankingWeightStore rankingWeights;
    private final Clock clock;

    public PostgresSearchService(
            NamedParameterJdbcTemplate jdbc,
            Taxonomy taxonomy,
            CuratedCollections collections,
            RankingWeightStore rankingWeights,
            Clock clock) {
        this.jdbc = jdbc;
        this.taxonomy = taxonomy;
        this.collections = collections;
        this.rankingWeights = rankingWeights;
        this.clock = clock;
    }

    /**
     * Free text, curation, and nothing else yet. See the class comment and
     * {@link DiscoveryCapability}.
     *
     * <p>The set is the whole of this class's public promise, and it is a claim the
     * tests hold it to: a capability announced here without an implementation behind
     * it fails the suite that pins each refusal, and one implemented without being
     * announced is refused by the controller and never reached.
     *
     * <p>{@code FILTER_SAVED} and {@code FILTER_RECOMMENDED} are deliberately still
     * absent. {@code SORT_NEAR_ME}, {@code FILTER_LOCATION} and
     * {@code FILTER_PROXIMITY} were, and are not: #47 brought V16's {@code locations}
     * table, {@code projects.location_id}, and the {@code earthdistance} arithmetic, so
     * all three are served — the sort, the country and city filters, and the bounded
     * radius, on both endpoints and in the facet panel.
     *
     * <p><strong>{@code SORT_RELEVANCE} is here and {@code FILTER_RECOMMENDED} is
     * not, and #44 is why both are true at once.</strong> The composite ranks
     * campaigns; it does not know who is reading. §11.2's {@code w6} — personalisation
     * — has no data source and is seeded inert (V15), and {@code showOnly=recommended}
     * is that term wearing a filter's clothes. Answering it out of the composite would
     * tell every reader that a feed computed identically for all of them had been
     * assembled for them personally, which is a stronger claim than the platform can
     * make and the exact failure {@link DiscoveryCapability} exists to prevent.
     */
    @Override
    public Set<DiscoveryCapability> capabilities() {
        return EnumSet.of(
                DiscoveryCapability.FULL_TEXT,
                DiscoveryCapability.SORT_RELEVANCE,
                DiscoveryCapability.SORT_NEAR_ME,
                DiscoveryCapability.FILTER_LOCATION,
                DiscoveryCapability.FILTER_PROXIMITY,
                DiscoveryCapability.FILTER_FEATURED,
                DiscoveryCapability.FILTER_PROGRAMME);
    }

    @Override
    @Transactional(readOnly = true)
    public DiscoveryPage search(DiscoveryQuery query) {
        Instant asOf = asOf(query);
        boolean exactTier = exactTierMatches(query.text());
        // Taken once, before anything is built, and passed down. A score is a weighted
        // sum, so reading the weights term by term could legitimately build one score
        // out of the configuration from before a change and the configuration from
        // after it -- and the keyset predicate and the projected score are two separate
        // compilations of the same expression, so the window is real rather than
        // theoretical. See RankingWeights.
        RankingWeights weights = weightsFor(query.sort());
        String fingerprint = fingerprintOf(query, weights);
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("asOf", OffsetDateTime.ofInstant(asOf, ZoneOffset.UTC));

        // Built once and used twice -- projected as `sort_score` and repeated inside the
        // keyset predicate, because a SELECT alias is not visible in a WHERE clause. One
        // string rather than two calls, so the two copies are the same characters and
        // cannot drift the way two calls to one builder eventually would.
        String relevance = query.sort() == DiscoverySort.RELEVANCE
                ? relevanceScore(exactTier, query.text(), weights, params)
                : null;
        // #47. Bound once, before anything is built, for the same reason `asOf` is: the
        // origin appears in the projected sort key AND in the keyset predicate, which
        // are two compilations of one expression, and a parameter added by only one of
        // them would make the second page resume from a distance measured from
        // somewhere else.
        if (query.sort() == DiscoverySort.NEAR_ME) {
            bindOrigin(params, query.location().proximity());
        }

        List<String> where = new ArrayList<>();
        where.add(statePredicate("p", DiscoveryStatus.statesFor(query.statuses()), params));
        add(where, textPredicate("p", query, exactTier, params));
        filters("p", query, where, params);

        DiscoveryCursor cursor = query.cursor();
        if (cursor != null) {
            cursor.requireMatches(fingerprint, query.sort());
            where.add(keyset(query.sort(), cursor, exactTier, relevance, params));
        }

        // One more row than asked for. It is not returned; its existence is the only
        // reliable answer to "is there a next page", and asking for it costs one row
        // rather than the COUNT(*) over the whole predicate that the alternative
        // would run on every page of every scroll.
        params.addValue("limit", query.limit() + 1);

        String sql = (query.sort() == DiscoverySort.NEAR_ME ? LOCATION_DISTANCE_CTE : "")
                + "SELECT " + ProjectCardRows.COLUMNS + ", "
                + scoreColumn(query.sort(), exactTier, relevance)
                + ProjectCardRows.FROM
                + (query.sort() == DiscoverySort.NEAR_ME ? LOCATION_JOIN : "")
                + " WHERE " + String.join(" AND ", where)
                + " ORDER BY " + orderBy(query.sort())
                + " LIMIT :limit";

        List<Row> rows = jdbc.query(sql, params, (resultSet, index) -> toRow(resultSet, asOf));

        boolean hasMore = rows.size() > query.limit();
        List<Row> page = hasMore ? rows.subList(0, query.limit()) : rows;
        List<ProjectCard> items = page.stream().map(Row::card).toList();

        DiscoveryCursor next = null;
        if (hasMore && !page.isEmpty()) {
            Row last = page.get(page.size() - 1);
            next = new DiscoveryCursor(
                    fingerprint, query.sort(), sortKey(query.sort(), last), last.card().id(), asOf);
        }
        return new DiscoveryPage(items, next);
    }

    /**
     * The weights this request scores with, or null for the seven orders that do not.
     *
     * <p>Not fetched for the other orders on purpose. {@code RankingWeightStore} caches
     * for a minute and the fetch is cheap, but a {@code sort=newest} feed that queried
     * the ranking configuration would be a dependency nothing needs — and one more thing
     * that has to be working for the default feed to serve.
     */
    private RankingWeights weightsFor(DiscoverySort sort) {
        return sort == DiscoverySort.RELEVANCE ? rankingWeights.current() : null;
    }

    /**
     * What a cursor for this request is bound to.
     *
     * <p>{@code DiscoveryQuery.fingerprint()} is "everything that decides which
     * campaigns are returned and in what order", and under {@code sort=relevance} the
     * weights are part of that and the query object cannot know them. So they are folded
     * in here.
     *
     * <p><strong>Why this rather than tolerating it.</strong> A weight changed between
     * page one and page two reorders the entire feed: every campaign's key means
     * something different, and the keyset resumes from a number that no longer picks out
     * the row it was written for. The result is a scroll that repeats a page or skips
     * one, silently. Refusing it produces {@code DISCOVERY_CURSOR_MISMATCH}, which the
     * client already handles because a filter change produces the same thing — see
     * {@code DiscoveryExceptionHandler}.
     *
     * <p>This is strictly more than #42 pinned. #42 pinned the decay clock in the
     * cursor, which is what stops the score moving on its own between pages, and that is
     * kept — {@link #asOf} still reads the instant back out of the cursor, and the
     * recency term scores against it. What #42 could not have anticipated is a sort key
     * whose <em>definition</em> is mutable at run time, which is what "tunable without a
     * deployment" introduces.
     *
     * <p><strong>What remains, stated plainly.</strong> The composite reads
     * {@code pledged_amount}, which changes whenever anybody pledges, and no cursor can
     * pin that without materialising the whole result set. The property that survives is
     * the one {@code DiscoveryCursor} claims for every order over a mutable column,
     * {@code most_funded} included: a row that moves is seen once or not at all
     * depending on where it moved to, and <strong>no row that stayed still is ever
     * duplicated or dropped</strong>. That is tested, with a campaign whose
     * {@code pledged_amount} changes mid-walk.
     */
    private static String fingerprintOf(DiscoveryQuery query, RankingWeights weights) {
        return weights == null ? query.fingerprint() : query.fingerprint() + "." + weights.version();
    }

    /**
     * Every facet in one round trip.
     *
     * <h2>Shape, and what it costs</h2>
     *
     * <p>A facet that excludes its own dimension cannot share a {@code WHERE} clause
     * with the others, so the obvious implementation is one query per dimension —
     * seven round trips for one panel. Instead a single {@code base} CTE scans the
     * publicly visible campaigns once and tags each row with a boolean per dimension
     * saying whether it matches that dimension's filter. Every facet is then an
     * aggregate over that one materialised set, requiring all the flags except its
     * own, and the seven aggregates are stitched together with {@code UNION ALL} into
     * one statement.
     *
     * <p><strong>Cost.</strong> One pass over the publicly visible campaigns to build
     * {@code base}, plus one hash aggregate per dimension over it, plus one join to
     * {@code project_tags} for the tag facet. Everything the aggregates join against —
     * fifteen categories, a hundred and five subcategories, five bands twice, five
     * statuses — is tiny and static. {@code MATERIALIZED} is explicit rather than left
     * to the planner, because the CTE is referenced seven times and inlining it would
     * turn one scan into seven.
     *
     * <p><strong>Where the ceiling is.</strong> {@code base} is O(public campaigns)
     * and no index removes that: a count over every matching row has to touch every
     * matching row. The partial covering index in V12 keeps it an index-only scan, so
     * the constant is small, but the shape is linear. At §11.1's tier-1 ceiling of
     * roughly ten thousand campaigns this is a few milliseconds. The first thing to do
     * when it stops being is <em>not</em> another index — it is to cache the panel per
     * filter set, because a filter panel changes far less often than a feed page. The
     * second is tier 2, which is exactly the trigger §11.1 names: "or when faceting
     * becomes complex".
     *
     * <p><strong>The one thing that is not in this query</strong> is the localised
     * name of each taxon. Those come from {@link Taxonomy}, which owns the
     * requested-locale → {@code az} → slug fallback chain and would otherwise be
     * reimplemented here in SQL — four small queries against a static tree, against
     * one place that decides what a category is called.
     */
    @Override
    @Transactional(readOnly = true)
    public FacetCounts facets(DiscoveryQuery query) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("asOf", OffsetDateTime.ofInstant(asOf(query), ZoneOffset.UTC));
        // #47's city labels are the one thing in this statement that depends on the
        // language. The taxonomy's names still come from Taxonomy in Java, for the
        // reason at the bottom of this comment; there is no in-memory Locations tree to
        // resolve a place name through, and adding one for a facet label would be a
        // cache to invalidate for eighteen rows.
        params.addValue("locale", query.locale());

        // The base set is every publicly visible campaign, NOT the status-filtered
        // one: the status facet has to be able to count the statuses the caller did
        // not select, which is the whole point of excluding a dimension from its own
        // counts.
        //
        // Free text narrows the base set rather than being a dimension of its own,
        // because there is no facet control for the search box. A panel counted over
        // every campaign on the platform beside a list of the four that match the
        // query would be describing a different result set from the one on screen —
        // see SearchService.facets.
        String publicStates = and(
                statePredicate("p", DiscoveryStatus.LISTED_STATES, params),
                textPredicate("p", query, exactTierMatches(query.text()), params));

        String matchesStatus = query.statuses().isEmpty()
                ? "true"
                : statePredicate("p", DiscoveryStatus.statesFor(query.statuses()), params);
        // Category and subcategory are one dimension for exclusion, not two. A caller
        // who selected "games / tabletop" and was shown category counts computed under
        // the subcategory filter would see zero beside every other category, because
        // no campaign outside Games is filed under Tabletop — the same dead end that
        // excluding the dimension exists to prevent, arriving through the back door.
        String matchesTaxonomy = and(
                categoryPredicate("p", query.categorySlugs(), params),
                subcategoryPredicate("p", query.subcategorySlugs(), params));
        String matchesTags = tagPredicate("p", query.tagSlugs(), params);
        String matchesCompletion = completionPredicate("p", query.completion(), params);
        String matchesGoal = amountPredicate("p.goal_amount", "goalFacet", query.goal(), params);
        String matchesRaised = amountPredicate("p.pledged_amount", "raisedFacet", query.raised(), params);
        // The two dimensions #48 adds. Each is a flag on the base row exactly like the
        // six above, which is what makes "composes with every existing filter" true
        // rather than aspirational: there is no second query and nothing to merge.
        String matchesProgramme = programmePredicate("p", query.programmeSlugs(), params);
        // Country, city and radius are ONE dimension (#47), exactly as category and
        // subcategory are one. §4.3's filter table gives Location a single row naming
        // all three, and they are one control on the panel: a caller who picked a city
        // and was shown country counts computed under the city filter would see zero
        // beside every country but one, which is the dead end excluding a dimension
        // from its own counts exists to prevent.
        String matchesLocation = locationPredicate("p", query.location(), params);
        String matchesFeatured = featuredPredicate("p", query.showOnly());

        String sql = facetSql(
                publicStates, matchesStatus, matchesTaxonomy, matchesTags,
                matchesCompletion, matchesGoal, matchesRaised, matchesLocation,
                matchesProgramme, matchesFeatured, params);

        List<FacetRow> rows = jdbc.query(sql, params, (resultSet, index) -> new FacetRow(
                resultSet.getString("dimension"),
                resultSet.getString("key"),
                resultSet.getString("extra"),
                resultSet.getLong("n")));

        Map<String, Map<String, Long>> counts = new LinkedHashMap<>();
        Map<String, String> tagLabels = new LinkedHashMap<>();
        List<String> tagOrder = new ArrayList<>();
        // The same pair for cities: the resolved name rides in `extra` the way a tag's
        // label does, so it is a label rather than half of a composite key.
        Map<String, String> cityNames = new LinkedHashMap<>();
        for (FacetRow row : rows) {
            if ("tag".equals(row.dimension())) {
                tagLabels.put(row.key(), row.extra());
                tagOrder.add(row.key());
            }
            if ("city".equals(row.dimension())) {
                cityNames.put(row.key(), row.extra());
            }
            // Subcategory slugs are unique per parent and not globally, so a
            // subcategory's key is the pair. Joining them with a character that
            // cannot occur in a slug keeps one flat map rather than a special case.
            String composite = row.extra() == null || LABEL_BEARING.contains(row.dimension())
                    ? row.key()
                    : row.key() + "/" + row.extra();
            counts.computeIfAbsent(row.dimension(), ignored -> new LinkedHashMap<>())
                    .put(composite, row.count());
        }

        return assemble(query.locale(), counts, tagLabels, tagOrder, cityNames);
    }

    // ---------------------------------------------------------------------------
    // Suggestions (D-02)
    // ---------------------------------------------------------------------------

    /**
     * What the reader might mean, from three sources at once.
     *
     * <h2>How a fragment matches</h2>
     *
     * <p>Substring of the folded form, with the prefix matches first. Substring
     * rather than prefix alone because a two-word title is usually remembered by its
     * second word — somebody typing "oyun" is looking for "Seçənək masa oyunu" — and
     * prefix-first because a fragment that starts a name is far more likely to be
     * what was meant than one that appears in the middle of it.
     *
     * <p>{@code LIKE} over {@code ideanest_fold(title)} rather than the
     * {@code tsvector}: a tsvector holds whole lexemes, so "seç" matches nothing in
     * it, and matching a partial word is the entire job here. The trigram index V13
     * creates on that expression is what makes the wildcard-leading pattern an index
     * scan rather than a table scan.
     *
     * <h2>How the three sources share the list</h2>
     *
     * <p>Round robin, in the order category, subcategory, tag, campaign, until the
     * limit is reached. Not concatenation: a fragment matching six categories would
     * otherwise fill a list of ten before a single campaign appeared, and the reader
     * typing the name of a campaign would be shown everything except it. Round robin
     * guarantees every kind that matched at all is represented, which is what makes
     * {@link Suggestion.Kind} worth carrying.
     *
     * <p>The taxonomy is matched in memory rather than in SQL. It is fifteen
     * categories and about a hundred subcategories, it is already loaded per request
     * for the facet labels, and {@link Taxonomy} owns the requested-locale → az →
     * slug fallback chain — reimplementing that chain in a {@code LIKE} over
     * {@code category_translations} would be a second answer to "what is this
     * category called".
     */
    @Override
    @Transactional(readOnly = true)
    public List<Suggestion> suggest(SuggestQuery query) {
        if (!query.isAnswerable()) {
            // A blank or one-character box suggests nothing rather than everything.
            // See SuggestQuery.isAnswerable.
            return List.of();
        }

        String fragment = Slugs.fold(query.text());
        List<Suggestion> categories = new ArrayList<>();
        List<Suggestion> subcategories = new ArrayList<>();
        for (Taxonomy.TaxonomyCategory category : taxonomy.all(query.locale())) {
            if (matches(fragment, category.name(), category.slug())) {
                categories.add(new Suggestion(
                        Suggestion.Kind.CATEGORY, category.name(), category.slug(), null));
            }
            for (Taxonomy.TaxonomySubcategory subcategory : category.subcategories()) {
                if (matches(fragment, subcategory.name(), subcategory.slug())) {
                    subcategories.add(new Suggestion(
                            Suggestion.Kind.SUBCATEGORY, subcategory.name(), subcategory.slug(), category.slug()));
                }
            }
        }

        return interleave(
                query.limit(),
                List.of(categories, subcategories, tagSuggestions(query), campaignSuggestions(query)));
    }

    /** A folded fragment inside a taxon's localised name or its slug. */
    private static boolean matches(String fragment, String name, String slug) {
        return Slugs.fold(name).contains(fragment) || slug.contains(fragment);
    }

    private List<Suggestion> tagSuggestions(SuggestQuery query) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("fragment", likePattern(query.text()));
        params.addValue("limit", query.limit());
        // Label and slug both, because they differ by exactly the fold: a reader
        // typing "ceramics" has to find the tag whose label is "Seramika" through its
        // slug, and one typing "Sər" has to find it through its label.
        return jdbc.query(
                """
                SELECT t.slug, t.label,
                       (ideanest_fold(t.label) LIKE ideanest_fold(:fragment) || '%' ESCAPE '\\'
                        OR t.slug LIKE ideanest_fold(:fragment) || '%' ESCAPE '\\') AS is_prefix
                  FROM tags t
                 WHERE ideanest_fold(t.label) LIKE '%' || ideanest_fold(:fragment) || '%' ESCAPE '\\'
                    OR t.slug LIKE '%' || ideanest_fold(:fragment) || '%' ESCAPE '\\'
                 ORDER BY is_prefix DESC, t.usage_count DESC, t.slug ASC
                 LIMIT :limit
                """,
                params,
                (resultSet, index) -> new Suggestion(
                        Suggestion.Kind.TAG, resultSet.getString("label"), resultSet.getString("slug"), null));
    }

    private List<Suggestion> campaignSuggestions(SuggestQuery query) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("fragment", likePattern(query.text()));
        params.addValue("limit", query.limit());
        params.addValue("states", List.copyOf(DiscoveryStatus.LISTED_STATES));
        // The same visibility predicate as everything else in this class, and for the
        // same reason: a suggestion is a campaign's title shown to whoever is typing,
        // so a draft leaking here leaks exactly as much as one leaking into the feed.
        //
        // Ordered by money raised after the prefix rule, as the closest thing to
        // prominence that exists today — a suggestion list is ten rows and something
        // has to decide which ten. `id` last, so the order is total and two runs of
        // the same keystroke do not reshuffle the dropdown under the reader's finger.
        return jdbc.query(
                """
                SELECT p.slug, p.title, u.slug AS creator_slug,
                       (ideanest_fold(p.title) LIKE ideanest_fold(:fragment) || '%' ESCAPE '\\') AS is_prefix
                  FROM projects p
                  JOIN users u ON u.id = p.creator_id
                 WHERE p.state IN (:states)
                   AND ideanest_fold(p.title) LIKE '%' || ideanest_fold(:fragment) || '%' ESCAPE '\\'
                 ORDER BY is_prefix DESC, p.pledged_amount DESC, p.id ASC
                 LIMIT :limit
                """,
                params,
                (resultSet, index) -> new Suggestion(
                        Suggestion.Kind.CAMPAIGN,
                        resultSet.getString("title"),
                        resultSet.getString("slug"),
                        resultSet.getString("creator_slug")));
    }

    /**
     * The reader's fragment as a {@code LIKE} operand.
     *
     * <p>{@code %}, {@code _} and {@code \} are wildcards to {@code LIKE} and
     * ordinary characters to a person: without this, typing {@code %} into the search
     * box would match every campaign on the platform, and typing {@code _} would match
     * every one whose title is one character longer than the fragment. Escaped here
     * rather than folded away because none of the three is touched by {@code ə→e}.
     *
     * <p>Escaped in Java and folded in SQL, so that the fold still has exactly one
     * implementation.
     */
    private static String likePattern(String fragment) {
        return fragment.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /**
     * One suggestion from each source in turn, until there are enough.
     *
     * <p>See {@link #suggest}: the alternative is that the first source fills the
     * list.
     */
    private static List<Suggestion> interleave(int limit, List<List<Suggestion>> sources) {
        List<Suggestion> merged = new ArrayList<>();
        int deepest = sources.stream().mapToInt(List::size).max().orElse(0);
        for (int depth = 0; depth < deepest && merged.size() < limit; depth++) {
            for (List<Suggestion> source : sources) {
                if (merged.size() >= limit) {
                    break;
                }
                if (depth < source.size()) {
                    merged.add(source.get(depth));
                }
            }
        }
        return List.copyOf(merged);
    }

    // ---------------------------------------------------------------------------
    // The ranking diagnostic (§11.2)
    // ---------------------------------------------------------------------------

    /**
     * One campaign's composite, taken apart term by term.
     *
     * <p><strong>Every number here comes from the expressions the feed orders by.</strong>
     * The per-term columns are {@code RelevanceScore.expressions()} and the total is
     * {@code RelevanceScore.of()} — the same strings, in the same statement, against the
     * same row. An explanation computed a second way would be a plausible story about a
     * position rather than the reason for it, and the day the two drifted somebody would
     * spend an afternoon tuning against a fiction.
     *
     * <p>The clock is the same bucketed instant a feed request would use, so the recency
     * term reported here is the recency term the feed is applying within this cache
     * window rather than one measured a few hundred milliseconds later.
     *
     * <p>Visibility is the same predicate as everything else in this class. A moderator
     * tool is still not a way to read a draft — {@code DiscoveryStatus.LISTED_STATES},
     * always — and a campaign that is not in a feed has no position in one to explain.
     */
    @Override
    @Transactional(readOnly = true)
    public Optional<RankingExplanation> explain(String slug, String text, RankingWeights weights) {
        Instant asOf = bucketedNow();
        boolean exactTier = exactTierMatches(text);
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("asOf", OffsetDateTime.ofInstant(asOf, ZoneOffset.UTC));
        params.addValue("slug", slug);
        params.addValue("states", List.copyOf(DiscoveryStatus.LISTED_STATES));
        if (text != null) {
            params.addValue("text", text);
        }

        String textTerm = RelevanceScore.textTermFor(text == null ? null : textScore("p", exactTier));
        Map<RankingTerm, String> expressions = RelevanceScore.expressions(textTerm);
        Map<RankingTerm, String> aliases = new LinkedHashMap<>();
        List<String> projections = new ArrayList<>();
        int index = 0;
        for (Map.Entry<RankingTerm, String> entry : expressions.entrySet()) {
            String alias = "term_" + index++;
            aliases.put(entry.getKey(), alias);
            projections.add("(" + entry.getValue() + ") AS " + alias);
        }

        String sql = "SELECT p.slug, p.title, (" + RelevanceScore.of(weights, textTerm, params) + ") AS sort_score, "
                + String.join(", ", projections)
                + " FROM projects p WHERE p.slug = :slug AND p.state IN (:states)";

        List<RankingExplanation> found = jdbc.query(sql, params, (resultSet, row) -> {
            List<RankingExplanation.Term> terms = new ArrayList<>();
            for (RankingTerm term : RankingTerm.values()) {
                RankingWeight configured = weights.find(term).orElse(null);
                String alias = aliases.get(term);
                // Null rather than zero for the five terms nothing computes. Zero is a
                // campaign that scores nothing on a term that works, and the difference
                // is the entire point of this endpoint.
                BigDecimal value = alias == null ? null : resultSet.getBigDecimal(alias);
                BigDecimal weight = configured == null ? BigDecimal.ZERO : configured.weight();
                boolean active = configured != null && configured.active();
                BigDecimal contribution = BigDecimal.ZERO;
                if (active && value != null) {
                    BigDecimal product = weight.multiply(value);
                    contribution = term.sign() == RankingTerm.Sign.SUBTRACTS ? product.negate() : product;
                }
                terms.add(new RankingExplanation.Term(
                        term,
                        active,
                        configured == null ? term.blockedBy() : configured.blockedBy(),
                        value,
                        weight,
                        contribution));
            }
            return new RankingExplanation(
                    resultSet.getString("slug"),
                    resultSet.getString("title"),
                    weights.version(),
                    resultSet.getBigDecimal("sort_score"),
                    terms);
        });
        return found.stream().findFirst();
    }

    // ---------------------------------------------------------------------------
    // Filters
    // ---------------------------------------------------------------------------

    /**
     * The predicates a search applies, in the order they narrow hardest first.
     *
     * <p>Every one of them composes with every other because they are AND'd clauses
     * over one table; there is no combination of §4.3's filters that this cannot
     * express, which is what "combinable" in the issue means.
     */
    private static void filters(
            String alias, DiscoveryQuery query, List<String> where, MapSqlParameterSource params) {
        add(where, categoryPredicate(alias, query.categorySlugs(), params));
        add(where, subcategoryPredicate(alias, query.subcategorySlugs(), params));
        add(where, tagPredicate(alias, query.tagSlugs(), params));
        add(where, programmePredicate(alias, query.programmeSlugs(), params));
        add(where, locationPredicate(alias, query.location(), params));
        add(where, featuredPredicate(alias, query.showOnly()));
        add(where, completionPredicate(alias, query.completion(), params));
        add(where, amountPredicate(alias + ".goal_amount", "goal", query.goal(), params));
        add(where, amountPredicate(alias + ".pledged_amount", "raised", query.raised(), params));
    }

    /**
     * D-01 and D-03: the free-text clause, in whichever tier is live.
     *
     * <p>One AND'd predicate over the same table as every other filter, which is what
     * makes "text composes with everything" true rather than aspirational — there is
     * no separate query, no second result set, and nothing to merge.
     *
     * <p>Only one of the two tiers is ever in the SQL. The alternative — emitting
     * both, OR'd, and letting the fuzzy branch pick up what the exact one missed —
     * was measured and rejected: wrapping the two in a {@code CASE} or an {@code OR}
     * makes the whole predicate opaque to the planner, and the plan drops from a
     * bitmap index scan on {@code projects_search_vector_idx} to a sequential scan of
     * the table. The tier is therefore decided before the statement is built, by
     * {@link #exactTierMatches}, and the hot path is left as the single indexable
     * expression it needs to be.
     *
     * @param exactTier from {@link #exactTierMatches}; ignored when there is no text
     */
    private static String textPredicate(
            String alias, DiscoveryQuery query, boolean exactTier, MapSqlParameterSource params) {
        if (query.text() == null) {
            return "true";
        }
        params.addValue("text", query.text());
        if (exactTier) {
            return alias + ".search_vector @@ " + TEXT_QUERY;
        }
        // D-03. The title only: a typo is something a person makes while typing the
        // name of the thing they are looking for, and trigram-matching several
        // thousand words of story would be both expensive and noisy.
        return "word_similarity(ideanest_fold(:text), ideanest_fold(" + alias + ".title)) >= " + FUZZY_THRESHOLD;
    }

    /**
     * The score {@link DiscoverySort#BEST_MATCH} orders by, as {@code numeric}.
     *
     * <p>{@code ts_rank} in the exact tier, with PostgreSQL's default weights
     * {@code {D, C, B, A} = {0.1, 0.2, 0.4, 1.0}} — so a title match scores ten times
     * a story match, which is the whole reason V13 sets weights at all. Trigram
     * similarity in the fuzzy tier, which is the only thing there is to rank by when
     * nothing matched exactly.
     *
     * <p><strong>Rounded to six places and cast to {@code numeric}.</strong> Both
     * functions return {@code real}. The keyset predicate compares the cursor's key to
     * this expression for exact equality, and two evaluations of a float expression
     * that round differently would make a scroll skip a row — the same hazard, and
     * the same fix, as {@link #POPULARITY_SCORE}.
     */
    private static String textScore(String alias, boolean exactTier) {
        return exactTier
                ? "round(ts_rank(" + alias + ".search_vector, " + TEXT_QUERY + ")::numeric, 6)"
                : "round(word_similarity(ideanest_fold(:text), ideanest_fold(" + alias + ".title))::numeric, 6)";
    }

    /**
     * Whether the exact tier finds anything at all, which is what decides D-03.
     *
     * <p><strong>When the fallback engages.</strong> Only here: if the folded query
     * matches the search vector of any publicly visible campaign, the search is served
     * from the {@code tsvector} index and nothing pays for trigrams. If it matches
     * none, and only then, the whole query is re-expressed as a similarity filter. A
     * search that works is therefore never slowed down by a feature that exists for
     * searches that do not.
     *
     * <p>The cost of asking is one probe of {@code projects_search_vector_idx} with a
     * {@code LIMIT 1} behind it, inside the same read-only transaction as the query
     * that follows.
     *
     * <p><strong>It deliberately ignores the caller's filters.</strong> The question
     * is "is this word spelled like something on the platform", not "does this
     * combination of filters match anything" — so {@code ?q=robto&category=games}
     * corrects the spelling and then honestly returns nothing if no games campaign
     * matches. Asking the filtered question instead would turn every over-narrow
     * filter set into a fuzzy search, and the reader who ticked four filters and got
     * approximate matches back would have no way to tell which of the two happened.
     *
     * <p><strong>And it is asked again on every page.</strong> The tier is a function
     * of the query and the data, not of the page, so page two agrees with page one
     * unless a campaign matching the term exactly appeared or disappeared in between —
     * in which case the result set changed anyway, which is the condition every keyset
     * cursor on this platform already lives with.
     *
     * @param text null when the caller sent none, in which case there is no tier and
     *     the answer is unused
     */
    private boolean exactTierMatches(String text) {
        if (text == null) {
            return true;
        }
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("text", text);
        params.addValue("states", List.copyOf(DiscoveryStatus.LISTED_STATES));
        Boolean matched = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM projects p WHERE p.state IN (:states)"
                        + " AND p.search_vector @@ " + TEXT_QUERY + ")",
                params,
                Boolean.class);
        return Boolean.TRUE.equals(matched);
    }

    /**
     * The only clause that is never optional.
     *
     * <p>{@code DiscoveryStatus.statesFor} has already intersected whatever was asked
     * for with the nine states the public may see, so this cannot widen past them
     * however the argument was built.
     */
    private static String statePredicate(String alias, Set<String> states, MapSqlParameterSource params) {
        String name = "states" + params.getValues().size();
        params.addValue(name, List.copyOf(states));
        return alias + ".state IN (:" + name + ")";
    }

    private static String categoryPredicate(String alias, Set<String> slugs, MapSqlParameterSource params) {
        if (slugs.isEmpty()) {
            return "true";
        }
        String name = "categorySlugs" + params.getValues().size();
        params.addValue(name, List.copyOf(slugs));
        // By slug rather than by identifier, because a slug is what is in the URL and
        // in every fixture; V6 says so on the column. A slug nobody has matches
        // nothing, which is the right answer to a filter for a category that does not
        // exist — it is not an error, because a client following a stale link should
        // see an empty feed rather than a 400.
        return alias + ".category_id IN (SELECT id FROM categories WHERE slug IN (:" + name + "))";
    }

    private static String subcategoryPredicate(String alias, Set<String> slugs, MapSqlParameterSource params) {
        if (slugs.isEmpty()) {
            return "true";
        }
        String name = "subcategorySlugs" + params.getValues().size();
        params.addValue(name, List.copyOf(slugs));
        // Subcategory slugs are unique within a parent and not globally (V6), so
        // "festivals" names one row under Film and another under Theatre and this
        // matches both. That is the honest reading of a filter by slug, and a caller
        // who meant one of them sends the category too — the two clauses are AND'd.
        return alias + ".subcategory_id IN (SELECT id FROM subcategories WHERE slug IN (:" + name + "))";
    }

    /**
     * Every named tag, not any of them. See {@code DiscoveryQuery} for why AND.
     *
     * <p>One counting subquery rather than one {@code EXISTS} per tag: the count of
     * matching edges equals the number of tags asked for exactly when the campaign
     * carries all of them, and {@code project_tags} has the pair as its primary key so
     * an edge cannot be counted twice. The probe is by {@code (project_id, tag_id)},
     * which is that primary key.
     */
    private static String tagPredicate(String alias, Set<String> slugs, MapSqlParameterSource params) {
        if (slugs.isEmpty()) {
            return "true";
        }
        String name = "tagSlugs" + params.getValues().size();
        params.addValue(name, List.copyOf(slugs));
        params.addValue(name + "Count", slugs.size());
        return "(SELECT count(*) FROM project_tags pt JOIN tags t ON t.id = pt.tag_id"
                + " WHERE pt.project_id = " + alias + ".id AND t.slug IN (:" + name + ")) = :" + name + "Count";
    }

    /**
     * §4.3's Programmes filter (#48): campaigns in any of these open calls.
     *
     * <p>OR'd rather than AND'd — see {@code DiscoveryQuery} — so this is one
     * {@code EXISTS} over the membership edges rather than the counting probe the tag
     * filter uses. The probe is by {@code (project_id, collection_id)}, which is
     * V14's {@code collection_projects_project_idx}.
     *
     * <p><strong>It names the kind.</strong> A slug is unique across all collections,
     * so the {@code kind} clause changes no result today; it is there because the
     * parameter is called {@code programme} and §4.3 defines a programme as a themed
     * open call. Without it, {@code ?programme=staff-picks} would quietly work, and
     * "filter by the list you were picked for" and "filter by having been picked" are
     * two different questions with two different controls.
     *
     * <p><strong>And it applies the same visibility rule the collection's own page
     * does.</strong> Filtering by an unpublished or expired programme returns nothing
     * rather than its contents, so a slug that leaked from an admin screen is not a
     * way to read a list that has not been published.
     */
    private static String programmePredicate(String alias, Set<String> slugs, MapSqlParameterSource params) {
        if (slugs.isEmpty()) {
            return "true";
        }
        String name = "programmeSlugs" + params.getValues().size();
        params.addValue(name, List.copyOf(slugs));
        return "EXISTS (SELECT 1 FROM collection_projects cp JOIN collections c ON c.id = cp.collection_id"
                + " WHERE cp.project_id = " + alias + ".id"
                + " AND c.slug IN (:" + name + ")"
                + " AND c.kind = 'OPEN_CALL'"
                + " AND c.published_at IS NOT NULL"
                + " AND (c.opens_at IS NULL OR c.opens_at <= now())"
                + " AND (c.closes_at IS NULL OR c.closes_at > now()))";
    }

    /**
     * §4.3's Location filter (#47): country, city, and a bounded radius.
     *
     * <p><strong>One {@code IN} against a subquery over {@code locations}, not a
     * join.</strong> The three controls narrow the same small table — eighteen rows of
     * curated reference data — so the whole filter reduces to "which of these places,
     * and then which campaigns are in one of them". That leaves the predicate on
     * {@code projects} an ordinary membership test that V16's partial
     * {@code projects_discovery_location_idx} serves, and it keeps the geographic
     * arithmetic off the twenty-thousand-row side of the query entirely. It is the same
     * shape {@link #categoryPredicate} uses, and for the same reason.
     *
     * <p><strong>A campaign with no location matches no location filter.</strong>
     * {@code NULL IN (…)} is null and a null predicate excludes the row, which is the
     * answer that is true rather than merely convenient: a campaign whose location is
     * unknown cannot be shown to be in Azerbaijan, in Baku, or within fifty kilometres
     * of anywhere. Under {@link DiscoverySort#NEAR_ME} with no radius the same campaign
     * is <em>ordered</em> last rather than removed, because that is a sort and this is a
     * filter — see that constant.
     *
     * <p><strong>The radius boundary is inclusive, and it is the same number the sort
     * key is.</strong> {@code distance <= radius}, over the identical rounded
     * {@code numeric} expression the order reads, so "inside the circle" and "sorted
     * before the edge" cannot disagree by a floating-point ulp at exactly the boundary.
     * {@code DiscoveryProximityTests} tests the boundary rather than the middle.
     *
     * <p>Country and city are AND'd with each other, unlike the values within either.
     * {@code ?country=AZ&city=baki} means "in Baku, which is in Azerbaijan" — a
     * narrowing, like every other pair of dimensions here — while {@code ?city=baki&city=gence}
     * means either, because a campaign is in one city.
     */
    private static String locationPredicate(
            String alias, LocationFilter location, MapSqlParameterSource params) {
        if (!location.narrows()) {
            return "true";
        }
        String suffix = String.valueOf(params.getValues().size());
        List<String> clauses = new ArrayList<>();
        if (!location.countries().isEmpty()) {
            params.addValue("countryCodes" + suffix, List.copyOf(location.countries()));
            clauses.add("lf.country_code IN (:countryCodes" + suffix + ")");
        }
        if (!location.cities().isEmpty()) {
            // By the folded slug, which is what the binder produced and what V16
            // stores. An unknown slug matches nothing, which is the right answer to a
            // link shared before the gazetteer changed — an empty feed, not a 400.
            params.addValue("citySlugs" + suffix, List.copyOf(location.cities()));
            clauses.add("lf.slug IN (:citySlugs" + suffix + ")");
        }
        LocationFilter.Proximity proximity = location.proximity();
        if (proximity != null && proximity.radiusKilometres() != null) {
            bindOrigin(params, proximity);
            params.addValue("radiusMetres" + suffix, proximity.radiusMetres());
            clauses.add(distanceMetres("lf") + " <= :radiusMetres" + suffix);
        }
        return alias + ".location_id IN (SELECT lf.id FROM locations lf WHERE "
                + String.join(" AND ", clauses) + ")";
    }

    /**
     * Great-circle metres from the request's origin to a location, as {@code numeric}.
     *
     * <p>{@code earth_distance(ll_to_earth(…), ll_to_earth(…))} — V16's
     * {@code earthdistance}, and V16's comment has the whole argument for why that
     * rather than PostGIS. It measures on a sphere of radius 6378168 m, which is under
     * half a percent from a proper spheroid anywhere and about two parts in a thousand
     * at Azerbaijani latitudes, against points that are city centroids.
     *
     * <p><strong>Rounded to three places and cast to {@code numeric}, for the reason
     * {@link #POPULARITY_SCORE} and {@link #textScore} are.</strong>
     * {@code earth_distance} returns {@code double precision}; the keyset predicate
     * compares the cursor's key to this expression for exact equality, and two
     * evaluations of a float expression that round differently would make a scroll skip
     * a row. Three places is a millimetre, which is far below the accuracy of anything
     * being measured and is there only so the equality is reliable rather than likely.
     *
     * <p>Both casts to {@code float8} are explicit. {@code numeric} to
     * {@code double precision} is an implicit cast in PostgreSQL and the call would
     * resolve without them, but a function resolution that depends on an implicit cast
     * is one {@code CREATE FUNCTION} away from resolving to something else.
     *
     * @param alias the {@code locations} alias in whichever statement this is being
     *     built for — {@code l} inside {@link #LOCATION_DISTANCE_CTE}, {@code lf} inside
     *     the radius filter's subquery. One method rather than two strings, so the sort
     *     and the filter cannot come to measure distance differently
     */
    private static String distanceMetres(String alias) {
        return "round(earth_distance("
                + "ll_to_earth(:originLat::float8, :originLon::float8), "
                + "ll_to_earth(" + alias + ".latitude::float8, " + alias + ".longitude::float8)"
                + ")::numeric, 3)";
    }

    /**
     * The origin, bound under the two names {@link #distanceMetres} reads.
     *
     * <p>Fixed names rather than generated ones, because there is exactly one origin
     * per request and the expression appears in up to three places — the projected sort
     * key, the keyset predicate, and the radius filter — which all have to mean the same
     * point. Idempotent, so the order the three are built in does not matter.
     *
     * <p>The value is already quantised: {@code LocationFilter.Proximity} rounds it in
     * its constructor, so nothing at higher precision reaches a statement, a log, or a
     * cache key. See that record for why that is a privacy decision rather than a
     * formatting one.
     */
    private static void bindOrigin(MapSqlParameterSource params, LocationFilter.Proximity proximity) {
        if (proximity == null) {
            // Unreachable: the binder refuses `sort=near_me` with no origin, and the
            // radius filter cannot exist without one. Throwing rather than binding
            // nulls is what keeps that true — nulls would make every distance null and
            // the feed would quietly order by id.
            throw new IllegalStateException("near_me reached the query with no origin");
        }
        params.addValue("originLat", proximity.latitude());
        params.addValue("originLon", proximity.longitude());
    }

    /**
     * §4.3's "Show only: editorially featured" (#48).
     *
     * <p>One {@code EXISTS} against {@code project_editorial_badges}, which is V14's
     * view and the only definition of what "featured" means. Written this way rather
     * than as a column so that this filter, the badge on the card (D-05), the project
     * page header (§4.4), and #44's {@code w4} cannot come to disagree about which
     * campaigns are featured — there is one place to read and one place to change.
     *
     * <p>The other two {@link ShowOnly} values are unreachable here: the controller
     * refuses them through {@link DiscoveryCapability} before a query is built. This
     * method therefore only ever asks about {@code FEATURED}, and it takes no
     * parameters because the view carries the whole predicate.
     */
    private static String featuredPredicate(String alias, Set<ShowOnly> showOnly) {
        if (!showOnly.contains(ShowOnly.FEATURED)) {
            return "true";
        }
        return "EXISTS (SELECT 1 FROM project_editorial_badges b WHERE b.project_id = " + alias + ".id)";
    }

    /**
     * The completion bands, OR'd, compared without dividing.
     *
     * <p>{@code pledged × 100 ≥ goal × lower} rather than {@code pledged / goal ≥ …}:
     * {@code numeric} multiplication is exact, division is not, and
     * {@code projects_goal_is_positive} guarantees the multiplier is positive so the
     * direction of the comparison is preserved. A campaign with no goal is excluded
     * rather than treated as zero percent — it has not asked for anything yet.
     */
    private static String completionPredicate(
            String alias, Set<CompletionBand> bands, MapSqlParameterSource params) {
        if (bands.isEmpty()) {
            return "true";
        }
        List<String> clauses = new ArrayList<>();
        for (CompletionBand band : bands) {
            String prefix = "completion" + band.name() + params.getValues().size();
            params.addValue(prefix + "Lo", band.lowerInclusive());
            String clause = alias + ".pledged_amount * 100 >= " + alias + ".goal_amount * :" + prefix + "Lo";
            if (band.upperExclusive() != null) {
                params.addValue(prefix + "Hi", band.upperExclusive());
                clause += " AND " + alias + ".pledged_amount * 100 < " + alias + ".goal_amount * :" + prefix + "Hi";
            }
            clauses.add("(" + clause + ")");
        }
        return "(" + alias + ".goal_amount IS NOT NULL AND (" + String.join(" OR ", clauses) + "))";
    }

    /** One money dimension: bands OR'd with each other, AND'd with the custom range. */
    private static String amountPredicate(
            String column, String prefix, AmountRange range, MapSqlParameterSource params) {
        if (range.isAny()) {
            return "true";
        }
        List<String> clauses = new ArrayList<>();
        if (!range.bands().isEmpty()) {
            List<String> bandClauses = new ArrayList<>();
            for (AmountBand band : range.bands()) {
                String name = prefix + band.name() + params.getValues().size();
                params.addValue(name + "Lo", band.lowerInclusive());
                String clause = column + " >= :" + name + "Lo";
                if (band.upperExclusive() != null) {
                    params.addValue(name + "Hi", band.upperExclusive());
                    clause += " AND " + column + " < :" + name + "Hi";
                }
                bandClauses.add("(" + clause + ")");
            }
            clauses.add("(" + String.join(" OR ", bandClauses) + ")");
        }
        if (range.minInclusive() != null) {
            String name = prefix + "Min" + params.getValues().size();
            params.addValue(name, range.minInclusive());
            clauses.add(column + " >= :" + name);
        }
        if (range.maxInclusive() != null) {
            String name = prefix + "Max" + params.getValues().size();
            params.addValue(name, range.maxInclusive());
            clauses.add(column + " <= :" + name);
        }
        return "(" + String.join(" AND ", clauses) + ")";
    }

    // ---------------------------------------------------------------------------
    // Ordering and the keyset
    // ---------------------------------------------------------------------------

    /**
     * The order, always ending in {@code id}.
     *
     * <p>{@code NULLS LAST} is written out on both orders that can have a null key.
     * PostgreSQL's default is {@code NULLS FIRST} for {@code DESC} and
     * {@code NULLS LAST} for {@code ASC}, so leaving it implicit would put every
     * campaign that has not launched at the top of the newest feed — and, worse, would
     * disagree with the index in V12, which spells it out.
     */
    private static String orderBy(DiscoverySort sort) {
        return switch (sort) {
            case NEWEST -> "p.launched_at DESC NULLS LAST, p.id ASC";
            case ENDING_SOON -> "p.deadline ASC NULLS LAST, p.id ASC";
            case MOST_FUNDED -> "p.pledged_amount DESC, p.id ASC";
            case MOST_BACKED -> "p.backers_count DESC, p.id ASC";
            // Every order whose key is an expression rather than a column reads it
            // from the projected alias, so the score is computed once per row.
            case POPULARITY, BEST_MATCH, RELEVANCE -> "sort_score DESC, p.id ASC";
            // The only ascending order whose key is an expression: nearest first, and
            // nulls last so a campaign with no location is at the end of the feed
            // rather than the start of it. Spelled out for the reason V12 spells it
            // out on the two column orders — PostgreSQL's default for ASC is already
            // NULLS LAST, and an implicit agreement is one somebody can break by
            // adding a DESC.
            case NEAR_ME -> "sort_score ASC NULLS LAST, p.id ASC";
            // Unreachable for a different reason: `curated` is not a value a client
            // may send (DiscoverySort.isClientSelectable), and the order it names
            // belongs to the collection landing page, which is served by
            // PostgresCuratedCollections and never reaches this class.
            case CURATED -> throw new IllegalStateException(
                    "curated is the collection page's order and has no meaning in a feed");
        };
    }

    /** {@code sort_score} exists on every query so the row mapper has one shape. */
    private static String scoreColumn(DiscoverySort sort, boolean exactTier, String relevance) {
        return switch (sort) {
            case POPULARITY -> "(" + POPULARITY_SCORE + ") AS sort_score";
            case BEST_MATCH -> "(" + textScore("p", exactTier) + ") AS sort_score";
            case RELEVANCE -> "(" + relevance + ") AS sort_score";
            // Null for a campaign with no location — the outer join found no row —
            // which is what puts it in the nulls-last tail rather than at distance
            // zero, the origin.
            case NEAR_ME -> DISTANCE_COLUMN + " AS sort_score";
            case NEWEST, ENDING_SOON, MOST_FUNDED, MOST_BACKED, CURATED ->
                "NULL::numeric AS sort_score";
        };
    }

    /**
     * §11.2's composite, built from the weights this request was pinned to.
     *
     * <p><strong>The text term is {@link #textScore}, unchanged.</strong> That is what
     * #43 said would happen — "{@code best_match} becomes its text term rather than being
     * replaced by it" — and it is a fact about this one line rather than an aspiration:
     * both orders call the same method, so a change to how a title match is ranked
     * changes both, and the two can never come to disagree about what a good text match
     * is. When there is no query the term is a literal zero for every campaign, so
     * {@code sort=relevance} is one expression on a searched feed and on a browsing one.
     */
    private static String relevanceScore(
            boolean exactTier, String text, RankingWeights weights, MapSqlParameterSource params) {
        String textTerm = RelevanceScore.textTermFor(text == null ? null : textScore("p", exactTier));
        return RelevanceScore.of(weights, textTerm, params);
    }

    /**
     * "Everything after this row, in this order."
     *
     * <p>Three shapes, because two of the orders can have a null key and are sorted
     * nulls-last. For those, a cursor whose key is null means the scroll has reached
     * the null tail, and the only rows still to come are other null-keyed rows with a
     * larger id; a cursor whose key is not null means everything strictly after that
     * key, plus the whole null tail, plus the ties broken by id.
     *
     * <p>Getting this wrong is not a slow feed, it is a wrong one: dropping the
     * {@code IS NULL} branch loses every unlaunched campaign from the second page
     * onwards, and dropping the {@code id} branch loses every row that shares a key
     * with the last row of the previous page.
     */
    private static String keyset(
            DiscoverySort sort,
            DiscoveryCursor cursor,
            boolean exactTier,
            String relevance,
            MapSqlParameterSource params) {
        params.addValue("cursorId", cursor.id());
        String key = cursor.sortKey();
        return switch (sort) {
            case NEWEST -> nullableKeyset("p.launched_at", "<", instant(key), params);
            case ENDING_SOON -> nullableKeyset("p.deadline", ">", instant(key), params);
            case MOST_FUNDED -> presentKeyset("p.pledged_amount", decimal(key), params);
            case MOST_BACKED -> presentKeyset("p.backers_count", integer(key), params);
            case POPULARITY -> presentKeyset("(" + POPULARITY_SCORE + ")", decimal(key), params);
            // The score is repeated here rather than referenced as `sort_score`: a
            // SELECT alias is not visible in the WHERE clause, which is evaluated
            // first. Both copies come from textScore, so they cannot disagree.
            case BEST_MATCH -> presentKeyset("(" + textScore("p", exactTier) + ")", decimal(key), params);
            // The composite, repeated for the same reason and out of the same string
            // the SELECT list projects -- so the two are the same characters rather than
            // two builds of one expression that a future edit could separate.
            case RELEVANCE -> presentKeyset("(" + relevance + ")", decimal(key), params);
            // Ascending and nullable, which is `ending_soon`'s shape rather than
            // `popularity`'s: ">" resumes after a distance, and the null branch is the
            // tail of campaigns with no location. Getting the null branch wrong here
            // would drop every unlocated campaign from the second page onwards, which
            // is exactly what deciding to sort them last rather than exclude them was
            // meant to avoid.
            // And unlike every other computed key here, this one is a plain column
            // reference rather than the expression repeated: the CTE already holds it.
            // Measured, that is the difference between 199.8 ms and 20.4 ms on page two
            // — see LOCATION_DISTANCE_CTE.
            case NEAR_ME -> nullableKeyset(DISTANCE_COLUMN, ">", decimal(key), params);
            case CURATED -> throw new IllegalStateException(
                    "curated is the collection page's order and has no meaning in a feed");
        };
    }

    private static String nullableKeyset(
            String column, String comparison, Object key, MapSqlParameterSource params) {
        if (key == null) {
            return "(" + column + " IS NULL AND p.id > :cursorId)";
        }
        params.addValue("cursorKey", key);
        return "(" + column + " " + comparison + " :cursorKey"
                + " OR " + column + " IS NULL"
                + " OR (" + column + " = :cursorKey AND p.id > :cursorId))";
    }

    private static String presentKeyset(String column, Object key, MapSqlParameterSource params) {
        if (key == null) {
            // A cursor for an order whose key is NOT NULL, carrying no key, is a
            // cursor this service did not write.
            throw InvalidCursorException.undecodable(
                    "That cursor is not a cursor this service issued.");
        }
        params.addValue("cursorKey", key);
        return "(" + column + " < :cursorKey OR (" + column + " = :cursorKey AND p.id > :cursorId))";
    }

    private static OffsetDateTime instant(String key) {
        if (key == null) {
            return null;
        }
        try {
            return OffsetDateTime.ofInstant(Instant.parse(key), ZoneOffset.UTC);
        } catch (DateTimeParseException e) {
            throw InvalidCursorException.undecodable(
                    "That cursor is not a cursor this service issued.");
        }
    }

    private static BigDecimal decimal(String key) {
        if (key == null) {
            return null;
        }
        try {
            return new BigDecimal(key);
        } catch (NumberFormatException e) {
            throw InvalidCursorException.undecodable(
                    "That cursor is not a cursor this service issued.");
        }
    }

    private static Integer integer(String key) {
        if (key == null) {
            return null;
        }
        try {
            return Integer.valueOf(key);
        } catch (NumberFormatException e) {
            throw InvalidCursorException.undecodable(
                    "That cursor is not a cursor this service issued.");
        }
    }

    /** The key of the last row on this page, as the cursor stores it. */
    private static String sortKey(DiscoverySort sort, Row row) {
        ProjectCard card = row.card();
        return switch (sort) {
            case NEWEST -> card.launchedAt() == null ? null : card.launchedAt().toString();
            case ENDING_SOON -> card.deadline() == null ? null : card.deadline().toString();
            case MOST_FUNDED -> card.pledged().amount().toPlainString();
            case MOST_BACKED -> Integer.toString(card.backersCount());
            case POPULARITY, BEST_MATCH, RELEVANCE -> row.score().toPlainString();
            // The only computed key that can be null: a campaign with no location. The
            // cursor encoding distinguishes "no key" from "an empty key" with a
            // presence flag, so the null tail pages correctly. See DiscoveryCursor.
            case NEAR_ME -> row.score() == null ? null : row.score().toPlainString();
            case CURATED -> throw new IllegalStateException(
                    "curated is the collection page's order and has no meaning in a feed");
        };
    }

    /**
     * The instant this request scores and counts down from.
     *
     * <p>Taken from the cursor when there is one, so that every page of a scroll
     * agrees; truncated to {@link #POPULARITY_BUCKET} otherwise, so that two requests
     * inside one cache window produce the same bytes.
     */
    private Instant asOf(DiscoveryQuery query) {
        if (query.cursor() != null) {
            return query.cursor().asOf();
        }
        return bucketedNow();
    }

    /** Now, truncated to {@link #POPULARITY_BUCKET}. See {@link #asOf}. */
    private Instant bucketedNow() {
        long seconds = POPULARITY_BUCKET.toSeconds();
        Instant now = clock.instant();
        return Instant.ofEpochSecond(Math.floorDiv(now.getEpochSecond(), seconds) * seconds);
    }

    // ---------------------------------------------------------------------------
    // Rows
    // ---------------------------------------------------------------------------

    /**
     * A card, and the sort key that produced it.
     *
     * @param score null except under {@link DiscoverySort#POPULARITY},
     *     {@link DiscoverySort#BEST_MATCH} and {@link DiscoverySort#RELEVANCE}, the
     *     three orders whose key is computed by the database and cannot be recovered
     *     from the card
     */
    private record Row(ProjectCard card, BigDecimal score) {
    }

    /** One line of the facet query, before it is sorted back into dimensions. */
    private record FacetRow(String dimension, String key, String extra, long count) {
    }

    private static Row toRow(ResultSet resultSet, Instant asOf) throws SQLException {
        return new Row(ProjectCardRows.card(resultSet, asOf), resultSet.getBigDecimal("sort_score"));
    }

    // ---------------------------------------------------------------------------
    // Facets
    // ---------------------------------------------------------------------------

    private static String facetSql(
            String publicStates,
            String matchesStatus,
            String matchesTaxonomy,
            String matchesTags,
            String matchesCompletion,
            String matchesGoal,
            String matchesRaised,
            String matchesLocation,
            String matchesProgramme,
            String matchesFeatured,
            MapSqlParameterSource params) {

        String statusValues = statusValues(params);
        String completionValues = bandValues(params, "completionBand", completionRows());
        String amountValues = bandValues(params, "amountBand", amountRows());

        // Every facet requires all the flags except its own. Derived from one list
        // rather than written out eight times, which is the change #48 forced: with
        // six dimensions the eight-term conjunctions were readable, and with eight
        // they are eight nearly identical lines in which a missing term is invisible.
        // The dropped dimension is still named at each call site, which is the part a
        // reader needs to see.
        String exceptStatus = exceptFlag("b.m_status");
        String exceptTaxonomy = exceptFlag("b.m_taxonomy");
        String exceptTags = exceptFlag("b.m_tags");
        String exceptCompletion = exceptFlag("b.m_completion");
        String exceptGoal = exceptFlag("b.m_goal");
        String exceptRaised = exceptFlag("b.m_raised");
        // One name, used by both the country facet and the city facet, because §4.3
        // gives Location one row and one control. See `matchesLocation`.
        String exceptLocation = exceptFlag("b.m_location");
        String exceptProgramme = exceptFlag("b.m_programme");
        String exceptFeatured = exceptFlag("b.m_featured");

        return """
               WITH base AS MATERIALIZED (
                   SELECT p.id, p.state, p.category_id, p.subcategory_id, p.location_id,
                          p.goal_amount, p.pledged_amount,
                          (%s) AS m_status,
                          (%s) AS m_taxonomy,
                          (%s) AS m_tags,
                          (%s) AS m_completion,
                          (%s) AS m_goal,
                          (%s) AS m_raised,
                          (%s) AS m_location,
                          (%s) AS m_programme,
                          (%s) AS m_featured
                     FROM projects p
                    WHERE %s
               ),
               status_map (value, state) AS (VALUES %s),
               completion_bands (value, lo, hi) AS (VALUES %s),
               amount_bands (value, lo, hi) AS (VALUES %s)
               SELECT 'status'::text AS dimension, sm.value AS key, NULL::text AS extra, count(b.id) AS n
                 FROM status_map sm
                 LEFT JOIN base b ON b.state = sm.state AND %s
                GROUP BY sm.value
               UNION ALL
               SELECT 'category'::text, c.slug, NULL::text, count(b.id)
                 FROM categories c
                 LEFT JOIN base b ON b.category_id = c.id AND %s
                GROUP BY c.slug
               UNION ALL
               SELECT 'subcategory'::text, c.slug, s.slug, count(b.id)
                 FROM subcategories s
                 JOIN categories c ON c.id = s.parent_id
                 LEFT JOIN base b ON b.subcategory_id = s.id AND %s
                GROUP BY c.slug, s.slug
               UNION ALL
               SELECT * FROM (
                   SELECT 'tag'::text AS dimension, t.slug, t.label, count(*) AS n
                     FROM base b
                     JOIN project_tags pt ON pt.project_id = b.id
                     JOIN tags t ON t.id = pt.tag_id
                    WHERE %s
                    GROUP BY t.slug, t.label
                    ORDER BY count(*) DESC, t.slug ASC
                    LIMIT %d
               ) AS ranked_tags
               UNION ALL
               SELECT 'completion'::text, cb.value, NULL::text, count(b.id)
                 FROM completion_bands cb
                 LEFT JOIN base b
                   ON b.goal_amount IS NOT NULL
                  AND b.pledged_amount * 100 >= b.goal_amount * cb.lo
                  AND (cb.hi IS NULL OR b.pledged_amount * 100 < b.goal_amount * cb.hi)
                  AND %s
                GROUP BY cb.value
               UNION ALL
               SELECT 'goal'::text, ab.value, NULL::text, count(b.id)
                 FROM amount_bands ab
                 LEFT JOIN base b
                   ON b.goal_amount >= ab.lo
                  AND (ab.hi IS NULL OR b.goal_amount < ab.hi)
                  AND %s
                GROUP BY ab.value
               UNION ALL
               SELECT 'raised'::text, ab.value, NULL::text, count(b.id)
                 FROM amount_bands ab
                 LEFT JOIN base b
                   ON b.pledged_amount >= ab.lo
                  AND (ab.hi IS NULL OR b.pledged_amount < ab.hi)
                  AND %s
                GROUP BY ab.value
               UNION ALL
               -- §4.3's Location control, outer half (#47). Left-joined from
               -- `locations` and grouped by country, so a country with no visible
               -- campaigns comes back as a zero rather than as a missing row: this is
               -- curated reference data with a short vocabulary, which is the
               -- programme rule rather than the tag rule.
               --
               -- The label is the ISO code itself. Every client platform ships a
               -- localised country-name table and §21.1 says to use the platform
               -- internationalisation APIs, so the server does not keep a second one in
               -- four languages.
               SELECT 'country'::text, l.country_code, l.country_code, count(b.id)
                 FROM locations l
                 LEFT JOIN base b ON b.location_id = l.id AND %s
                GROUP BY l.country_code
               UNION ALL
               -- The inner half. The name is the requested locale, then `az`, then the
               -- slug -- the chain `Taxonomy` resolves a category through, with the
               -- endonym rather than English as the fallback, which is the right
               -- default for a proper noun. Resolved in SQL rather than in Java because
               -- there is no in-memory Locations tree to resolve it through and adding
               -- one for a facet label would be a cache to invalidate.
               --
               -- WHERE THE CEILING IS. This is a fixed vocabulary and returns every
               -- place, zeros included, because a filter control that vanishes when its
               -- count reaches zero is a control that moves under the reader's cursor.
               -- That holds while the gazetteer is a curated list of the places a
               -- campaign can be in. The day it becomes a real world city list -- order
               -- 10^5 rows -- the control stops being a list and becomes a search box,
               -- and this becomes a top-N like the tag facet. That is the trigger, and
               -- it is a product change rather than a query optimisation.
               SELECT 'city'::text, l.slug, COALESCE(lt.name, laz.name, l.slug), count(b.id)
                 FROM locations l
                 LEFT JOIN location_translations lt ON lt.location_id = l.id AND lt.locale = :locale
                 LEFT JOIN location_translations laz ON laz.location_id = l.id AND laz.locale = 'az'
                 LEFT JOIN base b ON b.location_id = l.id AND %s
                GROUP BY l.slug, COALESCE(lt.name, laz.name, l.slug)
               UNION ALL
               -- §4.3's Programmes control. Left-joined from `collections` rather than
               -- grouped out of `base`, so an open call with nothing visible in it
               -- still comes back with a zero: the vocabulary is short and curated,
               -- and a control that vanishes when its count reaches zero is a control
               -- that moves under the reader's cursor. Tags are the opposite case and
               -- are grouped out of `base` above, because that vocabulary is free.
               SELECT 'programme'::text, oc.slug, NULL::text, count(b.id)
                 FROM collections oc
                 LEFT JOIN collection_projects ocp ON ocp.collection_id = oc.id
                 LEFT JOIN base b ON b.id = ocp.project_id AND %s
                WHERE oc.kind = 'OPEN_CALL'
                  AND oc.published_at IS NOT NULL
                  AND (oc.opens_at IS NULL OR oc.opens_at <= now())
                  AND (oc.closes_at IS NULL OR oc.closes_at > now())
                GROUP BY oc.slug
               UNION ALL
               -- §4.3's "Show only" control, which has exactly one countable value.
               -- An aggregate with no GROUP BY always returns one row, so this is a
               -- zero rather than a missing entry when nothing is featured.
               SELECT 'showOnly'::text, 'featured'::text, NULL::text, count(*)
                 FROM base b
                WHERE %s
                  AND EXISTS (SELECT 1 FROM project_editorial_badges peb WHERE peb.project_id = b.id)
               """
                .formatted(
                        matchesStatus,
                        matchesTaxonomy,
                        matchesTags,
                        matchesCompletion,
                        matchesGoal,
                        matchesRaised,
                        matchesLocation,
                        matchesProgramme,
                        matchesFeatured,
                        publicStates,
                        statusValues,
                        completionValues,
                        amountValues,
                        exceptStatus,
                        exceptTaxonomy,
                        exceptTaxonomy,
                        exceptTags,
                        FacetCounts.TAG_LIMIT,
                        exceptCompletion,
                        exceptGoal,
                        exceptRaised,
                        exceptLocation,
                        exceptLocation,
                        exceptProgramme,
                        exceptFeatured);
    }

    /**
     * The flags every facet but one requires.
     *
     * <p>The exclude-own-dimension rule of {@link FacetCounts}, as a list minus one
     * entry. A dimension added to the base CTE and forgotten here would silently be
     * applied to its own counts, which is the dead-end panel that rule exists to
     * prevent, so there is one list and it is this one.
     */
    private static String exceptFlag(String dropped) {
        List<String> kept = new ArrayList<>(FACET_FLAGS);
        if (!kept.remove(dropped)) {
            // A typo in a flag name would otherwise produce a panel that looks right
            // and counts the wrong thing.
            throw new IllegalArgumentException(dropped + " is not a facet dimension");
        }
        return String.join(" AND ", kept);
    }

    /**
     * A {@code VALUES} list of one row per (grouping, state) pair.
     *
     * <p>A pair rather than a grouping with a list, so that a state belonging to two
     * groupings — {@code LATE_PLEDGE} is both late-pledging and successful — is
     * counted in both without the query having to know that it is.
     *
     * <p>Bound rather than interpolated even though every value comes from an enum in
     * this package. A literal built by concatenation is a habit, and the next person
     * to reach for it will have something that is not from an enum.
     */
    private static String statusValues(MapSqlParameterSource params) {
        List<String> rendered = new ArrayList<>();
        int index = 0;
        for (DiscoveryStatus status : DiscoveryStatus.values()) {
            for (String state : status.states()) {
                String valueName = "statusValue" + index;
                String stateName = "statusState" + index;
                params.addValue(valueName, status.wireValue());
                params.addValue(stateName, state);
                // The first row of a VALUES list decides the column types, and a bound
                // parameter has none until it is told. Without the casts PostgreSQL
                // refuses the statement outright.
                rendered.add("(:" + valueName + "::text, :" + stateName + "::text)");
                index++;
            }
        }
        return String.join(", ", rendered);
    }

    private static List<List<Object>> completionRows() {
        List<List<Object>> rows = new ArrayList<>();
        for (CompletionBand band : CompletionBand.values()) {
            rows.add(row(band.wireValue(), band.lowerInclusive(), band.upperExclusive()));
        }
        return rows;
    }

    private static List<List<Object>> amountRows() {
        List<List<Object>> rows = new ArrayList<>();
        for (AmountBand band : AmountBand.values()) {
            rows.add(row(band.wireValue(), band.lowerInclusive(), band.upperExclusive()));
        }
        return rows;
    }

    /** A three-column band row; the upper bound is null on the open-ended band. */
    private static List<Object> row(String value, BigDecimal lower, BigDecimal upper) {
        List<Object> cells = new ArrayList<>();
        cells.add(value);
        cells.add(lower);
        cells.add(upper);
        return cells;
    }

    /** The same, for the band lists, whose second and third columns are numeric. */
    private static String bandValues(MapSqlParameterSource params, String prefix, List<List<Object>> rows) {
        List<String> rendered = new ArrayList<>();
        for (int r = 0; r < rows.size(); r++) {
            List<Object> row = rows.get(r);
            String valueName = prefix + r + "_v";
            String loName = prefix + r + "_lo";
            String hiName = prefix + r + "_hi";
            params.addValue(valueName, row.get(0));
            params.addValue(loName, row.get(1));
            params.addValue(hiName, row.get(2));
            rendered.add("(:" + valueName + "::text, :" + loName + "::numeric, :" + hiName + "::numeric)");
        }
        return String.join(", ", rendered);
    }

    /**
     * The counts, with the taxonomy's names and every zero-count value put back.
     *
     * <p>A dimension with a fixed vocabulary answers for all of its values, whether or
     * not the query produced a row for each: a filter control that vanishes when its
     * count reaches zero is a control that moves under the reader's cursor.
     */
    private FacetCounts assemble(
            String locale,
            Map<String, Map<String, Long>> counts,
            Map<String, String> tagLabels,
            List<String> tagOrder,
            Map<String, String> cityNames) {

        Map<String, Long> statuses = counts.getOrDefault("status", Map.of());
        Map<String, Long> categories = counts.getOrDefault("category", Map.of());
        Map<String, Long> subcategories = counts.getOrDefault("subcategory", Map.of());
        Map<String, Long> tags = counts.getOrDefault("tag", Map.of());
        Map<String, Long> completion = counts.getOrDefault("completion", Map.of());
        Map<String, Long> goal = counts.getOrDefault("goal", Map.of());
        Map<String, Long> raised = counts.getOrDefault("raised", Map.of());
        Map<String, Long> countries = counts.getOrDefault("country", Map.of());
        Map<String, Long> cities = counts.getOrDefault("city", Map.of());
        Map<String, Long> programmes = counts.getOrDefault("programme", Map.of());
        Map<String, Long> showOnly = counts.getOrDefault("showOnly", Map.of());

        List<FacetCounts.CategoryCount> categoryCounts = new ArrayList<>();
        for (Taxonomy.TaxonomyCategory category : taxonomy.all(locale)) {
            List<FacetCounts.NamedCount> children = new ArrayList<>();
            for (Taxonomy.TaxonomySubcategory subcategory : category.subcategories()) {
                children.add(new FacetCounts.NamedCount(
                        subcategory.slug(),
                        subcategory.name(),
                        subcategories.getOrDefault(category.slug() + "/" + subcategory.slug(), 0L)));
            }
            categoryCounts.add(new FacetCounts.CategoryCount(
                    category.slug(), category.name(), categories.getOrDefault(category.slug(), 0L), children));
        }

        List<FacetCounts.NamedCount> tagCounts = new ArrayList<>();
        for (String slug : tagOrder) {
            tagCounts.add(new FacetCounts.NamedCount(slug, tagLabels.get(slug), tags.getOrDefault(slug, 0L)));
        }

        // §4.3's Location control (#47), sorted here rather than in SQL. Sorted by the
        // stable handle rather than by the count, deliberately: this is a fixed
        // vocabulary, and a control whose entries reorder as campaigns are pledged to
        // is a control that moves under the reader's cursor — the same rule that keeps
        // the zero-count entries present. The folded slug is very nearly Azerbaijani
        // alphabetical order, which is the order a list of cities should be in.
        List<FacetCounts.NamedCount> countryCounts = new ArrayList<>();
        for (String code : new java.util.TreeSet<>(countries.keySet())) {
            countryCounts.add(new FacetCounts.NamedCount(code, code, countries.get(code)));
        }
        List<FacetCounts.NamedCount> cityCounts = new ArrayList<>();
        for (String slug : new java.util.TreeSet<>(cities.keySet())) {
            cityCounts.add(new FacetCounts.NamedCount(slug, cityNames.getOrDefault(slug, slug), cities.get(slug)));
        }

        // The programme control, named in the reader's language and in the order the
        // collections index lists them. The titles come from CuratedCollections for
        // the reason the category names come from Taxonomy: that class owns the
        // requested-locale → az → slug chain, and resolving it a second time in SQL
        // would be a second answer to "what is this open call called".
        List<FacetCounts.NamedCount> programmeCounts = new ArrayList<>();
        for (Map.Entry<String, String> programme :
                collections.visibleTitles(CollectionKind.OPEN_CALL, locale).entrySet()) {
            programmeCounts.add(new FacetCounts.NamedCount(
                    programme.getKey(), programme.getValue(), programmes.getOrDefault(programme.getKey(), 0L)));
        }

        return new FacetCounts(
                fixedVocabulary(DiscoveryStatus.wireValues(), statuses),
                categoryCounts,
                tagCounts,
                fixedVocabulary(CompletionBand.wireValues(), completion),
                fixedVocabulary(AmountBand.wireValues(), goal),
                fixedVocabulary(AmountBand.wireValues(), raised),
                countryCounts,
                cityCounts,
                programmeCounts,
                // One value, deliberately. See FacetCounts: `saved` is per-caller and
                // `recommended` is #44, and a zero for either would say the platform
                // has none rather than that it cannot count them.
                fixedVocabulary(List.of(ShowOnly.FEATURED.wireValue()), showOnly));
    }

    private static List<FacetCounts.ValueCount> fixedVocabulary(List<String> values, Map<String, Long> counts) {
        List<FacetCounts.ValueCount> result = new ArrayList<>();
        for (String value : values) {
            result.add(new FacetCounts.ValueCount(value, counts.getOrDefault(value, 0L)));
        }
        return result;
    }

    // ---------------------------------------------------------------------------

    private static void add(List<String> where, String clause) {
        if (!"true".equals(clause)) {
            where.add(clause);
        }
    }

    private static String and(String left, String right) {
        if ("true".equals(left)) {
            return right;
        }
        if ("true".equals(right)) {
            return left;
        }
        return "(" + left + " AND " + right + ")";
    }
}
