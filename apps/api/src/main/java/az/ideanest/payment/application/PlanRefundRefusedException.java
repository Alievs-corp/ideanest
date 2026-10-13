package az.ideanest.payment.application;

import java.util.UUID;

/** An unapplied plan payment cannot be returned the way staff asked — #457. */
public class PlanRefundRefusedException extends RuntimeException {

    public enum Reason {
        NOT_FOUND(404, "No such plan payment"),
        NOT_UNAPPLIED(409, "This plan payment is not waiting to be returned"),
        CARD_WINDOW_CLOSED(409, "The provider's refund window has closed; return it by bank transfer"),
        PROVIDER_REFUSED(409, "The provider refused the refund"),
        PROVIDER_UNAVAILABLE(503, "The provider could not be reached");

        private final int status;
        private final String title;

        Reason(int status, String title) {
            this.status = status;
            this.title = title;
        }

        public int status() {
            return status;
        }

        public String title() {
            return title;
        }
    }

    private final Reason reason;

    public PlanRefundRefusedException(Reason reason, UUID chargeId, String detail) {
        super(reason.title() + " (" + chargeId + ")" + (detail == null ? "" : ": " + detail));
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
