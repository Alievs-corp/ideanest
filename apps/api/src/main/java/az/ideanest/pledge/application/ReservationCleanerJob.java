package az.ideanest.pledge.application;

import az.ideanest.pledge.PledgeProperties;
import az.ideanest.pledge.infrastructure.PledgeRaiseRepository;
import az.ideanest.pledge.infrastructure.PledgeRepository;
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
 * §8.4's {@code reservation-cleaner}, every minute: gives back the places held by
 * checkouts nobody finished.
 *
 * <p><strong>This is the price of not using a Redis TTL</strong>, and it is the
 * whole of it. PostgreSQL has no expiry, so a reservation lapses because a job
 * notices that it has — see V17 for why the reservation lives in the database
 * anyway. §8.4 lists this job, so the sweep is the design rather than a workaround
 * for it, and it buys something back: an expired reservation is a row with a state
 * and a history rather than a key that silently stopped existing.
 *
 * <p><strong>On the durable scheduler since #134</strong>, which means the trigger
 * claims a lease and exactly one replica sweeps. This job did not need that to be
 * correct: {@link ReservationExpiry#release} claims each row with a conditional
 * update, so two replicas sweeping at once already credited the tier once. What it
 * gains is that they no longer both read the same batch of lapsed drafts a minute —
 * and what the platform gains is that a sweep which starts failing now backs off and
 * says so, rather than throwing into a log once a minute for ever.
 *
 * <p>A minute late here is a minute in which a limited tier looks sold out while a
 * place is actually free: a lost sale rather than a wrong one, which is why this was
 * tolerable on an unclaimed timer and would not have been for anything that moves
 * money.
 */
@Component
public class ReservationCleanerJob implements ScheduledJob {

    private static final Logger log = LoggerFactory.getLogger(ReservationCleanerJob.class);

    private final PledgeRepository pledges;
    private final ReservationExpiry expiry;
    private final PledgeRaiseRepository raises;
    private final PledgeRaiseService raiseService;
    private final PledgeProperties properties;
    private final Clock clock;

    public ReservationCleanerJob(
            PledgeRepository pledges,
            ReservationExpiry expiry,
            PledgeRaiseRepository raises,
            PledgeRaiseService raiseService,
            PledgeProperties properties,
            Clock clock) {
        this.pledges = pledges;
        this.expiry = expiry;
        this.raises = raises;
        this.raiseService = raiseService;
        this.properties = properties;
        this.clock = clock;
    }

    /** §8.4's {@code reservation-cleaner}. */
    @Override
    public String name() {
        return "reservation-cleaner";
    }

    /**
     * The schedule is a property so that the test profile can set it to {@code -}
     * and drive {@link #releaseExpiredReservations(Instant)} directly. A timer
     * firing in the background of a test suite is a source of failures that
     * reproduce once a fortnight — and this one fires every minute, at rows a
     * concurrency test is in the middle of asserting on.
     */
    @Override
    public String schedule() {
        return properties.reservation().cleanupSchedule();
    }

    @Override
    public void run() {
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        releaseExpiredReservations(now);
        releaseLapsedRaises(now);
        settlePaidRaises(now);
    }

    /**
     * #171: a raise whose charge settled and which nothing settled with it — a node of the release
     * before raises existed took the webhook during a rolling deployment (V83) — is settled now, as the
     * webhook would have: applied while it still can be, otherwise {@code UNAPPLIED} so its charge is
     * refunded. Without this walk that money would be held for a raise nobody applies or returns.
     *
     * <p>Here rather than in the payment module because what it settles is the raise; the charge and
     * its ledger posting are already recorded. One raise per transaction, and one failure does not stop
     * the rest.
     *
     * @return how many raises this pass settled
     */
    public int settlePaidRaises(Instant now) {
        List<String> unsettled = raises.findPaidUnsettledChargeKeys(properties.reservation().cleanupBatchSize());
        int settled = 0;
        for (String chargeKey : unsettled) {
            try {
                RaiseSettlement.Outcome outcome = raiseService.settlePaidCharge(chargeKey, now).outcome();
                if (outcome == RaiseSettlement.Outcome.APPLIED || outcome == RaiseSettlement.Outcome.UNAPPLIED) {
                    settled++;
                }
            } catch (RuntimeException e) {
                log.error("Could not settle the paid raise {}; the next pass tries again.", chargeKey, e);
            }
        }
        return settled;
    }

    /**
     * #171: the places a raise held for its payment go back when nobody paid within the window.
     *
     * <p>The same walk as the drafts', for the same reason and in the same job: a raise's hold is a
     * reservation like a draft's, and a minute late is a minute in which a tier looks sold out while a
     * place is free. One raise per transaction, and one failure does not stop the rest.
     *
     * @return how many raises this pass released
     */
    public int releaseLapsedRaises(Instant now) {
        List<UUID> lapsed =
                raises.findPledgesWithLapsedRaises(now, PageRequest.ofSize(properties.reservation().cleanupBatchSize()));

        int released = 0;
        for (UUID pledgeId : lapsed) {
            try {
                if (raiseService.releaseLapsed(pledgeId, now)) {
                    released++;
                }
            } catch (RuntimeException e) {
                log.error("Could not release the lapsed raise of pledge {}; the next pass tries again.", pledgeId, e);
            }
        }
        if (released > 0) {
            log.info("Released {} of {} lapsed raises.", released, lapsed.size());
        }
        return released;
    }

    /**
     * One pass: up to a batch of drafts whose reservation has run out.
     *
     * <p>Takes the instant rather than reading the clock, so that a test can ask
     * what happens after the TTL without waiting for it, and so that every row in
     * one pass is judged against one moment.
     *
     * <p>Bounded rather than exhaustive. A campaign that closed with thousands of
     * checkouts in flight must not be one pass that overlaps its own next tick; the
     * remainder is found a minute later, in expiry order, so the place that has
     * been unavailable longest is the first one given back.
     *
     * @return how many reservations this pass released
     */
    public int releaseExpiredReservations(Instant now) {
        List<UUID> lapsed =
                pledges.findLapsedDrafts(now, PageRequest.ofSize(properties.reservation().cleanupBatchSize()));

        int released = 0;
        for (UUID pledgeId : lapsed) {
            try {
                if (expiry.release(pledgeId, now)) {
                    released++;
                }
            } catch (RuntimeException e) {
                // One reservation per transaction, and one failure must not stop the
                // rest: every draft behind this one is also holding a place that
                // somebody else could be buying. The row stays lapsed and the next
                // pass tries again.
                log.error("Could not release reservation {}; it stays held until the next pass.", pledgeId, e);
            }
        }

        if (released > 0) {
            log.info("Released {} of {} lapsed reservations.", released, lapsed.size());
        }
        return released;
    }
}
