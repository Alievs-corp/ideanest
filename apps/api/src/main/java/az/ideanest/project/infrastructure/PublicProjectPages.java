package az.ideanest.project.infrastructure;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.CampaignVideo;
import az.ideanest.project.application.PublicProjectPage;
import az.ideanest.project.domain.CoverImage;
import az.ideanest.shared.money.Money;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The public campaign page, in one query.
 *
 * <p><strong>SQL rather than JPA, and the reason is the joins.</strong> The page needs
 * the campaign, its creator, and the localised name of what it is filed under.
 * {@code users} belongs to another module — there is no association to map and mapping
 * one would be this module reaching into that one's domain — and the taxonomy names live
 * in a translation table with a per-locale row. Through JPA that is either four
 * repositories and four round trips or an association this module may not have; as one
 * statement it is one indexed lookup and one row. {@code discovery.infrastructure} makes
 * the same choice about the same two tables, and {@code ProjectCardRows} is where it says
 * so.
 *
 * <p>A read model, deliberately: nothing here returns a {@link az.ideanest.project.domain.Project}.
 * The page is served to anybody, so what it may show is a decision — {@code PublicProjects}
 * owns it — and handing an entity to the API layer would make every column on
 * {@code projects} one edit away from being public.
 *
 * <h2>The locale fallback is stated twice, on purpose</h2>
 *
 * <p>{@code COALESCE(requested, az, slug)} below is the same chain {@code Taxonomy} walks
 * in Java, and the duplication is the arrangement rather than an oversight: one statement
 * and one derivation that cannot disagree because nothing reads it is worse than two
 * statements checked against each other, which is what {@code PublicProjectApiTests}
 * does. Doing it in SQL is what keeps the page one query; doing it in Java is what keeps
 * the category tree one document.
 */
@Repository
public class PublicProjectPages {

    /** §21.1's primary language, and the second step of the fallback. Matches {@code Taxonomy}. */
    private static final String PRIMARY_LOCALE = "az";

    /**
     * The campaign, its creator, and its filing. Everything but the {@code WHERE}.
     *
     * <p>The four outer joins to the translation tables are two per taxon: the locale the
     * reader asked for, and {@code az}. Outer, because a campaign need not be filed and a
     * taxon need not have a row in the requested language — the second is the case that
     * would otherwise render an empty breadcrumb, and an inner join would drop the whole
     * campaign over a missing translation.
     *
     * <p><strong>Two callers address the same row two different ways</strong>, which is
     * why the predicate is separate from the projection rather than the query being
     * written twice. The public page is addressed by the pair of slugs its URL carries;
     * the console's staff preview (#399) is addressed by identifier, because the queue it
     * is opened from holds identifiers and a campaign in review has no public URL. A
     * second copy of these thirty columns would be the copy that stops carrying a field
     * the day one is added.
     */
    private static final String SELECT =
            """
            SELECT p.id, p.slug, p.state, p.title, p.blurb, p.risks, p.story::text AS story,
                   p.currency, p.goal_amount, p.pledged_amount, p.backers_count,
                   p.launched_at, p.deadline, p.late_pledge_enabled, p.late_pledge_ends_at,
                   p.finalized_at, p.outcome_goal_amount, p.outcome_pledged_amount,
                   p.outcome_backers_count,
                   p.cover_image_url, p.cover_image_width, p.cover_image_height,
                   p.video_media_id,
                   u.slug AS creator_slug, u.name AS creator_name, u.avatar_url AS creator_avatar_url,
                   c.slug AS category_slug,
                   COALESCE(ct.name, cfb.name, c.slug) AS category_name,
                   s.slug AS subcategory_slug,
                   COALESCE(st.name, sfb.name, s.slug) AS subcategory_name
              FROM projects p
              JOIN users u ON u.id = p.creator_id
              LEFT JOIN categories c ON c.id = p.category_id
              LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.locale = :locale
              LEFT JOIN category_translations cfb ON cfb.category_id = c.id AND cfb.locale = :fallback
              LEFT JOIN subcategories s ON s.id = p.subcategory_id
              LEFT JOIN subcategory_translations st ON st.subcategory_id = s.id AND st.locale = :locale
              LEFT JOIN subcategory_translations sfb ON sfb.subcategory_id = s.id AND sfb.locale = :fallback
            """;

