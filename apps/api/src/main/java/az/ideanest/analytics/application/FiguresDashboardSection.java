package az.ideanest.analytics.application;

import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.dashboard.DashboardSection;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The money on the console's front page: what was pledged, by how many people, and how it went —
 * #222.
 *
 * <p>Built on {@link PlatformAnalyticsService}, which is the one place these are computed, so the
 * dashboard and {@code /admin/analytics} cannot disagree about what a month came to. That service
 * checks {@code VIEW_FINANCE} itself, which is also what this section declares: the front page
 * shows revenue to exactly the people whose revenue screen would show it to them, and a
 * moderator's page has none.
 *
 * <p>The real figures, always. A partner holds neither capability and is never served this
 * section; their share is on their own statistics page, scaled there.
 */
@Component
public class FiguresDashboardSection implements DashboardSection {

    private static final BigDecimal HUNDRED = new BigDecimal("100");

    private final PlatformAnalyticsService analytics;

    public FiguresDashboardSection(PlatformAnalyticsService analytics) {
        this.analytics = analytics;
    }

    @Override
    public String key() {
        return "figures";
    }

    @Override
    public int order() {
        return 10;
    }

    @Override
    public Set<StaffCapability> requiresAny() {
        return Set.of(StaffCapability.VIEW_FINANCE);
    }

    @Override
    public Reading read(UUID staffId, Window window) {
        PlatformAnalytics result = analytics.dashboard(staffId, window.from(), window.to());
        PlatformAnalytics.Totals totals = result.totals();
        PlatformAnalytics.Outcomes outcomes = result.outcomes();

        List<Figure> figures = new ArrayList<>();
        figures.add(Figure.money("pledgeVolume", totals.volume().amount(), totals.volume().currency()));
        figures.add(Figure.count("pledgeCount", totals.pledgeCount()));
        figures.add(Figure.count("backerCount", totals.backerCount()));
        figures.add(Figure.money("averagePledge", totals.averagePledge().amount(), totals.averagePledge().currency()));
        // Reported rather than dropped: pledges in another currency are not in the volume above,
        // and a figure with a silent exclusion is worse than one with a stated gap.
        figures.add(Figure.count("otherCurrencyPledges", totals.otherCurrencyPledges()));
        figures.add(Figure.count("campaignsSucceeded", outcomes.succeeded()));
        figures.add(Figure.count("campaignsFailed", outcomes.failed()));
        figures.add(Figure.ratio("successRate", successRate(outcomes.succeeded(), outcomes.failed())));

        List<Point> series = result.daily().stream()
                .map(point -> new Point(point.day(), point.volume().amount().toPlainString(), point.pledgeCount()))
                .toList();

        return new Reading(figures, series);
    }

    /**
     * Succeeded over decided, in per cent, from the two counts rather than from the service's
     * {@code Double}: a binary fraction has no business on a page whose other figures are decimal
     * strings. Null when nothing has been decided yet, which the page says instead of showing 0%.
     */
    static BigDecimal successRate(long succeeded, long failed) {
        long decided = succeeded + failed;
        if (decided == 0) {
            return null;
        }
        return BigDecimal.valueOf(succeeded).multiply(HUNDRED).divide(BigDecimal.valueOf(decided), 2, RoundingMode.HALF_EVEN);
    }
}
