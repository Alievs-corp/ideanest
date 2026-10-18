package az.ideanest.analytics.api;

import az.ideanest.analytics.application.PlatformAnalyticsService;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.11's AD-13 over HTTP — issue #313.
 *
 * <h2>Not {@code /v1/projects/{id}/analytics}</h2>
 *
 * <p>That is #95's, it answers a creator asking about their own campaign, and every query
 * behind it is filtered by campaign. This answers the platform's own question with the same
 * nouns. Two routes because they are two different authorities over two different figures —
 * a creator may see their own volume and may not see everybody's.
 *
 * <p>Needs {@code VIEW_FINANCE}, checked in the service, and every read is recorded as
 * {@code analytics.read}.
 *
 * <p><strong>{@code no-store}</strong>: these are the platform's revenue figures.
 */
@RestController
@RequestMapping("/v1/admin/analytics")
public class PlatformAnalyticsController {

    private final PlatformAnalyticsService analytics;

    public PlatformAnalyticsController(PlatformAnalyticsService analytics) {
        this.analytics = analytics;
    }

    /**
     * Volume, success rate and average pledge over a window.
     *
     * @param from the first day, inclusive. Absent means thirty days back from {@code to}
     * @param to the last day, inclusive. Absent means today in the reporting zone
     */
    @GetMapping
    public ResponseEntity<PlatformAnalyticsResponse> dashboard(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PlatformAnalyticsResponse.of(
                        analytics.read(UUID.fromString(accessToken.getSubject()), from, to)));
    }
}
