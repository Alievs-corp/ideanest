package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.pledge.application.CollectionStage;
import az.ideanest.pledge.application.PledgeCollection;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * §8.4's {@code charge-retry}, every six hours: §9.6's second, third and fourth
 * attempts, and the drop at the end of the window (#65).
 *
 * <h2>Six hours, not a minute</h2>
 *
 * <p>§9.6's slots are at +24 hours, +72 hours and +5 days, so nobody can tell an
 * attempt made at 24:00 from one made at 27:00, and a sweep every minute would be
 * fifteen hundred passes a day finding nothing. Late is safe here in a way it is not
 * for the initial collection: a retry is a second chance at a card the backer has been
 * told to change, and the thing that must be on time is the seven-day drop — which is
 * also measured in days.
 *
 * <h2>Two jobs and not one, which is the lease's doing</h2>
 *
 * <p>{@code JobRunner} counts failures per job name and backs a failing job off to a
 * ten-minute cap and then {@code DEAD}. One job doing both queues would mean a database
 * problem in the retry sweep backing off the initial collection too — and the initial
 * collection is the pass that runs while a creator is watching their campaign close.
 * Two names, two lease rows, two failure budgets: the same argument §8.4 makes for
 * splitting {@code reminder-sender} from {@code deadline-reminder}.
 *
 * <h2>The drop is in this job rather than in one of its own</h2>
 *
 * <p>§8.4 does not list a {@code charge-dropper}, and it should not: the drop is the
 * last row of the same table the retries come from, its granularity is the same, and a
 * separate job would be a third lease row and a third failure budget for one bounded
 * {@code UPDATE}. It runs <em>after</em> the retries in each pass, so a pledge whose
 * final attempt is due in the same pass gets that attempt before its window is judged.
 */
@Component
public class ChargeRetryJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(ChargeRetryJob.class);

    private final CollectionRun collection;
    private final PledgeCollection pledges;
    private final CollectionDrop drop;
    private final PaymentProperties.Collection properties;
    private final CollectionMetrics metrics;
    private final Clock clock;

    public ChargeRetryJob(
            CollectionRun collection,
            PledgeCollection pledges,
            CollectionDrop drop,
            CollectionMetrics metrics,
            PaymentProperties properties,
            Clock clock) {
        this.collection = collection;
        this.pledges = pledges;
        this.drop = drop;
        this.metrics = metrics;
        this.properties = properties.collection();
        this.clock = clock;
    }

    /**
     * Paused while a maintenance window is in force (#214). It charges backers' cards.
     */
    @Override
    public boolean pausesDuringMaintenance() {
        return true;
    }

    /** §8.4's {@code charge-retry}. */
    @Override
    public String name() {
        return "charge-retry";
    }

    /** A property so that the test profile can set it to {@code -}; see {@code ChargeProcessorJob}. */
    @Override
    public String schedule() {
        return properties.retrySchedule();
    }

    @Override
    public void run() {
        retryFailedCollections(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /**
     * One pass: retry what is due, then drop what has run out of time.
     *
     * @return how many cards were collected on a retry
     */
    public int retryFailedCollections(Instant now) {
        int collected = retryDue(now);
        dropExpired(now);
        return collected;
    }

    private int retryDue(Instant now) {
        int collected = 0;
        for (int attempted = 0; attempted < properties.chargesPerPass(); attempted++) {
            CollectionOutcome outcome = collection.collectNext(CollectionStage.RETRY, now);
            // Counted on both passes, so §8.4's failure rate covers a retry that keeps
            // failing as well as a first attempt that does — #138.
            metrics.record(outcome);
            if (outcome == CollectionOutcome.COLLECTED) {
                collected++;
            }
            if (!outcome.continuesThePass()) {
                break;
            }
        }
        if (collected > 0) {
            log.info("Collected {} pledges on retry.", collected);
        }
        return collected;
    }

    /**
     * §9.6's last row: seven days after the close, a pledge that could not be charged is
     * dropped.
     *
     * <p><strong>One pledge's failure does not stop the rest</strong>, and here that is
     * more than a convention: a pledge that will not drop is a pledge that goes on being
     * retried for ever, and every other backer on the campaign is waiting behind it to
     * find out whether their own pledge stands.
     *
     * <p>Bounded by {@code drops-per-pass}. The remainder is six hours away, which is
     * well inside the tolerance of a deadline measured in days.
     */
    private void dropExpired(Instant now) {
        List<UUID> expired = pledges.pastTheirWindow(now, properties.dropsPerPass());
        int dropped = 0;
        for (UUID pledgeId : expired) {
            try {
                if (drop.drop(pledgeId, now)) {
                    dropped++;
                }
            } catch (RuntimeException e) {
                log.error("Could not drop pledge {}; it stays in the queue until the next pass.", pledgeId, e);
            }
        }
        if (dropped > 0) {
            log.info("Dropped {} of {} pledges past §9.6's window.", dropped, expired.size());
        }
    }

}
