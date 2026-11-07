package az.ideanest.analytics;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Audience analytics settings — #633.
 *
 * <p>Under {@code ideanest.analytics.audience} rather than {@code ideanest.audience},
 * which the plan suggested: that prefix already belongs to
 * {@code shared.audience.AudienceProperties}, the notification module's recipient lists,
 * and two records binding one prefix would each silently ignore the other's keys.
 *
 * <p>Defaulted in code, as everything in this module is, for the reason
 * {@link AnalyticsProperties} gives. The calendar is not here: a "day" is
 * {@code ideanest.analytics.reporting.time-zone}, the same zone every other analytics
 * screen uses, which {@code PlatformAnalyticsService} already refuses to start without
 * agreeing with the rollup's.
 *
 * @param geoipDatabase where DB-IP's country database is, as a file path. The image
 *     downloads it at build time (the Dockerfile). <strong>Optional by design:</strong> a
 *     path that does not exist or cannot be read is logged once at start-up and every
 *     lookup answers "unknown" — a missing country is a worse statistic, never a reason
 *     for the API not to start. Blank means "do not look"
 * @param eventsPerAddress how many events one source address may send in a
 *     {@link #window}. The capture endpoint takes no credential, so this is what stands
 *     between it and somebody inflating a campaign's views. Higher than the referral
 *     limit on purpose: browser traffic reaches the API through Cloudflare and the web
 *     container, and until the deployment trusts Cloudflare's header (ops/deploy README)
 *     every reader behind one edge address shares one bucket — a site visit sends one
 *     event per page
 * @param window the period the event budget is counted over
 * @param cleanupSchedule when {@code audience-cleanup} deletes the salts and markers of
 *     days that have passed, as a UTC cron expression, or {@code -} to register the job
 *     without a timer (the test profile)
 */
@ConfigurationProperties(prefix = "ideanest.analytics.audience")
public record AudienceAnalyticsProperties(
        String geoipDatabase, int eventsPerAddress, Duration window, String cleanupSchedule) {

    private static final int DEFAULT_EVENTS_PER_ADDRESS = 600;

    private static final Duration DEFAULT_WINDOW = Duration.ofMinutes(1);

    /** Hourly, at twenty past: off the hour every other sweep fires on. */
    private static final String DEFAULT_CLEANUP_SCHEDULE = "0 20 * * * *";

    public AudienceAnalyticsProperties {
        geoipDatabase = geoipDatabase == null ? "" : geoipDatabase.trim();
        // Failing open on a rate limit is a configuration mistake with no symptom until it
        // is exploited, so an omitted budget is the default and never "unlimited".
        eventsPerAddress = eventsPerAddress == 0 ? DEFAULT_EVENTS_PER_ADDRESS : eventsPerAddress;
        window = window == null ? DEFAULT_WINDOW : window;
        cleanupSchedule = cleanupSchedule == null || cleanupSchedule.isBlank()
                ? DEFAULT_CLEANUP_SCHEDULE
                : cleanupSchedule;

        if (eventsPerAddress < 1) {
            throw new IllegalArgumentException("A caller may send at least one audience event a window");
        }
        if (!window.isPositive()) {
            throw new IllegalArgumentException("A rate-limit window is a positive duration");
        }
    }
}
