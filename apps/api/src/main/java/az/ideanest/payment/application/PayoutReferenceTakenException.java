package az.ideanest.payment.application;

/**
 * The provider reference a member of staff read off the statement is already on a settled transaction -
 * #184's review.
 *
 * <p>409 rather than the unique index's 500: one provider transaction is one movement of money, and a
 * payout recorded against a reference another row already carries would count it twice.
 */
public class PayoutReferenceTakenException extends RuntimeException {

    public PayoutReferenceTakenException(String providerTransactionId) {
        super("Provider transaction " + providerTransactionId + " is already recorded");
    }
}
