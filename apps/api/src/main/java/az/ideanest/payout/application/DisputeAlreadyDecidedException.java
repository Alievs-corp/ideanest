package az.ideanest.payout.application;

import java.util.UUID;

/** IDN-EXT-01 (#43): answered DISPUTE_ALREADY_DECIDED. */
public class DisputeAlreadyDecidedException extends RuntimeException {

    private final UUID subject;

    public DisputeAlreadyDecidedException(UUID subject) {
        super("already decided: " + subject);
        this.subject = subject;
    }

    public UUID subject() {
        return subject;
    }
}
