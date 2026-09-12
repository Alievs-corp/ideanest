package az.ideanest.subscription.application;

import az.ideanest.admin.AdminConsoleProperties;
import az.ideanest.audit.AuditAction;
import az.ideanest.audit.AuditActor;
import az.ideanest.audit.AuditLog;
import az.ideanest.audit.AuditOutcome;
import az.ideanest.shared.access.PlatformStaff;
import az.ideanest.shared.access.StaffCapability;
import az.ideanest.shared.export.Csv;
import az.ideanest.subscription.infrastructure.SubscriptionRevenueRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reading V73's journal as a report — #23's second step.
 *
 * <h2>What this answers, and why it is four queries rather than one</h2>
 *
 * <p>"How much came in last month" is three questions that have to agree: the figure per
 * currency, the split by plan, and the split by how the money arrived. Each is its own
 * {@code GROUP BY} over the same rows in the same window, which is three index scans of a
 * few hundred rows rather than one scan and a fold in Java — and the fold in Java is the
 * version that has to be corrected in three places the day a reversal is added.
 *
 * <p>The payment list is the fourth, and it is the one three surfaces share: the report's
 * table, the CSV, and the console's per-account history. {@link PaymentPage} says why
 * there is one of those rather than three.
 *
 * <h2>Everything here needs {@code CONFIGURE_PLATFORM}</h2>
 *
 * <p>Which only {@code ADMINISTRATOR} holds. Checked in the service rather than by an
 * annotation, following {@code Subscriptions} and {@code FeeSchedules}: this is also where
 * the export is recorded, and an authorised action nobody recorded and a recorded action
 * nobody authorised are the same defect from opposite ends.
 *
 * <p>It is the same capability the plan catalogue needs, deliberately. A narrower
 * "may read revenue" capability would be a third answer to a question AD-11 already
 * answers twice — who administers what the platform charges — and the person who reprices
 * a plan is the person who then checks what it brought in.
 *
 * <h2>Reads are not audited; the export is</h2>
 *
 * <p>Opening a screen leaves a request in the log and nothing in {@code audit_logs}. The
 * export leaves a file on somebody's laptop carrying every paying creator's address and
 * what they paid, which is the whole subscriber list in one attachment — so that one is
 * recorded, for {@code PROJECT_BACKERS_EXPORTED}'s reason. Auditing the reads as well
 * would put a row in the one table with no retention rule for every refresh of a
 * dashboard, and the rows that matter would be the ones nobody could find.
 */
