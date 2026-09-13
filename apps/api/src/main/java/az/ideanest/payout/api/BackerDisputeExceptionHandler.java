package az.ideanest.payout.api;

import az.ideanest.payment.application.NothingToRefundException;
import az.ideanest.payment.application.RefundExceedsCollectionException;
import az.ideanest.payout.application.BackerDisputeNotFoundException;
import az.ideanest.payout.application.DisputeAlreadyDecidedException;
import az.ideanest.payout.application.DisputeRefundFailedException;
import az.ideanest.payout.application.DisputeWindowClosedException;
import az.ideanest.payout.application.NothingToDisputeException;
import java.net.URI;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** IDN-EXT-01 (#43): the dispute refusals. A missing capability is answered by the shared staff handling. */
@RestControllerAdvice(assignableTypes = BackerDisputeController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class BackerDisputeExceptionHandler {

    @ExceptionHandler(BackerDisputeNotFoundException.class)
    public ProblemDetail handleNotFound(BackerDisputeNotFoundException exception) {
        return problem(HttpStatus.NOT_FOUND, "dispute-not-found", "No such pledge or dispute", "DISPUTE_NOT_FOUND");
    }

    @ExceptionHandler(DisputeWindowClosedException.class)
    public ProblemDetail handleWindowClosed(DisputeWindowClosedException exception) {
        return problem(
                HttpStatus.CONFLICT,
                "dispute-window-closed",
                "A payment can be disputed only while the creator's payout is held and not yet sent",
                "DISPUTE_WINDOW_CLOSED");
    }

    @ExceptionHandler({NothingToDisputeException.class, NothingToRefundException.class, RefundExceedsCollectionException.class})
    public ProblemDetail handleNothing(RuntimeException exception) {
        return problem(
                HttpStatus.CONFLICT, "nothing-to-dispute", "This pledge has no payment left to refund", "NOTHING_TO_DISPUTE");
    }

    @ExceptionHandler(DisputeAlreadyDecidedException.class)
    public ProblemDetail handleDecided(DisputeAlreadyDecidedException exception) {
        return problem(
                HttpStatus.CONFLICT, "dispute-already-decided", "This dispute has already been decided", "DISPUTE_ALREADY_DECIDED");
    }

    @ExceptionHandler(DisputeRefundFailedException.class)
    public ProblemDetail handleRefundFailed(DisputeRefundFailedException exception) {
        return problem(
                HttpStatus.CONFLICT,
                "dispute-refund-failed",
                "The refund did not go through; the dispute stays open",
                "DISPUTE_REFUND_FAILED");
    }

    private static ProblemDetail problem(HttpStatus status, String type, String title, String code) {
        ProblemDetail problem = ProblemDetail.forStatus(status);
        problem.setType(URI.create("https://ideanest.az/problems/" + type));
        problem.setTitle(title);
        problem.setProperty("code", code);
        return problem;
    }
}
