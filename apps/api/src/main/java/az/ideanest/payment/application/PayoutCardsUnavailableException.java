package az.ideanest.payment.application;

/**
 * No provider can register a payout card now — IDN-EXT-01 (#44).
 *
 * <p>No provider configured, one that does not register payout cards, or one that could not be
 * reached. The creator's answer is the same for all three: try again later, nothing was recorded.
 */
public class PayoutCardsUnavailableException extends RuntimeException {

    public PayoutCardsUnavailableException(String message) {
        super(message);
    }

    public PayoutCardsUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
