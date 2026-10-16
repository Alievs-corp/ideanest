package az.ideanest.subscription.application;

import az.ideanest.subscription.domain.SubscriptionState;
import java.util.UUID;

/**
 * Staff tried to end a subscription that has already ended.
 *
 * <p>Ending is for a subscription that is still waiting for its payment or still running. An expired or
 * cancelled one is over already, and ending it again used to succeed: an {@code EXPIRED} row turned into
 * a {@code CANCELED} one, the note recorded at activation was overwritten with the new reason, and the
 * trail gained a second cancellation for a single subscription. Refused with the state the row is in,
 * which tells a reader with a stale page that somebody, or the clock, got there first.
 */
public class SubscriptionNotOpenException extends RuntimeException {

    private final UUID subscriptionId;
    private final SubscriptionState state;

    public SubscriptionNotOpenException(UUID subscriptionId, SubscriptionState state) {
        super("Subscription " + subscriptionId + " is " + state + " and has already ended");
        this.subscriptionId = subscriptionId;
        this.state = state;
    }

    public UUID subscriptionId() {
        return subscriptionId;
    }

    public SubscriptionState state() {
        return state;
    }
}
