package az.ideanest.moderation.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.moderation.domain.ContentReport;
import az.ideanest.moderation.domain.ReportState;
import az.ideanest.moderation.domain.ReportTargetType;
import az.ideanest.moderation.domain.TargetReportCount;
import az.ideanest.moderation.infrastructure.ContentReportRepository;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The queue, and the only way a report is decided.
 *
 * <p><strong>Three things happen together or not at all</strong> when a report is
 * resolved: the caller is established as platform staff, the row is moved out of
 * {@code OPEN} by a statement that refuses to move one twice, and an
 * {@code audit_logs} row is written in the same transaction. That last clause is the
 * point of doing this in a service rather than in the controller —
 * {@code AuditLog#record} is {@code MANDATORY} precisely so that "the report was
 * upheld and nobody recorded who upheld it" is not a state this code can reach.
 *
 * <p><strong>Who counts as staff is asked through {@link PlatformStaff}.</strong> There
 * is no role model until epic #100, and what stands in for one is the configured
 * address list that {@code ProjectModerationController} already checks. Keeping a
 * second list here would be two answers to "who is staff", which is the kind of
 * disagreement nobody notices until one of the two is out of date and somebody can
 * decide reports and not campaigns.
 *
 * <p>Asked through the contract in {@code shared.access} rather than by naming the
 * staff module's {@code StaffDirectory} directly, which is what this module did
 * before #236. The dependency on that module's {@code application} layer was legal —
 * it is the boundary {@code ModuleBoundaryTests} allows — but it was on a class, and
 * epic #100 replaces the class. Depending on the question instead means #100 changes
 * one file rather than every module that had to know who is staff.
 *
 * <p><strong>A decision is not an action.</strong> Upholding a report records that
 * the complaint was justified. It does not suspend the campaign, ban the account, or
 * remove anything — those are AD-02's and AD-04's own privileged actions, with their
 * own state machines and their own audit rows, and folding them in here would mean a
 * moderator could not agree with a report without also taking a campaign down.
 */
@Service
public class ReportModerationService {

    private final ContentReportRepository reports;
    private final PlatformStaff staff;
    private final AuditLog audit;

    public ReportModerationService(ContentReportRepository reports, PlatformStaff staff, AuditLog audit) {
        this.reports = reports;
        this.staff = staff;
        this.audit = audit;
    }

    /**
     * One page of reports in one state, oldest first.
     *
     * <p><strong>The target filter is what makes AD-09's profile queue a queue.</strong>
     * §4.11 lists moderation of campaigns, comments, updates and profiles as one module,
     * and one table holds all four; a screen for one of them therefore either narrows here
     * or narrows in the browser. Narrowing in the browser breaks the cursor — twenty-five
     * reports of which two are about profiles is not a page of two, and the client cannot
     * ask for the missing twenty-three — so the filter is a predicate on the query.
     *
     * @param targetType the kind of thing the reports are about, or null for every kind.
     *     {@code null} is the campaign-and-everything queue #101 already serves, so the
     *     existing screen is unchanged by this parameter existing
     * @param after the last identifier of the previous page, or null for the first
     * @param limit already clamped to {@code ModerationProperties.Queue} by the
     *     controller, which is where a request's shape is decided
     * @throws NotAModeratorException for a signed-in caller who is not staff. The
     *     queue names every reporter and quotes what they wrote, so this is not a
     *     screen an ordinary account may read
     */
    @Transactional(readOnly = true)
    public ReportQueuePage queue(
            UUID moderatorId, ReportState state, ReportTargetType targetType, UUID after, int limit) {

        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);

        PageRequest page = PageRequest.ofSize(limit);
        List<ContentReport> rows = pageOf(state, targetType, after, page);
        if (rows.isEmpty()) {
            return new ReportQueuePage(state, targetType, List.of(), null);
        }

        Map<UUID, Long> openPerTarget = openReportsOnTargetsOf(rows);
        List<QueuedReport> queued = rows.stream()
                .map(report -> QueuedReport.of(report, openPerTarget.getOrDefault(report.getTargetId(), 0L)))
                .toList();

        // A full page is the only honest signal that there may be more. Reporting
        // "no more" because the last page happened to be full would hide the tail of
        // the queue, and reporting a cursor on a short page would cost a client one
        // request to discover the same thing.
        UUID nextCursor = rows.size() < limit ? null : rows.get(rows.size() - 1).getId();
        return new ReportQueuePage(state, targetType, queued, nextCursor);
    }

    /**
     * The four queries the two optional arguments select between.
     *
     * <p>Spelled out rather than assembled, because {@code ContentReportRepository} keeps
     * each page shape as its own named query — see the argument there about a null
     * parameter whose type the driver has to guess.
     */
    private List<ContentReport> pageOf(
            ReportState state, ReportTargetType targetType, UUID after, PageRequest page) {

        if (targetType == null) {
            return after == null ? reports.firstPage(state, page) : reports.pageAfter(state, after, page);
        }
        return after == null
                ? reports.firstPageOfType(state, targetType, page)
                : reports.pageAfterOfType(state, targetType, after, page);
    }

    /**
     * Upholds or dismisses a report, and records who did.
     *
     * <p>The state is checked twice, and the second check is the one that holds. The
     * first reads the row and refuses a report that is already decided, which is what
     * gives the client a useful 409 naming the state it is actually in. The second is
     * {@code resolveIfOpen} coming back having changed nothing — the only check that
     * survives two moderators pressing the button at the same moment, because it is
     * part of the statement.
     *
     * @param outcome {@link ReportState#UPHELD} or {@link ReportState#DISMISSED}
     * @param note for the next moderator, or null. Optional on purpose: nothing shows
     *     it to the reporter, so requiring it would be a field people type "ok" into
     * @throws NotAModeratorException for a caller who is not platform staff
     * @throws ReportNotFoundException for an identifier that is not a report
     * @throws ReportAlreadyResolvedException when somebody has already decided it
     */
    @Transactional
    public QueuedReport resolve(UUID reportId, UUID moderatorId, ReportState outcome, String note) {
        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);
        if (!outcome.isResolution()) {
            // Unreachable from the two endpoints, which name the outcome themselves.
            // Here so that a third one cannot quietly re-open a decided report.
            throw new IllegalArgumentException(outcome + " is not a resolution");
        }

        ContentReport report = reports.findById(reportId).orElseThrow(() -> new ReportNotFoundException(reportId));
        if (!report.getState().canMoveTo(outcome)) {
            throw new ReportAlreadyResolvedException(reportId, report.getState());
        }

        int decided = reports.resolveIfOpen(reportId, outcome.name(), moderatorId, blankToNull(note));
        if (decided == 0) {
            // Somebody arrived between the read above and this statement. Re-read so
            // the client is told what the report actually became rather than what it
            // was a moment ago.
            ReportState now = reports.findById(reportId)
                    .map(ContentReport::getState)
                    .orElseThrow(() -> new ReportNotFoundException(reportId));
            throw new ReportAlreadyResolvedException(reportId, now);
        }

        // In this transaction, not after it. AuditLog#record is MANDATORY for that
        // reason: a decision that committed and a record of it that did not is the
        // one failure mode #107 exists to make impossible.
        //
        // The detail says what moved and what it was about, and deliberately not the
        // note -- that is free text somebody wrote about somebody, and audit_logs is
        // the table nothing may prune row by row.
        audit.record(
                actionFor(outcome),
                reportId,
                AuditActor.moderator(moderatorId),
                AuditOutcome.SUCCEEDED,
                report.getTargetType() + " " + report.getTargetId() + ": " + ReportState.OPEN + " -> " + outcome);

        ContentReport resolved = reports.findById(reportId)
                .orElseThrow(() -> new IllegalStateException("Report " + reportId + " vanished"));
        return QueuedReport.of(resolved, openReportsOn(resolved));
    }

    /**
     * What a report looks like to staff, on its own.
     *
     * <p>The read behind both endpoints' responses and the one a queue screen uses
     * after acting, so that a client does not have to re-fetch a page to refresh one
     * row.
     */
    @Transactional(readOnly = true)
    public QueuedReport report(UUID reportId, UUID moderatorId) {
        staff.requireCapability(moderatorId, StaffCapability.MODERATE_CONTENT);
        ContentReport report = reports.findById(reportId).orElseThrow(() -> new ReportNotFoundException(reportId));
        return QueuedReport.of(report, openReportsOn(report));
    }

    private static AuditAction actionFor(ReportState outcome) {
        return outcome == ReportState.UPHELD ? AuditAction.REPORT_UPHELD : AuditAction.REPORT_DISMISSED;
    }

    /**
     * The open-report count for every target on a page, in one query.
     *
     * <p>Keyed by target identifier alone rather than by the pair. A UUID names one
     * row in one table, so two targets of different kinds sharing an identifier is
     * not a collision that can happen — and a map keyed by a record would be a second
     * type for the sake of a key.
     */
    private Map<UUID, Long> openReportsOnTargetsOf(List<ContentReport> rows) {
        List<UUID> targetIds =
                rows.stream().map(ContentReport::getTargetId).distinct().toList();

        Map<UUID, Long> counts = new HashMap<>();
        for (TargetReportCount count : reports.countOpenByTarget(targetIds)) {
            counts.put(count.targetId(), count.openReports());
        }
        return counts;
    }

    private long openReportsOn(ContentReport report) {
        return reports.countOpenByTarget(List.of(report.getTargetId())).stream()
                .filter(count -> count.targetType() == report.getTargetType())
                .mapToLong(TargetReportCount::openReports)
                .findFirst()
                .orElse(0L);
    }

    private static String blankToNull(String note) {
        if (note == null) {
            return null;
        }
        String trimmed = note.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
