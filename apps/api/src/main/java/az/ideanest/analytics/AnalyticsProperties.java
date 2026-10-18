package az.ideanest.analytics;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Analytics settings.
 *
 * <p>Everything here is defaulted in code rather than in {@code application.yml}, for
 * the reason {@code AbuseProperties} gives: a deployment that configures none of this
 * has to start, and the value it starts with has to be the one somebody argued for
 * rather than a zero left behind by binding.
 *
 * @param referral how a visit becomes an attributed pledge — §4.7's CD-03
 * @param reporting the calendar and the currency AD-13's platform figures are stated in
 */
@ConfigurationProperties(prefix = "ideanest.analytics")
public record AnalyticsProperties(Referral referral, Reporting reporting) {

    public AnalyticsProperties {
        // A nested record binds to null when its whole block is absent, and a null
        // here would be a NullPointerException on the first visit rather than a
        // configuration error at start-up.
        referral = referral == null ? Referral.defaults() : referral;
        reporting = reporting == null ? Reporting.defaults() : reporting;
    }

    /**
     * How §4.11's AD-13 states a platform-wide figure — issue #313.
     *
     * @param timeZone the calendar a "day" belongs to. Must name the same zone as
     *     {@code AnalyticsAggregationProperties.zone} and the console front page's
     *     {@code DashboardService.ZONE}: {@code PlatformAnalyticsService} refuses to start
     *     otherwise, because two screens bucketing "the same" day differently would show two
     *     totals for it with nothing on either to say why
     * @param currency what the totals are denominated in. §21.2 gives nothing to convert
     *     with, so pledges in anything else are counted and reported separately rather than
     *     folded in — {@code PlatformAnalyticsService} has the argument
     */
    public record Reporting(String timeZone, String currency) {

        private static final String DEFAULT_TIME_ZONE = "Asia/Baku";

        private static final String DEFAULT_CURRENCY = "AZN";

        public static Reporting defaults() {
            return new Reporting(DEFAULT_TIME_ZONE, DEFAULT_CURRENCY);
        }

        public Reporting {
            timeZone = timeZone == null || timeZone.isBlank() ? DEFAULT_TIME_ZONE : timeZone;
            currency = currency == null || currency.isBlank() ? DEFAULT_CURRENCY : currency;

            // Parsed at start-up rather than per request, so a name neither the tz database
            // nor Java knows stops the process with the value in the message instead of
            // failing the first time somebody opens the dashboard.
            java.time.ZoneId.of(timeZone);

            if (!currency.matches("^[A-Z]{3}$")) {
                throw new IllegalArgumentException("A reporting currency is an ISO 4217 code, not " + currency);
            }
        }
    }

    /**
     * The three numbers the attribution rule is tuned by.
     *
     * @param attributionWindow <strong>how long a visit stays evidence.</strong>
     *     Thirty days, which is the interval this category of purchase is actually
     *     decided over: a backer who reads about a campaign, waits for a payday and
     *     comes back was still brought here by whoever told them. The two failure
     *     directions are not symmetrical — too short and the report credits "direct"
     *     for work somebody did, which makes a creator stop doing the thing that is
     *     working; too long and it credits a channel for a visit nobody remembers,
     *     which makes them keep spending. Thirty days is short enough that the second
     *     is bounded and long enough that the first is rare.
     *     <p>Changing it changes visits recorded from then on and cannot rewrite a
     *     report, because the window is frozen onto each row — see
     *     {@code ReferralTouch} and V24
     * @param repeatVisitInterval <strong>how long the same source from the same
     *     visitor is one visit.</strong> A person reading a campaign page reloads it,
     *     opens two tabs, and comes back from the same tweet three times in an
     *     afternoon; each of those is the same fact and recording it three times
     *     inflates nothing in the report — the rule takes one touch — but does turn
     *     the evidence table into a hit counter. Thirty minutes is the conventional
     *     session length and is what makes "a visit" mean something
     * @param maxSources <strong>how many rows a report may name.</strong> The
     *     labels on a visit are free text a link carried, so the number of distinct
     *     sources is bounded by what anybody chose to put in a URL rather than by
     *     anything the platform controls. Beyond this the remainder is folded into
     *     one {@code OTHER} row, so the shares still add up to a hundred and a
     *     creator's dashboard cannot be filled with somebody else's noise
     * @param visitsPerAddress §17.3's shape applied to an unauthenticated write: how
     *     many visits one source address may record in a window. The capture endpoint
     *     is reachable by anybody — that is what makes it a visit counter and not a
     *     signed-in event — so it is the rate limiter that stands between it and
     *     whoever wants to fill a creator's report
     * @param window the period the visit budget is counted over
     */
    public record Referral(
            Duration attributionWindow,
            Duration repeatVisitInterval,
            int maxSources,
            int visitsPerAddress,
            Duration window) {

        private static final Duration DEFAULT_ATTRIBUTION_WINDOW = Duration.ofDays(30);

        private static final Duration DEFAULT_REPEAT_VISIT_INTERVAL = Duration.ofMinutes(30);

        private static final int DEFAULT_MAX_SOURCES = 50;

        /** Generous for a person browsing, and a script is stopped within seconds. */
        private static final int DEFAULT_VISITS_PER_ADDRESS = 60;

        private static final Duration DEFAULT_WINDOW = Duration.ofMinutes(1);

        static Referral defaults() {
            return new Referral(
                    DEFAULT_ATTRIBUTION_WINDOW,
                    DEFAULT_REPEAT_VISIT_INTERVAL,
                    DEFAULT_MAX_SOURCES,
                    DEFAULT_VISITS_PER_ADDRESS,
                    DEFAULT_WINDOW);
        }

        public Referral {
            attributionWindow = attributionWindow == null ? DEFAULT_ATTRIBUTION_WINDOW : attributionWindow;
            repeatVisitInterval =
                    repeatVisitInterval == null ? DEFAULT_REPEAT_VISIT_INTERVAL : repeatVisitInterval;
            maxSources = maxSources == 0 ? DEFAULT_MAX_SOURCES : maxSources;
            // Failing open on a rate limit is a configuration mistake with no symptom
            // until it is exploited, so an omitted budget is the default and never
            // "unlimited".
            visitsPerAddress = visitsPerAddress == 0 ? DEFAULT_VISITS_PER_ADDRESS : visitsPerAddress;
            window = window == null ? DEFAULT_WINDOW : window;

            if (!attributionWindow.isPositive()) {
                throw new IllegalArgumentException("An attribution window is a positive duration");
            }
            if (repeatVisitInterval.isNegative()) {
                // Zero is meaningful and allowed: it records every visit, which is what
                // a deployment debugging its own tagging wants. Negative is not.
                throw new IllegalArgumentException("A repeat-visit interval is not negative");
            }
            if (maxSources < 1) {
                throw new IllegalArgumentException("A report names at least one source");
            }
            if (visitsPerAddress < 1) {
                throw new IllegalArgumentException("A caller may record at least one visit a window");
            }
            if (!window.isPositive()) {
                throw new IllegalArgumentException("A rate-limit window is a positive duration");
            }
        }
    }
}