    /**
     * The public URL's predicate: {@code (users.slug, projects.slug)}, which is exactly
     * the pair {@code projects_creator_slug_key} makes unique once the creator is
     * resolved. Two creators may both have a {@code coffee-table-book}, which is why the
     * public URL carries both halves and why this cannot be written against
     * {@code projects} alone.
     */
    private static final String BY_SLUGS =
            """
             WHERE u.slug = :creatorSlug
               AND p.slug = :projectSlug
               AND u.deleted_at IS NULL
            """;

    /**
     * The console's predicate: the primary key, and the same creator condition.
     *
     * <p>{@code u.deleted_at IS NULL} is kept rather than relaxed for staff, for the
     * reason {@link #find(String, String, String)} gives about the join: a campaign whose
     * creator is inside §17.4's deletion grace period has nobody to name in its header,
     * and the console has {@code /admin/campaigns} to say the campaign exists. Serving a
     * preview with a blank byline would be the one place on the platform that renders an
     * account the platform has undertaken to stop rendering.
     */
    private static final String BY_ID =
            """
             WHERE p.id = :projectId
               AND u.deleted_at IS NULL
            """;

    private final NamedParameterJdbcTemplate jdbc;

    /**
     * The video's location is the media module's to say — it knows where the bucket is
     * served from — so the row carries an identifier and this asks for the rest (#331).
     */
    private final MediaLibrary media;

    public PublicProjectPages(DataSource dataSource, MediaLibrary media) {
        this.jdbc = new NamedParameterJdbcTemplate(dataSource);
        this.media = media;
    }

    /**
     * The campaign at this URL, whatever state it is in.
     *
     * <p><strong>Visibility is not decided here.</strong> This answers "is there a row"
     * and {@code PublicProjects} answers "may a stranger see it" — the same split every
     * public read in this module already makes, and the reason it is worth keeping is
     * that the second question has one answer written down in one place. A query that
     * filtered by state would be a second copy of that list, and the first one to fall
     * behind publishes a campaign trust and safety has just stopped.
     *
     * <p>An account inside §17.4's deletion grace period is filtered out here rather than
     * there, because it is a fact about the join and not about the campaign: the row
     * would have no creator to name, and a page whose header is blank is worse than a
     * page that is not served.
     *
     * @param locale the reader's language, already narrowed to one of §21.1's four by
     *     {@code Taxonomy.localeFor}. Interpolated as a parameter, never as text
     */
    public Optional<PublicProjectPage> find(String creatorSlug, String projectSlug, String locale) {
        Map<String, Object> parameters = Map.of(
                "creatorSlug", creatorSlug,
                "projectSlug", projectSlug,
                "locale", locale,
                "fallback", PRIMARY_LOCALE);

        List<PublicProjectPage> found =
                jdbc.query(SELECT + BY_SLUGS, parameters, (resultSet, row) -> page(resultSet, media));
        // At most one by construction — projects_creator_slug_key and users_slug_key are
        // both unique — so this is a `findFirst` over a list that cannot have two.
        return found.stream().findFirst();
    }

