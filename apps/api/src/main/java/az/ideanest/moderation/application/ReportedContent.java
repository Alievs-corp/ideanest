package az.ideanest.moderation.application;

import az.ideanest.community.application.ModeratedContent;
import az.ideanest.community.application.ModeratedContent.ModeratedComment;
import az.ideanest.community.application.ModeratedContent.ModeratedUpdate;
import az.ideanest.moderation.domain.ContentReport;
import az.ideanest.moderation.domain.ReportTargetType;
import az.ideanest.moderation.infrastructure.ContentReportRepository;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.project.ProjectSummaries;
import az.ideanest.shared.project.ProjectSummary;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The evidence behind one report — #399.
 *
 * <h2>A third read, not a wider one</h2>
 *
 * <p>{@code ReportModerationService.report} serves the complaint and its decision history,
 * and this serves what the complaint is about. Two services rather than one field added to
 * {@link QueuedReport}, because that record is also every row of the queue: assembling the
 * comment, its author and its campaign for twenty-five rows is twenty-five lookups nobody
 * reads, on the one screen in the console that has to stay fast enough to work from.
 *
 * <p>The detail page already reads the report and its audit trail independently, so that a
 * trail which fails to load costs a line of text rather than the screen. This is the third
 * read in that arrangement and it degrades the same way — a moderator who cannot load the
 * evidence should be told the evidence is missing, and should still see the report.
 *
 * <h2>The refusal is here, and it is the queue's own</h2>
 *
 * <p>{@code requireStaff}, matching {@code ReportModerationService.report} exactly. This
 * endpoint says nothing about a report that a moderator holding the report cannot already
 * see, so a stricter check would refuse somebody the evidence for a decision they are
 * entitled to take. Checked before the report is loaded, so a caller who is not staff
 * learns nothing about which report identifiers are real.
 *
 * <h2>Every kind of target is answered, including the two with nothing to inline</h2>
 *
 * <p>A campaign and an account are reached directly by the console — the staff preview at
 * {@code /admin/campaigns/{id}} renders a campaign in any state, and a profile has a public
 * page — so this returns {@link ReportedItem.State#ADDRESSED_DIRECTLY} for them rather than
 * a 404 or an empty body. One shape for four kinds is what lets the screen render the
 * answer without knowing which kind it asked about.
 */
@Service
public class ReportedContent {

    private final ContentReportRepository reports;
    private final ModeratedContent content;
    private final ProjectSummaries projects;
    private final PlatformStaff staff;

    public ReportedContent(
            ContentReportRepository reports,
            ModeratedContent content,
            ProjectSummaries projects,
            PlatformStaff staff) {

        this.reports = reports;
        this.content = content;
        this.projects = projects;
        this.staff = staff;
    }

    /**
     * What this report is about.
     *
     * @param moderatorId whoever is signed in, from the access token's subject
     * @throws ReportNotFoundException when there is no such report. Never for content that
     *     has gone: that is {@link ReportedItem.State#GONE}, and the difference matters —
     *     "there is no such report" and "the comment it was about has been purged" send a
     *     moderator to two different places
     */
    @Transactional(readOnly = true)
    public ReportedItem of(UUID reportId, UUID moderatorId) {
        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);

        ContentReport report = reports.findById(reportId).orElseThrow(() -> new ReportNotFoundException(reportId));

        return switch (report.getTargetType()) {
            case COMMENT -> comment(report.getTargetId());
            case PROJECT_UPDATE -> update(report.getTargetId());
            // The campaign the report names, so the console can link to its staff preview.
            case PROJECT -> ReportedItem.addressedDirectly(
                    report.getTargetType(), projects.summaryOf(report.getTargetId()).orElse(null));
            // An account belongs to no campaign, and the console names it through the
            // directory #402 built rather than through a field on this response.
            case USER -> ReportedItem.addressedDirectly(report.getTargetType(), null);
        };
    }

    private ReportedItem comment(UUID commentId) {
        ModeratedComment found = content.comment(commentId).orElse(null);
        if (found == null) {
            return ReportedItem.gone(ReportTargetType.COMMENT);
        }
        return ReportedItem.comment(
                found.removed() ? ReportedItem.State.REMOVED : ReportedItem.State.PRESENT,
                found.body(),
                found.authorId(),
                campaign(found.projectId()),
                found.createdAt());
    }

    private ReportedItem update(UUID updateId) {
        ModeratedUpdate found = content.update(updateId).orElse(null);
        if (found == null) {
            return ReportedItem.gone(ReportTargetType.PROJECT_UPDATE);
        }
        return ReportedItem.update(
                found.title(),
                found.body(),
                found.authorId(),
                found.number(),
                campaign(found.projectId()),
                found.publishedAt());
    }

    /**
     * The campaign the content is on, or null.
     *
     * <p>Null rather than a failure, which is {@link ProjectSummaries}' own contract and the
     * right one here: a comment whose campaign has been hard deleted is still a comment
     * somebody complained about, and losing the evidence over a missing link would be the
     * console failing at exactly the moment it is most needed.
     */
    private ProjectSummary campaign(UUID projectId) {
        return projects.summaryOf(projectId).orElse(null);
    }
}
