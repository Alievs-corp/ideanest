package az.ideanest.analytics.infrastructure;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The platform's pledge figures, summed across every campaign — issue #313.
 *
 * <h2>One population, read from {@code pledges}</h2>
 *
 * <p>These figures used to come from three places. Volume, count and the daily series were
 * summed from V27's {@code project_analytics_daily}, which is built from
 * {@code referral_attributions} — written when a pledge is collected and never reversed — so a
 * refunded or charged-back pledge stayed in the volume for ever. The backer count came from
 * {@code pledges} keyed on {@code created_at}, which is when the checkout began rather than when
 * the money arrived. Three populations in one row of tiles, and a reader dividing one by
 * another was dividing unlike things.
 *
 * <p>So every pledge figure here now counts the same set, which {@link #COUNTED} spells out once:
 *
 * <ul>
 *   <li><strong>collected and still standing</strong> — {@code COLLECTED} or {@code FULFILLED}.
 *       A {@code REFUNDED} or {@code CHARGEBACK} pledge is money that went back, and is not
 *       volume;
 *   <li><strong>keyed on {@code collected_at}</strong>, the moment the money arrived. A pledge is
 *       charged when it is made (IDN-EXT-01), so {@code Pledge.collect} stamps
 *       {@code confirmed_at} and {@code collected_at} with the same instant, and either would
 *       give the same answer; the column named for the money is the one used;
 *   <li><strong>net of the refunds that have settled against a pledge that is still
 *       collected</strong> — a partial refund leaves the pledge {@code COLLECTED}, and its
 *       amount (with any provider fee V101 withheld) comes off that pledge's total. A refund
 *       for a raise that was never applied ({@code RAISE_NOT_APPLIED}) is not subtracted:
 *       that charge never reached the total, which is exactly how
 *       {@code PledgeRefunds.recordRefunded} treats it for the campaign's own figure.
 * </ul>
 *
 * <p>The figures are therefore "what the pledges collected in this window come to now". A
 * refund settled next month lowers this month's volume when this month is read again — which
 * is the honest direction: the money is not the platform's to report.
 *
 * <h2>{@code NamedParameterJdbcTemplate}</h2>
 *
 * <p>Aggregates over a native shape — a correlated subtraction, a date in a zone — that JPQL
 * cannot express without an entity loaded and discarded per row.
 *
 * <h2>Every money figure is filtered by currency</h2>
 *
 * <p>§21.2 refuses to convert between currencies for anything that moves money, and a figure a
 * director reads is not exempt: a total that added manat to dollars would be a number nobody can
 * reconcile against the ledger. {@link Totals#otherCurrencyPledges} counts what was left out, so
 * the response can state the gap rather than hide it.
 *
 * <h2>The scan</h2>
 *
 * <p>V110 gives this set a partial index on {@code collected_at}, so a window is a range scan
 * over collected pledges rather than a pass over every checkout ever started.
 */
@Repository
public class PlatformFiguresRepository {

    /**
     * The pledges every figure counts, with what each one still holds.
     *
     * <p>The states are spelled out because SQL cannot name a Java constant;
     * {@code PlatformAnalyticsApiTests} asserts a refunded and a charged-back pledge are left out.
     */
    private static final String COUNTED =
            """
            WITH counted AS (
                SELECT p.backer_id,
                       p.currency,
                       (p.collected_at AT TIME ZONE CAST(:zone AS text))::date AS day,
                       GREATEST(p.total_amount - COALESCE((
                           SELECT SUM(r.amount + r.withheld_fee)
                             FROM refunds r
                            WHERE r.pledge_id = p.id
                              AND r.state = 'SUCCEEDED'
                              AND r.reason <> 'RAISE_NOT_APPLIED'), 0), 0) AS net
                  FROM pledges p
                 WHERE p.state IN ('COLLECTED', 'FULFILLED')
                   AND p.collected_at >= :from
                   AND p.collected_at < :to
            )
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public PlatformFiguresRepository(DataSource dataSource) {
        this.jdbc = new NamedParameterJdbcTemplate(dataSource);
    }

    /**
     * The headline pledge figures over {@code [from, to)}, all from one statement so that the
     * average, the count and the volume describe the same rows at the same moment.
     */
    public Totals totals(Instant from, Instant to, ZoneId zone, String currency) {
        List<Totals> rows = jdbc.query(
                COUNTED
                        + """
                        SELECT COUNT(*) FILTER (WHERE c.currency = :currency) AS pledge_count,
                               COALESCE(SUM(c.net) FILTER (WHERE c.currency = :currency), 0) AS volume,
                               COUNT(DISTINCT c.backer_id) FILTER (WHERE c.currency = :currency) AS backers,
                               COUNT(*) FILTER (WHERE c.currency <> :currency) AS other_currency
                          FROM counted c
                        """,
                parameters(from, to, zone, currency),
                (rs, row) -> new Totals(
                        rs.getLong("pledge_count"),
                        rs.getBigDecimal("volume"),
                        rs.getLong("backers"),
                        rs.getLong("other_currency")));

        // An aggregate with no GROUP BY always returns one row. Defended anyway: a query that
        // stopped returning one should fail as a zero on a dashboard, not as an exception.
        return rows.isEmpty() ? new Totals(0, BigDecimal.ZERO, 0, 0) : rows.getFirst();
    }

    /**
     * One row per day that had a counted pledge in the platform currency, in day order. The
     * service fills the days between them with zeros.
     */
    public List<DailyTotal> dailyTotals(Instant from, Instant to, ZoneId zone, String currency) {
        return jdbc.query(
                COUNTED
                        + """
                        SELECT c.day AS day,
                               COUNT(*) AS pledge_count,
                               COALESCE(SUM(c.net), 0) AS amount
                          FROM counted c
                         WHERE c.currency = :currency
                         GROUP BY c.day
                         ORDER BY c.day
                        """,
                parameters(from, to, zone, currency),
                PlatformFiguresRepository::readDailyTotal);
    }

    /**
     * Campaigns running at the moment this was read: {@code LIVE}, {@code CLOSING_WINDOW} and
     * {@code EXTENDED}.
     *
     * <p>The same three states the console's front page counts as "running"
     * ({@code CampaignsDashboardSection}). A campaign in its closing window or extended is still
     * taking pledges, and counting {@code LIVE} alone dropped it on the day it reached its
     * deadline — while the front page, one click away, still counted it.
     */
    public long runningProjects() {
        Long value = jdbc.queryForObject(
                "SELECT COUNT(*) FROM projects WHERE state IN ('LIVE', 'CLOSING_WINDOW', 'EXTENDED')",
                Map.of(),
                Long.class);
        return value == null ? 0L : value;
    }

    /**
     * Campaigns <strong>decided</strong> in {@code [from, to)}: how many were declared
     * successful and how many unsuccessful.
     *
     * <p>Keyed on the transition that decided them, not on the deadline. IDN-EXT-01 opens a
     * closing window at the deadline (seven days by default) and decides at its end, so a count
     * keyed on the deadline put a campaign into a month in which nothing had been decided about
     * it yet — and, for a campaign whose deadline fell in the window's last week, counted it as
     * neither. A campaign is decided once; {@code COUNT(DISTINCT …)} is there so that a history
     * written twice by a retried job cannot count it twice.
     *
     * <p>Two counts in one statement, because they are read together and a rate computed from
     * two separately-taken snapshots is a rate over two different moments.
     */
    public Outcomes decisions(Instant from, Instant to) {
        List<Outcomes> rows = jdbc.query(
                """
                SELECT COUNT(DISTINCT t.project_id) FILTER (WHERE t.to_state = 'SUCCESSFUL') AS succeeded,
                       COUNT(DISTINCT t.project_id) FILTER (WHERE t.to_state = 'UNSUCCESSFUL') AS failed
                  FROM project_state_transitions t
                 WHERE t.to_state IN ('SUCCESSFUL', 'UNSUCCESSFUL')
                   AND t.created_at >= :from
                   AND t.created_at < :to
                """,
                Map.of("from", Timestamp.from(from), "to", Timestamp.from(to)),
                (rs, row) -> new Outcomes(rs.getLong("succeeded"), rs.getLong("failed")));

        return rows.isEmpty() ? new Outcomes(0, 0) : rows.getFirst();
    }

    private static Map<String, Object> parameters(Instant from, Instant to, ZoneId zone, String currency) {
        return Map.of(
                "from", Timestamp.from(from),
                "to", Timestamp.from(to),
                "zone", zone.getId(),
                "currency", currency);
    }

    private static DailyTotal readDailyTotal(ResultSet rs, int row) throws SQLException {
        return new DailyTotal(
                rs.getObject("day", LocalDate.class), rs.getLong("pledge_count"), rs.getBigDecimal("amount"));
    }

    /**
     * The headline figures.
     *
     * @param pledgeCount counted pledges in the platform currency
     * @param volume what they still hold, net of settled refunds
     * @param backerCount distinct accounts behind {@code pledgeCount}
     * @param otherCurrencyPledges counted pledges in another currency, left out of the three above
     */
    public record Totals(long pledgeCount, BigDecimal volume, long backerCount, long otherCurrencyPledges) {
    }

    /** One day's counted pledges across the platform. */
    public record DailyTotal(LocalDate day, long pledgeCount, BigDecimal amount) {
    }

    /** How many campaigns were decided each way. */
    public record Outcomes(long succeeded, long failed) {
    }
}
