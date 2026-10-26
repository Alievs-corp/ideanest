package az.ideanest.payment.domain;

/**
 * The provider answered, and the payment a callback is about is not decided yet — #587.
 *
 * <p>The delivery must be sent again, so the endpoint answers 500 and the provider retries, as it does
 * for {@link ProviderUnavailableException}. It is <strong>not</strong> that exception, and the difference
 * is the circuit breaker: the provider was reached and said something, which is evidence it is up. Were it
 * counted as an outage, anybody who knew the order of a page still open — the backer, from the page's own
 * address — could post its callback a handful of times and open the breaker, refusing every backer's
 * payment for the cooldown.
 */
public class PaymentUndecidedException extends RuntimeException {

    private final ProviderName provider;

    public PaymentUndecidedException(ProviderName provider, String message) {
        super(message);
        this.provider = provider;
    }

    /** Which provider answered. */
    public ProviderName provider() {
        return provider;
    }
}
