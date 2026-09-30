package az.ideanest.dashboard.api;

import az.ideanest.dashboard.application.DashboardService;
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
 * The console's front page over HTTP — #222.
 *
 * <p><strong>Two parameters, a first day and a last, and nothing that widens the answer.</strong>
 * Which sections a caller receives is decided in {@link DashboardService} from their roles. There
 * is no {@code sections}, {@code view} or {@code accountId} to set in the developer tools,
 * because a parameter that could widen the answer is one somebody will eventually find.
 *
 * <p>Open to any member of staff, since the front page is for all of them, and for each of them
 * it holds exactly the sections their capabilities open. A member of staff who holds none, a
 * partner, gets an empty page rather than an error.
 *
 * <p><strong>{@code no-store}</strong>, like everything under this prefix: the body is the
 * platform's figures.
 */
@RestController
@RequestMapping("/v1/admin/dashboard")
public class ConsoleDashboardController {

    private final DashboardService dashboard;

    public ConsoleDashboardController(DashboardService dashboard) {
        this.dashboard = dashboard;
    }

    /**
     * The front page for the caller.
     *
     * @param from the first day, inclusive. Absent means thirty days back from {@code to}
     * @param to the last day, inclusive. Absent means today in Baku
     */
    @GetMapping
    public ResponseEntity<ConsoleDashboardResponse> read(
            @AuthenticationPrincipal Jwt accessToken,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ConsoleDashboardResponse.of(dashboard.read(UUID.fromString(accessToken.getSubject()), from, to)));
    }
}
