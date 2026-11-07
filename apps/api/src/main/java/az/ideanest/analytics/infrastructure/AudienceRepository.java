package az.ideanest.analytics.infrastructure;

import java.sql.Types;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * V124's three tables as SQL — #633.
 *
 * <p>Plain JDBC rather than entities, as {@link DailyRollupRepository} is: every write here
 * is an {@code INSERT ... ON CONFLICT}, whose result is the whole point (an inserted
 * marker is a first visit; an upsert adds to a running count), and every read is a sum.
 * Neither is a shape an entity manager has anything to add to.
 */
@Repository
public class AudienceRepository {

    /** V124's stand-in for "the whole site" in its two unique keys. */
    private static final String SITE = "'00000000-0000-0000-0000-000000000000'::uuid";

    private final NamedParameterJdbcTemplate jdbc;

    public AudienceRepository(DataSource dataSource) {
        this.jdbc = new NamedParameterJdbcTemplate(dataSource);
    }

    // ------------------------------------------------------------------
    // Salts and markers
    // ------------------------------------------------------------------

    public Optional<byte[]> saltOf(LocalDate day) {
        return jdbc
                .queryForList(
                        "SELECT salt FROM audience_day_salts WHERE day = :day",
                        new MapSqlParameterSource("day", day),
                        byte[].class)
                .stream()
                .findFirst();
    }

    /**
     * Stores a salt for the day unless one is already there. Whichever request gets there
     * first decides the day's salt for every replica; the loser reads the winner's back.
     */
    public void insertSaltIfAbsent(LocalDate day, byte[] salt) {
        jdbc.update(
                "INSERT INTO audience_day_salts (day, salt) VALUES (:day, :salt) ON CONFLICT (day) DO NOTHING",
                new MapSqlParameterSource().addValue("day", day).addValue("salt", salt));
    }

    /**
     * Marks this visitor as counted for this kind (and campaign) today.
     *
     * @return whether the marker is new — that is, whether this event is the visitor's
     *     first of its kind today. Decided by the unique index, so two concurrent first
     *     events cannot both win
     */
    public boolean markFirst(LocalDate day, byte[] visitor, short kind, UUID projectId) {
        int inserted = jdbc.update(
                """
                INSERT INTO audience_seen (day, visitor_hash, kind, project_id)
                VALUES (:day, :visitor, :kind, :projectId)
                ON CONFLICT DO NOTHING
                """,
                new MapSqlParameterSource()
                        .addValue("day", day)
                        .addValue("visitor", visitor)
                        .addValue("kind", kind, Types.SMALLINT)
                        .addValue("projectId", projectId, Types.OTHER));
        return inserted == 1;
    }

    /**
     * Deletes every salt and marker of a day before {@code day}.
     *
     * @return how many rows went, salts and markers together, for the job's log line
     */
    public int forgetDaysBefore(LocalDate day) {
        MapSqlParameterSource parameters = new MapSqlParameterSource("day", day);
        int markers = jdbc.update("DELETE FROM audience_seen WHERE day < :day", parameters);
        int salts = jdbc.update("DELETE FROM audience_day_salts WHERE day < :day", parameters);
        return markers + salts;
    }

    // ------------------------------------------------------------------
    // The figures
    // ------------------------------------------------------------------

    /**
     * Adds to one hour's counts, creating the row on the hour's first event.
     *
     * @param projectId null for the site as a whole
     */
    public void addToHour(Instant hour, UUID projectId, String country, String platform, String surface, Counts counts) {
        jdbc.update(
                """
                INSERT INTO audience_hourly
                    (hour, project_id, country, platform, surface, visitors, page_views, views, clicks)
                VALUES
                    (:hour, :projectId, :country, :platform, :surface, :visitors, :pageViews, :views, :clicks)
                ON CONFLICT (hour, (COALESCE(project_id, %s)), country, platform, surface) DO UPDATE
                   SET visitors   = audience_hourly.visitors   + EXCLUDED.visitors,
                       page_views = audience_hourly.page_views + EXCLUDED.page_views,
                       views      = audience_hourly.views      + EXCLUDED.views,
                       clicks     = audience_hourly.clicks     + EXCLUDED.clicks
                """
                        .formatted(SITE),
                new MapSqlParameterSource()
                        .addValue("hour", at(hour))
                        .addValue("projectId", projectId, Types.OTHER)
                        .addValue("country", country)
                        .addValue("platform", platform)
                        .addValue("surface", surface)
                        .addValue("visitors", counts.visitors())
                        .addValue("pageViews", counts.pageViews())
                        .addValue("views", counts.views())
                        .addValue("clicks", counts.clicks()));
    }

    /** The whole platform, one row per hour that had anything, oldest first. */
    public List<HourTotals> platformHours(Instant from, Instant to) {
        return jdbc.query(
                """
                SELECT hour,
                       sum(visitors)   AS visitors,
                       sum(page_views) AS page_views,
                       sum(views)      AS views,
                       sum(clicks)     AS clicks
                  FROM audience_hourly
                 WHERE hour >= :from AND hour < :to
                 GROUP BY hour
                 ORDER BY hour
                """,
                window(from, to),
                (rs, row) -> new HourTotals(
                        rs.getObject("hour", OffsetDateTime.class).toInstant(),
                        new Counts(
                                rs.getLong("visitors"), rs.getLong("page_views"), rs.getLong("views"), rs.getLong("clicks"))));
    }

