package az.ideanest.staff.api;

import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.staff.application.PartnerNotConfiguredException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The statistics endpoint's own refusals — #205.
 *
 * <p>Scoped to {@link PartnerStatisticsController}, like every advice in the service.
 */
@RestControllerAdvice(assignableTypes = PartnerStatisticsController.class)
public class PartnerStatisticsExceptionHandler {

    /** 403: the caller does not work here. */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    /** 403: the caller works here and is neither a super admin nor a partner. */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 403: a partner with no percentage. Never the real figures, and never an unscaled zero:
     * the statistics are withheld until a super admin gives this partner a share.
     */
    @ExceptionHandler(PartnerNotConfiguredException.class)
    public ProblemDetail handleNotConfigured(PartnerNotConfiguredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/partner-not-configured"));
        problem.setTitle("No share set");
        problem.setDetail("No percentage has been set for this account yet.");
        problem.setProperty("code", "PARTNER_NOT_CONFIGURED");
        return problem;
    }
}
