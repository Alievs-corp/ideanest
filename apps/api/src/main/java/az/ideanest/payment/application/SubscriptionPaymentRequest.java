package az.ideanest.payment.application;

import az.ideanest.shared.money.Money;
import java.util.Objects;
import java.util.UUID;

/**
 * A creator plan's period to be paid on the provider's page — issue #449.
 *
 * @param amount what this period costs: the subscription's own price for its own period, or the
 *     plan's current price for another one it is extended by (#660)
 * @param billingPeriod the period paid for, as the subscription module names it ({@code MONTHLY},
 *     {@code SEMIANNUAL}, {@code YEARLY}). Recorded on the page, and what settlement extends by
 * @param planName shown on the provider's page
 * @param renewal whether this extends a running period rather than opening the first one
 */
public record SubscriptionPaymentRequest(
        UUID subscriptionId, UUID accountId, Money amount, String billingPeriod, String planName, boolean renewal) {

    public SubscriptionPaymentRequest {
        Objects.requireNonNull(subscriptionId, "A plan payment is for a subscription");
        Objects.requireNonNull(accountId, "A plan payment is made by an account");
        Objects.requireNonNull(amount, "A plan payment has an amount");
        Objects.requireNonNull(billingPeriod, "A plan payment is for some period");
        if (!amount.isPositive()) {
            throw new IllegalArgumentException("A free plan is not paid for, and this one costs " + amount);
        }
    }
}
