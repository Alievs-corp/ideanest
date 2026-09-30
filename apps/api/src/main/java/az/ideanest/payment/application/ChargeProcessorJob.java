package az.ideanest.payment.application;

import az.ideanest.payment.PaymentProperties;
import az.ideanest.pledge.application.CollectionStage;
import az.ideanest.project.application.CampaignCollections;
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
 * §8.4's {@code charge-processor}, every minute: opens the collection of campaigns
 * that closed above goal, and charges the pledges it queued (#64).
 *
 * <p>Two halves in one job, in that order, and it matters that they are one job. A
 * campaign is opened and its pledges are charged in the same pass, so §9.6's first row
 * — "immediately after close" — is honoured to within the minute the finaliser already
 * costs. Splitting them would add a second minute for no gain, on the one pass where a
 * creator is watching.
 *
 * <h2>Rate limiting, which is §9.3's R-09</h2>
 *
 * <p>The rate limit is <strong>{@code charges-per-pass} per tick</strong>, and that is
 * the whole of it. At the default hundred a minute the platform makes roughly 1.7
 * requests a second to a provider — a figure that can be agreed with one in advance,
 * which is what R-09 asks for, rather than one discovered by being throttled during a
 * campaign's close. A campaign with four thousand backers therefore takes about forty
 * minutes to collect, which is well inside §9.6's first day.
 *
 * <p>There is deliberately no sleeping inside a pass to smooth the rate further. A
 * sleep would hold the job's lease — {@code ideanest.jobs.lock-lease}, a minute — and a
 * pass that outlasts its lease is joined by a second replica, which is the one thing
 * this job's per-pledge row lock is protecting against.
 *
 * <h2>The circuit breaker ends a pass, and does not end the job</h2>
 *
 * <p>A {@link CollectionOutcome#PROVIDER_UNAVAILABLE} stops the pass immediately:
 * every remaining pledge would meet the same outage. The job itself does not fail —
 * {@code JobRunner} would count the failure, back it off exponentially, and eventually
 * mark it {@code DEAD}, which would mean a provider's bad ten minutes stopping
 * collection until somebody reset a row by hand. A returned pass and a breaker that
 * closes on its own is the recovery that needs nobody.
 */
@Component
public class ChargeProcessorJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(ChargeProcessorJob.class);

    private final CampaignCollections campaigns;
    private final CollectionOpening opening;
    private final CollectionRun collection;
    private final CollectionMetrics metrics;
    private final PaymentProperties.Collection properties;
    private final Clock clock;

    public ChargeProcessorJob(
            CampaignCollections campaigns,
            CollectionOpening opening,
            CollectionRun collection,
            CollectionMetrics metrics,
            PaymentProperties properties,
            Clock clock) {
        this.campaigns = campaigns;
        this.opening = opening;
        this.collection = collection;
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

    /** §8.4's {@code charge-processor}. */
    @Override
    public String name() {
        return "charge-processor";
    }

    /**
     * The schedule is a property so that the test profile can set it to {@code -} and
     * drive {@link #collect(Instant)} directly — the reason every job in this codebase
     * reads its own, and the sharpest one here: a timer firing in the background of a
     * test suite would charge the very pledges a test is about to charge itself, and the
     * assertion that fails would be about somebody's card.
     */
    @Override
    public String schedule() {
        return properties.schedule();
    }

    @Override
    public void run() {
        collect(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /**
     * One pass: open what has closed, then charge what is due.
     *
     * <p>Takes the instant rather than reading the clock, so that every campaign opened
     * in one pass is given the same seven-day window and a test can ask what happens in
     * five days without waiting five days.
     *
     * @return how many cards were charged, which is what an operator watching a
     *     campaign's close is actually looking at
     */
    public int collect(Instant now) {
        openClosedCampaigns(now);
        return chargeDuePledges(now);
    }

    /**
     * §6.1's {@code SUCCESSFUL → COLLECTING} for everything that has closed above goal.
     *
     * <p><strong>One campaign's failure does not stop the rest</strong>, which is
     * {@code CampaignFinalizerJob}'s line and is worth repeating here: those are other
     * people's campaigns, and one row that will not serialise must not hold every
     * campaign behind it out of collection.
     */
    private void openClosedCampaigns(Instant now) {
        List<UUID> awaiting = campaigns.awaitingCollection(properties.campaignsPerPass());
        for (UUID projectId : awaiting) {
            try {
                opening.open(projectId, now);
            } catch (RuntimeException e) {
                log.error("Could not open the collection of campaign {}; it stays SUCCESSFUL.", projectId, e);
            }
        }
    }

    /**
     * §9.6's first row, bounded by {@code charges-per-pass}.
     *
     * <p>{@code CHARGE_PENDING} only. A pledge that has been refused is
     * {@code CHARGE_FAILED} and belongs to {@code charge-retry}, whose schedule is
     * measured in hours because §9.6's is measured in days. The two queues never contend,
     * because a pledge is in exactly one state.
     *
     * <p>Unlike the loop above there is no per-pledge {@code catch}: an exception here is
     * a bug rather than one campaign's bad row — {@code CollectionRun} already turns
     * every expected failure into an outcome — and letting it out is what makes
     * {@code JobRunner} count it and eventually stop a job that is failing every minute.
     */
    private int chargeDuePledges(Instant now) {
        int charged = 0;
        for (int attempted = 0; attempted < properties.chargesPerPass(); attempted++) {
            CollectionOutcome outcome = collection.collectNext(CollectionStage.INITIAL, now);
            /*
             * Counted here rather than inside `collectNext` — #138. That method runs in the
             * transaction that moves somebody's money, and a meter registry does not belong
             * on that path: a counter that threw would roll back a charge that succeeded.
             */
            metrics.record(outcome);
            if (outcome == CollectionOutcome.COLLECTED) {
                charged++;
            }
            if (!outcome.continuesThePass()) {
                if (outcome == CollectionOutcome.NO_PROVIDER && attempted == 0) {
                    log.debug("No payment provider is configured; nothing was collected.");
                }
                break;
            }
        }
        if (charged > 0) {
            log.info("Collected {} pledges.", charged);
        }
        return charged;
    }
}
