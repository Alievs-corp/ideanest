package az.ideanest.admin.api;

import az.ideanest.audit.InvalidAuditCursorException;
import az.ideanest.payment.application.InvalidPaymentLogCursorException;
import az.ideanest.payment.application.UnknownTransactionOutcomeException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The console's three read surfaces, when they refuse — AD-05 and AD-14.
 *
 * <p>Scoped to those three controllers rather than applied globally, for the reason every
 * other advice in the service gives: an advice that catches a broad type across the whole
 * application turns a bug somewhere else into a tidy 4xx and hides it. It is separate from
 * {@link AdminUserExceptionHandler} for the same reason in miniature — that one maps
 * {@link IllegalArgumentException} to a refusal about suspending an account, and these
 * endpoints have no account to suspend.
 *
 * <p>Every response carries a {@code code} as well as a status, per §10.4. The status tells
 * a client how to behave; the code tells it what happened.
 */
@RestControllerAdvice(
        assignableTypes = {AuditTrailController.class, PaymentLogController.class, LedgerController.class})
public class ConsoleExceptionHandler {

    /**
     * 403 for a caller who is signed in and is not platform staff.
     *
     * <p>The same body the rest of the platform's staff surfaces answer with, because it is
     * the same refusal from the same configured list. A client that already handles
     * {@code NOT_A_MODERATOR} should not need a fourth branch for these three routes, and
     * when epic #100 replaces the list with a role model they all change together.
     */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("The administration console is read by platform staff.");
        problem.setProperty("code", "NOT_A_MODERATOR");
        return problem;
    }

    /**
     * 403 for a colleague on a surface that is not theirs.
     *
     * <p>A different refusal from the one above and deliberately not collapsed into it: that
     * one says "you do not work here", this one names the capability the caller is short of,
     * and only the second can be fixed by asking an administrator for a role. The console
     * reads {@code meta.capability} off this body and says which — and it is what the rail
     * hides an entry on, so the two agree about the three read surfaces a role model now separates: the trail is every role's to read,
     * and the ledger and the payment log are finance's.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 400 for a paging cursor {@code /v1/admin/audit} or {@code /v1/admin/payments} did not
     * produce.
     *
     * <p>A refusal rather than the first page, which is the same distinction the handler
     * below draws and matters here for a sharper reason: quietly restarting the list would
     * hand an investigator the top of the log again in place of the part they had not read,
     * and there is nothing on the screen to tell them which one they are looking at.
     *
     * <p><strong>Two exception types and one body, since #412.</strong> The payment log's
     * cursor became a pair for the reason the trail's did — it is ordered by a column that is
     * not unique — so it gained the same way of being malformed. The types stay separate
     * because {@link az.ideanest.payment.application.PaymentLogCursor} says why the cursors
     * are: one endpoint must not accept the other's value and page somebody else's rows. What
     * a client does about either is identical, so the answer is, and a second {@code code}
     * would be a branch every client had to write for no decision.
     *
     * <p>The body does not say which half of the cursor was wrong. There is nothing to act
     * on in that — the client's next move is to start the list again either way — and
     * naming it would tell whoever is probing how the value is built.
     */
    @ExceptionHandler({InvalidAuditCursorException.class, InvalidPaymentLogCursorException.class})
    public ProblemDetail handleInvalidCursor(RuntimeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-cursor"));
        problem.setTitle("Invalid cursor");
        problem.setDetail("Send the nextCursor from the previous page, or nothing for the first.");
        problem.setProperty("code", "INVALID_CURSOR");
        problem.setProperty("meta", Map.of("parameter", "after"));
        return problem;
    }

    /**
     * 400 for a payment outcome that is not one of the three — #404.
     *
     * <p>The same distinction the ledger handler below draws, and it lands in the same place
     * for a sharper reason: {@code ?status=refunded} is the mistake somebody actually makes,
     * because a refund <em>is</em> a thing this table records — as a {@code type}, never as a
     * {@code status}. Dropping the filter would draw every successful charge on the platform
     * under a chip that says "rejected", which is worse than an empty page and much worse than
     * a refusal.
     *
     * <p>{@code meta.parameter} names the query parameter rather than the value, and the detail
     * quotes what was sent back. It came from the caller's own URL, so there is nothing in it
     * a support ticket could leak.
     */
    @ExceptionHandler(UnknownTransactionOutcomeException.class)
    public ProblemDetail handleUnknownOutcome(UnknownTransactionOutcomeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-transaction-outcome"));
        problem.setTitle("No such payment outcome");
        problem.setDetail("Outcome is SUCCEEDED, FAILED or PENDING. Received: " + exception.asked());
        problem.setProperty("code", "UNKNOWN_TRANSACTION_OUTCOME");
        problem.setProperty("meta", Map.of("parameter", "status"));
        return problem;
    }

    /**
     * 400 for a ledger account that is not one of §7.2's six.
     *
     * <p>A refusal rather than an empty page, and the distinction is the whole reason this
     * handler exists. {@code ?account=platform_fees} — the plural, which is the mistake
     * somebody actually makes — would otherwise return a page of nothing, and a page of
     * nothing on a ledger reads as "this account is empty" rather than "there is no such
     * account". One of those is a fact about the platform's money.
     *
     * <p>The message is {@link az.ideanest.ledger.application.LedgerAccount}'s own, which names the value and points at the
     * six. It quotes what the caller sent and nothing else, so there is nothing here for a
     * support ticket to leak.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleUnknownAccount(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-ledger-account"));
        problem.setTitle("No such ledger account");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "UNKNOWN_LEDGER_ACCOUNT");
        problem.setProperty("meta", Map.of("parameter", "account"));
        return problem;
    }
}
