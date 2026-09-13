package az.ideanest.payout.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.payout.domain.BackerDispute;
import az.ideanest.payout.domain.BackerDisputeState;
import az.ideanest.payout.infrastructure.BackerDisputeRepository;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The writes of a dispute decision, each in one transaction — IDN-EXT-01 (#43).
 *
 * <p>Apart from {@link BackerDisputes#decide} for {@code RefundRecords}' reason: the refund's provider
 * call must not run inside a transaction, and the dispute's outcome, its audit row and the recalculated
 * payout must commit together once the refund has gone through.
 */
@Service
class BackerDisputeRecords {

    private final BackerDisputeRepository disputes;
    private final WithdrawalPayouts payouts;
    private final AuditLog audit;

    BackerDisputeRecords(BackerDisputeRepository disputes, WithdrawalPayouts payouts, AuditLog audit) {
        this.disputes = disputes;
        this.payouts = payouts;
        this.audit = audit;
    }

    @Transactional
    BackerDispute reject(UUID disputeId, UUID staffId, String note, Instant at) {
        BackerDispute dispute = open(disputeId);
        dispute.rejected(staffId, note, at);
        BackerDispute saved = disputes.save(dispute);
        audit.record(
                AuditAction.DISPUTE_HANDLED,
                disputeId,
                AuditActor.moderator(staffId),
                AuditOutcome.REFUSED,
                "backerDispute; rejected; pledge=%s".formatted(dispute.pledgeId()));
        return saved;
    }

    /** Marks it upheld and recalculates the campaign's payout without the refunded backer, keeping its hold. */
    @Transactional
    BackerDispute uphold(UUID disputeId, UUID staffId, String note, UUID refundId, Instant at) {
        BackerDispute dispute = open(disputeId);
        dispute.upheld(staffId, note, refundId, at);
        BackerDispute saved = disputes.save(dispute);
        audit.record(
                AuditAction.DISPUTE_HANDLED,
                disputeId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "backerDispute; upheld; pledge=%s; refund=%s".formatted(dispute.pledgeId(), refundId));
        payouts.recalculate(dispute.projectId());
        return saved;
    }

    private BackerDispute open(UUID disputeId) {
        BackerDispute dispute =
                disputes.findById(disputeId).orElseThrow(() -> new BackerDisputeNotFoundException(disputeId));
        if (dispute.state() != BackerDisputeState.OPEN) {
            throw new DisputeAlreadyDecidedException(disputeId);
        }
        return dispute;
    }
}
