package az.ideanest.platform.application;

/** The times asked for do not make a window — an end before the start, a start in the past — #214. */
public class InvalidMaintenanceWindowException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public InvalidMaintenanceWindowException(String message) {
        super(message);
    }
}
