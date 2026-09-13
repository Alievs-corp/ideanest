package az.ideanest.discovery.infrastructure;

import az.ideanest.discovery.application.CuratedCollections;
import az.ideanest.discovery.application.DiscoveryPage;
import az.ideanest.discovery.domain.CollectionKind;
import az.ideanest.discovery.domain.CuratedCollection;
import az.ideanest.discovery.domain.DiscoveryCursor;
import az.ideanest.discovery.domain.DiscoverySort;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.InvalidCursorException;
import az.ideanest.discovery.domain.ProjectCard;
import az.ideanest.project.application.Taxonomy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * D-08's collections and open-call landing pages, read from PostgreSQL.
 *
 * <p>Raw SQL and a projection rather than the module's first JPA entity, for the two
 * reasons {@code PostgresSearchService} gives: this module is a read model, and a
 * landing page of a hundred cards loaded as managed entities is a hundred object
 * graphs for fourteen columns.
 *
 * <h2>The visibility predicate</h2>
 *
 * <p>There are two of them and they compose, which is the thing to keep hold of while
 * reading this class. A <strong>collection</strong> is visible when it is published
 * and {@code now()} is inside its window; a <strong>campaign inside it</strong> is
 * visible under {@code DiscoveryStatus.LISTED_STATES}, exactly as everywhere else in
 * discovery. Neither implies the other, and the second is the one that is easy to
 * forget: a curator adds a campaign, trust and safety suspends it a week later, and
 * the membership row is still there. It stays there deliberately — deleting it would
 * rewrite the editorial record to say the campaign was never chosen — so the read is
 * what has to exclude it, from the cards and from the count alike.
 */
@Service
public class PostgresCuratedCollections implements CuratedCollections {

    /**
     * How coarse the instant {@code daysLeft} is measured against is.
     *
     * <p>The same sixty seconds {@code PostgresSearchService} buckets to, and for the
     * same reason: two requests inside one cache window have to produce the same bytes
     * or the ETag revalidates to a 200 every time and buys nothing.
     */
    private static final Duration DAYS_LEFT_BUCKET = Duration.ofSeconds(60);

    /**
     * When the public may see a collection at all.
     *
     * <p>Written once and used by every read here, because the failure mode of a
     * second copy is a query that forgot the window and served last spring's expired
     * theme from one endpoint while another 404s it. V14's
     * {@code project_editorial_badges} view carries the same three clauses for the same
     * reason and is the third copy — unavoidable, because it is a view definition, and
     * pinned by {@code CollectionApiTests} against this one.
     */
    private static final String VISIBLE =
            """
            c.published_at IS NOT NULL
            AND (c.opens_at IS NULL OR c.opens_at <= now())
            AND (c.closes_at IS NULL OR c.closes_at > now())
            """;

