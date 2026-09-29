package az.ideanest.payment.application;

import az.ideanest.payment.domain.PaymentLookup;
import az.ideanest.payment.domain.PaymentProvider;
import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.ProviderOutcome;
import az.ideanest.payment.domain.ProviderUnavailableException;
import az.ideanest.payment.domain.Refund;
import az.ideanest.payment.domain.RefundReason;
import az.ideanest.payment.domain.RefundRequest;
import az.ideanest.payment.domain.RefundResult;
import az.ideanest.payment.domain.RefundState;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import az.ideanest.payment.infrastructure.RefundRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.idempotency.IdempotencyKeyReusedException;
import az.ideanest.shared.money.Money;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sending money back — §9.7, §4.11's AD-06, issues #67 and #307.
 *
 * <h2>Three commits, and the order is the whole design</h2>
 *
 * <p>A refund is a database write, a call to somebody else's server, and another database
 * write. No arrangement of those is atomic, so the only question is which failure the
 * platform prefers — and the answer is the one that leaves a record.
 *
 * <ol>
 *   <li><strong>Record the intent.</strong> A {@code REQUESTED} row carrying the
 *       idempotency key, committed before the provider is called. Call-then-record loses
 *       the case that matters: a call that reaches the provider and whose answer is lost.
 *       Money has gone, no row says anybody meant it to, and the key that would make a
 *       retry safe was never stored.
 *   <li><strong>Call the provider.</strong> Outside a transaction. A database transaction
 *       held open across a call to a third party is a connection pool waiting on somebody
 *       else's timeout.
 *   <li><strong>Record the outcome</strong>, with the {@code transactions} row and the
 *       ledger posting, in one transaction — those three are one fact.
 * </ol>
 *
 * <p>What remains is the window between two and three: the provider says yes and the
 * platform dies before recording it. The row stays {@code REQUESTED} with its key, which
 * is exactly enough for a reconciliation to find it and for a replay to be safe. That is a
 * gap somebody can close; a missing row is not.
 *
 * <p><strong>The commits live in {@link RefundRecords}</strong>, a separate bean, because
 * {@code @Transactional} is applied by a proxy and would do nothing at all if these steps
 * were methods on this class. That class has the argument.
 *
 * <h2>Two capabilities, not one</h2>
 *
 * <p>Reading the refund list needs {@code VIEW_FINANCE}; issuing one needs
 * {@code ISSUE_REFUND}. §4.11's AD-06 is one module and those are not one authority — the
 * mistakes are not comparable, and {@code StaffCapability} draws the line in the same
 * place for the same reason.
 */
@Service
public class RefundService {

    private static final Logger log = LoggerFactory.getLogger(RefundService.class);

    /** The failure code of a refund that never reached a provider. */
    static final String NOT_SENT = "not_sent";

    private final RefundRepository refunds;
    private final PaymentTransactionRepository transactions;
    private final PaymentProviders providers;
    private final RefundRecords records;
    private final PlatformStaff staff;

    public RefundService(
            RefundRepository refunds,
            PaymentTransactionRepository transactions,
            PaymentProviders providers,
            RefundRecords records,
            PlatformStaff staff) {
        this.refunds = refunds;
        this.transactions = transactions;
        this.providers = providers;
        this.records = records;
        this.staff = staff;
    }

    /** AD-06's list, newest first, optionally narrowed to one state. */
    @Transactional(readOnly = true)
    public List<Refund> list(UUID staffId, RefundState state, int page, int size) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        PageRequest request = PageRequest.of(Math.max(page, 0), size);

