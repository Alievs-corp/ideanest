package az.ideanest.shared.maintenance;

import java.util.Optional;
import java.util.UUID;

/**
 * Whether the platform is closed for maintenance, for callers outside the platform
 * module — issue #214.
 *
 * <p>Answered from a snapshot held for a few seconds, so asking costs no database read
 * on the hot path. See {@code platform.application.MaintenanceWindows}.
 */
public interface MaintenanceGate {

    /** The window in force right now, if there is one. */
    Optional<ActiveMaintenance> active();

    /**
     * Refuses a new session, or a refreshed one, to anybody who is not staff while a
     * window is in force.
     *
     * <p>Called after the credentials have been checked and before anything is issued,
     * so a reader who signs in during maintenance leaves with the maintenance problem and
     * no session, no refresh token, and no two-factor challenge.
     *
     * @throws MaintenanceInProgressException when a window is active and the account is
     *     not platform staff
     */
    void admitSession(UUID accountId);
}
