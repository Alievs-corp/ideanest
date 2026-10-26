package az.ideanest.project.infrastructure;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.ProfileCampaign;
import az.ideanest.project.application.ProfileCursor;
import az.ideanest.shared.money.Money;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The cards on a profile page, in one query each.
 *
 * <p><strong>SQL rather than JPA, for {@code PublicProjectPages}' reason.</strong> A card
 * needs the campaign and the creator's slug, {@code users} belongs to another module —
 * there is no association to map and mapping one would be this module reaching into that
 * one's domain — and {@code ProjectRepository} maps an entity with fifty columns, a story
 * document and a frozen outcome. Rendering twenty titles through it would pull twenty
 * story documents through Hibernate.
 *
 * <p>A read model, deliberately: nothing here returns a
 * {@link az.ideanest.project.domain.Project}. These rows are served to anybody, so what
 * they may show is a decision — {@code ProfileCampaigns} owns it — and handing an entity to
 * the API layer would make every column on {@code projects} one edit away from being
 * public.
 *
 * <h2>Two page queries rather than one with a nullable cursor</h2>
 *
 * <p>The first page and the pages after it are separate statements. The alternative —
 * {@code (:cursorAt IS NULL OR (created_at, id) < (:cursorAt, :cursorId))} — reads as one
 * rule and is two: PostgreSQL cannot infer the type of a bound {@code NULL} in that
 * position, so every occurrence needs a cast, and the planner is handed a predicate it
 * cannot use for a range scan on the page where it matters least. Two statements are two
 * plans, both of which are the plan they should be.
 *
 * <p>The comparison itself is a row value, {@code (p.created_at, p.id) < (:at, :id)}, which
 * is the one form that expresses "strictly after this row in this ordering" without
 * spelling out the tie-break as a second disjunct — and a hand-written disjunct is how a
 * keyset page comes to drop the row on the boundary.
 *
 * <h2>The join, and where it is outer</h2>
 *
 * <p>Both public reads join {@code users} inner and require {@code deleted_at IS NULL}, as
 * {@code PublicProjectPages} does and for its reason: a campaign whose creator has been
 * anonymised has no creator to name and no addressable public page, and a card with a blank
 * byline is worse than a card that is not served.
 *
 * <p>{@link #ofAnyState} joins outer instead, and that is the whole difference between it
 * and {@link #publiclyVisible}. It serves a backer their own pledges, where dropping the
 * campaign would leave a pledge attached to nothing — {@code ProjectSummaryLookup} makes
 * exactly this argument about the {@code LEFT JOIN} in its own query.
 */
@Repository
public class ProfileCampaignRows {

    private static final String COLUMNS =
            """
            p.id, p.slug, p.title, p.blurb, p.state, p.currency,
            p.goal_amount, p.pledged_amount, p.backers_count,
            p.launched_at, p.deadline, p.created_at, p.scheduled_launch_at,
            p.cover_image_url, p.cover_image_width, p.cover_image_height,
            vm.storage_key AS video_storage_key, vm.poster_storage_key AS video_poster_storage_key,
            vm.width AS video_width, vm.height AS video_height,
            u.slug AS creator_slug
            """;

    /** The campaign video, when it is ready. Outer: most campaigns have none. */
    private static final String VIDEO_JOIN = " LEFT JOIN media vm ON vm.id = p.video_media_id"
            + " AND vm.status = 'READY' AND vm.kind = 'VIDEO'";

    private static final String CREATED_BY =
            "SELECT " + COLUMNS + " FROM projects p JOIN users u ON u.id = p.creator_id" + VIDEO_JOIN
                    + " WHERE p.creator_id = :creatorId AND u.deleted_at IS NULL AND p.state IN (:states)";

    /** Newest first, tie-broken on the identifier — the pair {@link ProfileCursor} names. */
    private static final String NEWEST_FIRST = " ORDER BY p.created_at DESC, p.id DESC LIMIT :limit";

    private static final String FIRST_PAGE = CREATED_BY + NEWEST_FIRST;

    private static final String AFTER_CURSOR =
            CREATED_BY + " AND (p.created_at, p.id) < (:cursorAt, :cursorId)" + NEWEST_FIRST;

    private static final String VISIBLE_BY_ID =
            "SELECT " + COLUMNS + " FROM projects p JOIN users u ON u.id = p.creator_id" + VIDEO_JOIN
                    + " WHERE p.id IN (:projectIds) AND u.deleted_at IS NULL AND p.state IN (:states)";

    private static final String ANY_BY_ID = "SELECT " + COLUMNS
            + " FROM projects p LEFT JOIN users u ON u.id = p.creator_id" + VIDEO_JOIN
            + " WHERE p.id IN (:projectIds)";

    private final RowMapper<ProfileCampaign> cards = (row, index) -> card(row);

    private final NamedParameterJdbcTemplate jdbc;

    private final MediaLibrary media;

    public ProfileCampaignRows(NamedParameterJdbcTemplate jdbc, MediaLibrary media) {
        this.jdbc = jdbc;
        this.media = media;
    }

    /**
     * One page of the campaigns this account created, newest first.
     *
     * @param states which of §6.1's sixteen this reader may see. Bound rather than inlined
     *     — unlike {@code BackedPledgeFacts}, which inlines its own list so the planner can
     *     use a partial index — because there is no partial index on this predicate to
     *     match and the set is the caller's decision, which is where it belongs
     * @param after the last row of the previous page, or null for the first
     * @param limit already clamped by the caller. This class does not decide page sizes
     * @return at most {@code limit} rows. The caller decides whether a full page means
     *     there is another one
     */
    public List<ProfileCampaign> createdBy(UUID creatorId, Set<String> states, ProfileCursor after, int limit) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("creatorId", creatorId)
                .addValue("states", states)
                .addValue("limit", limit);

        if (after == null) {
            return jdbc.query(FIRST_PAGE, parameters, cards);
        }
        return jdbc.query(
                AFTER_CURSOR,
                parameters
                        .addValue("cursorAt", OffsetDateTime.ofInstant(after.at(), ZoneOffset.UTC))
                        .addValue("cursorId", after.id()),
                cards);
    }

    /**
     * The cards for a set of campaigns, keeping only the ones a stranger may see.
     *
     * <p>For the backed archive, which arrives holding identifiers from {@code pledges} and
     * nothing else. The state filter is here rather than in the module that holds those
     * identifiers because {@code projects} is this module's table and its states are this
     * module's vocabulary — which is the whole reason that endpoint asks rather than joins.
     *
     * @return one card per campaign that exists, is in one of the given states, and has a
     *     creator. Shorter than what was asked for whenever one of those fails, never
     *     longer, and in no promised order — {@code ProfileCampaigns} restores the caller's
     */
    public List<ProfileCampaign> publiclyVisible(Collection<UUID> projectIds, Set<String> states) {
        if (projectIds == null || projectIds.isEmpty()) {
            // No statement at all rather than one that can match nothing.
            return List.of();
        }
        return jdbc.query(
                VISIBLE_BY_ID,
                new MapSqlParameterSource()
                        // Deduplicated before binding, so a caller holding one campaign twice
                        // cannot make the answer carry it twice.
                        .addValue("projectIds", Set.copyOf(projectIds))
                        .addValue("states", states),
                cards);
    }

    /**
     * The same, in whatever state the campaign is in.
     *
     * <p>For a backer's own pledge list, and the argument is {@code ProjectSummaries}':
     * that reader is already party to the campaign, and the pledges most likely to be on a
     * campaign that is no longer public are the ones about it being suspended, cancelled or
     * unsuccessful. A state filter would blank exactly those rows, which is the one place
     * the backer most needs to be told what happened.
     */
    public List<ProfileCampaign> ofAnyState(Collection<UUID> projectIds) {
        if (projectIds == null || projectIds.isEmpty()) {
            return List.of();
        }
        return jdbc.query(
                ANY_BY_ID, new MapSqlParameterSource("projectIds", Set.copyOf(projectIds)), cards);
    }

    private ProfileCampaign card(ResultSet row) throws SQLException {
        String currency = row.getString("currency");

        String coverUrl = row.getString("cover_image_url");
        // The three cover columns are written together or not at all --
        // projects_cover_image_is_complete -- so one check answers for all three.
        ProfileCampaign.Cover cover = coverUrl == null
                ? null
                : new ProfileCampaign.Cover(
                        coverUrl, row.getInt("cover_image_width"), row.getInt("cover_image_height"));

        String videoKey = row.getString("video_storage_key");
        // A READY video holds its key, its poster and its extent: V61's and V94's constraints.
        ProfileCampaign.Video video = videoKey == null
                ? null
                : new ProfileCampaign.Video(
                        media.publicUrlOf(videoKey),
                        media.publicUrlOf(row.getString("video_poster_storage_key")),
                        row.getInt("video_width"),
                        row.getInt("video_height"));

        return new ProfileCampaign(
                row.getObject("id", UUID.class),
                row.getString("slug"),
                row.getString("creator_slug"),
                row.getString("title"),
                row.getString("blurb"),
                row.getString("state"),
                Money.orNull(row.getBigDecimal("goal_amount"), currency),
                Money.orNull(row.getBigDecimal("pledged_amount"), currency),
                row.getInt("backers_count"),
                instantOf(row, "launched_at"),
                instantOf(row, "deadline"),
                instantOf(row, "created_at"),
                instantOf(row, "scheduled_launch_at"),
                cover,
                video);
    }

    /**
     * {@code timestamptz} as an instant, or null.
     *
     * <p>Read as {@link OffsetDateTime} rather than {@code java.sql.Timestamp}: the latter
     * is interpreted in the JVM's default zone, which makes the value depend on where the
     * service happens to run — and this one is a cursor key as well as a rendered date, so
     * a shifted value would page wrongly rather than merely display wrongly.
     */
    private static Instant instantOf(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
