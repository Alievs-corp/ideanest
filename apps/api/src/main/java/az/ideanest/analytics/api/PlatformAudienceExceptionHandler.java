package az.ideanest.analytics.api;

import az.ideanest.analytics.application.InvalidAudiencePeriodException;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** The console audience screen's refusals — #633. */
@RestControllerAdvice(assignableTypes = PlatformAudienceController.class)
public class PlatformAudienceExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    @ExceptionHandler(ProjectNotFoundException.class)
    public ProblemDetail handleProjectNotFound(ProjectNotFoundException exception) {
        return AudienceProblems.projectNotFound();
    }

    @ExceptionHandler(InvalidAudiencePeriodException.class)
    public ProblemDetail handlePeriod(InvalidAudiencePeriodException exception) {
        return AudienceProblems.invalidPeriod(exception);
    }
}
