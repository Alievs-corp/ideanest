package az.ideanest.platform.api;

import az.ideanest.platform.application.MaintenanceWindows;
import az.ideanest.platform.domain.MaintenanceWindow;
import az.ideanest.shared.maintenance.MaintenanceProblem;
import com.fasterxml.jackson.annotation.JsonInclude;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import java.time.Instant;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /v1/status}: is the platform open — issue #214.
 *
 * <p><strong>What clients poll instead of a business endpoint.</strong> The mobile app
 * used to poll {@code GET /v1/categories} to find out whether maintenance was over, and
 * that answer can come from an HTTP cache. This one is {@code no-store}, answers without a
 * session, and is exempt from the maintenance filter, so it answers during a window.
 *
 * <p><strong>No database read per request.</strong> It is served from
 * {@code MaintenanceWindows}' snapshot, so a fleet of clients polling every thirty seconds
 * costs one query per instance every ten.
 *
 * <p>Never carries the window's note, which is internal.
 */
@RestController
public class StatusController {

    private final MaintenanceWindows windows;

    public StatusController(MaintenanceWindows windows) {
        this.windows = windows;
    }

    @GetMapping("/v1/status")
    @ApiResponse(
            responseCode = "200",
            description = "Whether the platform is open, and any window in force or announced.",
            content = @Content(
                    mediaType = MediaType.APPLICATION_JSON_VALUE,
                    schema = @Schema(implementation = PlatformStatus.class)))
    @ApiResponse(
            responseCode = "503",
            description = "Only from the edge, when this service is not running at all: the maintenance"
                    + " problem with source \"edge\". This endpoint is exempt from the API's own gate.",
            content = @Content(
                    mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                    schema = @Schema(implementation = MaintenanceProblem.class)))
    public ResponseEntity<PlatformStatus> current() {
        MaintenanceWindows.Status status = windows.status();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new PlatformStatus(
                        status.active().isPresent() ? PlatformStatus.MAINTENANCE : PlatformStatus.OPERATIONAL,
                        status.active().map(StatusWindow::of).orElse(null),
                        status.upcoming().map(StatusWindow::of).orElse(null)));
    }

    /**
     * @param state {@code operational} or {@code maintenance}
     * @param maintenance the window in force, or null
     * @param upcoming the window announced and not yet started, or null
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record PlatformStatus(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {OPERATIONAL, MAINTENANCE})
                    String state,
            @Schema(description = "The window in force, or null.") StatusWindow maintenance,
            @Schema(description = "The window announced and not yet started, or null.") StatusWindow upcoming) {

        static final String OPERATIONAL = "operational";

        static final String MAINTENANCE = "maintenance";
    }

    /** @param endsAt null when no end is announced */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record StatusWindow(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant startsAt,
            @Schema(description = "Null when no end is announced.", types = {"string", "null"}, format = "date-time")
                    Instant endsAt) {

        static StatusWindow of(MaintenanceWindow window) {
            return new StatusWindow(window.startsAt(), window.endsAt());
        }
    }
}