        return state == null ? refunds.page(request) : refunds.pageByState(state, request);
    }

    /** Every refund against one pledge, for the support conversation behind it. */
    @Transactional(readOnly = true)
    public List<Refund> forPledge(UUID staffId, UUID pledgeId) {
        staff.requireCapability(staffId, StaffCapability.VIEW_FINANCE);
        return refunds.forPledge(pledgeId);
    }

    /**
     * Issues a refund, and answers with the part that best describes how it went.
     *
     * <p>A refund of a raised pledge is sent as one part per charge (#171, {@link #issueParts}); the
     * console shows one row, so this answers with the first part that did not succeed, or the first
     * part when every one did. Every part is listed against the pledge.
     *
     * @see #issueParts
     */
    public Refund issue(
            UUID staffId, UUID pledgeId, Money amount, RefundReason reason, String detail, String idempotencyKey) {
        List<Refund> parts = issueParts(staffId, pledgeId, amount, reason, detail, idempotencyKey);
        return parts.stream()
                .filter(part -> part.state() != RefundState.SUCCEEDED)
                .findFirst()
                .orElse(parts.getFirst());
    }

    /**
     * Issues a refund, one part per charge it draws on.
     *
     * <p>Deliberately not {@code @Transactional}: it commits twice with a network call in
     * between. See the class comment.
     *
     * <p><strong>One part per charge (#171).</strong> A provider reverses a payment up to what that
     * payment was, and a raised pledge was paid for more than once. So the refund is split across the
     * pledge's charges, newest first ({@link RefundRecords#record}), all of them recorded in one
     * commit and then each sent on its own. A part the provider refuses leaves the others standing;
     * the refusal is on its row, and a retry under a new key sends only what is still left.
     *
     * <p><strong>Every part is sent, whatever happened to the one before (#174's review).</strong> A
     * part whose sending throws — its answer lost, the database refusing the settlement — is left
     * {@code REQUESTED} and the next part is sent anyway; {@link #reconcile} settles the stuck one from
     * the provider's status once it is old enough, staff refunds included. A part that could not even
     * be sent — its charge or its provider gone — is recorded {@code FAILED} ({@link #send}). A part
     * whose provider could not be reached is left {@code REQUESTED} too (#176), and the console shows it
     * as pending: the reversal may have gone through, and the next refund of the same money finds
     * nothing left until the reconciliation has asked the provider.
     *
     * @param amount what to send back, or null for the whole of what is left. Null rather
     *     than a {@code full} flag, so "all of it" cannot disagree with a number the
     *     console computed from a page it loaded ten minutes ago
     * @param idempotencyKey CLAUDE.md: every payment mutation is idempotent. A replay
     *     returns the original parts and reaches no provider
     * @return every part, in the order they were sent
     * @throws RefundExceedsCollectionException when this would return more than was taken
     * @throws NothingToRefundException when the pledge has no settled charge
     * @throws IdempotencyKeyReusedException when the key was spent on a refund of another pledge
     * @throws RefundReasonNotIssuableException for {@code CHARGEBACK}, which only a lost dispute records
     */
    public List<Refund> issueParts(
            UUID staffId, UUID pledgeId, Money amount, RefundReason reason, String detail, String idempotencyKey) {

        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        if (reason == RefundReason.CHARGEBACK) {
            throw new RefundReasonNotIssuableException(reason);
        }

        Optional<Refund> replayed = refunds.byIdempotencyKey(idempotencyKey);
        if (replayed.isPresent()) {
            // The whole of §9.3's R-08. A retried request returns the original result and
            // does not reach the provider, which on this endpoint is the difference
            // between refunding once and refunding twice.
            if (!replayed.get().pledgeId().equals(pledgeId)) {
                // The key answers for a refund of another pledge. Replaying it would tell the caller a
                // refund happened that did not; refusing it is §10.3's answer to a reused key.
                throw new IdempotencyKeyReusedException("refund");
            }
            log.info("Refund {} replayed under key {}", replayed.get().id(), idempotencyKey);
            List<Refund> parts = new ArrayList<>(List.of(replayed.get()));
            for (int n = 2; ; n++) {
                Optional<Refund> part = refunds.byIdempotencyKey(RefundRecords.partKey(idempotencyKey, n));
                if (part.isEmpty() || !part.get().pledgeId().equals(pledgeId)) {
                    break;
                }
                parts.add(part.get());
            }
            return parts;
        }

        List<Refund> sent = new ArrayList<>();
        for (Refund part : records.record(staffId, pledgeId, amount, reason, detail, idempotencyKey)) {
            try {
                sent.add(send(part));
            } catch (RuntimeException unknown) {
                // Whether the provider reversed it is not known: left REQUESTED, still counted as gone,
                // and settled by reconcile() from the provider's status. The other parts go regardless.
                log.error(
                        "Refund {} of {} on pledge {} has no recorded outcome; the reconciliation settles it.",
                        part.id(),
                        part.amount(),
                        pledgeId,
                        unknown);
                sent.add(refunds.findById(part.id()).orElse(part));
            }
        }
        return sent;
    }

    /**
     * Steps two and three: the provider call, then the outcome.
     *
     * <p>A refund that cannot be sent at all — its charge or its provider cannot be found — is recorded
     * {@code FAILED} rather than thrown (#174's review): nothing reached a provider, and a
     * {@code REQUESTED} row would count as money gone that never left.
     *
     * <p><strong>A provider that could not be reached is not a failure (#176).</strong> The call may
     * have reached it and been carried out, with the answer lost on the way back — and Epoint's
     * {@code /reverse} has no duplicate protection, so a refund recorded {@code FAILED} and offered
     * again would pay the backer twice. The row stays {@code REQUESTED}: still counted as gone, so no
     * path sends that money again, and settled by {@link #reconcile} from the provider's status of the
     * payment once it is {@code unresolved-after} old. Only a reconciliation that finds the payment
     * still paid makes it {@code FAILED}, and only then does the sweep send it again.
     */
    private Refund send(Refund refund) {
        Optional<PaymentTransaction> found = transactions.findById(refund.chargeTransactionId());
        if (found.isEmpty()) {
            return records.settleFailure(refund, NOT_SENT, "The charge this refund reverses was not found.");
        }
        PaymentTransaction charge = found.get();
        Optional<PaymentProvider> configured = providers.byName(charge.getProvider());
        if (configured.isEmpty()) {
            return records.settleFailure(
                    refund, NOT_SENT, "No payment provider is configured for " + charge.getProvider() + ".");
        }
        PaymentProvider provider = configured.get();

        RefundResult result;
        try {
            result = provider.refund(new RefundRequest(
                    refund.pledgeId(),
                    charge.getProviderTransactionId(),
                    refund.amount(),
                    refund.reason().name(),
                    refund.idempotencyKey()));
        } catch (ProviderUnavailableException e) {
            // Unknown, not failed (#176): the reversal may have happened. Left REQUESTED for reconcile().
            log.warn(
                    "Refund {} of {} on pledge {} has no answer from {}; the reconciliation settles it: {}",
                    refund.id(),
                    refund.amount(),
                    refund.pledgeId(),
                    charge.getProvider(),
                    e.getMessage());
            return refunds.findById(refund.id()).orElse(refund);
        }

        if (result.outcome() == ProviderOutcome.DECLINED) {
            return records.settleFailure(refund, result.failureCode(), result.failureMessage());
        }

        return records.settleSuccess(refund, charge, result);
    }

    /**
     * IDN-EXT-01 (#40): refund what one settled charge has left because its campaign failed or was
     * halted, or because it paid for a raise that could not be applied (#171).
     *
     * <p><strong>The platform's own protection against refunding twice</strong>, since Epoint's
     * {@code /reverse} has none: the sweep only offers a charge with money left once every refund
     * requested or succeeded against it is counted, a {@code REQUESTED} row counts until it is settled,
     * and the key is unique per attempt. A refund whose outcome was lost is never re-sent blind —
     * {@link #reconcile} asks the provider what the payment is first.
     *
     * @return the settled refund, or empty when nothing remained to refund
     */
    public Optional<Refund> issueForCharge(UUID chargeId, UUID pledgeId, RefundReason reason) {
        String prefix = reason == RefundReason.RAISE_NOT_APPLIED ? "raise-refund:" : "campaign-refund:";
        String key = prefix + chargeId + ":" + (refunds.countAgainstCharge(chargeId) + 1);
        return records.recordForCharge(chargeId, reason, key).map(this::send);
    }

    /**
     * IDN-EXT-01 (#40): settle a refund whose outcome was never recorded — a crash between asking the
     * provider and writing the answer — from the provider's own status of the payment. Staff refunds
     * as well as the platform's, since #174's review.
     *
     * <p>{@code returned} is the refund having happened, and a payment the provider still calls paid
     * was not refunded — the row is failed so the next pass sends it again. <strong>But only when this
     * refund is the only one against its charge</strong> (#174's review). The status is the whole
     * payment's, and since #171 a payment can be reversed in parts: with another refund against the
     * same charge, {@code returned} may be that one, and a partial reversal may leave the payment
     * reported as paid. So a partial refund told "still paid", or any refund sharing its charge, is
     * not decided: it stays {@code REQUESTED} — still counted as gone, so nothing is sent twice — and is
     * marked for a person ({@link Refund#needsReview}), which the console's {@code REQUESTED} list
     * shows. Anything else — pending, or a provider that cannot look payments up — is left for a later
     * pass.
     */
    public Refund reconcile(Refund refund) {
        Optional<PaymentTransaction> found = transactions.findById(refund.chargeTransactionId());
        Optional<PaymentProvider> configured = found.flatMap(charge -> providers.byName(charge.getProvider()));
        if (configured.isEmpty()) {
            return records.markForReview(refund, "Its charge or the charge's provider cannot be found.");
        }
        PaymentTransaction charge = found.get();
        PaymentProvider provider = configured.get();

        PaymentLookup lookup;
        try {
            lookup = provider.lookUpPayment(charge.getProviderTransactionId());
        } catch (UnsupportedOperationException | ProviderUnavailableException e) {
            log.info("Refund {} stays unresolved: {}", refund.id(), e.getMessage());
            return refund;
        }

        // Every refund against the charge that has not failed, this one included: equal to this one's
        // amount only when it is the only one.
        boolean alone = refund.amount()
                .equals(Money.of(refunds.refundedAgainstCharge(charge.getId()), refund.amount().currency()));
        boolean whole = refund.amount().equals(charge.getAmount());
        return switch (lookup.state()) {
            case RETURNED -> alone
                    ? records.settleSuccess(
                            refund,
                            charge,
                            new RefundResult(ProviderOutcome.APPROVED, null, null, null, lookup.rawResponse()))
                    : records.markForReview(
                            refund,
                            "The provider reports the payment returned, and another refund went against the same"
                                    + " charge: which of them it was cannot be told from the payment's status.");
            case SUCCEEDED -> alone && whole
                    ? records.settleFailure(
                            refund, "reverse_not_confirmed", "The provider still reports the payment as paid.")
                    : records.markForReview(
                            refund,
                            "The provider still reports the payment as paid, and this refund was only part of it:"
                                    + " a partial reversal may not change the payment's status.");
            case PENDING, FAILED -> refund;
        };
    }

    /**
     * IDN-EXT-01 (#43): refund a pledge in full because an administrator upheld the backer's dispute.
     *
     * <p>For the payout module, which may not name this module's domain: the refund goes through
     * {@link #issueParts} with {@code DISPUTE_CONCEDED} and no amount, which returns every charge's
     * remainder (#171), and the answer is only whether all of it went through.
     *
     * <p><strong>A retry completes it (#174's review).</strong> When nothing is left to send because
     * every earlier part has gone back, the dispute is answered with the latest refund that did; when
     * a part is still without an outcome, the answer is empty until the reconciliation settles it —
     * never a second refund beside one that may have happened.
     *
     * @return a refund's identifier when all of the pledge's money has gone back, empty when a part was
     *     refused or has no outcome yet — a retry under a new key sends only what is still left
     */
    public Optional<UUID> refundForDispute(UUID staffId, UUID pledgeId, String detail, String idempotencyKey) {
        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);
        List<PaymentTransaction> charges = transactions.settledChargesOf(pledgeId);
        if (!charges.isEmpty()) {
            String currency = charges.getFirst().getAmount().currency();
            Money left = Money.of(transactions.collectedOn(pledgeId), currency)
                    .minus(Money.of(refunds.refundedAgainst(pledgeId), currency));
            if (!left.isPositive()) {
                return settledInFull(pledgeId);
            }
        }
        List<Refund> parts = issueParts(staffId, pledgeId, null, RefundReason.DISPUTE_CONCEDED, detail, idempotencyKey);
        boolean allSucceeded = parts.stream().allMatch(part -> part.state() == RefundState.SUCCEEDED);
        return allSucceeded ? settledInFull(pledgeId).or(() -> Optional.of(parts.getFirst().id())) : Optional.empty();
    }

    /** The latest refund that went back, when nothing on the pledge is still without an outcome. */
    private Optional<UUID> settledInFull(UUID pledgeId) {
        if (refunds.countRequestedAgainst(pledgeId) > 0) {
            return Optional.empty();
        }
        return refunds.forPledge(pledgeId).stream()
                .filter(refund -> refund.state() == RefundState.SUCCEEDED)
                .map(Refund::id)
                .findFirst();
    }
}
