package az.ideanest.payout.application;

import java.util.UUID;

/**
 * A payout being paid by bank transfer was cancelled, or had a signature withdrawn — #397.
 *
 * <p>409, and {@code PayoutSendUnconfirmedException}'s argument on the other route. The money may
 * already be on its way: a cancelled payout is followed by a fresh calculation under a new key, and a
 * second transfer would pay the creator twice. The transfer is recorded or, if it was never made,
 * abandoned first.
 */
public class PayoutBankTransferInProgressException extends RuntimeException {

    public PayoutBankTransferInProgressException(UUID payoutId) {
        super("Payout " + payoutId + " is being paid by bank transfer; record or abandon the transfer first");
    }
}
