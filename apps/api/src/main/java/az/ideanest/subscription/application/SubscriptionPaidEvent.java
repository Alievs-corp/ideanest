package az.ideanest.subscription.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code subscription.paid} — issues #449 and #450: a creator paid for a plan period by card, and is
 * sent a receipt. Recorded in the transaction that opens or extends the period.
 *
 * @param renewal whether it extended a running period rather than opening the first one
 * @param periodEnd when the period it paid for ends
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
