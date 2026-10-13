package az.ideanest.subscription.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code subscription.lapsed} — #450: a priced plan's period ended without a renewal, so its creator can
 * no longer submit a campaign until they buy one again. Live campaigns are untouched (epic #448).
 * Recorded once per subscription and period end by {@code subscription-renewal-reminders}.
 *
 * @param price what the plan cost, the subscription's own snapshot price
 * @param periodEnd when the entitlement stopped
 */
public record SubscriptionLapsedEvent(
        UUID subscriptionId,
        UUID accountId,
        UUID planId,
        String planName,
        Money price,
        Instant periodEnd,
        Instant noticedAt) {

    public static final String AGGREGATE_TYPE = "subscription";
    public static final String EVENT_TYPE = "subscription.lapsed";
}
