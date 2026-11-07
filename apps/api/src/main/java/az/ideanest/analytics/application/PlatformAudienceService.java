package az.ideanest.analytics.application;

import az.ideanest.analytics.AnalyticsProperties;
import az.ideanest.analytics.domain.AudiencePeriod;
import az.ideanest.analytics.domain.AudienceWindow;
import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.project.ProjectSummaries;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The console's audience screen — #633, {@code /admin/audience}.
 *
 * <p><strong>{@code VIEW_AUDIENCE}, its own capability</strong>, rather than
 * {@code VIEW_FINANCE} as {@code PlatformAnalyticsService} uses. These are visitor counts,
 * not revenue: a curator deciding what goes on the front page needs to know which
 * campaigns people open, and should not have to be trusted with the ledger to find out.
 * Held by default by super admins, finance and curators, and adjustable per role like
 * every other capability (V114).
 *
 * <p>Every read is recorded as {@code analytics.read} with what was read, written
 * independently of it, for {@code AuditAction.ANALYTICS_READ}'s reason: "who has been
 * looking at the platform's figures" is answerable only if every screen showing them says
 * so.
 */
@Service
public class PlatformAudienceService {

    private final AudienceReports reports;
    private final ProjectSummaries summaries;
    private final PlatformStaff staff;
    private final AuditLog audit;
    private final Clock clock;
    private final ZoneId zone;

    public PlatformAudienceService(
            AudienceReports reports,
            ProjectSummaries summaries,
            PlatformStaff staff,
            AuditLog audit,
            AnalyticsProperties properties,
            Clock clock) {
        this.reports = reports;
        this.summaries = summaries;
        this.staff = staff;
        this.audit = audit;
        this.clock = clock;
        this.zone = ZoneId.of(properties.reporting().timeZone());
    }

    /**
     * The whole platform.
     *
     * @throws InvalidAudiencePeriodException for a period other than the four
     */
    public PlatformAudience read(UUID staffId, String period) {
        staff.requireCapability(staffId, StaffCapability.VIEW_AUDIENCE);
        AudiencePeriod requested = periodOf(period);

        Instant now = clock.instant();
        PlatformAudience result = reports.platform(AudienceWindow.of(requested, now, zone), now);
        audit.recordIndependently(
                AuditAction.ANALYTICS_READ,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "audience period=%s".formatted(requested.wireValue()));
        return result;
    }

    /**
     * One campaign, in any state: staff look at drafts and suspended campaigns too.
     *
     * @throws ProjectNotFoundException for a campaign that does not exist
     */
    public ProjectAudience readProject(UUID staffId, UUID projectId, String period) {
        staff.requireCapability(staffId, StaffCapability.VIEW_AUDIENCE);
        AudiencePeriod requested = periodOf(period);
        summaries.summaryOf(projectId).orElseThrow(() -> new ProjectNotFoundException(projectId));

        Instant now = clock.instant();
        ProjectAudience result = reports.project(projectId, AudienceWindow.of(requested, now, zone), now);
        audit.recordIndependently(
                AuditAction.ANALYTICS_READ,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "audience project=%s period=%s".formatted(projectId, requested.wireValue()));
        return result;
    }

    static AudiencePeriod periodOf(String period) {
        return AudiencePeriod.fromWire(period).orElseThrow(() -> new InvalidAudiencePeriodException(period));
    }
}
