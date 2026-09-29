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
import az.ideanest.payment.domain.RefundState;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.pledge.application.PledgeRefunds;
import az.ideanest.shared.money.Money;
import java.time.Clock;
import java.nio.charset.StandardCharsets;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
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
     * <p>The overdraft check and the insert are in this transaction together, under the pledge's row
     * lock ({@link PledgeRefunds#lock}). Two members of staff each issuing a full refund in the same
     * second would otherwise both read a zero, and the platform would return twice what it took.
     *
     * <p><strong>One refund reverses one charge (#171).</strong> A provider refunds a payment it
     * took, up to what that payment was, and a raised pledge was paid for in more than one payment.
     * So a refund is recorded as one part per charge it draws on, newest charge first, each for no
     * more than that charge has left: with no amount, every charge's whole remainder; with an amount,
     * up to what the pledge has left in all, split across its charges. The first part carries the
     * caller's idempotency key and the others keys derived from it ({@link #partKey}).
     *
     * <p>A charge that paid for a raise which could not be applied is drawn on <strong>last</strong>
     * (#174's review). It is owed back already, and the platform refunds it on its own; a staff refund
     * of an amount that took it first would leave the backer short by that much, because the
     * platform's refund would then find nothing left of it.
     *
     * @return the parts, newest charge first; never empty
     * @throws NothingToRefundException when the pledge has no settled charge
     * @throws RefundExceedsCollectionException when this would return more than the pledge has left
     */
    @Transactional
    List<Refund> record(
            UUID staffId, UUID pledgeId, Money amount, RefundReason reason, String detail, String idempotencyKey) {

        pledges.lock(pledgeId);
        List<PaymentTransaction> charges = transactions.settledChargesOf(pledgeId);
        if (charges.isEmpty()) {
            throw new NothingToRefundException(pledgeId);
        }

        String currency = charges.getFirst().getAmount().currency();
        Money remaining = remainingOn(pledgeId, currency);
        Money requested = amount == null ? remaining : amount;
        if (!requested.isPositive() || requested.isGreaterThan(remaining)) {
            throw new RefundExceedsCollectionException(pledgeId, requested, remaining);
        }
        // "Meant to be the whole thing" (V53): the rest of the pledge, on every part of it.
        boolean full = requested.equals(remaining);

        Set<String> owedBack = Set.copyOf(transactions.unappliedRaiseChargesOf(pledgeId));
        List<PaymentTransaction> ordered = new ArrayList<>(charges);
        // Stable: newest first within each group, the pledge's own money before money owed back.
        ordered.sort(Comparator.comparing(charge -> owedBack.contains(charge.getId().toString())));

        List<Refund> parts = new ArrayList<>();
        Money unassigned = requested;
        for (PaymentTransaction charge : ordered) {
            if (!unassigned.isPositive()) {
                break;
            }
            Money left = remainingOnCharge(charge);
            if (!left.isPositive()) {
                continue;
            }
            Money part = left.min(unassigned);
            String key = parts.isEmpty() ? idempotencyKey : partKey(idempotencyKey, parts.size() + 1);
            Refund refund = refunds.save(Refund.requested(
                    pledgeId, charge.getProjectId(), charge.getId(), part, full, reason, detail, staffId, key));
            audit.record(
                    AuditAction.REFUND_ISSUED,
                    refund.id(),
                    AuditActor.moderator(staffId),
                    AuditOutcome.SUCCEEDED,
                    "pledge=%s; charge=%s; amount=%s; reason=%s; full=%s"
                            .formatted(pledgeId, charge.getId(), part, reason, full));
            parts.add(refund);
            unassigned = unassigned.minus(part);
        }
        if (unassigned.isPositive()) {
            // The pledge's remainder is never more than its charges' remainders added up: every refund
            // counted against the pledge is counted against one of its charges too. Rolled back rather
            // than sent short.
            throw new IllegalStateException("Pledge " + pledgeId + " has " + remaining
                    + " left and its charges only " + requested.minus(unassigned));
        }
        return parts;
    }

    /**
     * The idempotency key of the {@code n}th part of a refund, derived from the caller's key so a replay
     * finds every part.
     *
     * <p>A name-based UUID of the key and the part's number, not the key with a suffix (#174's review):
     * "key#2" is a key somebody else may have sent, and truncating a long key to fit V53's 200
     * characters made two different keys derive the same one. Of a fixed length, and different for
     * every key and part: the number is last, after a separator no number contains.
     */
    static String partKey(String idempotencyKey, int n) {
        byte[] name = (idempotencyKey + "|part|" + n).getBytes(StandardCharsets.UTF_8);
        return "refund-part-" + UUID.nameUUIDFromBytes(name);
    }

    /**
     * IDN-EXT-01 (#40): the platform refunds what one settled charge has left, because its campaign
     * failed or was halted, or because it paid for a raise that could not be applied (#171). No member
     * of staff asked, so there is no author and no capability check; the reason is the author, and the
     * audit row says the system acted.
     *
     * <p><strong>Per charge, since #171.</strong> A raised pledge was paid for twice or more, and each
     * payment is reversed on its own, against its own provider transaction and for no more than it has
     * left. Whether the pledge is refunded in full is not decided here: a requested refund may fail, so
     * {@link #settleSuccess} decides it from what has actually gone back.
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
        UUID pledgeId = charge.getPledgeId();
        // Locked before what is left is read, so a staff refund recorded at the same moment is either
        // counted here or counts this one.
        pledges.lock(pledgeId);
        Money left = remainingOnCharge(charge);
        if (!left.isPositive()) {
            return Optional.empty();
        }

        Refund refund = refunds.save(Refund.requested(
                pledgeId,
                charge.getProjectId(),
                charge.getId(),
                left,
                // A campaign refund is meant to return everything (§9.7); a raise's, only the raise.
                reason != RefundReason.RAISE_NOT_APPLIED,
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
     *
     * <p><strong>The pledge is refunded in full when this leaves nothing (#171)</strong>: under its
     * row lock, everything it was charged less every refund that has succeeded is zero. Decided here
     * and nowhere else, because only a settled refund has certainly returned money: a refund recorded
     * as "the last one" may fail, and a raise paid for after it was recorded would leave money behind.
     * The pledge then moves to {@code REFUNDED} and its whole total leaves the campaign's figures, in
     * this transaction.
     */
    @Transactional
    Refund settleSuccess(Refund refund, PaymentTransaction charge, RefundResult result) {
        pledges.lock(refund.pledgeId());
        Refund current = refunds.findById(refund.id()).orElseThrow();
        if (current.state() != RefundState.REQUESTED) {
            // Settled already: a reconciliation and a late answer both arriving. Nothing moves twice.
            return current;
        }
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

        current.succeeded(recorded.getId(), clock.instant().truncatedTo(ChronoUnit.MICROS));
        Refund settled = refunds.saveAndFlush(current);

        // IDN-EXT-01 (#40): a pledge refunded in full is REFUNDED and leaves its campaign's totals, in
        // this transaction; a partial refund leaves it standing. Since #171 "in full" is what has gone
        // back, read under the pledge's lock taken above, and not what this refund was meant to be.
        String currency = refund.amount().currency();
        Money collected = Money.of(transactions.collectedOn(refund.pledgeId()), currency);
        Money returned = Money.of(refunds.succeededAgainst(refund.pledgeId()), currency);
        if (collected.isPositive() && !collected.isGreaterThan(returned)) {
            pledges.recordRefunded(refund.pledgeId());
        }

        log.info("Refund {} of {} settled on pledge {}", refund.id(), refund.amount(), refund.pledgeId());
        return settled;
    }

    /**
     * Leaves a refund whose outcome cannot be decided to a person — #174's review.
     *
     * <p>It stays {@code REQUESTED}, so it still counts as gone and nothing is sent twice, and the
     * reconciliation stops asking about it. Logged at {@code ERROR}: money may or may not have moved.
     */
    @Transactional
    Refund markForReview(Refund refund, String reason) {
        pledges.lock(refund.pledgeId());
        Refund attached = refunds.findById(refund.id()).orElseThrow();
        if (attached.state() != RefundState.REQUESTED) {
            return attached;
        }
        attached.needsReview(reason);
        log.error("Refund {} of {} on pledge {} needs a person: {}", refund.id(), refund.amount(), refund.pledgeId(), reason);
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
        pledges.lock(refund.pledgeId());
        Refund attached = refunds.findById(refund.id()).orElseThrow();
        if (attached.state() != RefundState.REQUESTED) {
            return attached;
        }
        attached.failed(failureCode, failureMessage, clock.instant().truncatedTo(ChronoUnit.MICROS));

        log.warn("Refund {} failed on pledge {}: {}", refund.id(), refund.pledgeId(), failureCode);
        return refunds.save(attached);
    }
}
