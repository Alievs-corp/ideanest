package az.ideanest.platform.api;

import az.ideanest.platform.application.MaintenanceWindows;
import az.ideanest.platform.domain.MaintenanceWindow;
import az.ideanest.shared.Patched;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Maintenance windows over HTTP, for the console — issue #214.
 *
 * <p>Needs {@code CONFIGURE_PLATFORM}, checked in the service, and every change is in the
 * audit log with the window before and after. A member of staff reaches this during a
 * window because the maintenance filter lets a staff token through; that is how a window
 * is ended early at all.
 *
 * <p><strong>Start now and end now are verbs, not a {@code PATCH} of the start.</strong>
 * "Now" has to be the server's now: a console whose clock is a minute out would otherwise
 * close the platform a minute early or late, and the audit row would record a time
 * nobody chose.
 */
@RestController
@RequestMapping("/v1/admin/maintenance")
public class MaintenanceController {

    private final MaintenanceWindows windows;
    private final Clock clock;

    public MaintenanceController(MaintenanceWindows windows, Clock clock) {
        this.windows = windows;
        this.clock = clock;
    }

    /** The window in force, every window still to come, and the last twenty. */
    @GetMapping
    public ResponseEntity<PlatformResponses.MaintenanceOverview> overview(@AuthenticationPrincipal Jwt accessToken) {
        MaintenanceWindows.Overview overview = windows.overview(callerOf(accessToken));
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlatformResponses.MaintenanceOverview.of(overview, clock.instant()));
    }

    /** Schedules a window. */
    @PostMapping
    public ResponseEntity<PlatformResponses.MaintenanceWindowView> schedule(
            @AuthenticationPrincipal Jwt accessToken, @Valid @RequestBody ScheduleMaintenanceRequest request) {

        MaintenanceWindow window = windows.schedule(
                callerOf(accessToken), request.startsAt(), request.endsAt(), request.announceFrom(), request.note());
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(PlatformResponses.MaintenanceWindowView.of(window, clock.instant()));
    }

    /** Closes the platform now with a window scheduled for later. */
    @PostMapping("/{id}/start-now")
    public ResponseEntity<PlatformResponses.MaintenanceWindowView> startNow(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return view(windows.startNow(callerOf(accessToken), id));
    }

    /** Reopens the platform now. */
    @PostMapping("/{id}/end-now")
    public ResponseEntity<PlatformResponses.MaintenanceWindowView> endNow(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return view(windows.endNow(callerOf(accessToken), id));
    }

    /** Moves the end — extends it, shortens it, or makes it open — or edits the note. */
    @PatchMapping("/{id}")
    public ResponseEntity<PlatformResponses.MaintenanceWindowView> change(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestBody ChangeMaintenanceRequest request) {
        return view(windows.change(
                callerOf(accessToken), id, Patched.orAbsent(request.endsAt()), Patched.orAbsent(request.note())));
    }

    /** Calls off a window that has not started. The row stays, marked cancelled. */
    @DeleteMapping("/{id}")
    public ResponseEntity<PlatformResponses.MaintenanceWindowView> cancel(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return view(windows.cancel(callerOf(accessToken), id));
    }

    /**
     * A window to schedule.
     *
     * @param startsAt when the platform closes. Up to a minute in the past is read as now
     * @param endsAt null or absent for "until further notice"
     * @param announceFrom when readers start being told; absent for a day before the start
     * @param note internal only — why, and who to ask. Never shown to readers
     */
    public record ScheduleMaintenanceRequest(
            @NotNull Instant startsAt, Instant endsAt, Instant announceFrom, @Size(max = 2000) String note) {
    }

    /**
     * A change to a window that is not over. An absent field is left as it is.
     *
     * @param endsAt a new end, or null for "until further notice"
     * @param note a new note, or null to clear it. At most 2000 characters
     */
    public record ChangeMaintenanceRequest(Patched<Instant> endsAt, Patched<String> note) {
    }

    private ResponseEntity<PlatformResponses.MaintenanceWindowView> view(MaintenanceWindow window) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlatformResponses.MaintenanceWindowView.of(window, clock.instant()));
    }

    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
