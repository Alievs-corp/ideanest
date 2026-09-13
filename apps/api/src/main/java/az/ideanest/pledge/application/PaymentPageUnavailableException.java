package az.ideanest.pledge.application;

/**
 * No payment page can be opened now — IDN-EXT-01 (#39).
 *
 * <p>No provider is configured, the configured one does not take payments on a hosted page, or it
 * could not be reached. Nothing was charged, and the draft keeps its places until its hold ends.
 */
public class PaymentPageUnavailableException extends RuntimeException {

    public PaymentPageUnavailableException(String message) {
        super(message);
    }

    public PaymentPageUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
