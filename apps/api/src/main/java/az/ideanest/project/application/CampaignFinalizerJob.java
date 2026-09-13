package az.ideanest.project.application;

import az.ideanest.project.ProjectProperties;
import az.ideanest.project.infrastructure.ProjectRepository;
import az.ideanest.shared.jobs.ScheduledJob;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * §8.4's {@code campaign-finalizer}, every minute: applies §5.1 at the deadline.
 *
 * <p><strong>This is the job the platform is built around.</strong> Every other sweep in
 * §8.4 keeps something tidy or moves something along; this one is the moment a campaign
 * stops being a page and becomes an obligation. Until it ran, a campaign whose deadline
 * had passed simply stayed {@code LIVE} — the state machine has had the edge since #31 and
 * nothing performed it, so a funded campaign would have gone on counting down for ever and
 * nobody would have been charged.
 *
 * <h2>Why a minute is the right lateness</h2>
 *
 * <p>A deadline is a promise to backers and creators about a wall-clock moment, and a job
 * that ran hourly would close a campaign up to an hour after the countdown reached zero —
 * an hour in which the page says "0 minutes left" and the campaign is still taking money.
 * A minute is small enough to read as the same moment and large enough that the sweep
 * costs one indexed lookup that usually returns nothing.
 *
 * <p><strong>Late is safe here, and early would not be.</strong> The pass compares each
 * campaign's stored deadline against its own instant, under the lock, so a run that starts
 * ten minutes late closes exactly the campaigns that would have closed on time and gives
 * every one of them the same outcome. What it costs is that pledges made in those ten
 * minutes count — which is the correct answer, because a pledge the platform accepted is
 * a pledge the platform accepted.
 *
 * <h2>The claim, and why the lease is not it</h2>
 *
 * <p>On the durable scheduler like every job since #134, so a fleet of replicas produces
 * one sweep rather than one per replica. The lease is <em>not</em> what makes this
 * correct: §8.4 is explicit that a run outlasting its lease is joined by a second replica
 * part-way through. What prevents a campaign being closed twice is
 * {@link ProjectTransitionService#finalise} claiming the row with
 * {@code findByIdForUpdate} and re-reading the state under the lock — the second caller
 * waits, finds {@code SUCCESSFUL}, and does nothing. That matters more here than anywhere
 * else in §8.4: closing a campaign twice would record two decisions and publish two
 * events, and the second event is ten thousand duplicate notifications about somebody's
 * money.
 */
@Component
public class CampaignFinalizerJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(CampaignFinalizerJob.class);

    private final ProjectRepository projects;
    private final CampaignFinalizer finalizer;
    private final ProjectProperties properties;
    private final Clock clock;

    public CampaignFinalizerJob(
            ProjectRepository projects, CampaignFinalizer finalizer, ProjectProperties properties, Clock clock) {
        this.projects = projects;
        this.finalizer = finalizer;
        this.properties = properties;
        this.clock = clock;
    }

    /** §8.4's {@code campaign-finalizer}. */
    @Override
    public String name() {
        return "campaign-finalizer";
    }

    /**
     * The schedule is a property so that the test profile can set it to {@code -} and
     * drive {@link #finaliseClosedCampaigns(Instant)} directly — the reason every job in
     * this codebase reads its own, and a sharper one here: the suite moves
     * {@code AdjustableClock} past campaign deadlines on purpose, and a timer firing in
     * the background would close the very campaigns a test is about to close itself.
     */
    @Override
    public String schedule() {
        return properties.finalisation().schedule();
    }

    @Override
    public void run() {
        finaliseClosedCampaigns(clock.instant().truncatedTo(ChronoUnit.MICROS));
    }

    /**
     * One pass: up to a batch of campaigns whose deadline has passed.
     *
     * <p>Takes the instant rather than reading the clock, so that every campaign in one
     * pass is judged against one moment and a test can ask what happens after a deadline
     * without waiting for it.
     *
     * <p>Bounded rather than exhaustive. Campaigns cluster at midnight and at the ends of
     * months, so "every campaign that has closed" is a number this job does not control;
     * the remainder is a minute away, in deadline order, so the campaign that has been
     * waiting longest is closed first.
     *
     * <p><strong>One campaign's failure does not stop the rest</strong>, and that is the
     * single most important line in this file. A campaign whose event will not serialise,
     * or whose row is locked by something that has hung, must not prevent every campaign
     * behind it from closing — those are other people's campaigns, and the alternative is
     * one bad row holding the entire platform's deadlines open. The failure is logged at
     * {@code ERROR} naming the campaign, the row stays {@code LIVE}, and the next pass
     * tries again.
     *
     * @return how many campaigns this pass closed
     */
    public int finaliseClosedCampaigns(Instant now) {
        List<UUID> closed = projects.findClosedCampaigns(
                now,
                now.minus(properties.finalisation().closingWindow()),
                PageRequest.ofSize(properties.finalisation().batchSize()));

        int finalised = 0;
        for (UUID projectId : closed) {
            try {
                if (finalizer.finalise(projectId, now)) {
                    finalised++;
                }
            } catch (RuntimeException e) {
                log.error("Could not finalise campaign {}; it stays live until the next pass.", projectId, e);
            }
        }

        if (finalised > 0) {
            log.info("Finalised {} of {} campaigns past their deadline.", finalised, closed.size());
        }
        return finalised;
    }
}
