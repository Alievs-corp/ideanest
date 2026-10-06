package az.ideanest.payout.api;

import az.ideanest.project.application.CapabilityNotGrantedException;
import az.ideanest.project.application.ProjectNotFoundException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The two refusals a campaign's financial summary can raise, in the bodies the project module
 * gives them everywhere else.
 *
 * <p>Its own advice rather than a line in {@code ProjectExceptionHandler}'s list: that advice
 * naming this controller would make the project module depend on the payout module, which
 * already depends on it. Without either, a stranger got a 500 where every other dashboard
 * panel answers 404.
 */
@RestControllerAdvice(assignableTypes = CampaignFinanceController.class)
public class CampaignFinanceExceptionHandler {

    /** 404 for a campaign that does not exist and for one this caller is not party to. */
    @ExceptionHandler(ProjectNotFoundException.class)
    public ProblemDetail handleProjectNotFound(ProjectNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-found"));
        problem.setTitle("No such project");
        problem.setDetail("That project does not exist.");
        problem.setProperty("code", "PROJECT_NOT_FOUND");
        return problem;
    }

    /** 403 for a collaborator whose grant does not include {@code VIEW_FINANCES}. */
    @ExceptionHandler(CapabilityNotGrantedException.class)
    public ProblemDetail handleCapabilityNotGranted(CapabilityNotGrantedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/capability-not-granted"));
        problem.setTitle("Not permitted on this campaign");
        problem.setDetail("Your collaborator access on this campaign does not include that.");
        problem.setProperty("code", "CAPABILITY_NOT_GRANTED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("requiredAnyOf", exception.requiredAnyOf());
        meta.put("held", exception.held());
        problem.setProperty("meta", meta);
        return problem;
    }
}
