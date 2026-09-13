package az.ideanest.project.application;

import az.ideanest.project.domain.CampaignOutcome;
import az.ideanest.project.domain.Project;
import az.ideanest.project.domain.ProjectState;
import az.ideanest.shared.outbox.Outbox;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * One campaign, decided by §5.1 and announced, in one transaction.
 *
 * <p><strong>The transaction boundary is the whole reason this class exists</strong>
 * rather than being three lines inside {@link CampaignFinalizerJob}. Three things have to
 * commit together:
 *
 * <ol>
 *   <li>the {@code LIVE → SUCCESSFUL} or {@code LIVE → UNSUCCESSFUL} edge, with its row in
 *       {@code project_state_transitions};
 *   <li>V29's frozen outcome, which is the evidence for that edge;
 *   <li>the {@code project.succeeded} or {@code project.unsuccessful} outbox event, which
 *       is how everybody who backed the campaign finds out.
 * </ol>
 *
 * <p>Any two of the three without the third is a distinct kind of wrong. A state without
 * an event is a campaign that closed and told nobody. An event without a state is a
 * backer told their campaign succeeded and a page that still shows a countdown. A state
 * without a frozen outcome is a decision with no evidence, which V29 argues at length
 * will read as the opposite decision once collections start failing.
 *
 * <p><strong>And one campaign per transaction, not one pass per transaction.</strong> A
 * batch that shared a transaction would make one campaign's failure roll back every
 * campaign the pass had already closed, and — worse — would hold the outbox insert of the
 * first campaign open until the last one finished. The sweep above catches the failure
 * per campaign and carries on, which is {@code ReservationCleanerJob}'s arrangement and
 * for the same reason: every campaign behind this one also has backers waiting to be
 * told.
 *
 * <h2>What this does not do</h2>
 *
 * <p><strong>It collects nothing.</strong> §5.1's successful branch says "collect every
 * confirmed pledge", and that is {@code batched collection at campaign close} (#64), which
 * moves {@code SUCCESSFUL → COLLECTING} and works from the state this job writes. §6.1
 * makes them two states precisely so that deciding and charging are two decisions with a
 * durable record between them — a platform that decided and charged in one transaction
 * could not tell you, after a crash, which of the two it had done.
 *
 * <p><strong>It purges nothing.</strong> §5.1's unsuccessful branch deletes stored card
 * tokens within thirty days, which is §8.4's {@code token-cleaner} and which reads the
 * same state. Thirty days is not this job's minute.
 */
@Service
public class CampaignFinalizer {

    private static final Logger log = LoggerFactory.getLogger(CampaignFinalizer.class);

    private final ProjectTransitionService transitions;
    private final Outbox outbox;

    public CampaignFinalizer(ProjectTransitionService transitions, Outbox outbox) {
        this.transitions = transitions;
        this.outbox = outbox;
    }

    /**
     * Closes one campaign, or finds that somebody else already has.
     *
     * <p>{@link Propagation#REQUIRES_NEW} rather than the default, and it is deliberate:
     * the sweep that calls this is not transactional, but a test — or a future caller —
     * that drove it from inside one would otherwise silently turn "one campaign per
     * transaction" back into "one pass per transaction", which is the property this class
     * exists to have. Asking for a new transaction states the requirement instead of
     * inheriting whatever the caller happened to have.
     *
     * @param projectId a campaign {@code findClosedCampaigns} selected
     * @param now the pass's instant, used for the deadline comparison and stamped on the
     *     row; see {@link ProjectTransitionService#finalise}
     * @return whether this call is the one that closed it
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean finalise(UUID projectId, Instant now) {
        Optional<Project> finalised = transitions.finalise(projectId, now);
        if (finalised.isEmpty()) {
            return false;
        }

        Project project = finalised.get();
        if (project.getState() == ProjectState.CLOSING_WINDOW) {
            // IDN-EXT-01 (#33): the deadline opened the seven days and decided nothing, so there
            // is nothing to announce. The page's "Closing soon" badge is read from the state;
            // an event here would be a message about a decision nobody has taken.
            log.debug("Campaign {} entered its closing window.", project.getId());
            return true;
        }
        // Recorded from the row after the freeze, never from the numbers this method was
        // handed, so a redelivery eight hours later reproduces the message the deadline
        // would have produced. CampaignFinalisedEvent says why the outcome is the event
        // type rather than a field in it.
        UUID eventId = outbox.record(
                CampaignFinalisedEvent.AGGREGATE_TYPE,
                project.getId(),
                // The state the transition wrote, not the rule applied again: the threshold is
                // configuration, and a second reading of it could disagree with the first.
                CampaignFinalisedEvent.eventTypeFor(CampaignOutcome.decidedBy(project.getState())),
                CampaignFinalisedEvent.of(project));

        // The two identifiers and the state, which is what lets somebody trace a backer's
        // "my campaign succeeded" message back to the decision that produced it. No
        // amount: a log line about a campaign should not be a record of what it raised.
        log.debug(
                "Campaign {} finalised as {}; recorded outbox event {}.",
                project.getId(),
                project.getState(),
                eventId);
        return true;
    }
}
