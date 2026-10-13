package az.ideanest.payment.application;

import az.ideanest.shared.money.Money;
import java.util.Objects;
import java.util.UUID;

/**
 * A creator plan's period to be paid on the provider's page — issue #449.
 *
 * @param amount the subscription's own price, which V62 snapshots at purchase
 * @param planName shown on the provider's page
 * @param renewal whether this extends a running period rather than opening the first one
 */
public record SubscriptionPaymentRequest(
        UUID subscriptionId, UUID accountId, Money amount, String planName, boolean renewal) {

    public SubscriptionPaymentRequest {
        Objects.requireNonNull(subscriptionId, "A plan payment is for a subscription");
        Objects.requireNonNull(accountId, "A plan payment is made by an account");
        Objects.requireNonNull(amount, "A plan payment has an amount");
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("A free plan is not paid for, and this one costs " + amount);
        }
    }
}
