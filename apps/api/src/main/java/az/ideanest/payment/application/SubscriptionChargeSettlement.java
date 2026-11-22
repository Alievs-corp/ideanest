package az.ideanest.payment.application;

import az.ideanest.shared.money.Money;
import java.time.Instant;
import java.util.UUID;

/**
 * What a paid plan page means to the subscription — issue #449.
 *
 * <p>Declared here and implemented by the subscription module, for {@code PaymentPage}'s reason in
 * the other direction: the subscription module opens pages through {@link SubscriptionCheckout}, and
 * this module naming a subscription type would make the two a cycle, which
 * {@code ModuleBoundaryTests} refuses.
 *
 * <p>Called inside the transaction that settles the page, so the period and the receipt commit with
 * the page's settlement or not at all.
 */
public interface SubscriptionChargeSettlement {

    Outcome paid(PaidSubscriptionCharge charge);

    /**
     * @param amount what the provider took, and the subscription's price from now on (#660)
     * @param billingPeriod the period the page was opened for, as the subscription module names it,
     *     and what the subscription is extended by — never a re-read of the plan (#660). Null for a
     *     page opened before V129, which pays for the subscription's own period
     * @param provider the provider's name, for the receipt's reference
     * @param providerTransactionId the provider's order, recorded as the receipt's reference
     */
    record PaidSubscriptionCharge(
            UUID chargeId,
            UUID subscriptionId,
            UUID accountId,
            Money amount,
            String billingPeriod,
            String provider,
            String providerTransactionId,
            Instant paidAt) {
    }

    enum Outcome {
        /** The first period opened. */
        ACTIVATED,
        /** The running period was extended by one more. */
        RENEWED,
        /** The subscription had ended and could not take the money. A person refunds it. */
        UNAPPLIED
    }
}
