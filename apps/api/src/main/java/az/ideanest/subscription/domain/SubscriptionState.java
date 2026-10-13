package az.ideanest.subscription.domain;

/**
 * Where a subscription is in its life.
 *
 * <p><strong>{@code ACTIVE} is not the same as entitled.</strong> An active subscription
 * whose {@code current_period_end} has passed entitles nobody, and
 * {@link Subscription#entitlesAt} is the only thing that answers the question — see V62 on
 * why there is no sweep marking those rows {@code EXPIRED} on a schedule. Anything that
 * branches on this enum alone is asking the wrong question.
 */
public enum SubscriptionState {

    /**
     * Chosen and not yet paid for.
     *
     * <p>Where a priced plan starts. The provider's callback for a card payment (#449), or a
     * member of staff recording a bank transfer, makes it {@link #ACTIVE}.
     *
     * <p>A plan priced at zero never passes through here. There is no payment to wait for,
     * and a state that meant "waiting for nothing" would be a queue entry a member of
     * staff has to clear for a subscription that costs the platform nothing.
     */
    PENDING_PAYMENT,

    /**
     * Paid for, and running until {@code current_period_end}.
     *
     * <p>Terminal in the sense that nothing moves it back to {@link #PENDING_PAYMENT}: a
     * subscription that has lapsed is bought again as a new row rather than reopened, so
     * that what somebody paid and when stays one fact per row.
     */
    ACTIVE,

    /**
     * Ended before its period ran out.
     *
     * <p>What staff ending a subscription does. <strong>Not</strong> what a creator
     * cancelling does — they have paid for the period, so their cancellation sets
     * {@code cancel_at_period_end} and leaves the row {@link #ACTIVE} until the clock
     * catches up. Taking the entitlement away the moment they click would be charging for
     * something and then withdrawing it.
     */
    CANCELED,

    /**
     * Its period ran out.
     *
     * <p>Written by {@code Subscriptions.subscribe} on the row it is about to replace, and
     * by nothing else. It exists for V62's unique index, which cannot consult a clock: an
     * {@code ACTIVE} row whose period ended last week would otherwise block the same
     * account from subscribing again.
     */
    EXPIRED
}
