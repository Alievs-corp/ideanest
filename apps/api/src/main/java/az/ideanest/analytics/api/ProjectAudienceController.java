package az.ideanest.analytics.api;

import az.ideanest.analytics.application.ProjectAudienceService;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /v1/projects/{id}/audience}: a campaign's audience for the people running it
 * — #633, the dashboard's Charts tab.
 *
 * <p>{@code VIEW_FINANCES}, checked one layer in. {@code Cache-Control: private,
 * no-store}, for the reason {@code ReferralController} gives about the referral report:
 * the body is one campaign's marketing performance and belongs to the account that asked.
 */
@RestController
public class ProjectAudienceController {

    private final ProjectAudienceService audience;

    public ProjectAudienceController(ProjectAudienceService audience) {
        this.audience = audience;
    }

    /** @param period {@code day}, {@code week}, {@code month} or {@code year}; {@code day} when absent */
    @GetMapping("/v1/projects/{projectId}/audience")
    public ResponseEntity<ProjectAudienceResponse> audience(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Parameter(schema = @Schema(allowableValues = {"day", "week", "month", "year"}, defaultValue = "day"))
                    @RequestParam(defaultValue = "day") String period) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore().cachePrivate())
                .body(ProjectAudienceResponse.of(
                        audience.of(projectId, UUID.fromString(accessToken.getSubject()), period)));
    }
}
