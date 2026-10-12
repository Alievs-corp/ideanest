package az.ideanest.payout.application;

import java.util.UUID;

/**
 * IDN-EXT-01 (#43): answered DISPUTE_REFUND_FAILED.
 *
 * <p>Since #399 a refund that did not go through may instead be waiting to be paid by bank transfer,
 * past the provider's refund window: nothing failed, and the dispute is upheld once the transfer is
 * recorded. {@link #awaitingBankTransfer} says which, so the console does not call it a refusal.
 */
public class DisputeRefundFailedException extends RuntimeException {

    private final UUID subject;
    private final boolean awaitingBankTransfer;

    public DisputeRefundFailedException(UUID subject) {
        this(subject, false);
    }

    public DisputeRefundFailedException(UUID subject, boolean awaitingBankTransfer) {
        super("the refund " + (awaitingBankTransfer ? "waits for a bank transfer" : "failed") + " for dispute " + subject);
        this.subject = subject;
        this.awaitingBankTransfer = awaitingBankTransfer;
    }

    /** Whether the refund waits to be paid by bank transfer rather than having been refused. */
    public boolean awaitingBankTransfer() {
        return awaitingBankTransfer;
    }

    public UUID subject() {
        return subject;
    }
}
