package az.ideanest.pledge.application;

import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.pledge.PledgeProperties;
import az.ideanest.shared.export.Csv;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * §4.7's CD-11 and §4.8's PM-17 (#79): the backer report, in a file a fulfilment partner
 * accepts.
 *
 * <h2>What is in the file, and what is missing from it</h2>
 *
 * <p>Eleven columns: who backed, how to reach them, which tier they took, what they paid,
 * which state the pledge is in, where it is going, and when. That is every fact the
 * platform currently holds about a backer of a running campaign.
 *
 * <p><strong>It does not carry a postal address, and that is a gap rather than a
 * decision.</strong> §4.8's PM-07 collects one after the campaign closes and #75 is the
 * issue that builds it; {@code pledges} has a {@code shipping_country} and no street. A
 * fulfilment partner will ask for the rest, and the answer today is that nobody has it —
 * which is a better answer than a column of blanks that looks like the backers declined to
 * say. The header row and this comment are where that is stated; when #75 lands, the
 * columns go in beside {@code shipping_country} and nothing else here changes.
 *
 * <h2>CSV, and the two ways CSV goes wrong</h2>
 *
 * <p><strong>Formula injection.</strong> A cell beginning {@code =}, {@code +}, {@code -}
 * or {@code @} is executed by Excel and by Sheets when the file is opened, and a campaign's
 * backers can choose their own display name. {@link #safe} prefixes those with an
 * apostrophe, which the spreadsheet strips on display and the parser does not execute. This
 * is not hypothetical: a display name is the most attacker-controlled string on the
 * platform, and the person who opens the file is the creator.
 *
 * <p><strong>Encoding.</strong> The document begins with a UTF-8 byte order mark, because
 * Excel on Windows reads a BOM-less UTF-8 file as the system code page and turns every
 * Azerbaijani name into mojibake. The BOM costs three bytes and is what makes the file
 * openable by the tool the recipients actually use.
 *
 * <h2>Why it is materialised rather than streamed</h2>
 *
 * <p>Because the response has to be able to say {@link BackerExport#truncated()} in the
 * body it is describing, and a stream has already sent its first byte by the time it finds
 * out. The cap that makes this safe is
 * {@link PledgeProperties.Report#exportRowCap()}; the day a campaign is genuinely larger
 * than it, the answer is an asynchronous export with a download URL, which needs the media
 * module and is not this issue.
 */
@Service
public class BackerExportService {

    /**
     * The three bytes that tell Excel the file is UTF-8 — {@link Csv#BYTE_ORDER_MARK}.
     *
     * <p>Kept as a name here because this file's tests and header refer to it, and
     * defined there because #23's revenue report needs the same three bytes and the rule
     * is about CSV rather than about backers.
     */
    static final String BYTE_ORDER_MARK = Csv.BYTE_ORDER_MARK;

    /**
     * The header row.
     *
     * <p>Snake case, because the recipients are spreadsheets and importers rather than
     * people, and a column named {@code Backer Name} is one every importer has to be told
     * about. Stable: renaming a column here breaks every mapping a creator has set up
     * downstream, which is the same class of change as renaming a wire field.
     */
    static final String HEADER =
            "pledge_id,backer_name,backer_email,anonymous,reward_tier_id,reward_tier,amount,currency,state,shipping_country,backed_at";

    private final BackerReportService report;
    private final BackerSegmentService segments;
    private final PledgeProperties properties;
    private final AuditLog audit;
    private final Clock clock;

    public BackerExportService(
            BackerReportService report,
            BackerSegmentService segments,
            PledgeProperties properties,
            AuditLog audit,
            Clock clock) {

        this.report = report;
        this.segments = segments;
        this.properties = properties;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * Exports the backers a filter matches.
     *
     * <p><strong>Not {@code @Transactional}.</strong> The read is one statement and needs
     * no transaction of its own, and the audit row must commit whether or not the response
     * reaches the client — {@link AuditLog#recordIndependently} is for exactly this case
     * and says why an over-record beats a gap.
     *
     * @param segmentId a saved segment to export instead of {@code filter}, or null. When
     *     both are given the segment wins, because a client that sent both has described
     *     the same thing twice and the saved definition is the one the creator can see
     * @throws az.ideanest.project.application.ProjectNotFoundException for a campaign that
     *     does not exist and for one this account has no part in, identically
     * @throws az.ideanest.project.application.CapabilityNotGrantedException without
     *     VIEW_FINANCES
     * @throws BackerSegmentNotFoundException when {@code segmentId} names no segment on
     *     this campaign
     */
    public BackerExport export(UUID projectId, UUID accountId, BackerFilter filter, UUID segmentId) {
        // The authorisation is BackerReportService's, made where the rows are read. Asking
        // twice would be two answers to a question ProjectAccess exists to answer once, and
        // the one that mattered would be the one nearest the data.
        BackerFilter effective = segmentId == null ? filter : segments.filterOf(projectId, accountId, segmentId);

        int cap = properties.report().exportRowCap();
        List<BackerPage.Backer> rows = report.matching(projectId, accountId, effective, cap);
        boolean truncated = rows.size() > cap;
        List<BackerPage.Backer> included = truncated ? rows.subList(0, cap) : rows;

        String csv = documentOf(included);
        LocalDate today = LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC);

        // Recorded after the file is built and before it is returned. The detail says what
        // left and under what question -- never a name or an address from inside it, which
        // would put personal data in the one table with no retention rule.
        audit.recordIndependently(
                AuditAction.PROJECT_BACKERS_EXPORTED,
                projectId,
                AuditActor.user(accountId),
                AuditOutcome.SUCCEEDED,
                detailOf(included.size(), truncated, effective, segmentId));

        return new BackerExport(
                "backers-" + projectId + "-" + today + ".csv", csv, included.size(), truncated);
    }

    /** The document: a byte order mark, a header, and one line per backer. */
    private static String documentOf(List<BackerPage.Backer> rows) {
        StringBuilder csv = new StringBuilder(BYTE_ORDER_MARK).append(HEADER).append("\r\n");
        for (BackerPage.Backer backer : rows) {
            csv.append(safe(backer.pledgeId().toString()))
                    .append(',')
                    .append(safe(backer.name()))
                    .append(',')
                    .append(safe(backer.email()))
                    .append(',')
                    .append(backer.anonymous())
                    .append(',')
                    .append(backer.rewardTierId() == null ? "" : backer.rewardTierId())
                    .append(',')
                    .append(safe(backer.rewardTitle()))
                    .append(',')
                    // The amount as the string Money carries, never a double and never
                    // reformatted with a thousands separator: this column is read by an
                    // importer, and a grouped number is the classic way a total arrives as
                    // text.
                    .append(backer.amount().amount().toPlainString())
                    .append(',')
                    .append(safe(backer.amount().currency()))
                    .append(',')
                    .append(backer.state().name())
                    .append(',')
                    .append(safe(backer.country()))
                    .append(',')
                    .append(backer.backedAt())
                    .append("\r\n");
        }
        return csv.toString();
    }

    /**
     * One cell: escaped for CSV, and disarmed for the spreadsheet that opens it.
     *
     * <p>RFC 4180 quoting — a field containing a comma, a quote or a newline is wrapped in
     * quotes and its own quotes are doubled — and the formula prefix described on the class.
     * Null becomes an empty cell rather than the four letters {@code null}.
     */
    static String safe(String value) {
        // Both rules now live in `shared.export.Csv`, because #23's revenue report is the
        // second file this platform hands somebody and a display name is not the only
        // string an attacker chooses. This name stays for the call sites below and for
        // what the class header says about them.
        return Csv.cell(value);
    }

    /**
     * What the audit row says about the export.
     *
     * <p>The shape of the question and the size of the answer. Not the answer: a filter's
     * search term is whatever the creator typed, which can be a backer's email address, and
     * copying that into {@code audit_logs} would be personal data acquired by accident in
     * the one table nothing can edit. The term is reported as present or absent.
     */
    private static String detailOf(int rows, boolean truncated, BackerFilter filter, UUID segmentId) {
        StringBuilder detail = new StringBuilder("rows=").append(rows);
        if (truncated) {
            detail.append(" truncated=true");
        }
        if (segmentId != null) {
            detail.append(" segment=").append(segmentId);
        }
        if (!filter.states().isEmpty()) {
            detail.append(" states=").append(filter.states().size());
        }
        if (!filter.rewardTiers().isEmpty()) {
            detail.append(" tiers=").append(filter.rewardTiers().size());
        }
        if (!filter.countries().isEmpty()) {
            detail.append(" countries=").append(filter.countries().size());
        }
        if (filter.term() != null) {
            detail.append(" search=yes");
        }
        return detail.toString();
    }
}
