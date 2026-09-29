package az.ideanest.pledge.application;

import az.ideanest.shared.money.Money;
import java.util.UUID;

/**
 * #171: a raise that may be paid for now, and what the payment module needs to take the payment.
 *
 * @param payment the pledge and the difference, as {@link PaymentPage} takes a payment
 * @param chargeKey the idempotency key the charge is recorded and sent under — derived from the
 *     raise, so the settled charge finds it again
 * @param newTotal what the pledge will come to once the difference is paid
 */
public record PayableRaise(UUID raiseId, String chargeKey, PayablePledge payment, Money newTotal) {
}
