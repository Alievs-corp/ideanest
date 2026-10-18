package az.ideanest.platform.application;

/**
 * A flag cannot be saved as asked — AD-12.
 *
 * <p>One exception with a machine-readable code, for the reason
 * {@link MaintenanceWindowConflictException} gives: the console words every one of them
 * from its catalogue by the code, and the sentence here is for whoever reads the log.
 */
public class FeatureFlagRefusedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** Why, as the console branches on it. */
    public enum Reason {
        /** The name is not one V50's {@code CHECK} accepts. 400. */
        FEATURE_FLAG_KEY_INVALID,
        /** A create named a flag that already exists. 409. */
        FEATURE_FLAG_EXISTS,
        /** An edit was made from a version somebody else has since replaced. 409. */
        FEATURE_FLAG_CHANGED,
        /** An edit named a flag that does not exist. 404. */
        FEATURE_FLAG_NOT_FOUND
    }

    private final Reason reason;

    public FeatureFlagRefusedException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
