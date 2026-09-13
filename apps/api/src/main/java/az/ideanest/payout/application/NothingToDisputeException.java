package az.ideanest.payout.application;

import java.util.UUID;

/** IDN-EXT-01 (#43): answered NOTHING_TO_DISPUTE. */
public class NothingToDisputeException extends RuntimeException {

    private final UUID subject;

    public NothingToDisputeException(UUID subject) {
        super("nothing is left to dispute on " + subject);
        this.subject = subject;
    }

    public UUID subject() {
        return subject;
    }
}
