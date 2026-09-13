package az.ideanest.analytics.infrastructure;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * V27's rollups, summed across the platform rather than within a campaign — issue #313.
 *
 * <h2>Its own class rather than methods on {@code DailyRollupRepository}</h2>
 *
 * <p>That one is #95's, and every statement in it is scoped to a campaign — which is the
 * whole of what makes it a creator's view. Adding platform-wide sums beside them would
 * leave one repository whose methods answer two different questions, and the first caller
 * to pick the wrong one would show a creator the platform's revenue.
 *
 * <h2>{@code NamedParameterJdbcTemplate}, like its neighbour</h2>
 *
 * <p>{@code project_analytics_daily} has no JPA entity: it is written by a single
 * {@code INSERT … SELECT} in {@code DailyRollupRepository} and read as aggregates. Mapping
 * it would mean an entity loaded and discarded for every row of every sum, and a repository
 * interface whose managed type exists only to satisfy Spring Data.
 *
 * <h2>Every query is filtered by currency</h2>
 *
 * <p>§21.2 refuses to convert between currencies for anything that moves money, and a
 * figure a director reads is not exempt: a total that added manat to dollars would be a
 * number nobody can reconcile against the ledger. {@link #otherCurrencyPledges} counts what
 * was left out, so the response can state the gap rather than hide it.
 */
@Repository
public class PlatformRollupRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public PlatformRollupRepository(DataSource dataSource) {
        this.jdbc = new NamedParameterJdbcTemplate(dataSource);
    }

    /**
     * One row per day: how many pledges and how much, across every campaign.
     *
     * <p>Ordered by day so the chart does not have to sort, and so two reads of the same
     * window produce the same bytes.
     */
    public List<DailyTotal> dailyTotals(LocalDate from, LocalDate to, String currency) {
        return jdbc.query(
                """
                SELECT r.day AS day,
                       COALESCE(SUM(r.pledge_count), 0) AS pledge_count,
                       COALESCE(SUM(r.amount), 0) AS amount
                  FROM project_analytics_daily r
                 WHERE r.day BETWEEN :from AND :to
                   AND r.currency = :currency
                 GROUP BY r.day
                 ORDER BY r.day
                """,
                Map.of("from", from, "to", to, "currency", currency),
                PlatformRollupRepository::readDailyTotal);
    }

    /** Every pledge counted in the window, in the platform currency. */
    public long pledgeCount(LocalDate from, LocalDate to, String currency) {
        return count(
                """
                SELECT COALESCE(SUM(r.pledge_count), 0)
                  FROM project_analytics_daily r
                 WHERE r.day BETWEEN :from AND :to AND r.currency = :currency
                """,
                Map.of("from", from, "to", to, "currency", currency));
    }

    /** What they came to. */
    public BigDecimal volume(LocalDate from, LocalDate to, String currency) {
        BigDecimal total = jdbc.queryForObject(
                """
                SELECT COALESCE(SUM(r.amount), 0)
                  FROM project_analytics_daily r
                 WHERE r.day BETWEEN :from AND :to AND r.currency = :currency
                """,
                Map.of("from", from, "to", to, "currency", currency),
                BigDecimal.class);

        return total == null ? BigDecimal.ZERO : total;
    }

    /**
     * Pledges in the window denominated in something else.
     *
     * <p>Counted so the response can say what it left out. A dashboard with a silent
     * exclusion is worse than one with a stated gap, because the gap is what somebody would
     * otherwise discover by reconciling against the ledger.
     */
    public long otherCurrencyPledges(LocalDate from, LocalDate to, String currency) {
        return count(
                """
                SELECT COALESCE(SUM(r.pledge_count), 0)
                  FROM project_analytics_daily r
                 WHERE r.day BETWEEN :from AND :to AND r.currency <> :currency
                """,
                Map.of("from", from, "to", to, "currency", currency));
    }

    /**
     * Distinct accounts that pledged in the window.
     *
     * <p><strong>Read from {@code pledges} rather than from the rollups</strong>, and it is
     * the one figure on this screen that cannot come from V27: a daily rollup holds a count,
     * and counts do not deduplicate across days. A backer who pledged on Monday and again on
     * Friday is two rows there and one person here.
     *
     * <p>Counted over the pledge states that represent a real backer. A draft is a basket
     * somebody abandoned, and the cancelled and dropped states are people who are no longer
     * backing anything — {@code PledgeState.ACTIVE} is this set plus {@code DRAFT}. The
     * values are spelled out because SQL cannot name a Java constant;
     * {@code PlatformAnalyticsTests} asserts the two agree.
     *
     * <p>The cost is a scan over a large table, which is why the window is bounded and why
     * §4.11's cohorts and funnels are not built on this — those need a rollup of their own,
     * and inventing one inside a console issue would be the wrong place to design it.
     */
    public long distinctBackers(Instant from, Instant to) {
        return count(
                """
                SELECT COUNT(DISTINCT p.backer_id)
                  FROM pledges p
                 WHERE p.created_at >= :from AND p.created_at < :to
                   AND p.state IN ('CONFIRMED', 'CHARGE_PENDING', 'COLLECTED', 'FULFILLED')
                """,
                Map.of("from", java.sql.Timestamp.from(from), "to", java.sql.Timestamp.from(to)));
    }

    /** Campaigns that were live at the moment this was read. */
    public long liveProjects() {
        return count("SELECT COUNT(*) FROM projects WHERE state = 'LIVE'", Map.of());
    }

    /**
     * How campaigns that closed in the window ended.
     *
     * <p>Two counts in one statement rather than two, because they are read together and a
     * rate computed from two separately-taken snapshots is a rate over two different
     * moments.
     *
     * <p>"Succeeded" is every state §6.1 puts after a campaign reached its goal, not only
     * {@code SUCCESSFUL}: a campaign that has since moved on to {@code COLLECTING} or
     * {@code COMPLETED} still succeeded, and counting only the first of those would make the
     * success rate fall as campaigns progressed.
     */
    public Outcomes outcomes(Instant from, Instant to) {
        List<Outcomes> rows = jdbc.query(
                """
                SELECT COALESCE(SUM(CASE WHEN p.state IN
                           ('SUCCESSFUL', 'COLLECTING', 'LATE_PLEDGE', 'WITHDRAWN', 'FULFILLING', 'COMPLETED')
                       THEN 1 ELSE 0 END), 0) AS succeeded,
                       COALESCE(SUM(CASE WHEN p.state = 'UNSUCCESSFUL' THEN 1 ELSE 0 END), 0) AS failed
                  FROM projects p
                 WHERE p.deadline >= :from AND p.deadline < :to
                """,
                Map.of("from", java.sql.Timestamp.from(from), "to", java.sql.Timestamp.from(to)),
                (rs, row) -> new Outcomes(rs.getLong("succeeded"), rs.getLong("failed")));

        // An aggregate with no GROUP BY always returns one row, so the list is never empty.
        // Defended anyway rather than indexed blindly: a query that stops returning a row
        // should fail as a zero on a dashboard, not as an exception in a support ticket.
        return rows.isEmpty() ? new Outcomes(0, 0) : rows.getFirst();
    }

    private long count(String sql, Map<String, ?> parameters) {
        Long value = jdbc.queryForObject(sql, parameters, Long.class);
        return value == null ? 0L : value;
    }

    private static DailyTotal readDailyTotal(ResultSet rs, int row) throws SQLException {
        return new DailyTotal(
                rs.getObject("day", LocalDate.class),
                rs.getLong("pledge_count"),
                rs.getBigDecimal("amount"));
    }

    /** One day's totals across the platform. */
    public record DailyTotal(LocalDate day, long pledgeCount, BigDecimal amount) {
    }

    /** How campaigns that closed in a window ended. */
    public record Outcomes(long succeeded, long failed) {
    }
}