    /**
     * The collection's own columns, and how many publicly visible campaigns are in it.
     *
     * <p>The count is a correlated subquery rather than a join and a {@code GROUP BY}:
     * the outer query returns tens of rows, the inner one probes
     * {@code collection_projects} by its primary key prefix, and the alternative would
     * make every column of the outer row a grouping key.
     */
    private static final String COLLECTION_COLUMNS =
            """
            c.id, c.slug, c.kind, c.opens_at, c.closes_at, c.grants_badge,
            c.cover_image_url, c.cover_image_width, c.cover_image_height,
            (SELECT count(*)
               FROM collection_projects cp
               JOIN projects p ON p.id = cp.project_id
              WHERE cp.collection_id = c.id AND p.state IN (:states)) AS project_count
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final Clock clock;

    public PostgresCuratedCollections(NamedParameterJdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public List<CuratedCollection> index(String locale) {
        MapSqlParameterSource params = publicStates();
        List<Header> headers = jdbc.query(
                "SELECT " + COLLECTION_COLUMNS
                        + " FROM collections c WHERE " + VISIBLE
                        // sort_order is the platform's placement decision; slug breaks
                        // the tie so that two collections sharing an order do not
                        // reshuffle between requests and break the ETag.
                        + " ORDER BY c.sort_order ASC, c.slug ASC",
                params,
                (resultSet, index) -> header(resultSet));

        Map<UUID, Map<String, Translation>> translations = translationsOf(headers);
        List<CuratedCollection> collections = new ArrayList<>();
        for (Header header : headers) {
            collections.add(header.resolve(translations.getOrDefault(header.id(), Map.of()), locale));
        }
        return List.copyOf(collections);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<CuratedCollection> find(String slug, String locale) {
        MapSqlParameterSource params = publicStates();
        params.addValue("slug", slug);
        List<Header> headers = jdbc.query(
                "SELECT " + COLLECTION_COLUMNS + " FROM collections c WHERE c.slug = :slug AND " + VISIBLE,
                params,
                (resultSet, index) -> header(resultSet));
        if (headers.isEmpty()) {
            return Optional.empty();
        }
        Header header = headers.get(0);
        return Optional.of(header.resolve(
                translationsOf(headers).getOrDefault(header.id(), Map.of()), locale));
    }

    /**
     * One page of the curator's sequence.
     *
     * <p>The keyset is {@code (position, project_id)} ascending — the order V14's
     * {@code collection_projects_order_idx} is built in, tiebreaker included. Getting
     * the tiebreaker wrong here is not a slow page, it is a wrong one: sparse
     * positions make ties rare and not impossible, and a cursor that resumed on
     * position alone would drop or repeat every row sharing one.
     *
     * <p>The cursor is bound to the collection through its fingerprint, so a token
     * from one landing page replayed against another is refused rather than answered
     * with a page of somebody else's list — the same guarantee
     * {@code DiscoveryQuery.fingerprint} gives the feed, with the collection standing
     * in for the filters because it <em>is</em> the filter.
     */
    @Override
    @Transactional(readOnly = true)
    public DiscoveryPage projects(CuratedCollection collection, int limit, DiscoveryCursor cursor) {
        Instant asOf = cursor == null ? bucketedNow() : cursor.asOf();
        String fingerprint = fingerprintOf(collection);

        MapSqlParameterSource params = publicStates();
        params.addValue("collectionId", collection.id());
        // One more row than asked for: its existence is the only reliable answer to
        // "is there a next page", and it costs one row rather than a COUNT(*) over the
        // whole collection on every page.
        params.addValue("limit", limit + 1);

        String keyset = "";
        if (cursor != null) {
            cursor.requireMatches(fingerprint, DiscoverySort.CURATED);
            params.addValue("cursorPosition", position(cursor));
            params.addValue("cursorId", cursor.id());
            keyset = " AND (cp.position > :cursorPosition"
                    + " OR (cp.position = :cursorPosition AND p.id > :cursorId))";
        }

        List<Placed> rows = jdbc.query(
                "SELECT " + ProjectCardRows.COLUMNS + ", cp.position"
                        + " FROM collection_projects cp"
                        + " JOIN projects p ON p.id = cp.project_id"
                        + " JOIN users u ON u.id = p.creator_id"
                        + " WHERE cp.collection_id = :collectionId"
                        // The campaign-level half of the visibility rule. See the class
                        // comment: the membership row outlives the campaign's right to
                        // be shown, and this is what keeps the two apart.
                        + " AND p.state IN (:states)"
                        + keyset
                        + " ORDER BY cp.position ASC, p.id ASC"
                        + " LIMIT :limit",
                params,
                (resultSet, index) ->
                        new Placed(ProjectCardRows.card(resultSet, asOf), resultSet.getInt("position")));

        boolean hasMore = rows.size() > limit;
        List<Placed> page = hasMore ? rows.subList(0, limit) : rows;
        List<ProjectCard> items = page.stream().map(Placed::card).toList();

        DiscoveryCursor next = null;
        if (hasMore && !page.isEmpty()) {
            Placed last = page.get(page.size() - 1);
            next = new DiscoveryCursor(
                    fingerprint,
                    DiscoverySort.CURATED,
                    Integer.toString(last.position()),
                    last.card().id(),
                    asOf);
        }
        return new DiscoveryPage(items, next);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<String, String> visibleTitles(CollectionKind kind, String locale) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("kind", kind.name());
        List<Label> labels = jdbc.query(
                """
                SELECT c.slug, t.locale, t.title
                  FROM collections c
                  LEFT JOIN collection_translations t ON t.collection_id = c.id
                 WHERE c.kind = :kind AND %s
                 ORDER BY c.sort_order ASC, c.slug ASC
                """.formatted(VISIBLE),
                params,
                (resultSet, index) -> new Label(
                        resultSet.getString("slug"), resultSet.getString("locale"), resultSet.getString("title")));

        // Grouped in iteration order, which is the query's order, so the facet control
        // is rendered in the same sequence as the collections index. A HashMap here
        // would reorder the panel between JVM runs and change the ETag with it.
        Map<String, Map<String, String>> titles = new LinkedHashMap<>();
        for (Label label : labels) {
            Map<String, String> byLocale = titles.computeIfAbsent(label.slug(), key -> new LinkedHashMap<>());
            if (label.locale() != null) {
                byLocale.put(label.locale(), label.title());
            }
        }

        Map<String, String> resolved = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, String>> entry : titles.entrySet()) {
            // The taxonomy's chain: requested locale, then az, then the slug. Reused
            // rather than reimplemented so that a collection and a category fall back
            // the same way — see Taxonomy for why the last step exists.
            resolved.put(entry.getKey(), Taxonomy.resolveName(entry.getValue(), locale, entry.getKey()));
        }
        return Collections.unmodifiableMap(resolved);
    }

    // ---------------------------------------------------------------------------

    /**
     * The cursor's identity for a collection page.
     *
     * <p>The collection, and the fact that this is a collection page rather than a
     * feed. Not a digest: there is nothing to hide — the identifier is in the response
     * body — and a readable fingerprint makes a mismatched cursor diagnosable from the
     * token itself.
     */
    private static String fingerprintOf(CuratedCollection collection) {
        return "collection:" + collection.id();
    }

    private static int position(DiscoveryCursor cursor) {
        try {
            return Integer.parseInt(cursor.sortKey());
        } catch (NumberFormatException e) {
            // A cursor for an order whose key is a NOT NULL integer, carrying anything
            // else, is a cursor this service did not write.
            throw InvalidCursorException.undecodable("That cursor is not a cursor this service issued.");
        }
    }

    private Instant bucketedNow() {
        long seconds = DAYS_LEFT_BUCKET.toSeconds();
        Instant now = clock.instant();
        return Instant.ofEpochSecond(Math.floorDiv(now.getEpochSecond(), seconds) * seconds);
    }

    private static MapSqlParameterSource publicStates() {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("states", List.copyOf(DiscoveryStatus.LISTED_STATES));
        return params;
    }

    private Map<UUID, Map<String, Translation>> translationsOf(List<Header> headers) {
        if (headers.isEmpty()) {
            return Map.of();
        }
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("ids", headers.stream().map(Header::id).toList());
        List<TranslationRow> rows = jdbc.query(
                "SELECT collection_id, locale, title, description FROM collection_translations"
                        + " WHERE collection_id IN (:ids)",
                params,
                (resultSet, index) -> new TranslationRow(
                        resultSet.getObject("collection_id", UUID.class),
                        resultSet.getString("locale"),
                        new Translation(resultSet.getString("title"), resultSet.getString("description"))));

        Map<UUID, Map<String, Translation>> byCollection = new LinkedHashMap<>();
        for (TranslationRow row : rows) {
            byCollection
                    .computeIfAbsent(row.collectionId(), key -> new LinkedHashMap<>())
                    .put(row.locale(), row.translation());
        }
        return byCollection;
    }

    private static Header header(ResultSet resultSet) throws SQLException {
        String kind = resultSet.getString("kind");
        String coverUrl = resultSet.getString("cover_image_url");
        ProjectCard.CoverImage cover = coverUrl == null
                ? null
                : new ProjectCard.CoverImage(
                        coverUrl, resultSet.getInt("cover_image_width"), resultSet.getInt("cover_image_height"));
        return new Header(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("slug"),
                // A kind the enum does not know is a row written by a later release
                // against an older binary. Refusing loudly beats rendering a landing
                // page whose kind is null.
                CollectionKind.fromStorageValue(kind)
                        .orElseThrow(() -> new IllegalStateException("Unknown collection kind: " + kind)),
                cover,
                ProjectCardRows.instantOf(resultSet, "opens_at"),
                ProjectCardRows.instantOf(resultSet, "closes_at"),
                resultSet.getBoolean("grants_badge"),
                resultSet.getLong("project_count"));
    }

    /** The row, before its copy has been resolved into a language. */
    private record Header(
            UUID id,
            String slug,
            CollectionKind kind,
            ProjectCard.CoverImage coverImage,
            Instant opensAt,
            Instant closesAt,
            boolean grantsBadge,
            long projectCount) {

        CuratedCollection resolve(Map<String, Translation> translations, String locale) {
            Map<String, String> titles = new LinkedHashMap<>();
            for (Map.Entry<String, Translation> entry : translations.entrySet()) {
                titles.put(entry.getKey(), entry.getValue().title());
            }
            // The title falls back to the slug, so a heading is never empty. The
            // description does not: there is no readable handle for a paragraph, and
            // rendering "spring-2027" as the standfirst would be worse than rendering
            // none. A collection with no description in the requested language and
            // none in az simply has no standfirst.
            Translation requested = translations.get(locale);
            Translation primary = translations.get(Taxonomy.PRIMARY_LOCALE);
            String description = requested != null && requested.description() != null
                    ? requested.description()
                    : primary == null ? null : primary.description();

            return new CuratedCollection(
                    id,
                    slug,
                    kind,
                    Taxonomy.resolveName(titles, locale, slug),
                    description,
                    coverImage,
                    opensAt,
                    closesAt,
                    grantsBadge,
                    projectCount);
        }
    }

    private record Translation(String title, String description) {
    }

    private record TranslationRow(UUID collectionId, String locale, Translation translation) {
    }

    private record Label(String slug, String locale, String title) {
    }

    /** A card and the position the curator gave it, which is the cursor's key. */
    private record Placed(ProjectCard card, int position) {
    }
}
