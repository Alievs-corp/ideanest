package az.ideanest.staff.api;

import az.ideanest.staff.application.PartnerStatistics;
import java.time.Instant;
import java.util.List;

/**
 * The statistics page's response — #205.
 *
 * <p>Money and counts cross as strings with two decimals, the way money does everywhere on this
 * platform: a client that parsed {@code 33.33} into a binary double and summed a column would be
 * producing the rounding error the rule against floating-point money exists to keep out.
 *
 * <p><strong>There is deliberately no field here that could carry a transaction.</strong> No
 * payment identifier, no payer, no reference, no per-payment amount, no list of payments. The
 * statistics are sums and counts, and the test suite walks a real response looking for any key
 * that says otherwise.
 */
public final class PartnerStatisticsResponses {

    private PartnerStatisticsResponses() {}

    /**
     * @param view {@code REAL} for a super admin, {@code PARTNER} for a partner, so a screen can
     *     say which it is showing
     * @param sharePercentage {@code "100.00"} for the real view, the partner's percentage
     *     otherwise
     * @param timeZone the zone every date and month is in
     * @param today today's figures, empty {@code currencies} if nothing arrived
     * @param thisMonth the month so far
     * @param daily the days of this month that had activity, oldest first
     * @param monthly the last twelve months, oldest first, empty where nothing arrived
     * @param byPlan this month's figures per plan
     */
    public record Statistics(
            PartnerStatistics.View view,
            String sharePercentage,
            Instant generatedAt,
            String timeZone,
            Day today,
            Month thisMonth,
            List<Day> daily,
            List<Month> monthly,
            List<Plan> byPlan) {

        static Statistics of(PartnerStatistics.Statistics statistics) {
            return new Statistics(
                    statistics.view(),
                    statistics.sharePercentage().toPlainString(),
                    statistics.generatedAt(),
                    statistics.timeZone(),
                    Day.of(statistics.today()),
                    Month.of(statistics.thisMonth()),
                    statistics.daily().stream().map(Day::of).toList(),
                    statistics.monthly().stream().map(Month::of).toList(),
                    statistics.byPlan().stream().map(Plan::of).toList());
        }
    }

    /**
     * One currency.
     *
     * @param revenue what the platform kept, such as {@code "5000.00"}
     * @param subscriptions payments received, such as {@code "3.50"} for a partner at 50%
     * @param reversals reversals recorded, scaled the same way
     */
    public record Figures(String currency, String revenue, String subscriptions, String reversals) {

        static Figures of(PartnerStatistics.CurrencyFigures figures) {
            return new Figures(
                    figures.currency(),
                    figures.revenue().toPlainString(),
                    figures.subscriptions().toPlainString(),
                    figures.reversals().toPlainString());
        }
    }

    /** One day, {@code YYYY-MM-DD}, in Baku. */
    public record Day(String date, List<Figures> currencies) {

        static Day of(PartnerStatistics.DayStatistics day) {
            return new Day(day.date().toString(), day.currencies().stream().map(Figures::of).toList());
        }
    }

    /** One month, {@code YYYY-MM}, in Baku. */
    public record Month(String month, List<Figures> currencies) {

        static Month of(PartnerStatistics.MonthStatistics month) {
            return new Month(month.month().toString(), month.currencies().stream().map(Figures::of).toList());
        }
    }

    /** One plan this month, under the name it carried while the money arrived. */
    public record Plan(
            String planCode, String planName, String currency, String revenue, String subscriptions, String reversals) {

        static Plan of(PartnerStatistics.PlanStatistics plan) {
            return new Plan(
                    plan.planCode(),
                    plan.planName(),
                    plan.currency(),
                    plan.revenue().toPlainString(),
                    plan.subscriptions().toPlainString(),
                    plan.reversals().toPlainString());
        }
    }
}