@Service
public class SubscriptionRevenue {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionRevenue.class);

    /**
     * The export's columns.
     *
     * <p>Snake case, because the recipients are spreadsheets and importers rather than
     * people — {@code BackerExportService}'s argument, and the same stability promise:
     * renaming a column here breaks every mapping somebody has built downstream, which is
     * the same class of change as renaming a wire field.
     *
     * <p><strong>{@code amount} is signed and there is a {@code reverses} column beside
     * it.</strong> An export that dropped reversals would total higher than the platform
     * ever kept, and one that made them positive would double the error. A spreadsheet
     * summing this column gets the same net the report shows.
     */
    static final String HEADER = String.join(
            ",",
            "received_at",
            "recorded_at",
            "payment_id",
            "subscription_id",
            "account_id",
            "account_email",
            "account_name",
            "plan_code",
            "plan_name",
            "billing_period",
            "amount",
            "currency",
            "method",
            "reference",
            "reverses",
            "note");

    private final SubscriptionRevenueRepository journal;
    private final PlatformStaff staff;
    private final AdminConsoleProperties properties;
    private final AuditLog audit;
    private final Clock clock;

    public SubscriptionRevenue(
            SubscriptionRevenueRepository journal,
            PlatformStaff staff,
            AdminConsoleProperties properties,
            AuditLog audit,
            Clock clock) {
        this.journal = journal;
        this.staff = staff;
        this.properties = properties;
        this.audit = audit;
        this.clock = clock;
    }

    /**
     * The totals for one period.
     *
     * @param period the window, from {@link RevenuePeriod#of}, so a request that named
     *     none gets the current month rather than the whole history
     */
    @Transactional(readOnly = true)
    public RevenueReport report(UUID staffId, RevenuePeriod period, RevenueFilter filter) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        RevenueFilter asked = filter == null ? RevenueFilter.ANY : filter;

        List<RevenueReport.Currency> currencies = new ArrayList<>();
        for (SubscriptionRevenueRepository.CurrencyTotal total :
                journal.totalsByCurrency(
                        period.from(), period.to(), asked.planCode(), asked.accountId(), asked.methodName())) {
            currencies.add(RevenueReport.Currency.of(total));
        }

        List<RevenueReport.Plan> plans = new ArrayList<>();
        for (SubscriptionRevenueRepository.PlanTotal total :
                journal.totalsByPlan(
                        period.from(), period.to(), asked.planCode(), asked.accountId(), asked.methodName())) {
            plans.add(RevenueReport.Plan.of(total));
        }

        List<RevenueReport.Method> methods = new ArrayList<>();
        for (SubscriptionRevenueRepository.MethodTotal total :
                journal.totalsByMethod(
                        period.from(), period.to(), asked.planCode(), asked.accountId(), asked.methodName())) {
            methods.add(RevenueReport.Method.of(total));
        }

        return new RevenueReport(period, asked, List.copyOf(currencies), List.copyOf(plans), List.copyOf(methods));
    }

    /**
     * One page of payments, newest first.
     *
     * <p><strong>One row more than asked for is read, and then dropped.</strong> That is
     * what lets the page say whether there is another without a second query and without a
     * count: a cursor handed back when there is nothing after it makes a client fetch an
     * empty page, which on a reconciliation screen reads as the list having ended twice.
     *
     * @param cursor the previous page's {@code nextCursor}, or null for the first page
     * @param limit clamped to {@code ideanest.admin.subscription-revenue.paging}
     * @throws InvalidPaymentCursorException for a cursor this endpoint did not issue
     */
    @Transactional(readOnly = true)
    public PaymentPage payments(
            UUID staffId, RevenuePeriod period, RevenueFilter filter, String cursor, Integer limit) {

        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        RevenueFilter asked = filter == null ? RevenueFilter.ANY : filter;

        int size = properties.subscriptionRevenue().paging().effective(limit);
        PaymentCursor after = PaymentCursor.decode(cursor);

        List<PaymentPage.Payment> rows = read(period, asked, after, size + 1);

        if (rows.size() <= size) {
            return new PaymentPage(List.copyOf(rows), null);
        }
        List<PaymentPage.Payment> page = rows.subList(0, size);
        PaymentPage.Payment last = page.get(size - 1);
        return new PaymentPage(List.copyOf(page), new PaymentCursor(last.receivedAt(), last.id()).encode());
    }

    /**
     * The payment list as a file.
     *
     * <p>Materialised rather than streamed, so the response can say whether the cap was
     * reached in the body it is describing — {@code BackerExport} carries that argument and
     * this follows it, including the header that reports it.
     *
     * <p><strong>Not {@code @Transactional}</strong>, for {@code BackerExportService}'s
     * reason: the read is one statement and needs no transaction of its own, and the audit
     * row must commit whether or not the file reaches the client.
     * {@link AuditLog#recordIndependently} exists for exactly that, and an over-record
     * beats a gap on a row that says a subscriber list left the platform.
     */
    public RevenueExport export(UUID staffId, RevenuePeriod period, RevenueFilter filter) {
        staff.requireCapability(staffId, StaffCapability.CONFIGURE_PLATFORM);
        RevenueFilter asked = filter == null ? RevenueFilter.ANY : filter;

        int cap = properties.subscriptionRevenue().exportRowCap();
        List<PaymentPage.Payment> rows = read(period, asked, null, cap + 1);
        boolean truncated = rows.size() > cap;
        List<PaymentPage.Payment> included = truncated ? rows.subList(0, cap) : rows;

        String csv = documentOf(included);
        LocalDate taken = LocalDate.ofInstant(clock.instant(), RevenuePeriod.ZONE);

        audit.recordIndependently(
                AuditAction.SUBSCRIPTION_REVENUE_EXPORTED,
                staffId,
                AuditActor.moderator(staffId),
                AuditOutcome.SUCCEEDED,
                "period=%s/%s; plan=%s; account=%s; method=%s; rows=%d; truncated=%s"
                        .formatted(
                                period.from(),
                                period.to(),
                                asked.planCode() == null ? "any" : asked.planCode(),
                                asked.accountId() == null ? "any" : asked.accountId(),
                                asked.methodName() == null ? "any" : asked.methodName(),
                                included.size(),
                                truncated));

        log.info(
                "Staff {} exported {} subscription payments for {}/{} (truncated={})",
                staffId,
                included.size(),
                period.from(),
                period.to(),
                truncated);

        return new RevenueExport(
                "subscription-revenue-" + period.label() + "-taken-" + taken + ".csv",
                csv,
                included.size(),
                truncated);
    }

    private List<PaymentPage.Payment> read(
            RevenuePeriod period, RevenueFilter filter, PaymentCursor after, int limit) {

        List<PaymentPage.Payment> payments = new ArrayList<>();
        for (SubscriptionRevenueRepository.PaymentRow row : journal.page(
                period.from(),
                period.to(),
                filter.planCode(),
                filter.accountId(),
                filter.methodName(),
                after == null ? null : after.at(),
                after == null ? null : after.id(),
                limit)) {
            payments.add(PaymentPage.Payment.of(row));
        }
        return payments;
    }

    /** The document: a byte order mark, a header, and one line per payment. */
    private static String documentOf(List<PaymentPage.Payment> rows) {
        StringBuilder csv = new StringBuilder(Csv.BYTE_ORDER_MARK).append(HEADER).append(Csv.NEWLINE);
        for (PaymentPage.Payment payment : rows) {
            csv.append(payment.receivedAt())
                    .append(',')
                    .append(payment.recordedAt())
                    .append(',')
                    .append(payment.id())
                    .append(',')
                    .append(payment.subscriptionId())
                    .append(',')
                    .append(payment.accountId())
                    .append(',')
                    .append(Csv.cell(payment.accountEmail()))
                    .append(',')
                    .append(Csv.cell(payment.accountName()))
                    .append(',')
                    .append(Csv.cell(payment.planCode()))
                    .append(',')
                    .append(Csv.cell(payment.planName()))
                    .append(',')
                    .append(payment.billingPeriod().name())
                    /*
                     * The amount is written raw and NOT through `Csv.cell`, which would see
                     * the leading minus of a reversal as a formula and prefix it with an
                     * apostrophe -- turning the one column a spreadsheet is meant to sum
                     * into text on exactly the rows that make the total correct. It needs no
                     * escaping: a plain-string BigDecimal holds digits, a dot and a sign.
                     */
                    .append(',')
                    .append(payment.amount().amount().toPlainString())
                    .append(',')
                    .append(payment.amount().currency())
                    .append(',')
                    .append(payment.method().name())
                    .append(',')
                    .append(Csv.cell(payment.reference()))
                    .append(',')
                    .append(payment.reverses() == null ? "" : payment.reverses())
                    .append(',')
                    .append(Csv.cell(payment.note()))
                    .append(Csv.NEWLINE);
        }
        return csv.toString();
    }
}
