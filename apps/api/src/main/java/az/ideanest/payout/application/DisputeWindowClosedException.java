package az.ideanest.payout.application;

import java.util.UUID;

/** IDN-EXT-01 (#43): answered DISPUTE_WINDOW_CLOSED. */
public class DisputeWindowClosedException extends RuntimeException {

    private final UUID subject;

    public DisputeWindowClosedException(UUID subject) {
        super("the dispute window is closed for " + subject);
        this.subject = subject;
    }

    public UUID subject() {
        return subject;
    }
}
