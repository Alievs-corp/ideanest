package az.ideanest.payout.application;

import java.util.UUID;

/**
 * The payout's last send ended with the provider unreachable - #184's review.
 *
 * <p>409. Whether that instruction was carried out is unknown, so the payout cannot be cancelled: a
 * cancelled payout is followed by a fresh calculation under a new key, and if the first instruction
 * went through the creator would be paid twice. It is sent again under the same key instead.
 */
public class PayoutSendUnconfirmedException extends RuntimeException {

    private final transient UUID payoutId;

    public PayoutSendUnconfirmedException(UUID payoutId) {
        super("Payout " + payoutId + " may already have been sent; it is retried, not cancelled");
        this.payoutId = payoutId;
    }

    public UUID payoutId() {
        return payoutId;
    }
}
