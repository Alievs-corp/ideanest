package az.ideanest.pledge.application;

import az.ideanest.pledge.domain.Pledge;
import az.ideanest.pledge.domain.PledgeAddon;
import az.ideanest.pledge.domain.PledgeState;
import az.ideanest.pledge.infrastructure.PledgeAddonRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What happens to a campaign's pledges when the campaign is stopped — #103.
 *
 * <h2>Two things, and the second is the one that is easy to forget</h2>
 *
 * <p>Every pledge that is still a pledge becomes {@link PledgeState#CANCELED_BY_PROJECT},
 * <strong>and every place those pledges hold goes back on sale</strong>. A campaign that
 * was suspended while holding four hundred places on a limited tier is four hundred
 * places nobody can ever buy, on a campaign nobody can ever back — and the count would
 * stay wrong for as long as the row exists, because nothing else releases them.
 *
 * <h2>What is deliberately not cancelled</h2>
 *
 * <p>A pledge whose money has moved: {@link PledgeState#COLLECTED}. Marking a
 * collected pledge {@code CANCELED_BY_PROJECT} would say the money was never taken, and
 * §6.2 gives the honest edge a different name — {@code COLLECTED → REFUNDED}, which is
 * #67's and needs a payment provider behind it.
 *
 * <p><strong>None of those states can exist today</strong>, because nothing collects
 * anything: epic #59 is blocked on choosing a provider, and §9.2 is explicit that no
 * money moves before it. So this counts them and logs a warning naming the campaign
 * rather than acting on them — an empty branch would be the same code with nothing to
 * find when it stops being empty.
 *
 * <h2>Why one transaction</h2>
 *
 * <p>The listener runs inside the dispatch transaction, so a campaign whose pledges
 * could not all be released is a dispatch that failed and an event that is retried. Half
 * a release — some pledges cancelled, some places still held — is the one outcome nobody
 * can repair from the outside, because there is no record of which half ran.
 */
@Service
public class PledgeCancellationService {

    private static final Logger log = LoggerFactory.getLogger(PledgeCancellationService.class);

    /**
     * The states a halt can end.
     *
     * <p>The one that holds stock and no money: a checkout in progress. Everything else is
     * either already over or is a payment, and the second of those is a refund rather than
     * a cancellation.
     */
    private static final Set<PledgeState> ENDABLE = Set.of(PledgeState.DRAFT);

    /** The states in which money has moved. See the class comment. */
    private static final Set<PledgeState> OWED_A_REFUND = Set.of(PledgeState.COLLECTED);

    private final PledgeRepository pledges;
    private final PledgeAddonRepository addons;
    private final ReservationService reservations;
    private final Clock clock;

    public PledgeCancellationService(
            PledgeRepository pledges,
            PledgeAddonRepository addons,
            ReservationService reservations,
            Clock clock) {

        this.pledges = pledges;
        this.addons = addons;
        this.reservations = reservations;
        this.clock = clock;
    }

    /**
     * Ends every pledge on a stopped campaign and gives back what they were holding.
     *
     * <p>Idempotent: a second delivery finds nothing active and cancels nothing, which is
     * the contract {@code OutboxMessage} asks every consumer to keep.
     *
     * @param projectId the campaign that stopped
     * @param eventType which halt it was, for the log line only. What happens to the
     *     pledges is the same either way
     * @return how many pledges this call ended
     */
    @Transactional
    public int releaseCampaign(UUID projectId, String eventType) {
        List<Pledge> active = pledges.findByProjectAndStates(projectId, PledgeState.ACTIVE);

        int ended = 0;
        int owedRefunds = 0;
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);

        for (Pledge pledge : active) {
            if (OWED_A_REFUND.contains(pledge.getState())) {
                owedRefunds++;
                continue;
            }
            if (!ENDABLE.contains(pledge.getState())) {
                continue;
            }
            List<PledgeAddon> heldAddons = addons.findByPledge(pledge.getId());
            reservations.cancelByProject(pledge, heldAddons, now);
            ended++;
        }

        if (owedRefunds > 0) {
            // Unreachable until epic #59 collects anything, and a warning rather than a
            // silent skip because the day it is reachable is the day somebody has to
            // refund these by hand -- and this line is the only place that would say so.
            log.warn(
                    "Campaign {} was stopped with {} pledges whose money has moved."
                            + " They were left alone: reversing a collected pledge is a refund (#67).",
                    projectId,
                    owedRefunds);
        }

        log.info("Campaign {} stopped ({}); ended {} of {} pledges", projectId, eventType, ended, active.size());
        return ended;
    }
}
