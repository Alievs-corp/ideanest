package az.ideanest.subscription.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code subscription.renewal_due} — #450: a priced plan the creator has not cancelled ends soon, and
 * renewing it is their decision (epic #448: nothing is charged without them). Recorded by
 * {@code subscription-renewal-reminders} once per subscription, period end and lead, in the transaction
 * that claims that reminder.
 *
 * @param price what renewing costs: the subscription's own snapshot price, never the catalogue's
 * @param periodEnd when the entitlement stops if nobody renews it
 * @param daysLeft whole days from the reminder to the end, rounded up, so never zero
 */
public record SubscriptionRenewalDueEvent(
        UUID subscriptionId,
        UUID accountId,
        UUID planId,
        String planName,
        Money price,
        Instant periodEnd,
        int daysLeft,
        Instant remindedAt) {

    public static final String AGGREGATE_TYPE = "subscription";
    public static final String EVENT_TYPE = "subscription.renewal_due";
}
