package az.ideanest.payment.application;

import az.ideanest.payment.domain.PaymentTransaction;
import az.ideanest.payment.domain.TransactionStatus;
import az.ideanest.payment.infrastructure.PaymentTransactionRepository;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * §4.11's AD-05 payment log, read — #304.
 *
 * <p>Every charge the platform has attempted, its provider reference, and why the refused
 * ones were refused. It is the read half of a table the payment pages write and
 * nothing updates, so there is no consistency question here at all: a row that exists said
 * the same thing yesterday and will say it next year.
 *
 * <p><strong>No authorisation and no audit row here.</strong> Both live in
 * {@code admin.application.PaymentLogService}, one layer out, for the reason
 * {@code AuditTrail} gives: the module that owns the table publishes the read, and the
 * module that owns the console decides who may take it and records that they did. Putting
 * the staff check here would put {@code shared.access} in front of the collection run as
 * well, which has no caller to check.
 *
 * <p><strong>It is a projection boundary as much as a service.</strong> The rows leave here
 * as {@link LoggedTransaction}, which is what lets the admin module read this table without
 * naming a {@code domain} type — see that record for why that rule is doing real work
 * rather than being satisfied for form's sake.
 */
@Service
public class PaymentLog {

    private final PaymentTransactionRepository transactions;

    public PaymentLog(PaymentTransactionRepository transactions) {
        this.transactions = transactions;
    }

    /**
     * One page of the log, newest first.
     *
     * @param scope one of {@link PaymentLogScope}'s shapes, optionally narrowed to one
     *     outcome. Normalised first, so the page and the echoed scope describe the same query
     * @param before where the previous page ended, or null for the first. A position rather
     *     than a row that has to exist: it names an instant and an identifier, and every row
     *     below that pair is still a correct answer. Two values rather than one since #412 —
     *     {@link PaymentLogCursor} carries why
     * @param limit already clamped by the caller
     * @throws UnknownTransactionOutcomeException when the scope names a status that is not one
     *     of the three. Refused rather than dropped — see {@link PaymentLogScope#outcome()}
     */
    @Transactional(readOnly = true)
    public PaymentLogPage page(PaymentLogScope scope, PaymentLogCursor before, int limit) {
        PaymentLogScope asked = scope.normalised();
        PageRequest page = PageRequest.ofSize(limit);
        // Resolved before the query rather than inside the dispatch, so that a status nobody
        // can serve is a refusal about the request instead of a page of the wrong rows.
        List<PaymentTransaction> rows = rowsFor(asked, asked.outcome(), before, page);

        // A full page is the only honest signal that there may be more; the report queue
        // and the audit trail both take the same line, and for the same reason.
        PaymentLogCursor nextCursor = rows.size() < limit ? null : cursorTo(rows.get(rows.size() - 1));
        return new PaymentLogPage(asked, rows.stream().map(LoggedTransaction::of).toList(), nextCursor);
    }

    /**
     * Where the page just served ends.
     *
     * <p>Both halves, because the log is ordered by a column that is not unique — §9.6's four
     * attempts against one card land inside one second often enough that a cursor of one
     * instant would repeat a row or drop it, depending on which side of the boundary it fell.
     * {@link PaymentLogCursor} holds the whole of #412's argument.
     */
    private static PaymentLogCursor cursorTo(PaymentTransaction last) {
        return new PaymentLogCursor(last.getCreatedAt(), last.getId());
    }

    /**
     * The rows, from whichever of the twelve queries this scope names.
     *
     * <p>Two dispatches rather than one, and the outer one is on the outcome: the filtered and
     * unfiltered halves are separate queries so that each is exactly the index it uses, which
     * is the argument {@code PaymentTransactionRepository} carries. Nesting them the other way
     * round would put the same {@code status == null} test in three branches.
     */
    private List<PaymentTransaction> rowsFor(
            PaymentLogScope scope, TransactionStatus status, PaymentLogCursor before, PageRequest page) {

        if (status == null) {
            if (scope.pledgeId() != null) {
                return before == null
                        ? transactions.newestOfPledge(scope.pledgeId(), page)
                        : transactions.newestOfPledgeBefore(scope.pledgeId(), before.at(), before.id(), page);
            }
            if (scope.projectId() != null) {
                return before == null
                        ? transactions.newestOfProject(scope.projectId(), page)
                        : transactions.newestOfProjectBefore(scope.projectId(), before.at(), before.id(), page);
            }
            return before == null
                    ? transactions.newest(page)
                    : transactions.newestBefore(before.at(), before.id(), page);
        }

        if (scope.pledgeId() != null) {
            return before == null
                    ? transactions.newestOfPledgeWithStatus(scope.pledgeId(), status, page)
                    : transactions.newestOfPledgeWithStatusBefore(
                            scope.pledgeId(), status, before.at(), before.id(), page);
        }
        if (scope.projectId() != null) {
            return before == null
                    ? transactions.newestOfProjectWithStatus(scope.projectId(), status, page)
                    : transactions.newestOfProjectWithStatusBefore(
                            scope.projectId(), status, before.at(), before.id(), page);
        }
        return before == null
                ? transactions.newestWithStatus(status, page)
                : transactions.newestWithStatusBefore(status, before.at(), before.id(), page);
    }
}
