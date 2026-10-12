package az.ideanest.payout.application;

import java.util.UUID;

/**
 * A bank transfer was started for a payout whose destination is a provider's token — #397.
 *
 * <p>409. There is no account number to pay into, only a token the provider can read, so the payout
 * is sent through the provider rather than transferred by hand.
 */
public class PayoutSettlesThroughProviderException extends RuntimeException {

    public PayoutSettlesThroughProviderException(UUID payoutId) {
        super("Payout " + payoutId + "'s destination is a provider token; it is sent, not transferred by hand");
    }
}
