package az.ideanest.moderation.application;

import az.ideanest.moderation.domain.ContentReport;
import az.ideanest.moderation.domain.ReportReason;
import az.ideanest.moderation.domain.ReportTargetType;
import az.ideanest.moderation.infrastructure.ContentReportRepository;
import az.ideanest.shared.Identifiers;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only way a report is made.
 *
 * <p><strong>Reporting is idempotent per reporter per target, and the database is
 * what makes it so.</strong> The requirement — a reporter must not be able to
 * multiply their own report on one thing — cannot be met by reading first and
 * inserting second: two taps on a slow connection both see no open report, both
 * insert, and the campaign now carries two complaints from one person. Since the
 * only triage signal the queue has is how many people reported a thing, that is not
 * a cosmetic duplicate; it is the signal being writable by whoever is attacking it.
 * So the insert is an {@code ON CONFLICT DO NOTHING} against V23's partial unique
 * index, and the read below it is an optimisation rather than the check.
 *
 * <p><strong>A repeat report is a success, not a 409.</strong> The reporter did what
 * they meant to do, the platform has their complaint, and telling them otherwise
 * would train people to report the same thing from a second account. What they get
 * back is the report already on file, unchanged — including its original reason and
 * date, because rewriting either would let somebody move their own report up a queue
 * ordered by arrival.
 *
 * <p><strong>What is deliberately not here.</strong> Nothing is notified, nothing is
 * hidden, and nothing about the target changes. A report is a request for a person
 * to look, and auto-hiding on a report count is the mechanism by which a competitor
 * takes a campaign down with fifty free accounts. Acting on a report is AD-02's
 * suspension and AD-04's ban, each of which is a separate privileged action with its
 * own audit row.
 */
@Service
public class ReportingService {

    private static final Logger log = LoggerFactory.getLogger(ReportingService.class);

    private final ContentReportRepository reports;
    private final ReportTargets targets;

    public ReportingService(ContentReportRepository reports, ReportTargets targets) {
        this.reports = reports;
        this.targets = targets;
    }

    /**
     * Records a complaint, or returns the one this reporter already made.
     *
     * <p>The order of the checks is deliberate. The two that depend only on the
     * request — a reason that has to say what, and an account reporting itself —
     * happen before the target is loaded, so a malformed report costs no query. The
     * target is then established before anything is written, because a report about
     * an identifier nobody can resolve is a row a moderator opens, cannot find
     * anything behind, and closes.
     *
     * @param detail already trimmed and length-checked by the request type; null
     *     when the reporter wrote nothing
     * @throws ReportDetailRequiredException for {@link ReportReason#OTHER} with
     *     nothing written
     * @throws SelfReportException when the reporter is the account being reported
     * @throws ReportTargetNotFoundException when there is nothing there to report
     */
    @Transactional
    public SubmittedReport report(
            ReportTargetType targetType, UUID targetId, UUID reporterId, ReportReason reason, String detail) {

        String written = blankToNull(detail);
        if (reason.requiresDetail() && written == null) {
            throw new ReportDetailRequiredException(reason);
        }
        if (targetType == ReportTargetType.USER && targetId.equals(reporterId)) {
            throw new SelfReportException(reporterId);
        }
        targets.require(targetType, targetId);

        Optional<ContentReport> existing = reports.findOpenReport(targetType, targetId, reporterId);
        if (existing.isPresent()) {
            // The common repeat: a second tap, or somebody reporting the same
            // campaign again a day later. No statement is sent at all.
            return SubmittedReport.of(existing.get(), false);
        }

        UUID id = Identifiers.newIdentifier();
        int inserted =
                reports.insertIfAbsent(id, targetType.name(), targetId, reporterId, reason.name(), written);
        if (inserted == 0) {
            // The uncommon repeat: two requests arrived together and the index
            // decided between them. Whichever lost reads back the winner's row,
            // which is the same answer the caller would have got a moment earlier.
            return SubmittedReport.of(open(targetType, targetId, reporterId), false);
        }

        log.info("Report {} filed on {} {}", id, targetType, targetId);
        return SubmittedReport.of(
                reports.findById(id).orElseThrow(() -> new IllegalStateException("Report " + id + " vanished")),
                true);
    }

    /**
     * Records a complaint about an account named by its public slug (#143), or returns
     * the one this reporter already made.
     *
     * <p>The profile page has the slug and not the identifier, and following is
     * addressed the same way. The slug is resolved to the account first and the report
     * is then exactly {@link #report} on {@link ReportTargetType#USER}, so deduplication,
     * the self-report refusal and the queue row are unchanged — the queue still names the
     * account by its identifier, which survives a slug change.
     *
     * @throws ReportTargetNotFoundException when no account answers to the slug
     */
    @Transactional
    public SubmittedReport reportAccount(String slug, UUID reporterId, ReportReason reason, String detail) {
        UUID accountId = targets.requireAccountBySlug(slug);
        return report(ReportTargetType.USER, accountId, reporterId, reason, detail);
    }

    /**
     * The row the conflict pointed at.
     *
     * <p>It has to be there: {@code ON CONFLICT DO NOTHING} declined only because a
     * matching open report exists, and this transaction has not committed anything
     * that could remove it. Absence would mean the index and the query disagree
     * about what "open" means, which is worth a loud failure rather than a null.
     */
    private ContentReport open(ReportTargetType targetType, UUID targetId, UUID reporterId) {
        return reports.findOpenReport(targetType, targetId, reporterId)
                .orElseThrow(() -> new IllegalStateException(
                        "An open report on " + targetType + " " + targetId + " conflicted and cannot be read"));
    }

    /**
     * Whitespace is not detail.
     *
     * <p>Otherwise a client sending {@code " "} satisfies "OTHER has to say what" in
     * Java and is then refused by V23's {@code btrim} — a 500 where the honest answer
     * is a 400 naming the field.
     */
    private static String blankToNull(String detail) {
        if (detail == null) {
            return null;
        }
        String trimmed = detail.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
