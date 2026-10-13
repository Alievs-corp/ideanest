package az.ideanest.payment.application;

/** No provider can take a plan payment now: none is configured, or it could not be reached — #449. */
public class SubscriptionCheckoutUnavailableException extends RuntimeException {

    public SubscriptionCheckoutUnavailableException(String message) {
        super(message);
    }

    public SubscriptionCheckoutUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
