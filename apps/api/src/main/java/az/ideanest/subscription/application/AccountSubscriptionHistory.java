package az.ideanest.subscription.application;

import az.ideanest.subscription.domain.Subscription;
import java.util.List;

/**
 * Everything one account has held and paid — #23's fourth step, for the console's account
 * page.
 *
 * <p>Two lists rather than payments nested under their subscriptions, because the two do not
 * line up one-to-one and a nesting would pretend they do. A subscription that lapsed and was
 * bought again is two subscriptions and possibly one payment each; a reversal is a second
 * payment against the same subscription; and a payment outlives the subscription row V62
 * cascades away with a closed account, so a payment can have no parent here at all. Each row
 * of either list carries the identifiers that join them where a join exists.
 *
 * @param subscriptions newest first, every state, including the lapsed and the cancelled —
 *     "had Growth until March" is the answer a moderator is usually after
 * @param payments newest first by when the money arrived, reversals included and signed
 */
public record AccountSubscriptionHistory(List<Subscription> subscriptions, List<PaymentPage.Payment> payments) {

    public AccountSubscriptionHistory {
        subscriptions = List.copyOf(subscriptions);
        payments = List.copyOf(payments);
    }
}
