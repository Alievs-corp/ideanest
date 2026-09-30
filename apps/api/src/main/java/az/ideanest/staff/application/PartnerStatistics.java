package az.ideanest.staff.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.finance.RevenueFigures;
import az.ideanest.shared.finance.RevenueFigures.DayFigures;
import az.ideanest.shared.finance.RevenueFigures.PlanFigures;
import az.ideanest.staff.domain.StaffRole;
import az.ideanest.staff.infrastructure.PartnerProfileRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The financial statistics as the caller is entitled to see them — #205, part of #202.
 *
 * <h2>One endpoint, two answers, and the server decides which</h2>
 *
 * <p>A super admin gets the real figures. A partner gets each figure multiplied by their
 * percentage ({@link ShareScaling}). Which one is decided here from the account's roles and its
 * row in {@code partner_profiles}, read on every call, and never from anything the client sent:
 * the request has no parameters, so there is nothing to tamper with, and the response says which
 * view it is so a screen can say so.
 *
 * <p>Checked in this order on purpose. The capability first, which refuses everybody but super
 * admins and partners. Then <em>any</em> super-admin role wins: the real figures, even for an
 * account that somehow also holds {@code PARTNER}, because a super admin can read the real
 * figures everywhere else in the console and a smaller number here would be a statistic that
 * disagrees with the ledger. Only then the partner path, and a partner with no percentage is
 * refused rather than shown the real figures or an unscaled zero.
 *
 * <h2>Nothing real is split, copied or changed</h2>
 *
 * <p>The real journal is read as it is, by {@link RevenueFigures}, which can return only
 * sums and counts. The percentage is applied in this method to those sums, once per displayed
 * figure. No partner-specific copy of any data exists anywhere.
 *
 * <h2>Aggregates only</h2>
 *
 * <p>The response types below have no field that could carry a transaction: no payment id, no
 * payer, no reference, no per-payment amount. The data underneath has none either. Both halves
 * matter: a type without a field is a promise about this class, and data without a row is a
 * promise about the query.
 *
 * <h2>Windows</h2>
 *
 * <p>Baku's calendar, like {@link az.ideanest.subscription.application.RevenuePeriod}: today,
 * this month so far, every day of this month that had activity, the last twelve months, and this
 * month's plans. One query covers the twelve months and the rest is derived from it in memory, so
 * every figure on the page comes from the same snapshot (repeatable read) and a payment recorded
 * while the page is being built cannot appear in one figure and not its neighbour.
 */
@Service
public class PartnerStatistics {

    /** Baku, which is where the bank statement a figure is checked against is dated. */
    public static final ZoneId ZONE = ZoneId.of("Asia/Baku");

    private static final BigDecimal WHOLE = new BigDecimal("100.00");

    private final RevenueFigures figures;
    private final PartnerProfileRepository profiles;
    private final StaffDirectory directory;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;

