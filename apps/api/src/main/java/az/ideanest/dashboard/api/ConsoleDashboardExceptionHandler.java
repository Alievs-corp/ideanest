package az.ideanest.dashboard.api;

import az.ideanest.dashboard.application.InvalidDashboardRangeException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The front page's own refusals — #222.
 *
 * <p>Scoped to {@link ConsoleDashboardController}, like every advice in the service. There is no
 * "insufficient capability" here: a member of staff who holds no section's capability is not
 * refused, they receive an empty page.
 */
@RestControllerAdvice(assignableTypes = ConsoleDashboardController.class)
public class ConsoleDashboardExceptionHandler {

    /** 403: the caller does not work here. */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    /** 400: the window runs backwards or is longer than a year. */
    @ExceptionHandler(InvalidDashboardRangeException.class)
    public ProblemDetail handleRange(InvalidDashboardRangeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-dashboard-range"));
        problem.setTitle("That reporting window cannot be read");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_DASHBOARD_RANGE");
        return problem;
    }
}
