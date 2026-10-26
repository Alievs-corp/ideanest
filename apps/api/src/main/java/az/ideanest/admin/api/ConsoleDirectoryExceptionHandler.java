package az.ideanest.admin.api;

import az.ideanest.admin.application.TooManyIdentifiersException;
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
 * The identifier lookup, when it refuses — #402.
 *
 * <p>Its own advice rather than an addition to {@link ConsoleExceptionHandler}, and the
 * reason is that handler's {@link IllegalArgumentException} mapping: it turns any such
 * failure into {@code UNKNOWN_LEDGER_ACCOUNT}, which is correct for the three surfaces it
 * is scoped to and would be a sentence about the ledger in front of somebody who asked for
 * a list of names. Scoping an advice narrowly is what makes that mapping safe, so widening
 * this one to reuse the 403 would cost the thing that made it worth writing.
 */
@RestControllerAdvice(assignableTypes = ConsoleDirectoryController.class)
public class ConsoleDirectoryExceptionHandler {

    /** 403 for a caller who is signed in and does not work here. The platform's usual body. */
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

    /** 403 for a member of staff holding neither authority the lookup asks for. */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 400 for a lookup asking about more things than one page can hold.
     *
     * <p>The refusal names what was sent and what the ceiling is, because the caller's only
     * useful response is to split the request and it cannot size the pieces without both.
     */
    @ExceptionHandler(TooManyIdentifiersException.class)
    public ProblemDetail handleTooMany(TooManyIdentifiersException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/too-many-identifiers"));
        problem.setTitle("Too many identifiers");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "TOO_MANY_IDENTIFIERS");
        problem.setProperty("meta", Map.of("asked", exception.asked(), "limit", exception.limit()));
        return problem;
    }
}
