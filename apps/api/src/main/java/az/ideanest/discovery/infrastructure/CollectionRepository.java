package az.ideanest.discovery.infrastructure;

import az.ideanest.discovery.application.AdminCollection;
import az.ideanest.discovery.application.CollectionDraft;
import az.ideanest.discovery.domain.CollectionKind;
import az.ideanest.discovery.domain.CurationAction;
import az.ideanest.discovery.domain.DiscoveryStatus;
import az.ideanest.discovery.domain.ProjectCard;
import az.ideanest.shared.Identifiers;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The curation tables, for the admin surface that writes them.
 *
 * <p><strong>SQL rather than JPA entities, and this is the module's convention rather
 * than a shortcut.</strong> Nothing in {@code discovery} is a managed entity: the
 * module is a read model with its own queries, and introducing one entity here would
 * mean a second mapping of {@code projects} sitting next to the project module's, plus
 * Hibernate's schema validation over tables three of whose four are read exclusively
 * through hand-written SQL. The writes themselves are simple — four tables, no
 * associations, no lazy loading — and they run inside {@code CurationService}'s
 * transaction like any repository call.
 *
 * <p><strong>This class does not authorise anything and does not write audit rows on
 * its own.</strong> {@link #record} is here because the row is a row, but every caller
 * of it is {@code CurationService}, which is the one place that decides whether a
 * curator may act. A mutation added here without a matching {@code record} would be a
 * privileged action that leaves no trace, which is the failure CLAUDE.md's audit rule
 * exists to prevent — so the two are always written together in that class.
 */
@Repository
public class CollectionRepository {

    /**
     * The gap between two curated positions.
     *
     * <p>Ten, so that inserting a campaign between two others is one UPDATE of one row
     * rather than a renumbering of the list. V14 says the same thing on the column.
     */
    public static final int POSITION_STEP = 10;

    private final NamedParameterJdbcTemplate jdbc;

    public CollectionRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---------------------------------------------------------------------------
    // Reads, for the curator
    // ---------------------------------------------------------------------------

    /** Every collection, published or not, in the order the index shows them. */
    public List<AdminCollection> findAll() {
        List<Row> rows = jdbc.query(
                "SELECT " + ROW_COLUMNS + " FROM collections c ORDER BY c.sort_order ASC, c.slug ASC",
                new MapSqlParameterSource(),
                (resultSet, index) -> row(resultSet));
        List<AdminCollection> collections = new ArrayList<>();
        for (Row row : rows) {
            collections.add(assemble(row));
        }
        return List.copyOf(collections);
    }

    /** One collection with its copy and its membership, published or not. */
    public Optional<AdminCollection> findBySlug(String slug) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("slug", slug);
        List<Row> rows = jdbc.query(
                "SELECT " + ROW_COLUMNS + " FROM collections c WHERE c.slug = :slug",
                params,
                (resultSet, index) -> row(resultSet));
        return rows.isEmpty() ? Optional.empty() : Optional.of(assemble(rows.get(0)));
    }

    public boolean existsBySlug(String slug) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("slug", slug);
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM collections WHERE slug = :slug)", params, Boolean.class));
    }

    public boolean projectExists(UUID projectId) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("projectId", projectId);
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM projects WHERE id = :projectId)", params, Boolean.class));
    }

    // ---------------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------------

    /** @return the identifier of the new collection */
    public UUID insert(String slug, CollectionDraft draft, UUID actorId) {
        UUID id = Identifiers.newIdentifier();
        MapSqlParameterSource params = draftParameters(draft);
        params.addValue("id", id);
        params.addValue("slug", slug);
        params.addValue("createdBy", actorId);
        jdbc.update(
                """
                INSERT INTO collections (
                    id, slug, kind, opens_at, closes_at, grants_badge, sort_order,
                    cover_image_url, cover_image_width, cover_image_height, created_by)
                VALUES (
                    :id, :slug, :kind, :opensAt, :closesAt, :grantsBadge, :sortOrder,
                    :coverUrl, :coverWidth, :coverHeight, :createdBy)
                """,
                params);
        replaceTranslations(id, draft);
        return id;
    }

    /**
     * Replaces everything a curator decides about the list.
     *
     * <p>{@code published_at} is deliberately not among the columns: publishing is its
     * own decision with its own audit row and its own note, and an edit that could
     * publish as a side effect of saving a form is an edit that puts a list on the
     * front page by accident.
     */
    public void replace(UUID id, CollectionDraft draft) {
        MapSqlParameterSource params = draftParameters(draft);
        params.addValue("id", id);
        jdbc.update(
                """
                UPDATE collections
                   SET kind = :kind,
                       opens_at = :opensAt,
                       closes_at = :closesAt,
                       grants_badge = :grantsBadge,
                       sort_order = :sortOrder,
                       cover_image_url = :coverUrl,
                       cover_image_width = :coverWidth,
                       cover_image_height = :coverHeight
                 WHERE id = :id
                """,
                params);
        replaceTranslations(id, draft);
    }

    /**
     * @param at the instant it became visible, or null to withdraw it
     */
    public void setPublished(UUID id, Instant at) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("id", id);
        params.addValue("publishedAt", at == null ? null : OffsetDateTime.ofInstant(at, ZoneOffset.UTC));
        jdbc.update("UPDATE collections SET published_at = :publishedAt WHERE id = :id", params);
    }

    /**
     * Adds a campaign at the end of the list.
     *
     * @return false when it was already there, in which case nothing was written and
     *     no audit row should be either — an add that is a no-op is not a decision
     */
    public boolean addProject(UUID collectionId, UUID projectId, UUID actorId) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("collectionId", collectionId);
        params.addValue("projectId", projectId);
        params.addValue("actorId", actorId);
        params.addValue("step", POSITION_STEP);
        // The next position is computed in the same statement as the insert, so two
        // curators adding at the same moment cannot both read the same maximum. They
        // can still land on the same position if the second reads before the first
        // commits — which is why the order carries `project_id` as a tiebreaker and
        // does not depend on positions being distinct.
        return jdbc.update(
                        """
                        INSERT INTO collection_projects (collection_id, project_id, position, added_by)
                        SELECT :collectionId, :projectId,
                               coalesce(max(cp.position), 0) + :step, :actorId
                          FROM collection_projects cp
                         WHERE cp.collection_id = :collectionId
                        ON CONFLICT (collection_id, project_id) DO NOTHING
                        """,
                        params)
                > 0;
    }

    /** @return false when the campaign was not in the list */
    public boolean removeProject(UUID collectionId, UUID projectId) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("collectionId", collectionId);
        params.addValue("projectId", projectId);
        return jdbc.update(
                        "DELETE FROM collection_projects"
                                + " WHERE collection_id = :collectionId AND project_id = :projectId",
                        params)
                > 0;
    }

    /**
     * Renumbers the list to the sequence the curator sent.
     *
     * <p>One statement, from a {@code VALUES} list of (project, position) pairs.
     * Row-by-row updates would leave the collection in an order nobody chose if the
     * transaction failed halfway, and a reader inside the same transaction would see
     * it.
     *
     * @param order every campaign in the collection, in the new sequence
     */
    public void reposition(UUID collectionId, List<UUID> order) {
        if (order.isEmpty()) {
            return;
        }
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("collectionId", collectionId);
        List<String> values = new ArrayList<>();
        for (int index = 0; index < order.size(); index++) {
            String projectName = "reorderProject" + index;
            String positionName = "reorderPosition" + index;
            params.addValue(projectName, order.get(index));
            params.addValue(positionName, (index + 1) * POSITION_STEP);
            // The first row of a VALUES list decides the column types and a bound
            // parameter has none until it is told, so both are cast.
            values.add("(:" + projectName + "::uuid, :" + positionName + "::int)");
        }
        jdbc.update(
                "UPDATE collection_projects cp SET position = ordered.position"
                        + " FROM (VALUES " + String.join(", ", values) + ") AS ordered (project_id, position)"
                        + " WHERE cp.collection_id = :collectionId AND cp.project_id = ordered.project_id",
                params);
    }

    /**
     * Appends one row to the audit trail.
     *
     * <p>Append-only: there is no update and no delete anywhere in this class, which
     * is the whole value of the table. See V14.
     */
    public void record(
            UUID collectionId, UUID projectId, CurationAction action, UUID actorId, String actorRole, String note) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("id", Identifiers.newIdentifier());
        params.addValue("collectionId", collectionId);
        params.addValue("projectId", projectId);
        params.addValue("action", action.name());
        params.addValue("actorId", actorId);
        params.addValue("actorRole", actorRole);
        params.addValue("note", note);
        jdbc.update(
                "INSERT INTO curation_events (id, collection_id, project_id, action, actor_id, actor_role, note)"
                        + " VALUES (:id, :collectionId, :projectId, :action, :actorId, :actorRole, :note)",
                params);
    }

    // ---------------------------------------------------------------------------

    private static final String ROW_COLUMNS =
            """
            c.id, c.slug, c.kind, c.published_at, c.opens_at, c.closes_at,
            c.grants_badge, c.sort_order,
            c.cover_image_url, c.cover_image_width, c.cover_image_height
            """;

    private void replaceTranslations(UUID id, CollectionDraft draft) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("id", id);
        // Delete-then-insert rather than an upsert plus a delete of what is missing.
        // A translation row carries nothing but the text — no identifier anybody holds,
        // no created_at anybody reads — so replacing the set is exactly what a PUT of
        // the whole description means, and it is one statement fewer to get wrong.
        jdbc.update("DELETE FROM collection_translations WHERE collection_id = :id", params);
        for (Map.Entry<String, CollectionDraft.Copy> entry : draft.copy().entrySet()) {
            MapSqlParameterSource row = new MapSqlParameterSource();
            row.addValue("id", id);
            row.addValue("locale", entry.getKey());
            row.addValue("title", entry.getValue().title());
            row.addValue("description", entry.getValue().description());
            jdbc.update(
                    "INSERT INTO collection_translations (collection_id, locale, title, description)"
                            + " VALUES (:id, :locale, :title, :description)",
                    row);
        }
    }

    private static MapSqlParameterSource draftParameters(CollectionDraft draft) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("kind", draft.kind().name());
        params.addValue(
                "opensAt", draft.opensAt() == null ? null : OffsetDateTime.ofInstant(draft.opensAt(), ZoneOffset.UTC));
        params.addValue(
                "closesAt",
                draft.closesAt() == null ? null : OffsetDateTime.ofInstant(draft.closesAt(), ZoneOffset.UTC));
        params.addValue("grantsBadge", draft.grantsBadge());
        params.addValue("sortOrder", draft.sortOrder());
        ProjectCard.CoverImage cover = draft.coverImage();
        params.addValue("coverUrl", cover == null ? null : cover.url());
        params.addValue("coverWidth", cover == null ? null : cover.width());
        params.addValue("coverHeight", cover == null ? null : cover.height());
        return params;
    }

    private AdminCollection assemble(Row row) {
        MapSqlParameterSource params = new MapSqlParameterSource();
        params.addValue("id", row.id());

        List<LocaleCopy> translations = jdbc.query(
                "SELECT locale, title, description FROM collection_translations"
                        + " WHERE collection_id = :id ORDER BY locale ASC",
                params,
                (resultSet, index) -> new LocaleCopy(
                        resultSet.getString("locale"),
                        new CollectionDraft.Copy(resultSet.getString("title"), resultSet.getString("description"))));
        Map<String, CollectionDraft.Copy> copy = new LinkedHashMap<>();
        for (LocaleCopy translation : translations) {
            copy.put(translation.locale(), translation.copy());
        }

        params.addValue("states", List.copyOf(DiscoveryStatus.LISTED_STATES));
        List<AdminCollection.Member> members = jdbc.query(
                """
                SELECT p.id, p.slug, p.title, p.state, cp.position,
                       (p.state IN (:states)) AS publicly_visible
                  FROM collection_projects cp
                  JOIN projects p ON p.id = cp.project_id
                 WHERE cp.collection_id = :id
                 ORDER BY cp.position ASC, p.id ASC
                """,
                params,
                (resultSet, index) -> new AdminCollection.Member(
                        resultSet.getObject("id", UUID.class),
                        resultSet.getString("slug"),
                        resultSet.getString("title"),
                        resultSet.getString("state"),
                        resultSet.getInt("position"),
                        resultSet.getBoolean("publicly_visible")));

        return new AdminCollection(
                row.id(),
                row.slug(),
                row.kind(),
                row.publishedAt(),
                row.opensAt(),
                row.closesAt(),
                row.grantsBadge(),
                row.sortOrder(),
                row.coverImage(),
                copy,
                members);
    }

    private static Row row(ResultSet resultSet) throws SQLException {
        String kind = resultSet.getString("kind");
        String coverUrl = resultSet.getString("cover_image_url");
        ProjectCard.CoverImage cover = coverUrl == null
                ? null
                : new ProjectCard.CoverImage(
                        coverUrl, resultSet.getInt("cover_image_width"), resultSet.getInt("cover_image_height"));
        return new Row(
                resultSet.getObject("id", UUID.class),
                resultSet.getString("slug"),
                CollectionKind.fromStorageValue(kind)
                        .orElseThrow(() -> new IllegalStateException("Unknown collection kind: " + kind)),
                ProjectCardRows.instantOf(resultSet, "published_at"),
                ProjectCardRows.instantOf(resultSet, "opens_at"),
                ProjectCardRows.instantOf(resultSet, "closes_at"),
                resultSet.getBoolean("grants_badge"),
                resultSet.getInt("sort_order"),
                cover);
    }

    private record LocaleCopy(String locale, CollectionDraft.Copy copy) {
    }

    private record Row(
            UUID id,
            String slug,
            CollectionKind kind,
            Instant publishedAt,
            Instant opensAt,
            Instant closesAt,
            boolean grantsBadge,
            int sortOrder,
            ProjectCard.CoverImage coverImage) {
    }
}
