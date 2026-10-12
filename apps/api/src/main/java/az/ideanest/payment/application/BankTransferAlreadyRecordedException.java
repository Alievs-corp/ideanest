package az.ideanest.payment.application;

import java.util.UUID;

/**
 * A payout's bank transfer is already recorded, under a different reference — #397.
 *
 * <p>409. The payout was paid once; a second reference for it is a typo or a second transfer, and
 * either way it is a person's job to read the statement again. Replaying the same reference is not
 * this: that returns the row already written.
 */
public class BankTransferAlreadyRecordedException extends RuntimeException {

    private final UUID payoutId;

    public BankTransferAlreadyRecordedException(UUID payoutId) {
        super("Payout " + payoutId + "'s bank transfer is already recorded under another reference");
        this.payoutId = payoutId;
    }

    public UUID payoutId() {
        return payoutId;
    }
}
