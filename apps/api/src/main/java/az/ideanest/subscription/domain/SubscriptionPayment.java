package az.ideanest.subscription.domain;

import az.ideanest.shared.money.Money;
import az.ideanest.shared.money.MoneyAmountConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.Generated;
import org.hibernate.generator.EventType;

/**
 * Money the platform was actually paid for a subscription — V73's row.
 *
 * <h2>There is no method here that changes anything</h2>
 *
 * <p>{@code AuditEntry}'s argument, for the same reason and with the same division of
 * labour: V73's trigger is the guarantee, and this is the half that makes an accidental
 * change fail at compile time rather than at the statement. Every column is
 * {@code updatable = false} so a dirty-checked flush cannot emit an UPDATE the database
 * would then refuse — which would turn a recorded payment into a 500 for the member of
 * staff who recorded it.
 *
 * <h2>The plan is copied onto the row, and the subscription is not read to render it</h2>
 *
 * <p>V62 makes a plan editable on purpose, so a report that joined to
 * {@code subscription_plans} would be retitled by a rename and re-priced by a repricing.
 * {@link #planCode}, {@link #planName}, {@link #amount} and {@link #billingPeriod} are
 * what the report displays; {@link #planId} is kept so it can still be filtered by.
 *
 * <p>{@link #subscriptionId} and {@link #accountId} are identifiers without foreign keys,
 * and may point at rows that are gone — V62 cascades a subscription away with its account.
 * V73's header argues why that is correct for a receipt rather than a defect. Nothing here
 * dereferences them.
 *
 * <h2>A correction is another row</h2>
 *
 * <p>{@link #amount} is signed, so a refund or a mis-recorded payment is a reversing row
 * carrying the negative and {@link #reverses} pointing at what it undoes. Every total over
 * this table is therefore a sum that nets. Nothing writes {@link #reverses} in this
 * release; V73 says why the column ships anyway.
 */
@Entity
@Table(name = "subscription_payments")
public class SubscriptionPayment {

    private static final int REFERENCE_MAX = 200;
    private static final int NOTE_MAX = 2000;

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "subscription_id", nullable = false, updatable = false)
    private UUID subscriptionId;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "plan_id", nullable = false, updatable = false)
    private UUID planId;

    @Column(name = "plan_code", nullable = false, updatable = false)
    private String planCode;

    @Column(name = "plan_name", nullable = false, updatable = false)
    private String planName;

    @Convert(converter = MoneyAmountConverter.class)
    @Column(name = "amount", nullable = false, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_period", nullable = false, updatable = false)
    private BillingPeriod billingPeriod;

    @Enumerated(EnumType.STRING)
    @Column(name = "method", nullable = false, updatable = false)
    private PaymentMethod method;

    @Column(name = "reference", updatable = false)
    private String reference;

    @Column(name = "note", updatable = false)
    private String note;

    @Column(name = "received_at", nullable = false, updatable = false)
    private Instant receivedAt;

    /**
     * The database's, not the caller's — {@code AuditEntry}'s reasoning, and here it is
     * what makes {@link #receivedAt} safe to backdate. A row received on the 31st and
     * written on the 3rd is visible as exactly that rather than as one or the other.
     */
    @Generated(event = EventType.INSERT)
    @Column(name = "recorded_at", nullable = false, insertable = false, updatable = false)
    private Instant recordedAt;

    @Column(name = "recorded_by", updatable = false)
    private UUID recordedBy;

    @Column(name = "reverses", updatable = false)
    private UUID reverses;

    protected SubscriptionPayment() {
        // Hibernate.
    }

    /**
     * Records that a subscription payment arrived.
     *
     * <p>The plan is taken apart here rather than held as a reference, which is the whole
     * point of the row: what it says about the plan must not change when the plan does.
     *
     * @param subscription what was paid for. Its own price is used rather than the plan's
     *     current one — that price is itself a snapshot taken at purchase, and the figure
     *     the creator agreed to is the figure they transferred
     * @param plan the plan as it stands now, for its code and name. If it has been renamed
     *     since the purchase, the name recorded is the one in force when the money arrived,
     *     which is what a receipt written today would say
     * @param receivedAt when the money arrived. May be earlier than now: a transfer that
     *     cleared on the 31st belongs in the month it cleared
     * @param recordedBy the member of staff confirming it, or null for a provider callback
     *     when #60 lands
     */
    public static SubscriptionPayment received(
            UUID id,
            Subscription subscription,
            SubscriptionPlan plan,
            PaymentMethod method,
            Instant receivedAt,
            UUID recordedBy,
            String reference,
            String note) {

        Objects.requireNonNull(subscription, "A payment is against a subscription");
        Objects.requireNonNull(plan, "A payment is for a plan");

        Money price = subscription.getPrice();
        if (price.amount().signum() == 0) {
            // A free plan is activated without anybody confirming anything, so there is no
            // payment to record. Refused rather than written as a zero row: V73's CHECK
            // would refuse it at the statement, and a row saying nothing arrived would sit
            // in the account's history as a payment.
            throw new IllegalArgumentException("A payment of nothing is not a payment");
        }

        SubscriptionPayment payment = new SubscriptionPayment();
        payment.id = Objects.requireNonNull(id, "A payment has an identifier");
        payment.subscriptionId = subscription.getId();
        payment.accountId = subscription.getAccountId();
        payment.planId = plan.getId();
        payment.planCode = plan.getCode();
        payment.planName = plan.getName();
        payment.amount = price.amount();
        payment.currency = price.currency();
        payment.billingPeriod = subscription.getBillingPeriod();
        payment.method = Objects.requireNonNull(method, "A payment arrived somehow");
        payment.receivedAt = Objects.requireNonNull(receivedAt, "A payment arrived at some instant");
        payment.recordedBy = recordedBy;
        payment.reference = trimmedOrNull(reference, REFERENCE_MAX);
        payment.note = trimmedOrNull(note, NOTE_MAX);
        return payment;
    }

    /** Whether this row undoes another rather than recording money in. */
    public boolean isReversal() {
        return reverses != null;
    }

    public UUID getId() {
        return id;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getPlanId() {
        return planId;
    }

    /** The plan's code as it stood when the money arrived, which may not be its code now. */
    public String getPlanCode() {
        return planCode;
    }

    /** The plan's name as it stood when the money arrived. See the class header. */
    public String getPlanName() {
        return planName;
    }

    /** Signed: negative on a reversing row. */
    public Money getAmount() {
        return Money.of(amount, currency);
    }

    public BillingPeriod getBillingPeriod() {
        return billingPeriod;
    }

    public PaymentMethod getMethod() {
        return method;
    }

    public String getReference() {
        return reference;
    }

    public String getNote() {
        return note;
    }

    public Instant getReceivedAt() {
        return receivedAt;
    }

    public Instant getRecordedAt() {
        return recordedAt;
    }

    public UUID getRecordedBy() {
        return recordedBy;
    }

    public UUID getReverses() {
        return reverses;
    }

    private static String trimmedOrNull(String value, int max) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        // Truncated rather than refused, for `Subscription.trimmedOrNull`'s reason: losing
        // the record of a payment because somebody pasted a bank statement into the
        // reference field would be the wrong trade.
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}