    /**
     * The same campaign, addressed by identifier — #399's staff preview.
     *
     * <p><strong>Identical projection, and deliberately not a narrower one.</strong> The
     * screen this feeds exists so that a moderator deciding a submission can read what
     * they are deciding, and "what they are deciding" is the page a backer would see. A
     * preview assembled from a shorter row would be a second answer to "what is this
     * campaign", and the decision would be taken against the wrong one.
     *
     * <p>Visibility is not decided here either, for the reason above: this method answers
     * "is there a row" and its caller answers "may this account see it". The caller is
     * {@code CampaignDirectory}, which asks for {@code MODERATE_CONTENT} — the check that
     * makes reading a draft, a rejected campaign or a suspended one legitimate.
     */
    public Optional<PublicProjectPage> find(UUID projectId, String locale) {
        Map<String, Object> parameters =
                Map.of("projectId", projectId, "locale", locale, "fallback", PRIMARY_LOCALE);

        List<PublicProjectPage> found =
                jdbc.query(SELECT + BY_ID, parameters, (resultSet, row) -> page(resultSet, media));
        // At most one: the predicate is the primary key.
        return found.stream().findFirst();
    }

    private static PublicProjectPage page(ResultSet row, MediaLibrary media) throws SQLException {
        String currency = row.getString("currency");

        String coverUrl = row.getString("cover_image_url");
        // The three cover columns are written together or not at all —
        // projects_cover_image_is_complete — so one check answers for all three.
        CoverImage cover = coverUrl == null
                ? null
                : new CoverImage(coverUrl, row.getInt("cover_image_width"), row.getInt("cover_image_height"));

        return new PublicProjectPage(
                row.getObject("id", UUID.class),
                row.getString("slug"),
                row.getString("state"),
                row.getString("title"),
                row.getString("blurb"),
                new PublicProjectPage.Creator(
                        row.getString("creator_slug"),
                        row.getString("creator_name"),
                        row.getString("creator_avatar_url")),
                taxon(row.getString("category_slug"), row.getString("category_name")),
                taxon(row.getString("subcategory_slug"), row.getString("subcategory_name")),
                cover,
                videoOf(row.getObject("video_media_id", UUID.class), media),
                Money.orNull(row.getBigDecimal("goal_amount"), currency),
                Money.orNull(row.getBigDecimal("pledged_amount"), currency),
                row.getInt("backers_count"),
                instantOf(row, "launched_at"),
                instantOf(row, "deadline"),
                row.getBoolean("late_pledge_enabled"),
                instantOf(row, "late_pledge_ends_at"),
                row.getString("story"),
                row.getString("risks"),
                outcome(row, currency));
    }

    /** A taxon, or nothing when the campaign has not been filed under one. */
    /** Null for no video, and for one that is not ready to play — the page shows the cover. */
    private static CampaignVideo videoOf(UUID mediaId, MediaLibrary media) {
        return mediaId == null ? null : media.videoViewOf(mediaId).map(CampaignVideo::of).orElse(null);
    }

    private static PublicProjectPage.Taxon taxon(String slug, String name) {
        return slug == null ? null : new PublicProjectPage.Taxon(slug, name);
    }

    /**
     * V29's frozen outcome, or null while the campaign is still running.
     *
     * <p>{@code projects_outcome_frozen_together} makes the four columns all-or-nothing,
     * so {@code finalized_at} answers for the other three.
     */
    private static PublicProjectPage.Outcome outcome(ResultSet row, String currency) throws SQLException {
        Instant finalisedAt = instantOf(row, "finalized_at");
        if (finalisedAt == null) {
            return null;
        }
        BigDecimal goal = row.getBigDecimal("outcome_goal_amount");
        BigDecimal pledged = row.getBigDecimal("outcome_pledged_amount");
        return new PublicProjectPage.Outcome(
                Money.orNull(goal, currency),
                Money.orNull(pledged, currency),
                row.getInt("outcome_backers_count"),
                finalisedAt);
    }

    /**
     * {@code timestamptz} as an instant, or null.
     *
     * <p>Read as {@link OffsetDateTime} rather than {@code java.sql.Timestamp}: the
     * latter is interpreted in the JVM's default zone, which makes the value depend on
     * where the service happens to run.
     */
    private static Instant instantOf(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
