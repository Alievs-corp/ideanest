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
        // reasons (IDN-EXT-01, #40).
        if (requestedBy == null && reason != RefundReason.CAMPAIGN_FAILED && reason != RefundReason.CAMPAIGN_HALTED) {
            throw new IllegalArgumentException("Only a campaign refund may be issued by the platform itself");
        }
        this.requestedBy = requestedBy;
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey, "idempotencyKey");
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
