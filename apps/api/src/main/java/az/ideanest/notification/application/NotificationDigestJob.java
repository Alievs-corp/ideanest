package az.ideanest.notification.application;

import az.ideanest.notification.NotificationProperties;
import az.ideanest.notification.application.DigestAssembly.Outcome;
import az.ideanest.notification.domain.NotificationChannel;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §8.4's {@code notification-digest}: the job §12.2 promised and #244 reported missing.
 *
 * <p>{@code NotificationSender} is this class for the immediate queue, and the shape is
 * deliberately the same: a bounded pass that asks {@link DigestAssembly} for one message at a
 * time until there is nothing due or the pass is spent. Its reasoning about that shape applies
 * here without change — the transaction is inside the loop and not around it, because a pass that
 * opened one transaction and sent a hundred messages would re-send all hundred on a rollback
 * after the ninety-ninth; a refusal does not end the pass, because every digest still waiting is
 * somebody else's; and nothing here retries, because a retry is the next pass finding the group
 * eligible again.
 *
 * <h2>Hourly, for a daily digest</h2>
 *
 * <p>Not a contradiction, and {@code DigestWindow} is where the argument lives. The alternative —
 * a cron that fires once a day at the digest hour — is the one in which a single missed tick
 * delays a whole day's digest by a whole day, silently. So what the pass does is send everything
 * held from before the most recently <em>closed</em> digest period, which makes the cron's
 * frequency a statement about promptness rather than about correctness: an hourly tick means a
 * due digest goes out within the hour, and a tick lost to a deployment costs an hour rather than
 * a day.
 *
 * <p>Twenty-three ticks out of twenty-four therefore find nothing and return, which costs one
 * indexed query against a partial index. That is the price of the property above.
 *
 * <p><strong>On the shared scheduler, and this one genuinely needs the lease.</strong>
 * {@code AnalyticsRollupJob} makes the same declaration for the same reason and
 * {@link DigestAssembly} explains what specifically depends on it: a digest's claim is two
 * statements rather than one, because rows behind a {@code GROUP BY} cannot be locked, and the
 * lease is what stops two replicas picking the same group in the window between them. Moving
 * this to a per-replica timer would reintroduce a race whose symptom is somebody receiving the
 * same digest twice.
 *
 * <p>Throwing is how a failed pass is recorded. {@code JobRunner} counts the attempt in
 * {@code scheduled_jobs}, releases the lease, and backs off; catching a failure here to keep the
 * log tidy would have the job recorded as having succeeded.
 */
@Component
public class NotificationDigestJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(NotificationDigestJob.class);

    private final DigestAssembly assembly;
    private final NotificationProperties properties;
    private final Clock clock;

    public NotificationDigestJob(DigestAssembly assembly, NotificationProperties properties, Clock clock) {
        this.assembly = assembly;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * Paused while a maintenance window is in force (#214). It sends the scheduled digest
     * emails.
     */
    @Override
    public boolean pausesDuringMaintenance() {
        return true;
    }

    /** §8.4's name for it, verbatim. It is the key the lease is taken on. */
    @Override
    public String name() {
        return "notification-digest";
    }

    /**
     * From configuration, so that the test profile can set it to {@code -} and drive
     * {@link #combineDue(Instant)} with the instant it wants. A combining job firing in the
     * background of a suite sends the very rows a test is about to assert are held, on another
     * thread, which is the hardest kind of flake to reproduce.
     */
    @Override
    public String schedule() {
        return properties.digest().schedule();
    }

    @Override
    public void run() {
        combineDue(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /** One pass over the digests that are due, to the channels the application is wired with. */
    public int combineDue(Instant now) {
        return pass(now, null);
    }

    /**
     * One pass, to a given set of channels.
     *
     * @param now the instant this pass judges the digest period, eligibility and backoff
     *     against, so that every group in it is judged against one moment rather than against a
     *     clock that moved while the pass was running
     * @param senders what to hand each channel's digest to. See
     *     {@link DigestAssembly#combineNext(Instant, Map)} for why this is a parameter
     * @return how many digests this pass sent
     */
    public int combineDue(Instant now, Map<NotificationChannel, ChannelSender> senders) {
        return pass(now, Objects.requireNonNull(senders, "A pass sends to some set of channels"));
    }

    private int pass(Instant now, Map<NotificationChannel, ChannelSender> senders) {
        int sent = 0;
        int failed = 0;

        for (int attempted = 0; attempted < properties.digest().batchSize(); attempted++) {
            Outcome outcome = senders == null ? assembly.combineNext(now) : assembly.combineNext(now, senders);
            if (outcome == Outcome.NOTHING_TO_DO) {
                break;
            }
            if (outcome == Outcome.SENT) {
                sent++;
            } else {
                failed++;
            }
        }

        if (failed > 0) {
            log.warn("Digest pass sent {} and could not send {}.", sent, failed);
        } else if (sent > 0) {
            // Info rather than debug, unlike the sender's equivalent: this runs a handful of
            // times a day rather than every second, and "the digest went out, and it covered
            // this many people" is the line somebody looks for when asked whether it did.
            log.info("Digest pass sent {}.", sent);
        }
        return sent;
    }
}
