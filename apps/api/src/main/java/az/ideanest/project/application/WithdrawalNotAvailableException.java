package az.ideanest.project.application;

import java.util.UUID;

/**
 * A campaign's funds cannot be withdrawn now — IDN-EXT-01 (#41), §5.1.
 *
 * <p>The reason is on the refusal because each sends a creator somewhere different: a campaign below
 * 80% can still be extended, and one that is already closed has nothing left to decide.
 */
public class WithdrawalNotAvailableException extends RuntimeException {

    public enum Reason {
        /** Not live, in its window, extended or successful — already withdrawn, failed, halted or in draft. */
        WRONG_STATE,
        /** Below the success threshold. */
        BELOW_THRESHOLD
    }

    private final UUID projectId;
    private final Reason reason;

    public WithdrawalNotAvailableException(UUID projectId, Reason reason) {
        super("Campaign " + projectId + " cannot be withdrawn now: " + reason);
        this.projectId = projectId;
        this.reason = reason;
    }

    public UUID projectId() {
        return projectId;
    }

    public Reason reason() {
        return reason;
    }
}
