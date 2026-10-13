package az.ideanest.subscription.application;

/** Nothing on this subscription can be paid for now — #449. */
public class NoPaymentDueException extends RuntimeException {

    public enum Reason {
        /** A free plan: there is nothing to pay. */
        FREE_PLAN,
        /** The period is running and its end is not yet inside the renewal window. */
        RENEWAL_NOT_OPEN,
        /** The period has run out. A lapsed plan is bought again, not renewed. */
        LAPSED
    }

    private final Reason reason;

    public NoPaymentDueException(Reason reason) {
        super("Nothing is due on this subscription: " + reason);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
