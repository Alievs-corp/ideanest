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

    public PayoutSendUnconfirmedException(UUID payoutId) {
        super("Payout " + payoutId + " may already have been sent; it is retried, not cancelled");
    }

    private PayoutSendUnconfirmedException(String message) {
        super(message);
    }

    /** A campaign whose earlier payout a previous release recorded failed as unreachable: not priced again. */
    public static PayoutSendUnconfirmedException forCampaign(UUID projectId) {
        return new PayoutSendUnconfirmedException(
                "Campaign " + projectId + " has a payout whose send went unanswered; it is not priced again");
    }
}
