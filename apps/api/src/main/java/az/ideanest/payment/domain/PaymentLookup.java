package az.ideanest.payment.domain;

import java.util.Objects;

/**
 * What the provider says a payment is now — IDN-EXT-01 (#38).
 *
 * <p>Four states rather than {@link ProviderOutcome}'s three, because the charge-now model has to
 * tell a payment that went through from one that went through and was since given back: #40
 * reconciles its refunds against exactly that difference, since the provider's reversal keeps no
 * record of its own of having been asked.
 *
 * @param bankCode the bank's response code, or null
 * @param message the provider's message, or null
 * @param rawResponse the answer with the cardholder's name removed
 */
public record PaymentLookup(
        State state, String providerTransactionId, String bankCode, String message, String rawResponse) {

    public enum State {
        /** Registered with the provider, and not yet decided. */
        PENDING,
        /** Paid. */
        SUCCEEDED,
        /** Refused, or failed. */
        FAILED,
        /** Paid, and since given back. */
        RETURNED
    }

    public PaymentLookup {
        Objects.requireNonNull(state, "A lookup says what the payment is");
        if (providerTransactionId == null || providerTransactionId.isBlank()) {
            throw new IllegalArgumentException("A lookup is a lookup of a transaction");
        }
    }
}
