package az.ideanest.analytics.api;

import az.ideanest.analytics.application.InvalidAudiencePeriodException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

/** The two refusals both audience advices give, written once — #633. */
final class AudienceProblems {

    private AudienceProblems() {
    }

    static ProblemDetail projectNotFound() {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-found"));
        problem.setTitle("No such project");
        problem.setDetail("That project does not exist.");
        problem.setProperty("code", "PROJECT_NOT_FOUND");
        return problem;
    }

    /** 400 naming the four periods, so the caller can correct the request from the message. */
    static ProblemDetail invalidPeriod(InvalidAudiencePeriodException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-audience-period"));
        problem.setTitle("That is not a period the audience report offers");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_AUDIENCE_PERIOD");
        return problem;
    }
}
