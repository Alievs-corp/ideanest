package az.ideanest.payment.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.ledger.application.Ledger;
import az.ideanest.ledger.application.LedgerAccount;
import az.ideanest.ledger.application.Posting;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.pledge.application.PledgeRefunds;
import az.ideanest.shared.money.Money;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The two database halves of a refund, each in its own transaction — #67.
 *
 * <h2>Why this is a separate bean and not three methods on {@code RefundService}</h2>
 *
 * <p>Because {@code @Transactional} is applied by a proxy, and a proxy is only in the way
 * when a call arrives from outside. {@code RefundService.issue} calling its own
 * {@code @Transactional} method would run it on {@code this}, the annotation would do
 * nothing at all, and the refund would be recorded with no transaction and no error —
 * which is the worst shape a defect can have on this code path, because it works in every
 * test that does not kill the process at the right moment.
 *
 * <p>So the boundary is a bean boundary. {@code RefundService} orchestrates and calls
 * across; the commits happen here.
 *
 * <p>Every method is package-private except by necessity: nothing outside this package has
 * any business writing a refund without going through the overdraft check and the
 * idempotency replay that {@code RefundService} performs around them.
 */
@Service
public class RefundRecords {

    private static final Logger log = LoggerFactory.getLogger(RefundRecords.class);

    private final RefundRepository refunds;
    private final PaymentTransactionRepository transactions;
    private final Ledger ledger;
    private final PledgeRefunds pledges;
    private final AuditLog audit;
    private final Clock clock;