    /** One campaign, one row per hour that had anything, oldest first. */
    public List<HourTotals> projectHours(UUID projectId, Instant from, Instant to) {
        return jdbc.query(
                """
                SELECT hour, sum(views) AS views, sum(clicks) AS clicks
                  FROM audience_hourly
                 WHERE project_id = :projectId AND hour >= :from AND hour < :to
                 GROUP BY hour
                 ORDER BY hour
                """,
                window(from, to).addValue("projectId", projectId),
                (rs, row) -> new HourTotals(
                        rs.getObject("hour", OffsetDateTime.class).toInstant(),
                        new Counts(0, 0, rs.getLong("views"), rs.getLong("clicks"))));
    }

    /** Site visitors by country, most first; countries with none are left out. */
    public List<Count> siteVisitorsByCountry(Instant from, Instant to) {
        return siteVisitorsBy("country", from, to);
    }

    /** Site visitors by platform, most first; platforms with none are left out. */
    public List<Count> siteVisitorsByPlatform(Instant from, Instant to) {
        return siteVisitorsBy("platform", from, to);
    }

    /** The campaigns with the most views in the window, with their clicks. */
    public List<CampaignTotals> topCampaigns(Instant from, Instant to, int limit) {
        return jdbc.query(
                """
                SELECT project_id, sum(views) AS views, sum(clicks) AS clicks
                  FROM audience_hourly
                 WHERE project_id IS NOT NULL AND hour >= :from AND hour < :to
                 GROUP BY project_id
                HAVING sum(views) + sum(clicks) > 0
                 ORDER BY sum(views) DESC, sum(clicks) DESC, project_id
                 LIMIT :limit
                """,
                window(from, to).addValue("limit", limit),
                (rs, row) -> new CampaignTotals(
                        rs.getObject("project_id", UUID.class), rs.getLong("views"), rs.getLong("clicks")));
    }

    /** One campaign's views and clicks by country, most viewed first. */
    public List<CountryTotals> projectByCountry(UUID projectId, Instant from, Instant to) {
        return jdbc.query(
                """
                SELECT country, sum(views) AS views, sum(clicks) AS clicks
                  FROM audience_hourly
                 WHERE project_id = :projectId AND hour >= :from AND hour < :to
                 GROUP BY country
                HAVING sum(views) + sum(clicks) > 0
                 ORDER BY sum(views) DESC, sum(clicks) DESC, country
                """,
                window(from, to).addValue("projectId", projectId),
                (rs, row) -> new CountryTotals(rs.getString("country"), rs.getLong("views"), rs.getLong("clicks")));
    }

    /** One campaign's clicks by the surface they came from, most first. */
    public List<Count> projectClicksBySurface(UUID projectId, Instant from, Instant to) {
        return jdbc.query(
                """
                SELECT surface AS label, sum(clicks) AS total
                  FROM audience_hourly
                 WHERE project_id = :projectId AND surface <> 'NONE' AND hour >= :from AND hour < :to
                 GROUP BY surface
                HAVING sum(clicks) > 0
                 ORDER BY sum(clicks) DESC, surface
                """,
                window(from, to).addValue("projectId", projectId),
                (rs, row) -> new Count(rs.getString("label"), rs.getLong("total")));
    }

    /** One campaign's views by platform, most first. */
    public List<Count> projectViewsByPlatform(UUID projectId, Instant from, Instant to) {
        return jdbc.query(
                """
                SELECT platform AS label, sum(views) AS total
                  FROM audience_hourly
                 WHERE project_id = :projectId AND hour >= :from AND hour < :to
                 GROUP BY platform
                HAVING sum(views) > 0
                 ORDER BY sum(views) DESC, platform
                """,
                window(from, to).addValue("projectId", projectId),
                (rs, row) -> new Count(rs.getString("label"), rs.getLong("total")));
    }

    /** {@code column} is one of two literals above, never input. */
    private List<Count> siteVisitorsBy(String column, Instant from, Instant to) {
        return jdbc.query(
                """
                SELECT %1$s AS label, sum(visitors) AS total
                  FROM audience_hourly
                 WHERE project_id IS NULL AND hour >= :from AND hour < :to
                 GROUP BY %1$s
                HAVING sum(visitors) > 0
                 ORDER BY sum(visitors) DESC, %1$s
                """
                        .formatted(column),
                window(from, to),
                (rs, row) -> new Count(rs.getString("label"), rs.getLong("total")));
    }

    private static MapSqlParameterSource window(Instant from, Instant to) {
        return new MapSqlParameterSource().addValue("from", at(from)).addValue("to", at(to));
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    /** What one event adds, or what a span added up to. */
    public record Counts(long visitors, long pageViews, long views, long clicks) {

        public static final Counts NONE = new Counts(0, 0, 0, 0);

        public Counts plus(Counts other) {
            return new Counts(
                    visitors + other.visitors,
                    pageViews + other.pageViews,
                    views + other.views,
                    clicks + other.clicks);
        }
    }

    public record HourTotals(Instant hour, Counts counts) {
    }

    /** A label — a country, a platform, a surface — and how many. */
    public record Count(String label, long total) {
    }

    public record CampaignTotals(UUID projectId, long views, long clicks) {
    }

    public record CountryTotals(String country, long views, long clicks) {
    }
}
