/**
 * What a creator pays to publish, and what that buys them.
 *
 * <p><strong>Its own module because three others need it and none should own it.</strong>
 * The project module refuses a submission without an entitlement; the console edits the
 * catalogue; the pricing page reads it. Putting the plans in {@code project} would mean
 * the console reached into the campaign module to change a price, and putting them in
 * {@code fee} would conflate two different things the platform charges for — §9's cut of
 * a pledge is taken from a backer's money and belongs to the campaign's terms, whereas
 * this is a creator's own bill.
 *
 * <p>Callers name {@code shared.access.PublishingEntitlement} and get a
 * {@code PublishingAllowance}. Nothing outside this module names {@code SubscriptionPlan}
 * or {@code Subscription}, or reads {@code subscription_plans} and {@code subscriptions}.
 *
 * <p><strong>No card is handled here.</strong> A paid plan is bought into
 * {@code PENDING_PAYMENT}; the creator pays it on the provider's page, which the payment
 * module opens and settles ({@code SubscriptionCardPayments}, #449), or by bank transfer that
 * a member of staff records. Every later period is paid the same way by the creator, inside
 * the renewal window — nothing is charged on a schedule (epic #448).
 */
package az.ideanest.subscription;
