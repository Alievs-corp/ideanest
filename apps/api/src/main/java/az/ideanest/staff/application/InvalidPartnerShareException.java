package az.ideanest.staff.application;

/**
 * A partner's percentage was not a share — #204.
 *
 * <p>Not a number, not above zero, above one hundred, or with more than two decimal places.
 * 422 rather than 400: the request is well formed and says something the rule refuses, which
 * is the distinction the platform draws everywhere between a malformed body and a rejected
 * value.
 */
public class InvalidPartnerShareException extends RuntimeException {

    public InvalidPartnerShareException(String reason) {
        super(reason);
    }
}
