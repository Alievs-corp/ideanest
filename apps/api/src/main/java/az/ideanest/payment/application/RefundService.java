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
import az.ideanest.shared.money.Money;
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
     * Issues a refund.
     *
     * <p>Deliberately not {@code @Transactional}: it commits twice with a network call in
     * between. See the class comment.
     *
     * @param amount what to send back, or null for the whole of what is left. Null rather
     *     than a {@code full} flag, so "all of it" cannot disagree with a number the
     *     console computed from a page it loaded ten minutes ago
     * @param idempotencyKey CLAUDE.md: every payment mutation is idempotent. A replay
     *     returns the original row and reaches no provider
     * @throws RefundExceedsCollectionException when this would return more than was taken
     * @throws NothingToRefundException when the pledge has no settled charge
     */
    public Refund issue(
            UUID staffId, UUID pledgeId, Money amount, RefundReason reason, String detail, String idempotencyKey) {

        staff.requireCapability(staffId, StaffCapability.ISSUE_REFUND);

        Optional<Refund> replayed = refunds.byIdempotencyKey(idempotencyKey);
        if (replayed.isPresent()) {
            // The whole of §9.3's R-08. A retried request returns the original result and
            // does not reach the provider, which on this endpoint is the difference
            // between refunding once and refunding twice.
            log.info("Refund {} replayed under key {}", replayed.get().id(), idempotencyKey);
            return replayed.get();
        }

        return send(records.record(staffId, pledgeId, amount, reason, detail, idempotencyKey));
    }

    /** Steps two and three: the provider call, then the outcome. */
    private Refund send(Refund refund) {
        PaymentTransaction charge = transactions
                .findById(refund.chargeTransactionId())
                .orElseThrow(() -> new NothingToRefundException(refund.pledgeId()));

        PaymentProvider provider = providers
                .byName(charge.getProvider())
                .orElseThrow(() -> new UnconfiguredProviderException(charge.getProvider()));

        RefundResult result;
        try {
            result = provider.refund(new RefundRequest(
                    refund.pledgeId(),
                    charge.getProviderTransactionId(),
                    refund.amount(),
                    refund.reason().name(),
                    refund.idempotencyKey()));
        } catch (ProviderUnavailableException e) {
            // Recorded as a failure rather than propagated. The row is the point: a refund
            // nobody can see failed is a refund nobody retries, and the backer is still
            // waiting for their money.
            return records.settleFailure(refund, PaymentTransaction.UNREACHABLE, e.getMessage());
        }

        if (result.outcome() == ProviderOutcome.DECLINED) {
            return records.settleFailure(refund, result.failureCode(), result.failureMessage());
        }

        return records.settleSuccess(refund, charge, result);
    }

    /**
     * IDN-EXT-01 (#40): refund a paid pledge in full because its campaign failed or was halted.
     *
     * <p><strong>The platform's own protection against refunding twice</strong>, since Epoint's
     * {@code /reverse} has none: the sweep only offers a pledge with no refund requested or succeeded,
     * a {@code REQUESTED} row blocks every later attempt until it is settled, and the key is unique per
     * attempt. A refund whose outcome was lost is never re-sent blind — {@link #reconcile} asks the
     * provider what the payment is first.
     *
     * @return the settled refund, or empty when nothing remained to refund
     */
    public Optional<Refund> issueForCampaign(UUID pledgeId, RefundReason reason) {
        String key = "campaign-refund:" + pledgeId + ":" + (refunds.forPledge(pledgeId).size() + 1);
        return records.recordForCampaign(pledgeId, reason, key).map(this::send);
    }

    /**
     * IDN-EXT-01 (#40): settle a platform refund whose outcome was never recorded — a crash between
     * asking the provider and writing the answer — from the provider's own status.
     *
     * <p>{@code returned} is the refund having happened. A payment the provider still calls paid was
     * not refunded, and the row is failed so the next pass sends it again. Anything else — pending, or
     * a provider that cannot look payments up — is left for a later pass.
     */
    public Refund reconcile(Refund refund) {
        PaymentTransaction charge = transactions
                .findById(refund.chargeTransactionId())
                .orElseThrow(() -> new NothingToRefundException(refund.pledgeId()));
        PaymentProvider provider = providers
                .byName(charge.getProvider())
                .orElseThrow(() -> new UnconfiguredProviderException(charge.getProvider()));

        PaymentLookup lookup;
        try {
            lookup = provider.lookUpPayment(charge.getProviderTransactionId());
        } catch (UnsupportedOperationException | ProviderUnavailableException e) {
            log.info("Refund {} stays unresolved: {}", refund.id(), e.getMessage());
            return refund;
        }
        return switch (lookup.state()) {
            case RETURNED -> records.settleSuccess(
                    refund,
                    charge,
                    new RefundResult(ProviderOutcome.APPROVED, null, null, null, lookup.rawResponse()));
            case SUCCEEDED -> records.settleFailure(
                    refund, "reverse_not_confirmed", "The provider still reports the payment as paid.");
            case PENDING, FAILED -> refund;
        };
    }

    /**
     * IDN-EXT-01 (#43): refund a pledge in full because an administrator upheld the backer's dispute.
     *
     * <p>For the payout module, which may not name this module's domain: the refund goes through
     * {@link #issue} with {@code DISPUTE_CONCEDED}, and the answer is only whether it went through.
     *
     * @return the refund's identifier when it succeeded, empty when the provider refused it
     */
    public Optional<UUID> refundForDispute(UUID staffId, UUID pledgeId, String detail, String idempotencyKey) {
        Refund refund = issue(staffId, pledgeId, null, RefundReason.DISPUTE_CONCEDED, detail, idempotencyKey);
        return refund.state() == RefundState.SUCCEEDED ? Optional.of(refund.id()) : Optional.empty();
    }
}
