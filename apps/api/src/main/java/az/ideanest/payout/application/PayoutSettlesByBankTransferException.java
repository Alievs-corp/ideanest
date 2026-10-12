package az.ideanest.payout.application;

import java.util.UUID;

/**
 * The payout is paid by bank transfer, not sent through a provider — #397.
 *
 * <p>409. The creator's destination is an IBAN the platform holds, or a member of staff has already
 * started paying this one by hand: either way {@code send} is the wrong door, and asking a provider to
 * pay the same money as well is how a creator is paid twice. The console starts a bank transfer
 * instead.
 */
public class PayoutSettlesByBankTransferException extends RuntimeException {

    public PayoutSettlesByBankTransferException(UUID payoutId) {
        super("Payout " + payoutId + " is paid by bank transfer, not sent through a provider");
    }
}
