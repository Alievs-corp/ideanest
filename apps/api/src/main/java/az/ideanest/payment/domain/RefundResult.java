package az.ideanest.payment.domain;

import java.util.Objects;

/**
 * What the provider said about a {@link RefundRequest}.
 *
 * <p>The same shape as {@link ChargeResult} and the same rule about failure codes,
 * because it is the same fact from the other direction. {@link ProviderOutcome#PENDING}
 * is the ordinary answer here rather than the unusual one: most providers accept a
 * refund immediately and settle it over the following days, and #67 will have to
 * treat the webhook as the moment it happened.
 *
 * <p><strong>One refusal is not a refusal of the refund (#399).</strong> A provider reverses a
 * card payment only within its refund window, and past it the money is still owed: it goes back
 * by bank transfer. An adapter that recognises the provider saying so answers
 * {@link #windowClosed}, a decline under {@link #WINDOW_CLOSED}, and {@code RefundService} routes
 * the refund to a bank transfer instead of recording it failed.
 */
public record RefundResult(
        ProviderOutcome outcome,
        String providerTransactionId,
        String failureCode,
        String failureMessage,
        String rawResponse) {

    /** The failure code of a refund the provider refused because the payment is past its refund window. */
    public static final String WINDOW_CLOSED = "refund_window_closed";

    public RefundResult {
        Objects.requireNonNull(outcome, "A refund result says what the provider decided");
        if ((outcome == ProviderOutcome.DECLINED) == (failureCode == null || failureCode.isBlank())) {
            throw new IllegalArgumentException("A refused refund says why, and one that was not refused does not");
        }
    }

    /**
     * The provider refused because the payment is too old to reverse (#399).
     *
     * @param providerCode the provider's own code for it, kept in the message for whoever reads the row
     */
    public static RefundResult windowClosed(String providerCode, String providerMessage, String rawResponse) {
        return new RefundResult(
                ProviderOutcome.DECLINED,
                null,
                WINDOW_CLOSED,
                "The provider no longer refunds this payment (" + providerCode + "): " + providerMessage,
                rawResponse);
    }

    /** Whether the provider refused only because the payment is past its refund window. */
    public boolean isWindowClosed() {
        return outcome == ProviderOutcome.DECLINED && WINDOW_CLOSED.equals(failureCode);
    }
}
