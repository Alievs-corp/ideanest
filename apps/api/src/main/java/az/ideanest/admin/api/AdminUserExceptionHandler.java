package az.ideanest.admin.api;

import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.user.application.AccountNotFoundException;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The account-administration failures, as RFC 9457 problem details.
 *
 * <p>Scoped to this module's controller rather than applied globally, for the reason every
 * other handler here gives: an advice that catches a broad type across the whole service
 * turns a bug somewhere else into a tidy 4xx and hides it.
 *
 * <p><strong>No detail here quotes an address or a name.</strong> A problem detail is
 * logged by clients and pasted into support tickets, and this is the one surface whose
 * inputs are other people's personal data.
 */
@RestControllerAdvice(assignableTypes = AdminUserController.class)
public class AdminUserExceptionHandler {

    /**
     * 403 for a caller who is signed in and is not platform staff.
     *
     * <p>The same body the project module's moderation endpoints answer with, because it
     * is the same refusal from the same configured list — and a client that already
     * handles {@code NOT_A_MODERATOR} should not need a second branch for this surface.
     * When epic #100 replaces the list with a role model, both change together.
     */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("Account administration is done by platform staff.");
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
     * hides an entry on, so the two agree about account administration, which {@code StaffRole.MODERATOR} and
     * {@code StaffRole.ADMINISTRATOR} hold and the other roles do not.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 404 for an account that does not exist, and for one that has been deleted.
     *
     * <p>The same answer to both. An anonymised account has nothing left to inspect and
     * nothing left to stop, and telling a caller that somebody used to be here is the one
     * fact §17.4 exists to remove.
     */
    @ExceptionHandler(AccountNotFoundException.class)
    public ProblemDetail handleNotFound(AccountNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/account-not-found"));
        problem.setTitle("No such account");
        problem.setDetail("That account does not exist.");
        problem.setProperty("code", "ACCOUNT_NOT_FOUND");
        return problem;
    }

    /**
     * 422 for staff suspending themselves.
     *
     * <p>The request is well formed and the caller is entitled to make it; what is wrong is
     * the relationship between the two, which is what 422 is for.
     * {@code users_suspension_has_another_author} refuses the row anyway — this is the
     * refusal a person can read.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleRefused(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/account-suspension-refused"));
        problem.setTitle("That suspension cannot be recorded");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "ACCOUNT_SUSPENSION_REFUSED");
        problem.setProperty("meta", Map.of("field", "userId"));
        return problem;
    }
}