    public PartnerStatistics(
            RevenueFigures figures,
            PartnerProfileRepository profiles,
            StaffDirectory directory,
            PlatformStaff staff,
            AuditLog audit,
            Clock clock) {
        this.figures = figures;
        this.profiles = profiles;
        this.directory = directory;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * The statistics for whoever is asking.
     *
     * @throws InsufficientStaffCapabilityException for anybody who is neither a super admin nor a
     *     partner
     * @throws PartnerNotConfiguredException for a partner with no percentage
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Statistics read(UUID accountId) {
        staff.requireCapability(accountId, StaffCapability.VIEW_PARTNER_STATISTICS);

        boolean superAdmin = directory.membershipOf(accountId).roles().stream().anyMatch(StaffRole::isSuperAdmin);
        View view;
        BigDecimal share;
        if (superAdmin) {
            view = View.REAL;
            share = WHOLE;
        } else {
            view = View.PARTNER;
            share = profiles.find(accountId)
                    .map(PartnerProfileView::percentage)
                    .orElseThrow(() -> new PartnerNotConfiguredException(accountId));
        }

        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, ZONE);
        YearMonth thisMonth = YearMonth.from(today);
        LocalDate monthStart = thisMonth.atDay(1);
        LocalDate firstMonth = thisMonth.minusMonths(11).atDay(1);
        Instant from = firstMonth.atStartOfDay(ZONE).toInstant();
        Instant to = today.plusDays(1).atStartOfDay(ZONE).toInstant();

        List<DayFigures> days = figures.perDay(from, to);
        List<PlanFigures> plans = figures.perPlan(monthStart.atStartOfDay(ZONE).toInstant(), to);

        List<DayFigures> todayRows = days.stream().filter(d -> d.day().equals(today)).toList();
        List<DayFigures> monthRows =
                days.stream().filter(d -> !d.day().isBefore(monthStart)).toList();

        Map<LocalDate, List<DayFigures>> monthByDay = new TreeMap<>();
        for (DayFigures row : monthRows) {
            monthByDay.computeIfAbsent(row.day(), ignored -> new ArrayList<>()).add(row);
        }
        List<DayStatistics> daily = monthByDay.entrySet().stream()
                .map(entry -> new DayStatistics(entry.getKey(), scaled(entry.getValue(), share)))
                .toList();

        List<MonthStatistics> monthly = new ArrayList<>();
        for (int back = 11; back >= 0; back--) {
            YearMonth month = thisMonth.minusMonths(back);
            List<DayFigures> rows =
                    days.stream().filter(d -> YearMonth.from(d.day()).equals(month)).toList();
            monthly.add(new MonthStatistics(month, scaled(rows, share)));
        }

        List<PlanStatistics> byPlan = plans.stream()
                .map(plan -> new PlanStatistics(
                        plan.planCode(),
                        plan.planName(),
                        plan.currency(),
                        ShareScaling.money(plan.net(), share),
                        ShareScaling.count(plan.payments(), share),
                        ShareScaling.count(plan.reversals(), share)))
                .toList();

        audit.recordIndependently(
                AuditAction.PARTNER_STATISTICS_READ,
                accountId,
                AuditActor.moderator(accountId),
                AuditOutcome.SUCCEEDED,
                "view=%s; share=%s".formatted(view, share.toPlainString()));

        return new Statistics(
                view,
                share,
                now,
                ZONE.getId(),
                new DayStatistics(today, scaled(todayRows, share)),
                new MonthStatistics(thisMonth, scaled(monthRows, share)),
                daily,
                monthly,
                byPlan);
    }

    /** Sums the rows per currency, then scales each sum once. */
    private static List<CurrencyFigures> scaled(List<DayFigures> rows, BigDecimal share) {
        Map<String, long[]> counts = new TreeMap<>();
        Map<String, BigDecimal> nets = new TreeMap<>();
        for (DayFigures row : rows) {
            nets.merge(row.currency(), row.net(), BigDecimal::add);
            long[] c = counts.computeIfAbsent(row.currency(), ignored -> new long[2]);
            c[0] += row.payments();
            c[1] += row.reversals();
        }
        return nets.entrySet().stream()
                .map(entry -> new CurrencyFigures(
                        entry.getKey(),
                        ShareScaling.money(entry.getValue(), share),
                        ShareScaling.count(counts.get(entry.getKey())[0], share),
                        ShareScaling.count(counts.get(entry.getKey())[1], share)))
                .sorted(Comparator.comparing(CurrencyFigures::currency))
                .toList();
    }

    /** Whether the figures are the real ones or a partner's share of them. */
    public enum View {
        REAL,
        PARTNER
    }

    /**
     * One currency's figures, already scaled.
     *
     * @param revenue what the platform kept: payments plus reversals
     * @param subscriptions payments received, which may be fractional for a partner
     * @param reversals reversals recorded, scaled the same way
     */
    public record CurrencyFigures(
            String currency, BigDecimal revenue, BigDecimal subscriptions, BigDecimal reversals) {}

    /** One day, in Baku. Empty {@code currencies} for a day with no activity. */
    public record DayStatistics(LocalDate date, List<CurrencyFigures> currencies) {}

    /** One calendar month, in Baku. */
    public record MonthStatistics(YearMonth month, List<CurrencyFigures> currencies) {}

    /** One plan this month, under the name it carried while the money arrived. */
    public record PlanStatistics(
            String planCode,
            String planName,
            String currency,
            BigDecimal revenue,
            BigDecimal subscriptions,
            BigDecimal reversals) {}

    /**
     * Everything the statistics page shows.
     *
     * @param view which answer this is
     * @param sharePercentage 100.00 for the real view, the partner's percentage otherwise
     * @param timeZone the zone every date and month is in
     */
    public record Statistics(
            View view,
            BigDecimal sharePercentage,
            Instant generatedAt,
            String timeZone,
            DayStatistics today,
            MonthStatistics thisMonth,
            List<DayStatistics> daily,
            List<MonthStatistics> monthly,
            List<PlanStatistics> byPlan) {}
}
