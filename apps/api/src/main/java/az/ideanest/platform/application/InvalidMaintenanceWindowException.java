package az.ideanest.platform.application;

/**
 * The times asked for do not make a window — an end before the start, a start in the past — #214.
 *
 * <p>Two codes, because the console says two different things. A schedule is refused with
 * {@code MAINTENANCE_WINDOW_INVALID}, whose sentence states the rules a new window has to
 * meet. A changed end is refused with {@code MAINTENANCE_WINDOW_END_INVALID}: it has to be
 * after the start and in the future, and the schedule's sentence — "the start cannot be in
 * the past" — answered somebody who had not touched the start.
 */
public class InvalidMaintenanceWindowException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** A new window's times do not make a window. */
    public static final String INVALID = "MAINTENANCE_WINDOW_INVALID";

    /** A changed end is not after both the start and now. */
    public static final String END_INVALID = "MAINTENANCE_WINDOW_END_INVALID";

    private final String code;

    public InvalidMaintenanceWindowException(String message) {
        this(INVALID, message);
    }

    public InvalidMaintenanceWindowException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
