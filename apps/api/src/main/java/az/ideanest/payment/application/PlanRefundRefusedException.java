package az.ideanest.payment.application;

import java.util.UUID;

/** An unapplied plan payment cannot be returned the way staff asked — #457. */
public class PlanRefundRefusedException extends RuntimeException {

    public enum Reason {
        NOT_FOUND(404, "No such plan payment"),
        NOT_UNAPPLIED(409, "This plan payment is not waiting to be returned"),
        CARD_WINDOW_CLOSED(409, "The provider's refund window has closed; return it by bank transfer"),
        PROVIDER_REFUSED(409, "The provider refused the refund"),
        PROVIDER_UNAVAILABLE(503, "The provider could not be reached"),
        /**
         * A card refund was sent and its answer never arrived, so the money may already be on its way back.
         * The next card refund asks the provider before it sends anything; a bank transfer is refused until then.
         */
        UNCONFIRMED(503, "The provider did not confirm the refund; it may have been made"),
        /** Another card refund of the same payment was sent moments ago and has not finished. */
        IN_PROGRESS(409, "A refund of this payment is already under way"),
        /** A bank transfer was recorded while a card refund of the same payment is unsettled. */
        CARD_REFUND_UNSETTLED(409, "A card refund of this payment is unsettled; settle it before recording a transfer");

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
