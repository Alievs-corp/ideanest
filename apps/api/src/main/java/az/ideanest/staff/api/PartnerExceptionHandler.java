package az.ideanest.staff.api;

import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.InvalidPartnerShareException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.staff.application.PartnerHoldsOtherRolesException;
import az.ideanest.staff.application.PartnerIsSuperAdminException;
import az.ideanest.staff.application.PartnerNotFoundException;
import az.ideanest.staff.application.PartnerShareExceededException;
import az.ideanest.staff.application.UnknownStaffAccountException;
import az.ideanest.staff.domain.StaffRole;
import java.net.URI;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The partner endpoints' own refusals — #204.
 *
 * <p>Scoped to {@link PartnerController} like {@link StaffExceptionHandler}, for the reason
 * every advice in the service gives: a type handled globally is one some other module's
 * endpoint will one day throw by accident and have answered in this module's words.
 */
@RestControllerAdvice(assignableTypes = PartnerController.class)
public class PartnerExceptionHandler {

    /** 403: the caller does not work here. */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    /** 403: the caller works here and is not a super admin. */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 404: no such account. */
    @ExceptionHandler(UnknownStaffAccountException.class)
    public ProblemDetail handleUnknownAccount(UnknownStaffAccountException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/account-not-found"));
        problem.setTitle("No such account");
        problem.setDetail("No account with that identifier.");
        problem.setProperty("code", "ACCOUNT_NOT_FOUND");
        return problem;
    }

    /** 404: the account exists and is not a partner. */
    @ExceptionHandler(PartnerNotFoundException.class)
    public ProblemDetail handleNotAPartner(PartnerNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/partner-not-found"));
        problem.setTitle("Not a partner");
        problem.setDetail("That account has no partner profile.");
        problem.setProperty("code", "PARTNER_NOT_FOUND");
        return problem;
    }

    /** 422: the percentage is not a share. */
    @ExceptionHandler(InvalidPartnerShareException.class)
    public ProblemDetail handleInvalidShare(InvalidPartnerShareException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-partner-share"));
        problem.setTitle("Not a valid share");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_PARTNER_SHARE");
        return problem;
    }

    /** 409: the partners' shares would add up to more than the whole. Says how much is left. */
    @ExceptionHandler(PartnerShareExceededException.class)
    public ProblemDetail handleExceeded(PartnerShareExceededException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/partner-share-exceeded"));
        problem.setTitle("Shares add up to more than 100");
        problem.setDetail("At most " + exception.available().toPlainString() + " is left to give this partner.");
        problem.setProperty("code", "PARTNER_SHARE_EXCEEDED");
        problem.setProperty("meta", Map.of("available", exception.available().toPlainString()));
        return problem;
    }

    /** 409: a super admin cannot also be a partner. */
    @ExceptionHandler(PartnerIsSuperAdminException.class)
    public ProblemDetail handleSuperAdmin(PartnerIsSuperAdminException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/partner-is-super-admin"));
        problem.setTitle("Already a super admin");
        problem.setDetail("A super admin sees the real figures and cannot also be given a share of them.");
        problem.setProperty("code", "PARTNER_IS_SUPER_ADMIN");
        return problem;
    }

    /** 409: the account holds another staff role, through which it could read transactions. */
    @ExceptionHandler(PartnerHoldsOtherRolesException.class)
    public ProblemDetail handleOtherRoles(PartnerHoldsOtherRolesException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/partner-holds-other-roles"));
        problem.setTitle("Holds other roles");
        problem.setDetail("A partner may hold no other staff role: roles add up, and another role could open "
                + "the transactions this share exists to keep from them.");
        problem.setProperty("code", "PARTNER_HOLDS_OTHER_ROLES");
        problem.setProperty(
                "meta",
                Map.of("roles", exception.roles().stream().map(StaffRole::name).sorted().collect(Collectors.joining(","))));
        return problem;
    }
}
