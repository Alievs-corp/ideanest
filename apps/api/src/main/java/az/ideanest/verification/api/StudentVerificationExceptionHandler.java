package az.ideanest.verification.api;

import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.verification.application.DocumentStorageUnavailableException;
import az.ideanest.verification.application.DocumentUnreadableException;
import az.ideanest.verification.application.InvalidStudentVerificationException;
import az.ideanest.verification.application.StudentCardInUseException;
import az.ideanest.verification.application.StudentDocumentRefusedException;
import az.ideanest.verification.application.StudentVerificationAlreadySubmittedException;
import az.ideanest.verification.application.StudentVerificationNotDecidableException;
import az.ideanest.verification.application.StudentVerificationNotFoundException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What student verification refuses, as RFC 9457 problem details — #655.
 *
 * <p>Scoped to its two controllers, as {@code VerificationExceptionHandler} is. The document
 * refusals and the 503 carry the identity check's codes, so a client that already speaks them
 * needs one more field — {@code field}, naming {@code studentCard} or {@code selfie} — and nothing
 * else. No detail repeats a card number, an institution, or anything from a file.
 */
@RestControllerAdvice(assignableTypes = {StudentVerificationController.class, StudentVerificationAdminController.class})
public class StudentVerificationExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 400: a photograph the platform will not store. The reason is the {@code code}, the part the {@code field}. */
    @ExceptionHandler(StudentDocumentRefusedException.class)
    public ProblemDetail handleRefused(StudentDocumentRefusedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/document-refused"));
        problem.setTitle("That file cannot be used");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", exception.reason().name());
        problem.setProperty("field", exception.field());
        return problem;
    }

    /** 400: an institution, a card number or a reason that is not one. */
    @ExceptionHandler(InvalidStudentVerificationException.class)
    public ProblemDetail handleInvalid(InvalidStudentVerificationException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-student-verification"));
        problem.setTitle("That cannot be submitted");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_STUDENT_VERIFICATION");
        problem.setProperty("field", exception.field());
        return problem;
    }

    /** 409: the account's check is waiting for review, or approved and still counting. */
    @ExceptionHandler(StudentVerificationAlreadySubmittedException.class)
    public ProblemDetail handleAlreadySubmitted(StudentVerificationAlreadySubmittedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/student-verification-already-submitted"));
        problem.setTitle("Already submitted");
        problem.setDetail("Your student verification is waiting for review or already approved.");
        problem.setProperty("code", "STUDENT_VERIFICATION_ALREADY_SUBMITTED");
        return problem;
    }

    /**
     * 409: the card number is held by another account. Says nothing about which: whose card it is
     * is not the caller's to learn.
     */
    @ExceptionHandler(StudentCardInUseException.class)
    public ProblemDetail handleCardInUse(StudentCardInUseException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/student-card-in-use"));
        problem.setTitle("That student card is in use");
        problem.setDetail("This student card number is already used by another account.");
        problem.setProperty("code", "STUDENT_CARD_IN_USE");
        return problem;
    }

    /** 404: the console named a submission that is not there, or a photograph already erased. */
    @ExceptionHandler(StudentVerificationNotFoundException.class)
    public ProblemDetail handleNotFound(StudentVerificationNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/student-verification-not-found"));
        problem.setTitle("No such student verification");
        problem.setDetail("That student verification, or that photograph of it, does not exist.");
        problem.setProperty("code", "STUDENT_VERIFICATION_NOT_FOUND");
        return problem;
    }

    /** 409: not decidable in the state it is in — usually a colleague got there first. */
    @ExceptionHandler(StudentVerificationNotDecidableException.class)
    public ProblemDetail handleNotDecidable(StudentVerificationNotDecidableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/student-verification-not-decidable"));
        problem.setTitle("Not decidable");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "STUDENT_VERIFICATION_NOT_DECIDABLE");
        return problem;
    }

    /** 503: no document encryption key on this deployment — the identity check's answer. */
    @ExceptionHandler(DocumentStorageUnavailableException.class)
    public ProblemDetail handleUnavailable(DocumentStorageUnavailableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/document-storage-unavailable"));
        problem.setTitle("Documents cannot be submitted");
        problem.setDetail("This deployment is not configured to accept verification documents.");
        problem.setProperty("code", "DOCUMENT_STORAGE_UNAVAILABLE");
        return problem;
    }

    /** 500: a stored photograph that will not open. See {@code VerificationExceptionHandler}. */
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
