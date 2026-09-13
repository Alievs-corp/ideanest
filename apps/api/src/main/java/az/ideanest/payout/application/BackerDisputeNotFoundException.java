package az.ideanest.payout.application;

import java.util.UUID;

/** IDN-EXT-01 (#43): answered DISPUTE_NOT_FOUND. */
public class BackerDisputeNotFoundException extends RuntimeException {

    private final UUID subject;

    public BackerDisputeNotFoundException(UUID subject) {
        super("no such pledge or dispute: " + subject);
        this.subject = subject;
    }

    public UUID subject() {
        return subject;
    }
}
