package az.ideanest.platform.api;

import az.ideanest.platform.application.InvalidMaintenanceWindowException;
import az.ideanest.platform.application.MaintenanceWindowConflictException;
import az.ideanest.platform.application.MaintenanceWindowNotFoundException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * AD-12's, AD-16's and the maintenance console's refusals — issues #312, #316 and #214.
 *
 * <p>Flags and health refuse in exactly the two staff ways and in no others: neither has
 * a resource that can be missing. Maintenance windows add the three a schedule can: the
 * window is not there, it is in the wrong state for the verb, or the times asked for do
 * not make a window.
 */
@RestControllerAdvice(
        assignableTypes = {FeatureFlagController.class, SystemHealthController.class, MaintenanceController.class})
public class PlatformExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    @ExceptionHandler(MaintenanceWindowNotFoundException.class)
    public ProblemDetail handleWindowNotFound(MaintenanceWindowNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/maintenance-window-not-found"));
        problem.setTitle("Maintenance window not found");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "MAINTENANCE_WINDOW_NOT_FOUND");
        return problem;
    }

    /**
     * 409 with the reason as the code: the console tells "overlaps another window" apart
     * from "already started" by it, and the sentence is for whoever reads the log.
     */
    @ExceptionHandler(MaintenanceWindowConflictException.class)
    public ProblemDetail handleWindowConflict(MaintenanceWindowConflictException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/maintenance-window-conflict"));
        problem.setTitle("Maintenance window conflict");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", exception.reason().name());
        return problem;
    }

    @ExceptionHandler(InvalidMaintenanceWindowException.class)
    public ProblemDetail handleInvalidWindow(InvalidMaintenanceWindowException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/maintenance-window-invalid"));
        problem.setTitle("Invalid maintenance window");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "MAINTENANCE_WINDOW_INVALID");
        return problem;
    }
}