    public RefundRecords(
            RefundRepository refunds,
            PaymentTransactionRepository transactions,
            Ledger ledger,
            PledgeRefunds pledges,
            AuditLog audit,
            Clock clock) {
        this.refunds = refunds;
        this.transactions = transactions;
        this.ledger = ledger;
        this.pledges = pledges;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Step one: the intent, committed before anybody calls a provider.
     *
     * <p>The overdraft check and the insert are in this transaction together. Two members
     * of staff each issuing a full refund in the same second would otherwise both read a
     * zero, and the platform would return twice what it took.
     *
     * <p><strong>One refund reverses one charge (#171).</strong> A provider refunds a payment it
     * took, up to what that payment was, and a raised pledge was paid for in more than one payment.
     * So the refund goes against the newest charge that can cover it on its own: with no amount, that
     * charge's whole remainder; with an amount, the newest charge with at least that much left. A
     * raised pledge is therefore refunded in full in one refund per charge, and the one that leaves
     * nothing behind is the full refund that moves the pledge to {@code REFUNDED}.
     *
     * @throws NothingToRefundException when the pledge has no settled charge
     * @throws RefundExceedsCollectionException when this would return more than was taken, or more
     *     than any one of its charges has left
     */
    @Transactional
    Refund record(
            UUID staffId, UUID pledgeId, Money amount, RefundReason reason, String detail, String idempotencyKey) {

        List<PaymentTransaction> charges = transactions.settledChargesOf(pledgeId);
        if (charges.isEmpty()) {
            throw new NothingToRefundException(pledgeId);
        }

        String currency = charges.getFirst().getAmount().currency();
        Money remaining = remainingOn(pledgeId, currency);

        PaymentTransaction charge = null;
        Money chargeLeft = Money.zero(currency);
        for (PaymentTransaction candidate : charges) {
            Money left = remainingOnCharge(candidate);
            boolean covers = amount == null ? left.isPositive() : !left.isLessThan(amount);
            if (covers) {
                charge = candidate;
                chargeLeft = left;
                break;
            }
            chargeLeft = chargeLeft.max(left);
        }

        Money requested = amount == null ? (charge == null ? remaining : chargeLeft) : amount;
        if (!requested.isPositive() || requested.isGreaterThan(remaining)) {
            throw new RefundExceedsCollectionException(pledgeId, requested, remaining);
        }
        if (charge == null) {
            // Within what the pledge has left, and more than any one of its payments does.
            throw new RefundExceedsCollectionException(pledgeId, requested, chargeLeft);
        }

        Refund refund = refunds.save(Refund.requested(
                pledgeId,
                charge.getProjectId(),
                charge.getId(),
                requested,
                requested.equals(remaining),
                reason,
                detail,
                staffId,
                idempotencyKey));

        audit.record(
                AuditAction.REFUND_ISSUED,
                refund.id(),
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "pledge=%s; amount=%s; reason=%s; full=%s"
                        .formatted(pledgeId, requested, reason, refund.fullRefund()));

        return refund;
    }

    /**
     * Step three: the transaction row, the ledger posting and the state, in one commit.
     *
     * <p>All three or none. A {@code transactions} row without its posting is money that
     * moved and does not appear in the books; a posting without the row is the reverse.
     *
     * <p><strong>Escrow is credited and {@code refunds} is debited, and the fees are not
     * reversed.</strong> The processor keeps its fee on a refunded charge, and whether the
     * platform keeps its own is a policy question §9.7 does not settle — inventing it here
     * would mean a payment adapter deciding the platform's revenue. What the ledger says
     * instead is true and narrow: this much went back to a backer.
     */
    /**
     * IDN-EXT-01 (#40): the platform refunds one settled charge in full, because its campaign failed
     * or was halted, or because it paid for a raise that could not be applied (#171). No member of
     * staff asked, so there is no author and no capability check; the reason is the author, and the
     * audit row says the system acted.
     *
     * <p><strong>Per charge, since #171.</strong> A raised pledge was paid for twice or more, and each
     * payment is reversed on its own, against its own provider transaction and for no more than it
     * was. The refund that leaves nothing on the pledge is its full refund, and moves it to
     * {@code REFUNDED}. A raise's refund is that one only when everything else the pledge was paid
     * has already gone back; otherwise the pledge it did not change still stands.
     *
     * @return empty when nothing of this charge remains to refund
     */
    @Transactional
    Optional<Refund> recordForCharge(UUID chargeId, RefundReason reason, String idempotencyKey) {
        Optional<PaymentTransaction> found = transactions.findById(chargeId);
        if (found.isEmpty()) {
            return Optional.empty();
        }
        PaymentTransaction charge = found.get();
        Money left = remainingOnCharge(charge);
        if (!left.isPositive()) {
            return Optional.empty();
        }
        UUID pledgeId = charge.getPledgeId();
        Money remaining = remainingOn(pledgeId, left.currency());
        boolean completes = left.equals(remaining);

        Refund refund = refunds.save(Refund.requested(
                pledgeId,
                charge.getProjectId(),
                charge.getId(),
                left,
                completes,
                reason,
                switch (reason) {
                    case CAMPAIGN_FAILED ->
                        "The campaign ended below its success threshold; every backer is refunded in full.";
                    case RAISE_NOT_APPLIED ->
                        "The backer paid to raise their pledge and the raise could not be applied.";
                    default -> "The campaign was suspended or cancelled; every backer is refunded in full.";
                },
                null,
                idempotencyKey));
        audit.record(
                AuditAction.REFUND_ISSUED,
                refund.id(),
                AuditActor.system(),
                AuditOutcome.SUCCEEDED,
                "pledge=%s; charge=%s; amount=%s; reason=%s; full=%s"
                        .formatted(pledgeId, chargeId, left, reason, refund.fullRefund()));
        return Optional.of(refund);
    }

    /** What a pledge has left to refund: everything it was charged, less every refund not failed. */
    private Money remainingOn(UUID pledgeId, String currency) {
        return Money.of(transactions.collectedOn(pledgeId), currency)
                .minus(Money.of(refunds.refundedAgainst(pledgeId), currency));
    }

    /** What one charge has left to refund. */
    private Money remainingOnCharge(PaymentTransaction charge) {
        return charge.getAmount().minus(Money.of(refunds.refundedAgainstCharge(charge.getId()), charge.getAmount().currency()));
    }

    @Transactional
    Refund settleSuccess(Refund refund, PaymentTransaction charge, RefundResult result) {
        // A reversal the provider gave no identifier of its own — Epoint's /reverse gives none — is
        // recorded without one rather than under the charge's. V41 allows one settled row per
        // provider transaction, and the charge already is that row; the refund reaches its charge
        // through refunds.charge_transaction_id instead (IDN-EXT-01, #40).
        RefundResult stored = result.providerTransactionId() != null
                        && result.providerTransactionId().equals(charge.getProviderTransactionId())
                ? new RefundResult(result.outcome(), null, result.failureCode(), result.failureMessage(), result.rawResponse())
                : result;
        PaymentTransaction recorded = transactions.save(PaymentTransaction.refund(
                refund.pledgeId(),
                refund.projectId(),
                refund.amount(),
                charge.getProvider(),
                stored,
                refund.idempotencyKey()));

        ledger.post(Posting.of(recorded.getId(), refund.projectId())
                .debit(LedgerAccount.REFUNDS, refund.amount())
                .credit(LedgerAccount.ESCROW, refund.amount())
                .build());

        Refund attached = refunds.findById(refund.id()).orElseThrow();
        attached.succeeded(recorded.getId(), clock.instant().truncatedTo(ChronoUnit.MICROS));
        // IDN-EXT-01 (#40): a pledge refunded in full is REFUNDED and leaves its campaign's totals, in
        // this transaction. A partial refund leaves the pledge standing. Since #171 the full refund is
        // the one that leaves nothing, which on a raised pledge is the last of its charges.
        if (attached.fullRefund()) {
            pledges.recordRefunded(refund.pledgeId());
        }

        log.info("Refund {} of {} settled on pledge {}", refund.id(), refund.amount(), refund.pledgeId());
        return refunds.save(attached);
    }

    /**
     * The other outcome.
     *
     * <p>No {@code transactions} row and no posting, deliberately: nothing moved. The
     * provider's refusal is on the refund row, which is where somebody looking for it will
     * be — a {@code FAILED} transaction row for a refund would appear on the payment log
     * beside real charges and would have to be filtered out of every sum.
     */
    @Transactional
    Refund settleFailure(Refund refund, String failureCode, String failureMessage) {
        Refund attached = refunds.findById(refund.id()).orElseThrow();
        attached.failed(failureCode, failureMessage, clock.instant().truncatedTo(ChronoUnit.MICROS));

        log.warn("Refund {} failed on pledge {}: {}", refund.id(), refund.pledgeId(), failureCode);
        return refunds.save(attached);
    }
}
