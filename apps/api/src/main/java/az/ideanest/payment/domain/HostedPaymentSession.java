package az.ideanest.payment.domain;

import java.net.URI;
import java.util.Objects;

/**
 * A payment begun on the provider's page: the provider's transaction and where to send the backer.
 *
 * <p>The outcome is not known here. It arrives by webhook, and {@link PaymentProvider#lookUpPayment}
 * answers it on demand.
 */
public record HostedPaymentSession(String providerTransactionId, URI redirectUrl) {

    public HostedPaymentSession {
        if (providerTransactionId == null || providerTransactionId.isBlank()) {
            throw new IllegalArgumentException("A payment that cannot be looked up again is not one");
        }
        Objects.requireNonNull(redirectUrl, "A payment page is somewhere");
        if (!"https".equalsIgnoreCase(redirectUrl.getScheme())) {
            throw new IllegalArgumentException("A card entry page is reached over https, and this one is " + redirectUrl);
        }
    }
}
