package az.ideanest.project.application;

/**
 * The request is well formed and the revision's state refuses it: nothing to submit, or a
 * decision on one that is not waiting. Answered as 409 {@code REVISION_NOT_AVAILABLE}, with the
 * reason in {@code meta}, for the reason a refused transition is a 409 and not a 400.
 */
public class RevisionNotAvailableException extends RuntimeException {

    /** Why, as a code a client can switch on. */
    public enum Reason {
        /** The campaign has no revision open. */
        NO_OPEN_REVISION,
        /** The open revision is already with the moderators. */
        ALREADY_SUBMITTED,
        /** The revision is no different from the campaign. */
        NO_CHANGES,
        /** The revision is not waiting for a decision (it was decided, withdrawn, or edited since). */
        NOT_PENDING
    }

    private final Reason reason;

    public RevisionNotAvailableException(Reason reason) {
        super("The revision cannot be used: " + reason);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
