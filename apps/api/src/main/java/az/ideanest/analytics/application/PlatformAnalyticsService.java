package az.ideanest.analytics.application;

import az.ideanest.analytics.AnalyticsAggregationProperties;
import az.ideanest.analytics.AnalyticsProperties;
import az.ideanest.analytics.infrastructure.PlatformFiguresRepository;
import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.dashboard.application.DashboardService;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import az.ideanest.subscription.application.RevenueReport;
import az.ideanest.subscription.application.SubscriptionRevenue;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The platform's own figures — §4.11's AD-13, issue #313.
 *
 * <h2>One population of pledges</h2>
 *
 * <p>Volume, count, average, backers and the daily series all count the same pledges: collected
 * in the window, still collected (not refunded, not charged back), net of any partial refund that
 * has settled against them. {@link PlatformFiguresRepository} spells the set out once, and the
 * screen says on its face that refunds are excluded. Before, three of those figures came from a
 * rollup that never forgot a refunded pledge and the fourth from a different table keyed on a
 * different instant, so the average was not the volume divided by the count anybody could see.
 *
 * <h2>What is deliberately not built</h2>
 *
 * <p>§4.11's AD-13 lists "volume, success rate, average pledge, cohorts, funnels". The first
 * three are here. <strong>Cohorts and funnels are not</strong>, and that is stated rather than
 * approximated: a cohort is a retention question — do backers who arrived in March still back
 * campaigns in June — and answering it needs a rollup keyed on the backer's first pledge, which
 * does not exist. A funnel needs the visit-to-pledge path, and the referral record says where
 * somebody came from rather than what they did next. Approximating them would put two numbers on
 * a dashboard that look like cohorts and funnels and are not.
 *
 * <h2>{@code VIEW_FINANCE} rather than a capability of its own</h2>
 *
 * <p>These are revenue figures. {@code StaffCapability} folds AD-05 and AD-13 into one authority
 * deliberately: reading the payment log and reading what it adds up to are the same facts at two
 * levels of detail.
 *
 * <h2>One currency, and it says so</h2>
 *
 * <p>§21.2 refuses to convert between currencies for anything that moves money, and a figure a
 * director reads is not exempt. Everything is summed in the platform currency and the pledges
 * left out are counted and reported — a total with a silent exclusion is worse than one with a
 * stated gap.
 *
 * <h2>One calendar</h2>
 *
 * <p>Three settings name the platform's "day": {@code ideanest.analytics.reporting.time-zone}
 * (this service), {@code ideanest.analytics.aggregation.zone} (the creator rollups) and
 * {@link DashboardService#ZONE} (the front page, which reads this service for its figures card
 * and labels the window in its own zone). A deployment that set them apart would show a day's
 * volume on one screen and a different total for "the same" day on the next, with nothing on
 * either to say why, so the constructor refuses to start unless they agree.
 */
@Service
public class PlatformAnalyticsService {

    /**
     * The longest window a single request may ask for.
     *
     * <p>Every pledge figure is a range scan over the window, and that is what grows with the
     * platform rather than with the number of days. A year is what a dashboard is read over; a
     * request for five would be one query holding a connection for as long as it took.
     */
    private static final int MAX_WINDOW_DAYS = 366;

    /** What a request that names no window gets. A month is what the screen opens on. */
    private static final int DEFAULT_WINDOW_DAYS = 30;

    private final PlatformFiguresRepository figures;
    private final SubscriptionRevenue planRevenue;
    private final PlatformStaff staff;
    private final AnalyticsProperties properties;
    private final AuditLog audit;
    private final Clock clock;
    private final ZoneId zone;

    public PlatformAnalyticsService(
            PlatformFiguresRepository figures,
            SubscriptionRevenue planRevenue,
            PlatformStaff staff,
            AnalyticsProperties properties,
            AnalyticsAggregationProperties aggregation,
            AuditLog audit,
            Clock clock) {
        this.figures = figures;
        this.planRevenue = planRevenue;
        this.staff = staff;
        this.properties = properties;
        this.audit = audit;
        this.clock = clock;
        this.zone = ZoneId.of(properties.reporting().timeZone());
        requireOneCalendar(zone, aggregation.zone(), DashboardService.ZONE);
    }

    /**
     * Fails start-up when the three settings that name the platform's day disagree.
     *
     * <p>Compared by identifier, not by offset: {@code Asia/Baku} and a fixed {@code +04:00} agree
     * today and part company the day either zone's rules change, and a check that waved that
     * through would be a check that the rules happen to coincide.
     */
    static void requireOneCalendar(ZoneId reporting, ZoneId aggregation, ZoneId dashboard) {
        if (!reporting.getId().equals(aggregation.getId()) || !reporting.getId().equals(dashboard.getId())) {
            throw new IllegalStateException(("The platform's day is named three times and they disagree:"
                            + " ideanest.analytics.reporting.time-zone=%s, ideanest.analytics.aggregation.zone=%s,"
                            + " and the console's front page uses %s. Set the first two to the third.")
                    .formatted(reporting.getId(), aggregation.getId(), dashboard.getId()));
        }
    }

