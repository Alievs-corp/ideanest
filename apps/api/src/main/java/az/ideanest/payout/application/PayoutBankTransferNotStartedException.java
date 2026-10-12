package az.ideanest.payout.application;

import az.ideanest.payout.domain.PayoutState;
import java.util.UUID;

/**
 * A bank transfer was recorded, abandoned or opened again for a payout with none in progress — #397.
 *
 * <p>409. A transfer is recorded against the account somebody opened here to pay into; one recorded
 * without that would be money sent to an account nobody can say was the creator's.
 */
public class PayoutBankTransferNotStartedException extends RuntimeException {

    private final PayoutState state;

    public PayoutBankTransferNotStartedException(UUID payoutId, PayoutState state) {
        super("Payout " + payoutId + " is " + state + " with no bank transfer in progress");
        this.state = state;
    }

    public PayoutState state() {
        return state;
    }
}
