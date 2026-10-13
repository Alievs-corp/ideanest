package az.ideanest.payment.domain;

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
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A creator plan paid on the provider's page — V102's row, issue #449.
 *
 * <p>The page's life, not the money's record. {@code subscription_payments} is the receipt and is
 * written by the subscription module when this settles {@link Status#PAID}.
 */
@Entity
@Table(name = "subscription_charges")
public class SubscriptionCharge {

    public enum Purpose {
        FIRST_PERIOD,
        RENEWAL
    }

    public enum Status {
        PENDING,
        PAID,
        FAILED,
        /** Paid, for a subscription that could no longer take it. A person refunds it. */
        UNAPPLIED
    }

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "subscription_id", nullable = false, updatable = false)
    private UUID subscriptionId;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "purpose", nullable = false, updatable = false)
    private Purpose purpose;

    @Convert(converter = MoneyAmountConverter.class)
    @Column(name = "amount", nullable = false, updatable = false)
    private BigDecimal amount;

    @Column(name = "currency", nullable = false, updatable = false)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "provider", nullable = false, updatable = false)
    private ProviderName provider;

    @Column(name = "provider_transaction_id", nullable = false, updatable = false)
    private String providerTransactionId;

    @Column(name = "payment_url", nullable = false, updatable = false)
    private String paymentUrl;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private Status status;

    @Column(name = "opened_at", nullable = false, updatable = false)
    private Instant openedAt;

    @Column(name = "settled_at")
    private Instant settledAt;

    @Column(name = "checked_at")
    private Instant checkedAt;

    @Column(name = "raw_response")
    private String rawResponse;

    protected SubscriptionCharge() {
        // Hibernate.
    }

    public static SubscriptionCharge opened(
            UUID id,
            UUID subscriptionId,
            UUID accountId,
            Purpose purpose,
            Money amount,
            ProviderName provider,
            HostedPaymentSession session,
            Instant at) {
        SubscriptionCharge charge = new SubscriptionCharge();
        charge.id = Objects.requireNonNull(id);
        charge.subscriptionId = Objects.requireNonNull(subscriptionId);
        charge.accountId = Objects.requireNonNull(accountId);
        charge.purpose = Objects.requireNonNull(purpose);
        charge.amount = Objects.requireNonNull(amount).amount();
        charge.currency = amount.currency();
        charge.provider = Objects.requireNonNull(provider);
        charge.providerTransactionId = session.providerTransactionId();
        charge.paymentUrl = session.redirectUrl().toString();
        charge.status = Status.PENDING;
        charge.openedAt = Objects.requireNonNull(at);
        return charge;
    }

    public void paid(Instant at, String raw) {
        settle(Status.PAID, at, raw);
    }

    public void failed(Instant at, String raw) {
        settle(Status.FAILED, at, raw);
    }

    public void unapplied(Instant at, String raw) {
        settle(Status.UNAPPLIED, at, raw);
    }

    public void checked(Instant at) {
        this.checkedAt = Objects.requireNonNull(at);
    }

    public boolean isPending() {
        return status == Status.PENDING;
    }

    /** Whether the creator can be sent back to this page instead of opening another order. */
    public boolean isReusableAt(Instant now, Duration reuseFor) {
        return isPending() && openedAt.plus(reuseFor).isAfter(now);
    }

    private void settle(Status outcome, Instant at, String raw) {
        if (!isPending()) {
            throw new IllegalStateException("Subscription charge " + id + " is already " + status);
        }
        this.status = outcome;
        this.settledAt = Objects.requireNonNull(at);
        this.rawResponse = raw;
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

    public Purpose getPurpose() {
        return purpose;
    }

    public Money getAmount() {
        return Money.of(amount, currency);
    }

    public ProviderName getProvider() {
        return provider;
    }

    public String getProviderTransactionId() {
        return providerTransactionId;
    }

    public URI getPaymentUrl() {
        return URI.create(paymentUrl);
    }

    public Status getStatus() {
        return status;
    }

    public Instant getOpenedAt() {
        return openedAt;
    }

    public Instant getSettledAt() {
        return settledAt;
    }
}
