package az.ideanest.shared.maintenance;

import java.util.Objects;

/**
 * The platform is closed and this caller is not one it lets in — issue #214.
 *
 * <p>Rendered as {@link MaintenanceProblem} by the application-wide advice, so a refusal
 * raised deep inside the auth module reaches the client as the same body the servlet
 * filter would have sent.
 */
public class MaintenanceInProgressException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient ActiveMaintenance window;

    private final long retryAfterSeconds;

    public MaintenanceInProgressException(ActiveMaintenance window, long retryAfterSeconds) {
        super("The platform is closed for maintenance.");
        this.window = Objects.requireNonNull(window, "window");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public ActiveMaintenance window() {
        return window;
    }

    /** Computed when the refusal was raised, with the clock that decided it. */
    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
