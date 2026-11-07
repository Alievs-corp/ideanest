package az.ideanest.analytics.application;

import az.ideanest.analytics.AnalyticsProperties;
import az.ideanest.analytics.domain.AudienceWindow;
import az.ideanest.shared.access.ProjectAuthorisation;
import az.ideanest.shared.access.ProjectCapability;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * A campaign's audience, for the people running it — #633, the dashboard's Charts tab.
 *
 * <p>{@link ProjectCapability#VIEW_FINANCES}, the capability the rest of that tab already
 * asks for, through {@link ProjectAuthorisation}: a stranger gets a 404, a collaborator
 * whose grant lacks it a 403. How many people looked at a campaign and from where is
 * competitive information in the same way its pledge trend is.
 *
 * <p>Not audited, as {@code ProjectAnalyticsService} is not: a creator reading their own
 * campaign's figures is not the privileged read the audit trail exists for.
 */
@Service
public class ProjectAudienceService {

    private final ProjectAuthorisation projects;
    private final AudienceReports reports;
    private final Clock clock;
    private final ZoneId zone;

    public ProjectAudienceService(
            ProjectAuthorisation projects, AudienceReports reports, AnalyticsProperties properties, Clock clock) {
        this.projects = projects;
        this.reports = reports;
        this.clock = clock;
        this.zone = ZoneId.of(properties.reporting().timeZone());
    }

    /**
     * @throws az.ideanest.project.application.ProjectNotFoundException for a campaign that
     *     does not exist or that the caller has no relationship to
     * @throws az.ideanest.project.application.CapabilityNotGrantedException for a
     *     collaborator without {@code VIEW_FINANCES}
     * @throws InvalidAudiencePeriodException for a period other than the four
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ProjectAudience of(UUID projectId, UUID accountId, String period) {
        projects.requireCapability(projectId, accountId, ProjectCapability.VIEW_FINANCES);
        Instant now = clock.instant();
        return reports.project(
                projectId, AudienceWindow.of(PlatformAudienceService.periodOf(period), now, zone), now);
    }
}
