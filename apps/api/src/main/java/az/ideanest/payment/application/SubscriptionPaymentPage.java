package az.ideanest.payment.application;

import java.net.URI;

/** Where to send the creator to pay for their plan, and the provider's name for the payment — #449. */
public record SubscriptionPaymentPage(String providerTransactionId, URI redirectUrl) {
}
