package az.ideanest.shared.payment;

/**
 * A return address the platform will not hand a payment provider — issue #139. Answered as 400
 * {@code INVALID_RETURN_URL} by {@code ApiExceptionHandler}, whichever endpoint raised it.
 *
 * <p>Carries the field and never the address: the address is what the caller sent, and a refusal
 * that repeated it would put an attacker's link into every log that records the response.
 */
public class InvalidReturnUrlException extends RuntimeException {

    private final String field;

    public InvalidReturnUrlException(String field) {
        super(field + " is not an address on this platform's site");
        this.field = field;
    }

    /** The JSON field, as the client sent it: {@code successUrl} or {@code errorUrl}. */
    public String field() {
        return field;
    }
}