    /**
     * {@code /admin/analytics}: the dashboard, and a record that somebody read it.
     *
     * <p>The audit row is written here rather than in {@link #dashboard}, which the front page's
     * figures card also calls: that read is recorded as {@code dashboard.read}, and recording it
     * twice would say two people looked.
     */
    public PlatformAnalytics read(UUID staffId, LocalDate from, LocalDate to) {
        PlatformAnalytics result = dashboard(staffId, from, to);
        audit.recordIndependently(
                AuditAction.ANALYTICS_READ,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "window=%s/%s".formatted(result.from(), result.to()));
        return result;
    }

    /**
     * The dashboard.
     *
     * <p>{@code REPEATABLE_READ}, so the totals, the series, the decisions and the plan revenue
     * are one snapshot: a pledge collected between two of the statements would otherwise be in
     * the volume and not in the chart.
     *
     * @param from the first day, inclusive. Null means {@link #DEFAULT_WINDOW_DAYS} back from
     *     {@code to}
     * @param to the last day, inclusive. Null means today in the reporting zone
     * @throws InvalidAnalyticsRangeException when the window runs backwards or is longer than a
     *     year
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PlatformAnalytics dashboard(UUID staffId, LocalDate from, LocalDate to) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);

        LocalDate end = to == null ? LocalDate.now(clock.withZone(zone)) : to;
        LocalDate start = from == null ? end.minusDays(DEFAULT_WINDOW_DAYS - 1L) : from;

        if (start.isAfter(end)) {
            throw new InvalidAnalyticsRangeException("A reporting window does not run backwards");
        }
        if (ChronoUnit.DAYS.between(start, end) >= MAX_WINDOW_DAYS) {
            throw new InvalidAnalyticsRangeException(
                    "A reporting window covers at most " + MAX_WINDOW_DAYS + " days");
        }

        String currency = properties.reporting().currency();

        // The window as instants: from the start of the first day to the start of the day after
        // the last, in the reporting zone. Half-open, so a pledge made at 23:59:59.999 on the
        // final day is counted exactly once and one on the following midnight is not counted twice.
        Instant fromInstant = start.atStartOfDay(zone).toInstant();
        Instant toInstant = end.plusDays(1).atStartOfDay(zone).toInstant();

        PlatformFiguresRepository.Totals totals = figures.totals(fromInstant, toInstant, zone, currency);
        Money volume = Money.of(totals.volume(), currency);
        List<PlatformAnalytics.DailyPoint> daily =
                everyDay(start, end, figures.dailyTotals(fromInstant, toInstant, zone, currency), currency);
        PlatformFiguresRepository.Outcomes outcomes = figures.decisions(fromInstant, toInstant);
        Optional<RevenueReport.Currency> plans = planRevenue.receivedBetween(fromInstant, toInstant, currency);

        return new PlatformAnalytics(
                start,
                end,
                clock.instant(),
                new PlatformAnalytics.Totals(
                        totals.pledgeCount(),
                        volume,
                        averageOf(volume, totals.pledgeCount()),
                        totals.backerCount(),
                        figures.runningProjects(),
                        totals.otherCurrencyPledges(),
                        plans.map(RevenueReport.Currency::net).orElse(Money.zero(currency)),
                        plans.map(RevenueReport.Currency::payments).orElse(0L)),
                daily,
                PlatformAnalytics.Outcomes.of(outcomes.succeeded(), outcomes.failed()));
    }

    /**
     * One point for every day of the window, with zeros where nothing was collected.
     *
     * <p>A series with gaps is a series every consumer has to fill before it can be drawn or
     * compared, and the one that forgets draws Monday next to Friday as if they were adjacent. The
     * console's chart fills them too; this is so that the API's own answer is already the whole
     * window.
     */
    static List<PlatformAnalytics.DailyPoint> everyDay(
            LocalDate start, LocalDate end, List<PlatformFiguresRepository.DailyTotal> rows, String currency) {
        Map<LocalDate, PlatformFiguresRepository.DailyTotal> byDay = new HashMap<>();
        for (PlatformFiguresRepository.DailyTotal row : rows) {
            byDay.put(row.day(), row);
        }

        List<PlatformAnalytics.DailyPoint> points = new ArrayList<>();
        for (LocalDate day = start; !day.isAfter(end); day = day.plusDays(1)) {
            PlatformFiguresRepository.DailyTotal row = byDay.get(day);
            points.add(row == null
                    ? new PlatformAnalytics.DailyPoint(day, 0, Money.zero(currency))
                    : new PlatformAnalytics.DailyPoint(day, row.pledgeCount(), Money.of(row.amount(), currency)));
        }
        return List.copyOf(points);
    }

    /**
     * The average pledge.
     *
     * <p><strong>Computed here rather than in the browser</strong>, because dividing money is
     * exactly the operation {@link Money} refuses to offer carelessly — it has {@code allocate}
     * and no {@code divide}, so that the parts of a split always add back to the whole. An
     * average is not a split, so the division is done on the {@link BigDecimal} with the rounding
     * stated in one place: {@code HALF_EVEN} at the currency's scale, which is what
     * {@code MoneyRounding} uses everywhere else.
     *
     * <p>Zero pledges is zero rather than an error. A dashboard for a quiet week should render.
     */
    private static Money averageOf(Money volume, long pledgeCount) {
        if (pledgeCount <= 0) {
            return Money.zero(volume.currency());
        }
        return Money.of(
                volume.amount().divide(BigDecimal.valueOf(pledgeCount), Money.SCALE, RoundingMode.HALF_EVEN),
                volume.currency());
    }
}
