package az.ideanest.payment.application;

import az.ideanest.payment.domain.RefundReason;

/**
 * A member of staff asked to send a refund under a reason nobody sends — #175.
 *
 * <p>{@link RefundReason#CHARGEBACK} records money the card network already took back; a refund
 * issued under it would be sent to the provider and counted as a chargeback, which is the
 * double payment #175 closes spelled differently. 400: the request is wrong whatever the pledge.
 */
public class RefundReasonNotIssuableException extends RuntimeException {

    public RefundReasonNotIssuableException(RefundReason reason) {
        super(reason + " is recorded by the platform when a chargeback is lost and cannot be issued");
    }
}
