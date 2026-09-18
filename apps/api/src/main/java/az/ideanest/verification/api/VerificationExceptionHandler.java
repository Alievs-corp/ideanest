package az.ideanest.verification.api;

import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.verification.application.DocumentRefusedException;
import az.ideanest.verification.application.DocumentStorageUnavailableException;
import az.ideanest.verification.application.DocumentUnreadableException;
import az.ideanest.verification.application.VerificationNotDecidableException;
import az.ideanest.verification.application.VerificationNotFoundException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What identity verification refuses, as RFC 9457 problem details (§10.4) — issue #105.
 *
 * <p>Scoped to this module's two controllers rather than declared globally, exactly as
 * {@code NotificationExceptionHandler} is: an advice that catches a broad type across the
 * whole application turns a bug somewhere else into a tidy 4xx and hides it.
 *
 * <p><strong>No detail here repeats anything from a document.</strong> Not a filename, not
 * a media type the client claimed, not a byte. A problem detail is a document a client may
 * log, and the subject is somebody's passport.
 */
@RestControllerAdvice(assignableTypes = {VerificationController.class, VerificationAdminController.class})
public class VerificationExceptionHandler {

    /** 403 for a caller who is signed in and is not platform staff. */
    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-moderator"));
        problem.setTitle("Not a moderator");
        // Deliberately not the exception's message, which names the account.
        problem.setDetail("Identity documents are reviewed by platform staff.");
        problem.setProperty("code", "NOT_A_MODERATOR");
        return problem;
    }

    /**
     * 403 for a colleague on a surface that is not theirs.
     *
     * <p>A different refusal from the one above and deliberately not collapsed into it: that
     * one says "you do not work here", this one names the capability the caller is short of,
     * and only the second can be fixed by asking an administrator for a role. The console
     * reads {@code meta.capability} off this body and says which — and it is what the rail
     * hides an entry on, so the two agree about identity review, which is {@code StaffRole.COMPLIANCE}'s and holds the narrowest
     * reads on the platform.
     */
    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 404 for a verification that does not exist and for one belonging to somebody else.
     *
     * <p>The same answer for both, deliberately: whether a given person is being
     * identity-checked is a fact about them (§17.4), so an endpoint that told the two apart
     * would let anybody holding a staff token confirm it for an identifier they guessed.
     */
    @ExceptionHandler(VerificationNotFoundException.class)
    public ProblemDetail handleNotFound(VerificationNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/verification-not-found"));
        problem.setTitle("No such verification");
        problem.setDetail("That verification does not exist.");
        problem.setProperty("code", "VERIFICATION_NOT_FOUND");
        return problem;
    }

    /** 400 for a document the platform will not store. The reason is the {@code code}. */
    @ExceptionHandler(DocumentRefusedException.class)
    public ProblemDetail handleRefused(DocumentRefusedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/document-refused"));
        problem.setTitle("That document cannot be used");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", exception.reason().name());
        problem.setProperty("field", "file");
        return problem;
    }

    /**
     * 409 for a verification somebody has already decided.
     *
     * <p>The realistic cause is two members of staff in the same queue, which is a conflict
     * rather than a mistake — so the client refreshes rather than reports a bug.
     */
    @ExceptionHandler(VerificationNotDecidableException.class)
    public ProblemDetail handleNotDecidable(VerificationNotDecidableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/verification-not-decidable"));
        problem.setTitle("Already decided");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "VERIFICATION_NOT_DECIDABLE");
        return problem;
    }

    /**
     * 503 for a deployment with no document encryption key.
     *
     * <p><strong>Not a 500, and the difference is the whole point of the exception.</strong>
     * A creator whose upload failed with a server error tries again, and again. One told the
     * service is not accepting documents stops and asks somebody, which is the correct
     * response to a configuration that has not been finished.
     */
    @ExceptionHandler(DocumentStorageUnavailableException.class)
    public ProblemDetail handleUnavailable(DocumentStorageUnavailableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/document-storage-unavailable"));
        problem.setTitle("Documents cannot be submitted");
        problem.setDetail("This deployment is not configured to accept identity documents.");
        problem.setProperty("code", "DOCUMENT_STORAGE_UNAVAILABLE");
        return problem;
    }

    /**
     * 500 for a stored document that will not open.
     *
     * <p>A genuine server fault and reported as one: the key named on the row is not
     * configured, or the ciphertext failed its authentication tag. Neither is anything a
     * creator or a reviewer can act on, and the detail says nothing about which — a message
     * distinguishing a missing key from a failed tag would tell a reader which rows to
     * tamper with.
     */
    @ExceptionHandler(DocumentUnreadableException.class)
    public ProblemDetail handleUnreadable(DocumentUnreadableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        problem.setType(URI.create("https://ideanest.az/problems/document-unreadable"));
        problem.setTitle("That document could not be opened");
        problem.setDetail("The document is stored and could not be read on this deployment.");
        problem.setProperty("code", "DOCUMENT_UNREADABLE");
        return problem;
    }
}
