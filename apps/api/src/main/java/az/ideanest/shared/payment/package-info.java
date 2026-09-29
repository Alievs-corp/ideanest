/**
 * Where a payment provider may send a person back to — issue #139.
 *
 * <p>Two modules hand a provider a return address: the pledge module's hosted payment page and the
 * payment module's payout card registration, and compliance's controller is the door to the second.
 * Both take the address from the caller and both must refuse the same addresses with the same
 * body, so the rule lives here once rather than as a copy per module that could drift — the
 * argument {@code shared.idempotency} makes for its four refusals. The pledge module cannot name
 * the payment module's application layer without a cycle, which is the other reason it is here.
 */
package az.ideanest.shared.payment;
