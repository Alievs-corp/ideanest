package az.ideanest.fee.api;

import az.ideanest.fee.application.OverlappingFeeScheduleException;
import az.ideanest.fee.application.UnknownFeeScopeException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * AD-11's refusals — #311.
 *
 * <p>Scoped to {@link FeeScheduleController}, for the reason every advice in this service
 * gives. The two staff refusals delegate to {@link StaffRefusals} so that a console screen
 * branching on {@code INSUFFICIENT_STAFF_CAPABILITY} meets the same body everywhere.
 */
@RestControllerAdvice(assignableTypes = FeeScheduleController.class)
public class FeeExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 409 when another request opened a schedule for this scope first.
     *
     * <p>Not a 400 and not a 500: the request was correct when it was composed. The
     * console's answer is to reload and show what is now in force, because re-sending
     * would stack a third window on terms the reader has not seen.
     */
    @ExceptionHandler(OverlappingFeeScheduleException.class)
    public ProblemDetail handleOverlap(OverlappingFeeScheduleException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/fee-schedule-conflict"));
        problem.setTitle("Terms changed underneath you");
        problem.setDetail("Another administrator opened a schedule for this scope. Reload and try again.");
        problem.setProperty("code", "FEE_SCHEDULE_CONFLICT");
        return problem;
    }

    /**
     * 400 for a schedule whose scope and reference disagree.
     *
     * <p>{@code FeeSchedule}'s constructor throws this before the row reaches V49's
     * {@code CHECK}. Both exist: the constraint holds against a support script, and the
     * constructor gives an administrator a sentence rather than a stack trace.
     */
    /** 400 for an exception naming a category or campaign that does not exist. {@code meta.scope} says which. */
    @ExceptionHandler(UnknownFeeScopeException.class)
    public ProblemDetail handleUnknownScope(UnknownFeeScopeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/fee-scope-unknown"));
        problem.setTitle("Nothing by that identifier");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "FEE_SCOPE_UNKNOWN");
        problem.setProperty("meta", java.util.Map.of("scope", exception.scope().name()));
        return problem;
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleMismatch(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/fee-scope-mismatch"));
        problem.setTitle("Scope and reference disagree");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "FEE_SCOPE_MISMATCH");
        return problem;
    }
}
