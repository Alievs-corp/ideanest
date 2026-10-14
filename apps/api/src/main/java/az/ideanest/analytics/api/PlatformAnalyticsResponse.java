package az.ideanest.analytics.api;

import az.ideanest.analytics.application.PlatformAnalytics;
import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/**
 * AD-13's dashboard, as the service describes it — issue #313.
 *
 * <p>Every amount is a {@link Money} and therefore a string with its currency, per §10.3.
 * A dashboard is exactly where a JSON number would look harmless and would round somebody's
 * revenue in the last place.
 *
 * @param computedAt when this was read, so a tab left open cannot be mistaken for a live
 *     figure
 * @param notBuilt what AD-13 asks for and this screen does not answer, in the words the
 *     console renders. <strong>Sent by the service rather than hard-coded in the
 *     browser</strong>, so that the day cohorts are built the panel disappears without a
 *     frontend change — the same arrangement the console index uses for its blocked modules
 */
public record PlatformAnalyticsResponse(
        LocalDate from,
        LocalDate to,
        Instant computedAt,
        Totals totals,
        List<DailyPoint> daily,
        Outcomes outcomes,
        List<String> notBuilt) {

    /**
     * What AD-13 lists that no rollup can answer yet. {@code PlatformAnalyticsService} has why.
     *
     * <p><strong>Codes rather than sentences, since #403.</strong> These were English prose,
     * and the console rendered them under a translated heading in all four languages — the
     * only untranslated paragraph on the screen. A code the console looks up keeps the
     * property this field exists for, which is that the day cohorts are built the panel
     * disappears without a frontend change: the service stops sending the code. A code the
     * console does not recognise is drawn as itself, so a new one shows up rather than
     * vanishing.
     */
    private static final List<String> NOT_BUILT = List.of("COHORTS", "FUNNELS");

    public static PlatformAnalyticsResponse of(PlatformAnalytics analytics) {
        return new PlatformAnalyticsResponse(
                analytics.from(),
                analytics.to(),
                analytics.computedAt(),
                Totals.of(analytics.totals()),
                analytics.daily().stream().map(DailyPoint::of).toList(),
                Outcomes.of(analytics.outcomes()),
                NOT_BUILT);
    }

    /** The headline figures. */
    public record Totals(
            long pledgeCount,
            Money volume,
            Money averagePledge,
            long backerCount,
            long liveProjects,
            long otherCurrencyPledges,
            Money planRevenue,
            long planPayments) {

        static Totals of(PlatformAnalytics.Totals totals) {
            return new Totals(
                    totals.pledgeCount(),
                    totals.volume(),
                    totals.averagePledge(),
                    totals.backerCount(),
                    totals.liveProjects(),
                    totals.otherCurrencyPledges(),
                    totals.planRevenue(),
                    totals.planPayments());
        }
    }

    /** One day of the chart. */
    public record DailyPoint(LocalDate day, long pledgeCount, Money volume) {

        static DailyPoint of(PlatformAnalytics.DailyPoint point) {
            return new DailyPoint(point.day(), point.pledgeCount(), point.volume());
        }
    }

    /**
     * How campaigns that closed in the window ended.
     *
     * @param successRate null when nothing closed. Null rather than zero, because "no
     *     campaigns closed" and "none of them succeeded" are different facts and a zero on
     *     a dashboard reads as the second
     */
    public record Outcomes(long succeeded, long failed, Double successRate) {

        static Outcomes of(PlatformAnalytics.Outcomes outcomes) {
            return new Outcomes(outcomes.succeeded(), outcomes.failed(), outcomes.successRate());
        }
    }
}
