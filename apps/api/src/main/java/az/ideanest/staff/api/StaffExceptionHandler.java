package az.ideanest.staff.api;

import az.ideanest.staff.application.AccountIsPartnerException;
import az.ideanest.staff.application.CapabilityNotAdjustableException;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.staff.application.PartnerRoleManagedElsewhereException;
import az.ideanest.staff.application.RoleNotAdjustableException;
import az.ideanest.staff.application.UnknownStaffAccountException;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The role model's own refusals — #295.
 *
 * <p>Scoped to {@link StaffController} rather than applied globally, for the reason every
 * other advice in the service gives, and {@link StaffRefusals} has the sharper version of
 * it for these two types in particular.
 */
@RestControllerAdvice(assignableTypes = StaffController.class)
public class StaffExceptionHandler {

    /** 403: the caller does not work here. */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    /** 403: the caller works here and is not an administrator. */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 404 for a role granted to nobody.
     *
     * <p>Not a 400, although the identifier is in the path and is in that sense a bad
     * request. The distinction the platform draws everywhere is between a request that is
     * malformed and one that is well formed and names nothing — an administrator who
     * pastes a stale identifier has made the second kind of mistake, and a 400 would send
     * them looking at their JSON.
     */
    @ExceptionHandler(UnknownStaffAccountException.class)
    public ProblemDetail handleUnknownAccount(UnknownStaffAccountException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/account-not-found"));
        problem.setTitle("No such account");
        problem.setDetail("No account with that identifier.");
        problem.setProperty("code", "ACCOUNT_NOT_FOUND");
        return problem;
    }

    /** 409: {@code PARTNER} is a profile as well as a role, and is made where the share is set. */
    @ExceptionHandler(PartnerRoleManagedElsewhereException.class)
    public ProblemDetail handlePartnerRole(PartnerRoleManagedElsewhereException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/partner-role-managed-elsewhere"));
        problem.setTitle("Managed on the partner list");
        problem.setDetail("The partner role is granted and withdrawn with its share, on the partner list.");
        problem.setProperty("code", "PARTNER_ROLE_MANAGED_ELSEWHERE");
        return problem;
    }

    /** 409: roles add up, and a partner's share would protect nothing beside another role. */
    @ExceptionHandler(AccountIsPartnerException.class)
    public ProblemDetail handleAccountIsPartner(AccountIsPartnerException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/account-is-partner"));
        problem.setTitle("Account is a partner");
        problem.setDetail("A partner may hold no other staff role. End the partnership first.");
        problem.setProperty("code", "ACCOUNT_IS_PARTNER");
        return problem;
    }

    @ExceptionHandler(RoleNotAdjustableException.class)
    public ProblemDetail handleRoleNotAdjustable(RoleNotAdjustableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/role-not-adjustable"));
        problem.setTitle("This role cannot be changed");
        problem.setDetail("A super admin holds everything, and a partner's access is set on the partner list.");
        problem.setProperty("code", "ROLE_NOT_ADJUSTABLE");
        problem.setProperty("meta", Map.of("role", exception.role().name()));
        return problem;
    }

    @ExceptionHandler(CapabilityNotAdjustableException.class)
    public ProblemDetail handleCapabilityNotAdjustable(CapabilityNotAdjustableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/capability-not-adjustable"));
        problem.setTitle("Not something a role can be given");
        problem.setDetail("Administering staff stays with super admins, and partner statistics with partners.");
        problem.setProperty("code", "CAPABILITY_NOT_ADJUSTABLE");
        problem.setProperty(
                "meta",
                Map.of("capabilities", exception.capabilities().stream().map(Enum::name).sorted().toList()));
        return problem;
    }
}
