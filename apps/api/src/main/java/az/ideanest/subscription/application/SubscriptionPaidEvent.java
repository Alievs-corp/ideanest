package az.ideanest.subscription.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code subscription.paid} — epic #448: a payment for a creator plan was collected, for a first period
 * or for a renewal, and the creator is sent {@code SUBSCRIPTION_RENEWED} as the receipt (#450).
 *
 * <p>The contract between #449, which records it in the transaction that opens or extends the period,
 * and the notification module, which reads it by name. Changing a component is changing both.
 *
 * @param amount what was collected, the subscription's own snapshot price
 * @param renewal whether this extended a running period rather than opening the first one
 * @param periodEnd the end of the period the payment bought
 */
public record SubscriptionPaidEvent(
        UUID subscriptionId,
        UUID accountId,
        UUID planId,
        String planName,
        Money amount,
        boolean renewal,
        Instant periodEnd,
        Instant paidAt) {

    public static final String AGGREGATE_TYPE = "subscription";
    public static final String EVENT_TYPE = "subscription.paid";
}
