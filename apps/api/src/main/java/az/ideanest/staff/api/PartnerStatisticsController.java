package az.ideanest.staff.api;

import az.ideanest.staff.application.PartnerStatistics;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The financial statistics, scaled to whoever is asking — #205, part of #202.
 *
 * <p><strong>No parameters at all, and that is the security property.</strong> Which figures a
 * caller receives is decided in {@link PartnerStatistics} from their roles and their row in
 * {@code partner_profiles}. There is no {@code view}, {@code percentage}, {@code accountId},
 * {@code from} or {@code to} for a partner to change in the browser's developer tools or in a
 * hand-written request, because a parameter that could widen the answer is one somebody will
 * eventually find. The windows are fixed: today, this month, the last twelve months.
 *
 * <p>Needs {@code VIEW_PARTNER_STATISTICS}, which only super admins and partners hold, checked
 * in the service. <strong>{@code no-store}</strong>, like everything under this prefix: the body
 * is a share of the platform's revenue.
 */
@RestController
@RequestMapping("/v1/admin/partner-statistics")
public class PartnerStatisticsController {

    private final PartnerStatistics statistics;

    public PartnerStatisticsController(PartnerStatistics statistics) {
        this.statistics = statistics;
    }

    /** Today, this month, the days of this month, the last twelve months and this month's plans. */
    @GetMapping
    public ResponseEntity<PartnerStatisticsResponses.Statistics> read(@AuthenticationPrincipal Jwt accessToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(PartnerStatisticsResponses.Statistics.of(
                        statistics.read(UUID.fromString(accessToken.getSubject()))));
    }
}
