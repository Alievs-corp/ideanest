package az.ideanest.platform.application;

import java.util.UUID;

/** No maintenance window has this identifier — #214. */
public class MaintenanceWindowNotFoundException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public MaintenanceWindowNotFoundException(UUID id) {
        super("There is no maintenance window " + id + ".");
    }
}
