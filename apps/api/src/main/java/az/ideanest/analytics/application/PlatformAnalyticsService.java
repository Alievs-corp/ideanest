package az.ideanest.analytics.application;

import az.ideanest.analytics.AnalyticsProperties;
import az.ideanest.analytics.infrastructure.PlatformRollupRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.money.Money;
import az.ideanest.subscription.application.RevenueReport;
import az.ideanest.subscription.application.SubscriptionRevenue;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The platform's own figures — §4.11's AD-13, issue #313.
 *
 * <h2>What made this unblockable</h2>
 *
 * <p>#313 says "#95 aggregates one campaign, not the platform", which is true and is not
 * the same as "there is no data". V27 writes one row per campaign per day; the platform's
 * volume is that table grouped by day instead of by campaign, and the whole of this service
 * is that regrouping plus the two figures the rollups cannot answer.
 *
 * <h2>What is deliberately not built</h2>
 *
 * <p>§4.11's AD-13 lists "volume, success rate, average pledge, cohorts, funnels". The
 * first three are here. <strong>Cohorts and funnels are not</strong>, and that is stated
 * rather than approximated: a cohort is a retention question — do backers who arrived in
 * March still back campaigns in June — and answering it needs a rollup keyed on the
 * backer's first pledge, which does not exist. A funnel needs the visit-to-pledge path,
 * and {@code referral_touches} records where somebody came from rather than what they did
 * next.
 *
 * <p>Approximating them from what is here would produce two numbers on a dashboard that
 * look like cohorts and funnels and are not, which is worse than the two panels the screen
 * shows saying what they are waiting for. That is the same rule the console index follows
 * for its blocked modules.
 *
 * <h2>{@code VIEW_FINANCE} rather than a capability of its own</h2>
 *
 * <p>These are revenue figures. {@code StaffCapability} folds AD-05 and AD-13 into one
 * authority deliberately: reading the payment log and reading what it adds up to are the
 * same facts at two levels of detail, and a moderator who could see the platform's monthly
 * volume but not the charges behind it would have the more sensitive half of the pair.
 *
 * <h2>One currency, and it says so</h2>
 *
 * <p>§21.2 refuses to convert between currencies for anything that moves money, and a
 * figure a director reads is not exempt. Everything is summed in the platform currency and
 * the pledges left out are counted and reported — a total with a silent exclusion is worse
 * than one with a stated gap.
 */
@Service
public class PlatformAnalyticsService {

    /**
     * The longest window a single request may ask for.
     *
     * <p>{@link PlatformRollupRepository#distinctBackers} scans {@code pledges} over the
     * window, and that is the one query here that grows with the platform rather than with
     * the number of days. A year is what a dashboard is read over; a request for five would
     * be one query holding a connection for as long as it took.
     */
    private static final int MAX_WINDOW_DAYS = 366;

    /** What a request that names no window gets. A month is what the screen opens on. */
    private static final int DEFAULT_WINDOW_DAYS = 30;

    private final PlatformRollupRepository rollups;
    private final SubscriptionRevenue planRevenue;
    private final PlatformStaff staff;
    private final AnalyticsProperties properties;
    private final Clock clock;

    public PlatformAnalyticsService(
            PlatformRollupRepository rollups,
            SubscriptionRevenue planRevenue,
            PlatformStaff staff,
            AnalyticsProperties properties,
            Clock clock) {
        this.rollups = rollups;
        this.planRevenue = planRevenue;
        this.staff = staff;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * The dashboard.
     *
     * @param from the first day, inclusive. Null means {@link #DEFAULT_WINDOW_DAYS} back
     *     from {@code to}
     * @param to the last day, inclusive. Null means today in the reporting zone
     * @throws InvalidAnalyticsRangeException when the window runs backwards or is longer
     *     than a year
     */
    @Transactional(readOnly = true)
    public PlatformAnalytics dashboard(UUID staffId, LocalDate from, LocalDate to) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);

        ZoneId zone = ZoneId.of(properties.reporting().timeZone());
        LocalDate end = to == null ? LocalDate.now(clock.withZone(zone)) : to;
        LocalDate start = from == null ? end.minusDays(DEFAULT_WINDOW_DAYS - 1L) : from;

        if (start.isAfter(end)) {
            throw new InvalidAnalyticsRangeException("A reporting window does not run backwards");
        }
        if (java.time.temporal.ChronoUnit.DAYS.between(start, end) >= MAX_WINDOW_DAYS) {
            throw new InvalidAnalyticsRangeException(
                    "A reporting window covers at most " + MAX_WINDOW_DAYS + " days");
        }

        String currency = properties.reporting().currency();

        long pledgeCount = rollups.pledgeCount(start, end, currency);
        Money volume = Money.of(rollups.volume(start, end, currency), currency);

        List<PlatformAnalytics.DailyPoint> daily = rollups.dailyTotals(start, end, currency).stream()
                .map(row -> new PlatformAnalytics.DailyPoint(
                        row.day(), row.pledgeCount(), Money.of(row.amount(), currency)))
                .toList();

        // The pledge window as instants: from the start of the first day to the start of
        // the day after the last, in the reporting zone. Half-open, so a pledge made at
        // 23:59:59.999 on the final day is counted exactly once and a pledge on the
        // following midnight is not counted twice.
        java.time.Instant fromInstant = start.atStartOfDay(zone).toInstant();
        java.time.Instant toInstant = end.plusDays(1).atStartOfDay(zone).toInstant();

        PlatformRollupRepository.Outcomes outcomes = rollups.outcomes(fromInstant, toInstant);
        Optional<RevenueReport.Currency> plans = planRevenue.receivedBetween(fromInstant, toInstant, currency);

        return new PlatformAnalytics(
                start,
                end,
                clock.instant(),
                new PlatformAnalytics.Totals(
                        pledgeCount,
                        volume,
                        averageOf(volume, pledgeCount),
                        rollups.distinctBackers(fromInstant, toInstant),
                        rollups.liveProjects(),
                        rollups.otherCurrencyPledges(start, end, currency),
                        plans.map(RevenueReport.Currency::net).orElse(Money.zero(currency)),
                        plans.map(RevenueReport.Currency::payments).orElse(0L)),
                daily,
                PlatformAnalytics.Outcomes.of(outcomes.succeeded(), outcomes.failed()));
    }

    /**
     * The average pledge.
     *
     * <p><strong>Computed here rather than in the browser</strong>, because dividing money
     * is exactly the operation {@link Money} refuses to offer carelessly — it has
     * {@code allocate} and no {@code divide}, so that the parts of a split always add back
     * to the whole. An average is not a split, so the division is done on the
     * {@link BigDecimal} with the rounding stated in one place: {@code HALF_EVEN} at the
     * currency's scale, which is what {@code MoneyRounding} uses everywhere else.
     *
     * <p>Zero pledges is zero rather than an error. A dashboard for a quiet week should
     * render.
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
