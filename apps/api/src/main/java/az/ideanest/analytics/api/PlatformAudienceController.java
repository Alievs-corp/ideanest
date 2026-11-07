package az.ideanest.analytics.api;

import az.ideanest.analytics.application.PlatformAudienceService;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The console's audience screen over HTTP — #633.
 *
 * <p>Needs {@code VIEW_AUDIENCE}, checked in the service, and every read is recorded as
 * {@code analytics.read}. {@code no-store}, as every console read is.
 */
@RestController
@RequestMapping("/v1/admin/audience")
public class PlatformAudienceController {

    private final PlatformAudienceService audience;

    public PlatformAudienceController(PlatformAudienceService audience) {
        this.audience = audience;
    }

    /** Visitors, page views, campaign views and clicks across the platform. */
    @GetMapping
    public ResponseEntity<PlatformAudienceResponse> platform(
            @AuthenticationPrincipal Jwt accessToken,
            @Parameter(schema = @Schema(allowableValues = {"day", "week", "month", "year"}, defaultValue = "day"))
                    @RequestParam(defaultValue = "day") String period) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlatformAudienceResponse.of(audience.read(UUID.fromString(accessToken.getSubject()), period)));
    }

    /** One campaign's breakdown, in any state. */
    @GetMapping("/projects/{projectId}")
    public ResponseEntity<ProjectAudienceResponse> project(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Parameter(schema = @Schema(allowableValues = {"day", "week", "month", "year"}, defaultValue = "day"))
                    @RequestParam(defaultValue = "day") String period) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ProjectAudienceResponse.of(
                        audience.readProject(UUID.fromString(accessToken.getSubject()), projectId, period)));
    }
}
