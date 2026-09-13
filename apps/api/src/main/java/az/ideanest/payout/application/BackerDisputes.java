package az.ideanest.payout.application;

import az.ideanest.payment.application.PledgeFunds;
import az.ideanest.payment.application.RefundService;
import az.ideanest.payout.domain.BackerDispute;
import az.ideanest.payout.domain.BackerDisputeState;
import az.ideanest.payout.domain.Payout;
import az.ideanest.payout.infrastructure.BackerDisputeRepository;
import az.ideanest.payout.infrastructure.PayoutRepository;
import az.ideanest.pledge.application.BackedPledges;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

/**
 * A backer disputes their payment while the payout is held — IDN-EXT-01 (#43), §6.3.
 *
 * <p><strong>The window is the payout's</strong>: open while a payout for the campaign is in flight —
 * held, waiting for signatures or for the creator's details — and closed once it is sent, because
 * nothing is refunded through the platform after payout. That is §6.3's decision that a payout held
 * for a missing VÖEN keeps the window open until the money actually leaves.
 *
 * <p><strong>An administrator decides.</strong> Upheld, the backer is refunded in full through the
 * ordinary refund path — the pledge becomes {@code REFUNDED} and leaves the campaign's totals — and the
 * payout is recalculated without them, keeping its hold. The campaign's frozen outcome is untouched: it
 * stays successful even if the remainder is below 80%.
 */
@Service
public class BackerDisputes {

    private static final Logger log = LoggerFactory.getLogger(BackerDisputes.class);

    private static final int PAGE_SIZE = 50;

    private final BackerDisputeRepository disputes;
    private final PayoutRepository payouts;
    private final BackedPledges pledges;
    private final PledgeFunds funds;
    private final RefundService refunds;
    private final BackerDisputeRecords records;
    private final PlatformStaff staff;
    private final Clock clock;

    public BackerDisputes(
            BackerDisputeRepository disputes,
            PayoutRepository payouts,
            BackedPledges pledges,
            PledgeFunds funds,
            RefundService refunds,
            BackerDisputeRecords records,
            PlatformStaff staff,
            Clock clock) {
        this.disputes = disputes;
        this.payouts = payouts;
        this.pledges = pledges;
        this.funds = funds;
        this.refunds = refunds;
        this.records = records;
        this.staff = staff;
        this.clock = clock;
    }

    /**
     * Opens a dispute, or answers the one already open for this pledge.
     *
     * @throws BackerDisputeNotFoundException when the pledge is not this backer's — the same answer as
     *     no pledge, so a dispute cannot confirm that somebody else backed a campaign
     * @throws DisputeWindowClosedException when no payout for the campaign is held
     * @throws NothingToDisputeException when nothing of the payment is left to refund
     */
    public BackerDispute open(UUID backerId, UUID pledgeId, String reason) {
        BackedPledges.BackedPledge pledge = pledges
                .pledge(pledgeId)
                .filter(found -> found.backerId().equals(backerId))
                .orElseThrow(() -> new BackerDisputeNotFoundException(pledgeId));

        Optional<BackerDispute> existing = disputes.openFor(pledgeId);
        if (existing.isPresent()) {
            return existing.get();
        }
        Payout held = payouts
                .inFlightFor(pledge.projectId())
                .orElseThrow(() -> new DisputeWindowClosedException(pledge.projectId()));
        if (funds.refundableOn(pledgeId).isEmpty()) {
            throw new NothingToDisputeException(pledgeId);
        }

        BackerDispute opened = disputes.save(BackerDispute.opened(
                pledgeId,
                pledge.projectId(),
                backerId,
                held.id(),
                reason,
                clock.instant().truncatedTo(ChronoUnit.MICROS)));
        log.info("Backer dispute {} opened on pledge {} while payout {} is held.", opened.id(), pledgeId, held.id());
        return opened;
    }

    /** The undecided disputes, oldest first. {@code MANAGE_DISPUTES}. */
    public List<BackerDispute> queue(UUID staffId, int page) {
        staff.requireCapability(staffId, StaffCapability.MANAGE_DISPUTES);
        return disputes.queue(PageRequest.of(Math.max(page, 0), PAGE_SIZE));
    }

    /**
     * Decides a dispute. {@code MANAGE_DISPUTES}, and upholding refunds, so {@code ISSUE_REFUND} too.
     *
     * <p>The refund is issued first, through its own transactions, and the dispute is marked upheld only
     * once the refund succeeded — a refused refund leaves the dispute open to try again, under a new key,
     * rather than recording an outcome that did not happen.
     *
     * @throws DisputeAlreadyDecidedException when it is no longer open
     * @throws DisputeRefundFailedException when upholding and the refund did not go through
     */
    public BackerDispute decide(UUID staffId, UUID disputeId, boolean uphold, String note) {
        staff.requireCapability(staffId, StaffCapability.MANAGE_DISPUTES);
        BackerDispute dispute =
                disputes.findById(disputeId).orElseThrow(() -> new BackerDisputeNotFoundException(disputeId));
        if (dispute.state() != BackerDisputeState.OPEN) {
            throw new DisputeAlreadyDecidedException(disputeId);
        }
        Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        String detail = note == null || note.isBlank() ? "Backer dispute " + disputeId + " decided." : note.trim();

        if (!uphold) {
            return records.reject(disputeId, staffId, detail, now);
        }

        Optional<UUID> refund = refunds.refundForDispute(
                staffId, dispute.pledgeId(), detail, "backer-dispute-" + disputeId + "-" + now.toEpochMilli());
        if (refund.isEmpty()) {
            log.warn("Backer dispute {} stays open: its refund did not go through.", disputeId);
            throw new DisputeRefundFailedException(disputeId);
        }
        // The payout the campaign is owed now excludes this backer. Its hold is kept: the dispute did not
        // start a new one.
        return records.uphold(disputeId, staffId, detail, refund.get(), now);
    }
}
