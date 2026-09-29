package az.ideanest.payment.api;

import az.ideanest.payment.application.DisputeNotFoundException;
import az.ideanest.payment.application.NothingToRefundException;
import az.ideanest.payment.application.NothingToSubmitException;
import az.ideanest.payment.application.RefundExceedsCollectionException;
import az.ideanest.payment.application.RefundReasonNotIssuableException;
import az.ideanest.payment.application.UnconfiguredProviderException;
import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import java.net.URI;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * AD-05's, AD-06's and AD-07's refusals — issues #106, #307 and #308.
 *
 * <p>One advice over the three controllers, because their screens are one workflow: a
 * chargeback is often answered by issuing a refund, a reconciliation finding is what sends
 * somebody to the payment log, and a console handling one meets the refusals of the
 * others. All three refuse in the same two ways — not staff, and staff without
 * {@code VIEW_FINANCE} — so a second advice would be a second copy of those two handlers.
 *
 * <p>Scoped to those two rather than applied globally, for the reason every advice in this
 * service gives — and deliberately not extended to {@code ProviderWebhookController},
 * which has its own and whose caller is a provider rather than a person.
 */
@RestControllerAdvice(
        assignableTypes = {RefundController.class, DisputeController.class, ReconciliationController.class})
public class PaymentAdminExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * 409 when the refund would return more than was taken.
     *
     * <p>The remaining amount travels in {@code meta}, because the usual cause is a second
     * partial refund issued from a page loaded before the first. Telling somebody "too
     * much" without the number means they try again with a guess.
     */
    @ExceptionHandler(RefundExceedsCollectionException.class)
    public ProblemDetail handleOverdraft(RefundExceedsCollectionException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/refund-exceeds-collection"));
        problem.setTitle("More than was collected");
        problem.setDetail("Only " + exception.remaining() + " is left to refund on this pledge.");
        problem.setProperty("code", "REFUND_EXCEEDS_COLLECTION");
        problem.setProperty("meta", Map.of("remaining", exception.remaining().toString()));
        return problem;
    }

    /**
     * 409 for a pledge with no settled charge.
     *
     * <p>Not 404: the pledge exists, and a 404 would send somebody looking for a typo in
     * an identifier they pasted from the screen in front of them.
     */
    @ExceptionHandler(NothingToRefundException.class)
    public ProblemDetail handleNothingToRefund(NothingToRefundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/nothing-to-refund"));
        problem.setTitle("Nothing was collected");
        problem.setDetail("This pledge has no settled charge, so there is nothing to send back.");
        problem.setProperty("code", "NOTHING_TO_REFUND");
        return problem;
    }

    /** 400 for a refund asked for under {@code CHARGEBACK}, which only a lost dispute records (#175). */
    @ExceptionHandler(RefundReasonNotIssuableException.class)
    public ProblemDetail handleNotIssuable(RefundReasonNotIssuableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/refund-reason-not-issuable"));
        problem.setTitle("Not a reason a refund is sent for");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "REFUND_REASON_NOT_ISSUABLE");
        return problem;
    }

    /** 404 for a dispute identifier that names nothing. */
    @ExceptionHandler(DisputeNotFoundException.class)
    public ProblemDetail handleNoDispute(DisputeNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/dispute-not-found"));
        problem.setTitle("No such dispute");
        problem.setDetail("No dispute with that identifier.");
        problem.setProperty("code", "DISPUTE_NOT_FOUND");
        return problem;
    }

    /** 409 when the case has already been answered with everything on it. */
    @ExceptionHandler(NothingToSubmitException.class)
    public ProblemDetail handleNothingToSubmit(NothingToSubmitException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/nothing-to-submit"));
        problem.setTitle("Already answered");
        problem.setDetail("Every piece of evidence on this case has already been sent.");
        problem.setProperty("code", "NOTHING_TO_SUBMIT");
        return problem;
    }

    /**
     * 503 when the provider that took the charge is not configured on this deployment.
     *
     * <p>A refund is submitted to the provider that made the original authorisation, so a
     * deployment that has since dropped an adapter cannot reverse what that adapter took.
     * 503 rather than 500 because it is a deployment fact rather than a defect, and
     * because it becomes true again when the adapter is configured.
     */
    @ExceptionHandler(UnconfiguredProviderException.class)
    public ProblemDetail handleUnconfigured(UnconfiguredProviderException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/provider-unconfigured"));
        problem.setTitle("Provider not configured");
        problem.setDetail("The provider that took this charge is not configured on this deployment.");
        problem.setProperty("code", "PROVIDER_UNCONFIGURED");
        return problem;
    }

    /**
     * 400 for an outcome that is not one.
     *
     * <p>{@code Dispute.resolved} refuses a state that is not terminal. Narrow enough to
     * catch here: neither controller does arithmetic or parsing that could throw this for
     * another reason.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleNotAnOutcome(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-dispute-outcome"));
        problem.setTitle("Not an outcome");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "NOT_A_DISPUTE_OUTCOME");
        return problem;
    }
}
