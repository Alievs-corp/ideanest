package az.ideanest.platform.application;

/**
 * The window cannot be changed that way in the state it is in, or the change would make
 * two windows overlap — #214.
 *
 * <p>One exception with a machine-readable code rather than one class per reason: the
 * console renders every one of them as the same kind of refusal and branches on the code.
 */
public class MaintenanceWindowConflictException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** Why, as the console branches on it. */
    public enum Reason {
        /** Another window is active or announced for part of the same span. */
        MAINTENANCE_WINDOW_OVERLAPS,
        /** Start now and cancel need a window that has not started. */
        MAINTENANCE_WINDOW_ALREADY_STARTED,
        /** End now needs a window that is in force. */
        MAINTENANCE_WINDOW_NOT_ACTIVE,
        /** An ended or cancelled window is history and is not edited. */
        MAINTENANCE_WINDOW_OVER
    }

    private final Reason reason;

    public MaintenanceWindowConflictException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() {
        return reason;
    }
}
