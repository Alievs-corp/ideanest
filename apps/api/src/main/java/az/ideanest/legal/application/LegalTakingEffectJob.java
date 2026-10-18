package az.ideanest.legal.application;

import az.ideanest.legal.LegalProperties;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import org.springframework.stereotype.Component;

/**
 * {@code legal-taking-effect}: a legal version dated for the future reaches the website on its
 * date.
 *
 * <p>Publishing announces a version at once, which drops the web's cached legal pages — and
 * for a version dated next month that announcement arrives a month early, when the previous
 * text is still the one in force. Nothing announced the date itself, so the site went on
 * showing the previous version until the web's hour-long window happened to expire. This pass
 * announces every version whose date has just passed, through the same event and the same
 * invalidation a publication uses.
 *
 * <p>The gates were never affected: they read the database on every submission and every
 * confirmation, so what governed was always right. What was late was the page.
 *
 * <p>A {@link ScheduledJob}, so one replica runs each pass and a failure is counted and backed
 * off rather than logged on every replica.
 */
@Component
public class LegalTakingEffectJob implements ScheduledJob {

    private final LegalDocuments documents;
    private final LegalProperties properties;
    private final Clock clock;

    public LegalTakingEffectJob(LegalDocuments documents, LegalProperties properties, Clock clock) {
        this.documents = documents;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    public String name() {
        return "legal-taking-effect";
    }

    @Override
    public String schedule() {
        return properties.inForce().schedule();
    }

    @Override
    public void run() {
        documents.announceTakingEffect(
                clock.instant().truncatedTo(ChronoUnit.MICROS), properties.inForce().lookback());
    }
}
