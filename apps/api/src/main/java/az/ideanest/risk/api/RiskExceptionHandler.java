package az.ideanest.risk.api;

import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What the fraud queue refuses — issue #108.
 *
 * <p>Scoped to {@link RiskController} rather than applied globally, for the reason every
 * other advice in the service gives: an advice that catches a broad type across the whole
 * application turns a bug somewhere else into a tidy 4xx and hides it.
 *
 * <p>It is a second copy of {@code ConsoleExceptionHandler}'s one handler rather than an
 * extension of it, because that advice names its three controllers explicitly and adding a
 * fourth from another module would make an admin-module class the place a risk-module route
 * is configured. The body is deliberately identical: a client that already handles
 * {@code NOT_A_MODERATOR} should not need another branch for this route, and when epic
 * #100 replaces the staff list with a role model they change together.
 */
@RestControllerAdvice(assignableTypes = RiskController.class)
public class RiskExceptionHandler {

    /** 403 for a caller who is signed in and is not platform staff. */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("Fraud signals are read by platform staff.");
        problem.setProperty("code", "NOT_A_MODERATOR");
        return problem;
    }

    /**
     * 403 for a member of staff without {@code VIEW_FINANCE} — a curator or a partner, who
     * work here and are still not who reads a list of suspected backers.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }
}
