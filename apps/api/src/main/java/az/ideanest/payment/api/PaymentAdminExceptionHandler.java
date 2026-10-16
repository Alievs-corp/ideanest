package az.ideanest.payment.api;

import az.ideanest.payment.application.BankRefundRefusedException;
import az.ideanest.payment.application.PlanRefundRefusedException;
import az.ideanest.payment.application.DisputeAlreadyResolvedException;
import az.ideanest.payment.application.DisputeNotFoundException;
import az.ideanest.payment.application.NotADisputeOutcomeException;
import az.ideanest.payment.application.NothingToRefundException;
import az.ideanest.payment.application.NothingToSubmitException;
import az.ideanest.payment.application.RefundExceedsCollectionException;
import az.ideanest.payment.application.RefundReasonNotIssuableException;
import az.ideanest.payment.application.UnconfiguredProviderException;
import az.ideanest.shared.compliance.UnacceptableIbanException;
import az.ideanest.shared.money.CurrencyMismatchException;
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
        assignableTypes = {
            RefundController.class,
            DisputeController.class,
            ReconciliationController.class,
            RefundBankTransferController.class,
            PlanPaymentRefundController.class
        })
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

    /**
     * #399: a step of a refund paid by bank transfer, refused. The reason carries its own status and
     * code; {@code meta.subject} is the refund, pledge or ticket it is about.
     */
    /** #457: an unapplied plan payment cannot be returned that way. {@code code} is the reason. */
    @ExceptionHandler(PlanRefundRefusedException.class)
    public ProblemDetail handlePlanRefundRefused(PlanRefundRefusedException exception) {
        PlanRefundRefusedException.Reason reason = exception.reason();
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.valueOf(reason.status()));
        problem.setType(URI.create("https://ideanest.az/problems/plan-refund-"
                + reason.name().toLowerCase(java.util.Locale.ROOT).replace('_', '-')));
        problem.setTitle(reason.title());
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "PLAN_REFUND_" + reason.name());
        return problem;
    }

    @ExceptionHandler(BankRefundRefusedException.class)
    public ProblemDetail handleBankRefundRefused(BankRefundRefusedException exception) {
        BankRefundRefusedException.Reason reason = exception.reason();
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.valueOf(reason.status()));
        problem.setType(URI.create(
                "https://ideanest.az/problems/" + reason.name().toLowerCase(java.util.Locale.ROOT).replace('_', '-')));
        problem.setTitle(reason.title());
        problem.setProperty("code", reason.name());
        if (exception.subject() != null) {
            problem.setProperty("meta", Map.of("subject", exception.subject().toString()));
        }
        return problem;
    }

    /**
     * #399: 400, that is not an IBAN. {@code meta.defect} says what is wrong, from {@code Iban.Defect}'s
     * closed set, and — as for a creator's account — the refusal does not repeat what was typed.
     */
    @ExceptionHandler(UnacceptableIbanException.class)
    public ProblemDetail handleUnacceptableIban(UnacceptableIbanException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/malformed-iban"));
        problem.setTitle("That is not an IBAN");
        problem.setDetail("An IBAN is a country code, two check digits and the account, as the bank prints it.");
        problem.setProperty("code", "MALFORMED_IBAN");
        problem.setProperty("meta", Map.of("defect", exception.defect()));
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

    /** 400 for an outcome that is not one: {@code OPEN} or {@code UNDER_REVIEW}. */
    @ExceptionHandler(NotADisputeOutcomeException.class)
    public ProblemDetail handleNotAnOutcome(NotADisputeOutcomeException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/not-a-dispute-outcome"));
        problem.setTitle("Not an outcome");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "NOT_A_DISPUTE_OUTCOME");
        return problem;
    }

    /**
     * 409 for a dispute resolved a second time. {@code meta.state} is how it was resolved, so the console
     * can say which outcome stands.
     */
    @ExceptionHandler(DisputeAlreadyResolvedException.class)
    public ProblemDetail handleAlreadyResolved(DisputeAlreadyResolvedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/dispute-already-resolved"));
        problem.setTitle("Already resolved");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "DISPUTE_ALREADY_RESOLVED");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 400 for a refund asked for in a currency that is not the pledge's. {@code meta.currency} is the
     * pledge's, so the console can say which one it should have been; nothing is converted (§21.2).
     */
    @ExceptionHandler(CurrencyMismatchException.class)
    public ProblemDetail handleCurrencyMismatch(CurrencyMismatchException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/currency-mismatch"));
        problem.setTitle("Not the pledge's currency");
        problem.setDetail("A refund is made in the currency the pledge was paid in, " + exception.expected() + ".");
        problem.setProperty("code", "CURRENCY_MISMATCH");
        problem.setProperty("meta", Map.of("currency", exception.expected()));
        return problem;
    }

    /**
     * 400 for any other argument the service refused.
     *
     * <p>This used to answer every {@code IllegalArgumentException} as {@code NOT_A_DISPUTE_OUTCOME}, which
     * is how a refund in the wrong currency reached the refund screen as "not an outcome". The two that
     * have a meaning are handled above; anything else is a request the service could not use, said as such.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleIllegalArgument(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-request"));
        problem.setTitle("Invalid request");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_REQUEST");
        return problem;
    }
}
