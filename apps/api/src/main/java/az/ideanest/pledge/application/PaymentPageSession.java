package az.ideanest.pledge.application;

import java.net.URI;

/** Where to send the backer to pay, and the provider's name for the payment — IDN-EXT-01 (#39). */
public record PaymentPageSession(String providerTransactionId, URI redirectUrl) {
}
