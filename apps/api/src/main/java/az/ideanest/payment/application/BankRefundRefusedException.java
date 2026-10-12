package az.ideanest.payment.application;

import java.util.Objects;
import java.util.UUID;

/**
 * Why a step of a refund paid by bank transfer was refused — issue #399.
 *
 * <p>One exception with a closed set of reasons rather than eight classes, because the eight differ
 * only in what the console is told: each reason carries its HTTP status and its code, and
 * {@code PaymentAdminExceptionHandler} turns any of them into the same RFC 9457 shape.
 */
public class BankRefundRefusedException extends RuntimeException {

    /** What was refused, with the status and the code the console branches on. */
    public enum Reason {
        /** No refund has that identifier. */
        REFUND_NOT_FOUND(404, "No such refund"),
        /** The pledge has no part of its refund waiting for a bank account. */
        NO_REFUND_AWAITING_BANK_DETAILS(409, "Nothing on this pledge waits for bank details"),
        /** The refund is not waiting for a transfer: no account on file yet, or already paid. */
        REFUND_NOT_AWAITING_TRANSFER(409, "This refund is not waiting for a transfer"),
        /** Only a refund the provider refused is routed to a bank transfer by hand. */
        REFUND_NOT_FAILED(409, "Only a refused refund is sent by bank transfer"),
        /** The card network is contesting the charge: paying now could pay the backer twice. */
        REFUND_CHARGE_DISPUTED(409, "The charge is in an open chargeback"),
        /** The bank reference was recorded for another backer's refund. */
        BANK_REFERENCE_TAKEN(409, "That bank reference is recorded for another refund"),
        /** The person who recorded the account may not record the transfer. */
        REFUND_DUTIES_NOT_SEPARATE(403, "Somebody else records this transfer"),
        /** The ticket is not one the pledge's backer raised. */
        SUPPORT_TICKET_NOT_FROM_BACKER(400, "That ticket is not from this pledge's backer"),
        /** A transfer is recorded once it has been made, not before. */
        TRANSFER_DATE_IN_FUTURE(400, "The transfer date is in the future");

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
    private final UUID subject;

    public BankRefundRefusedException(Reason reason, UUID subject) {
        super(Objects.requireNonNull(reason, "reason") + ": " + subject);
        this.reason = reason;
        this.subject = subject;
    }

    public Reason reason() {
        return reason;
    }

    /** The refund, pledge or ticket the refusal is about. */
    public UUID subject() {
        return subject;
    }
}
