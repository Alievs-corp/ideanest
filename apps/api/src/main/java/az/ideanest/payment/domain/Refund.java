package az.ideanest.payment.domain;

import az.ideanest.shared.Identifiers;
import az.ideanest.shared.money.Money;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * The decision behind a refund — V53's row, issues #67 and #307.
 *
 * <p><strong>This is not where the money is.</strong> That is a {@code transactions} row
 * of type {@code REFUND} and the ledger entries behind it, both append-only. What lives
 * here is the half {@code transactions} deliberately does not carry: a reason code
 * somebody chose, the sentence they typed, who they were, and a state that exists before
 * any provider has been called. V53's header has the argument for the split.
 *
 * <p><strong>Two methods change anything</strong>, and they are the two outcomes. There is
 * no setter for the amount or the reason: a refund that could be edited after it was sent
 * would be a record of what somebody currently says they did.
 */
@Entity
@Table(name = "refunds")
public class Refund {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "pledge_id", nullable = false, updatable = false)
    private UUID pledgeId;

    @Column(name = "project_id", nullable = false, updatable = false)
    private UUID projectId;

    @Column(name = "charge_transaction_id", updatable = false)
    private UUID chargeTransactionId;

    @Column(name = "refund_transaction_id")
    private UUID refundTransactionId;

    @Column(name = "amount", nullable = false, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Column(name = "full_refund", nullable = false, updatable = false)
    private boolean fullRefund;

    @Enumerated(EnumType.STRING)
    @Column(name = "reason", nullable = false, updatable = false)
    private RefundReason reason;

    @Column(name = "detail", nullable = false, updatable = false)
    private String detail;

    @Enumerated(EnumType.STRING)
    @Column(name = "state", nullable = false)
    private RefundState state;

    @Column(name = "failure_code")
    private String failureCode;

    @Column(name = "failure_message")
    private String failureMessage;

    @Column(name = "review_reason")
    private String reviewReason;

    @Column(name = "requested_by", nullable = false, updatable = false)
    private UUID requestedBy;

    @Column(name = "requested_at", nullable = false, insertable = false, updatable = false)
    private Instant requestedAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    @Column(name = "idempotency_key", nullable = false, updatable = false)
    private String idempotencyKey;

    protected Refund() {
        // Hibernate.
    }

    private Refund(
            UUID pledgeId,
            UUID projectId,
            UUID chargeTransactionId,
            Money amount,
            boolean fullRefund,
            RefundReason reason,
            String detail,
            UUID requestedBy,
            String idempotencyKey) {

        this.id = Identifiers.newIdentifier();
        this.pledgeId = Objects.requireNonNull(pledgeId, "pledgeId");
        this.projectId = Objects.requireNonNull(projectId, "projectId");
        this.chargeTransactionId = chargeTransactionId;
        this.amount = amount.amount();
        this.currency = amount.currency();
        this.fullRefund = fullRefund;
        this.reason = Objects.requireNonNull(reason, "reason");
        this.detail = Objects.requireNonNull(detail, "detail");
        this.state = RefundState.REQUESTED;
        // Null only for a refund the platform issued itself, which V76 limits to the two campaign
        // reasons (IDN-EXT-01, #40) and V83 extends to a raise that could not be applied (#171).
        if (requestedBy == null && !isPlatformReason(reason)) {
            throw new IllegalArgumentException("Only a campaign refund may be issued by the platform itself");
        }
        this.requestedBy = requestedBy;
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey, "idempotencyKey");
    }

    /** The reasons the platform refunds on its own, with no member of staff behind them. */
    public static boolean isPlatformReason(RefundReason reason) {
        return reason == RefundReason.CAMPAIGN_FAILED
                || reason == RefundReason.CAMPAIGN_HALTED
                || reason == RefundReason.RAISE_NOT_APPLIED;
    }

    /**
     * A refund somebody has decided on and nobody has sent.
     *
     * <p>Written before the provider is called, deliberately. The alternative — call
     * first, record afterwards — loses the one case that matters: a call that reaches the
     * provider and whose answer is lost. Then money has left and there is no row saying
     * anybody meant it to, and the idempotency key that would make a retry safe was never
     * stored.
     */
    public static Refund requested(
            UUID pledgeId,
            UUID projectId,
            UUID chargeTransactionId,
            Money amount,
            boolean fullRefund,
            RefundReason reason,
            String detail,
            UUID requestedBy,
            String idempotencyKey) {

        return new Refund(
                pledgeId,
                projectId,
                chargeTransactionId,
                amount,
                fullRefund,
                reason,
                detail,
                requestedBy,
                idempotencyKey);
    }

    /** The provider took it. */
    public void succeeded(UUID refundTransactionId, Instant at) {
        this.state = RefundState.SUCCEEDED;
        this.refundTransactionId = Objects.requireNonNull(refundTransactionId, "refundTransactionId");
        this.settledAt = Objects.requireNonNull(at, "at");
        this.failureCode = null;
        this.failureMessage = null;
        this.reviewReason = null;
    }

    /**
     * The provider refused, or could not be reached.
     *
     * <p>Terminal for this row. A retry is a new {@link #requested} row with a new
     * idempotency key, because it is a new decision — and because reusing the key would
     * ask the provider to replay a call it has already refused.
     */
    public void failed(String failureCode, String failureMessage, Instant at) {
        this.state = RefundState.FAILED;
        this.failureCode = Objects.requireNonNull(failureCode, "failureCode");
        this.failureMessage = failureMessage;
        this.settledAt = Objects.requireNonNull(at, "at");
        this.reviewReason = null;
    }

    /**
     * The provider's answer was lost and its status of the payment cannot say whether this refund
     * happened (#174's review): another refund went against the same charge, or this one was only part
     * of it. The row stays {@code REQUESTED} — it still counts as gone, so nothing is sent twice — and
     * is left to a person; the reconciliation stops asking about it.
     */
    public void needsReview(String reason) {
        if (state != RefundState.REQUESTED) {
            throw new IllegalStateException("Only a refund whose outcome is unknown is left for review");
        }
        this.reviewReason = Objects.requireNonNull(reason, "reason");
    }

    /** Why a person has to settle this refund, or null when nobody has to. */
    public String reviewReason() {
        return reviewReason;
    }

    public UUID id() {
        return id;
    }

    public UUID pledgeId() {
        return pledgeId;
    }

    public UUID projectId() {
        return projectId;
    }

    public UUID chargeTransactionId() {
        return chargeTransactionId;
    }

    public UUID refundTransactionId() {
        return refundTransactionId;
    }

    public Money amount() {
        return Money.of(amount, currency);
    }

    /**
     * Whether this refund was meant to return the rest of the pledge — V53's intent, recorded when it
     * was requested and never changed.
     *
     * <p><strong>Not whether the pledge was refunded in full (#171).</strong> A refund of a raised
     * pledge is one part per charge and every part of a full refund carries the flag; and an intent
     * can fail. Whether the pledge's money has all gone back is decided when a refund settles, from
     * what was charged and what succeeded, and shows as the pledge's {@code REFUNDED} state.
     */
    public boolean fullRefund() {
        return fullRefund;
    }

    public RefundReason reason() {
        return reason;
    }

    public String detail() {
        return detail;
    }

    public RefundState state() {
        return state;
    }

    public String failureCode() {
        return failureCode;
    }

    public String failureMessage() {
        return failureMessage;
    }

    /** Whether the platform issued this refund itself rather than a member of staff. #40. */
    public boolean isSystemRefund() {
        return requestedBy == null;
    }

    public UUID requestedBy() {
        return requestedBy;
    }

    public Instant requestedAt() {
        return requestedAt;
    }

    public Instant settledAt() {
        return settledAt;
    }

    public String idempotencyKey() {
        return idempotencyKey;
    }
}
