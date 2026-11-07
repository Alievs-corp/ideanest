package az.ideanest.analytics.application;

import az.ideanest.analytics.AudienceAnalyticsProperties;
import az.ideanest.shared.jobs.ScheduledJob;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * {@code audience-cleanup}: forgets the salts and first-of-the-day markers of days that
 * have passed — #633.
 *
 * <p>This is the job the "no stored identifier" promise rests on. Until it runs, a day's
 * salt still exists and the day's visitor keys could in principle be recomputed from an
 * address; after it, they cannot. Hourly rather than daily so that a failed pass costs an
 * hour of delay rather than a day, and on the shared scheduler with its lease like every
 * other job: two replicas deleting the same rows is harmless, and still twice the work.
 *
 * <p>The trigger and nothing else, as {@link AnalyticsRollupJob} is: the work is
 * {@link AudienceEventService#forgetPassedDays}, which a test calls directly.
 */
@Component
public class AudienceCleanupJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(AudienceCleanupJob.class);

    private final AudienceEventService audience;
    private final AudienceAnalyticsProperties properties;

    public AudienceCleanupJob(AudienceEventService audience, AudienceAnalyticsProperties properties) {
        this.audience = audience;
        this.properties = properties;
    }

    @Override
    public String name() {
        return "audience-cleanup";
    }

    /** {@code -} in the test profile, which drives the work directly. */
    @Override
    public String schedule() {
        return properties.cleanupSchedule();
    }

    @Override
    public void run() {
        int forgotten = audience.forgetPassedDays();
        if (forgotten > 0) {
            log.info("Forgot {} audience salts and markers from days that have passed", forgotten);
        }
    }
}
