package az.ideanest.payout.application;

import java.util.UUID;

/** IDN-EXT-01 (#43): answered DISPUTE_REFUND_FAILED. */
public class DisputeRefundFailedException extends RuntimeException {

    private final UUID subject;

    public DisputeRefundFailedException(UUID subject) {
        super("the refund failed for dispute " + subject);
        this.subject = subject;
    }

    public UUID subject() {
        return subject;
    }
}
