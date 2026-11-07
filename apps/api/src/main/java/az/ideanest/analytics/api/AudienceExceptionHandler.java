package az.ideanest.analytics.api;

import az.ideanest.analytics.application.InvalidAudienceEventException;
import az.ideanest.analytics.application.InvalidAudiencePeriodException;
import az.ideanest.project.application.CapabilityNotGrantedException;
import az.ideanest.project.application.ProjectNotFoundException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The audience endpoints' refusals outside the console — #633.
 *
 * <p>Scoped to the two controllers that can raise them, for the reason
 * {@code PlatformAnalyticsExceptionHandler} gives about its own split: the staff refusals
 * mean nothing to a beacon or to a campaign's owner. The campaign refusals use the words
 * {@code AnalyticsExceptionHandler} uses for the same two outcomes, so a client handling
 * one handles both.
 */
@RestControllerAdvice(assignableTypes = {AudienceEventController.class, ProjectAudienceController.class})
public class AudienceExceptionHandler {

    /** 404 for a campaign that does not exist and for one the caller has no relationship to, alike. */
    @ExceptionHandler(ProjectNotFoundException.class)
    public ProblemDetail handleProjectNotFound(ProjectNotFoundException exception) {
        return AudienceProblems.projectNotFound();
    }

    @ExceptionHandler(CapabilityNotGrantedException.class)
    public ProblemDetail handleCapabilityNotGranted(CapabilityNotGrantedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/capability-not-granted"));
        problem.setTitle("Not permitted");
        problem.setDetail("You do not have the capability this request needs on that project.");
        problem.setProperty("code", "CAPABILITY_NOT_GRANTED");
        return problem;
    }

    @ExceptionHandler(InvalidAudiencePeriodException.class)
    public ProblemDetail handlePeriod(InvalidAudiencePeriodException exception) {
        return AudienceProblems.invalidPeriod(exception);
    }

    @ExceptionHandler(InvalidAudienceEventException.class)
    public ProblemDetail handleEvent(InvalidAudienceEventException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-audience-event"));
        problem.setTitle("That audience event does not fit together");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_AUDIENCE_EVENT");
        return problem;
    }
}
