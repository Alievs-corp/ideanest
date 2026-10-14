package az.ideanest.community.api;

import az.ideanest.community.application.BlockTargetNotFoundException;
import az.ideanest.community.application.CannotBlockStaffException;
import az.ideanest.community.application.CannotBlockYourselfException;
import az.ideanest.community.application.InvalidSignalCursorException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What the blocking endpoints refuse, as RFC 9457 problem details (§10.4).
 *
 * <p>Scoped to {@link BlockController}, for {@code CommentExceptionHandler}'s reason. The 404
 * and the cursor refusal are {@code BackerSignalExceptionHandler}'s bodies word for word, so a
 * client that already handles them for following handles them here.
 */
@RestControllerAdvice(assignableTypes = BlockController.class)
public class BlockExceptionHandler {

    /**
     * 404 for an account that does not exist and for one that has been closed — one answer for
     * both, which §17.4 requires.
     */
    @ExceptionHandler(BlockTargetNotFoundException.class)
    public ProblemDetail handleTargetNotFound(BlockTargetNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/user-not-found"));
        problem.setTitle("No such account");
        problem.setDetail("There is no account at that address.");
        problem.setProperty("code", "USER_NOT_FOUND");
        return problem;
    }

    /** 422 for blocking yourself: a real account, and a relationship that means nothing. */
    @ExceptionHandler(CannotBlockYourselfException.class)
    public ProblemDetail handleSelfBlock(CannotBlockYourselfException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/cannot-block-yourself"));
        problem.setTitle("Cannot block yourself");
        problem.setDetail("An account cannot block itself.");
        problem.setProperty("code", "CANNOT_BLOCK_YOURSELF");
        return problem;
    }

    /**
     * 422 for blocking a member of staff. {@code CannotBlockStaffException} says what this
     * reveals and why refusing is still the honest answer; the detail points at reporting,
     * which stays open.
     */
    @ExceptionHandler(CannotBlockStaffException.class)
    public ProblemDetail handleStaffBlock(CannotBlockStaffException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/cannot-block-staff"));
        problem.setTitle("Cannot block this account");
        problem.setDetail("Platform staff cannot be blocked. You can report the account instead.");
        problem.setProperty("code", "CANNOT_BLOCK_STAFF");
        return problem;
    }

    /** 400 for a page cursor this endpoint did not issue. */
    @ExceptionHandler(InvalidSignalCursorException.class)
    public ProblemDetail handleInvalidCursor(InvalidSignalCursorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-cursor"));
        problem.setTitle("Invalid cursor");
        problem.setDetail("That page cursor is not one this endpoint issued.");
        problem.setProperty("code", "INVALID_CURSOR");
        return problem;
    }
}
