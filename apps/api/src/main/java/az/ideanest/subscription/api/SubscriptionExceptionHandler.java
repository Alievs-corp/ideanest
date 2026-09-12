package az.ideanest.subscription.api;

import az.ideanest.staff.api.StaffRefusals;
import az.ideanest.staff.application.InsufficientStaffCapabilityException;
import az.ideanest.staff.application.NotAModeratorException;
import az.ideanest.subscription.application.AlreadySubscribedException;
import az.ideanest.subscription.application.InvalidPaymentCursorException;
import az.ideanest.subscription.application.InvalidRevenuePeriodException;
import az.ideanest.subscription.application.NoSubscriptionException;
import az.ideanest.subscription.application.PaymentNotYetReceivedException;
import az.ideanest.subscription.application.PlanCodeTakenException;
import az.ideanest.subscription.application.PlanNotOnSaleException;
import az.ideanest.subscription.application.SubscriptionNotAwaitingPaymentException;
import az.ideanest.subscription.application.SubscriptionNotFoundException;
import az.ideanest.subscription.application.UnknownPlanException;
import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * What the subscription endpoints refuse with — RFC 9457, as everything here is.
 *
 * <p>Scoped to the two controllers rather than global, for the reason every advice in this
 * service gives: an advice that catches {@code IllegalArgumentException} everywhere turns
 * a bug three modules away into a 400 that looks like the caller's fault.
 *
 * <p>The two staff refusals delegate to {@link StaffRefusals}, so that a console screen
 * branching on {@code INSUFFICIENT_STAFF_CAPABILITY} meets the same body on every screen.
 *
 * <p><strong>Every refusal carries a {@code code}.</strong> The pricing page and the
 * console branch on it — a client parsing a human sentence to decide what to draw is a
 * client that breaks when the sentence is translated, and §21.1 has four languages.
 */
@RestControllerAdvice(
        assignableTypes = {
            SubscriptionController.class,
            AdminSubscriptionController.class,
            SubscriptionRevenueController.class
        })
public class SubscriptionExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 404: the plan identifier names nothing. */
    @ExceptionHandler(UnknownPlanException.class)
    public ProblemDetail handleUnknownPlan(UnknownPlanException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/plan-not-found"));
        problem.setTitle("No such plan");
        problem.setDetail("That subscription plan does not exist.");
        problem.setProperty("code", "PLAN_NOT_FOUND");
        return problem;
    }

    /**
     * 409: the plan exists and is not on sale.
     *
     * <p>Distinct from a 404 because it leads somewhere different. A creator meets this by
     * leaving the pricing page open across an operator's repricing, and the fix is to
     * reload — whereas a 404 means the link itself was wrong.
     */
    @ExceptionHandler(PlanNotOnSaleException.class)
    public ProblemDetail handleNotOnSale(PlanNotOnSaleException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/plan-not-on-sale"));
        problem.setTitle("That plan is no longer offered");
        problem.setDetail("The plans changed while this page was open. Reload to see what is available now.");
        problem.setProperty("code", "PLAN_NOT_ON_SALE");
        return problem;
    }

    /**
     * 409: the account already holds one.
     *
     * <p>{@code awaitingPayment} is on the body because the two cases send a creator to
     * different places — one waits for a transfer to be recorded, the other cancels first.
     */
    @ExceptionHandler(AlreadySubscribedException.class)
    public ProblemDetail handleAlreadySubscribed(AlreadySubscribedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/already-subscribed"));
        problem.setTitle("You already have a plan");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "ALREADY_SUBSCRIBED");
        problem.setProperty("awaitingPayment", exception.awaitingPayment());
        return problem;
    }

    /** 404: nothing to cancel. */
    @ExceptionHandler(NoSubscriptionException.class)
    public ProblemDetail handleNoSubscription(NoSubscriptionException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/no-subscription"));
        problem.setTitle("There is nothing to cancel");
        problem.setDetail("This account holds no subscription.");
        problem.setProperty("code", "NO_SUBSCRIPTION");
        return problem;
    }

    /** 404: the console named a subscription that is not there. */
    @ExceptionHandler(SubscriptionNotFoundException.class)
    public ProblemDetail handleNotFound(SubscriptionNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/subscription-not-found"));
        problem.setTitle("No such subscription");
        problem.setDetail("That subscription does not exist.");
        problem.setProperty("code", "SUBSCRIPTION_NOT_FOUND");
        return problem;
    }

    /**
     * 409: a colleague recorded the payment first.
     *
     * <p>The state is on the body, because "it is already active" and "somebody cancelled
     * it" are the two answers and they mean opposite things to the person holding the bank
     * statement.
     */
    @ExceptionHandler(SubscriptionNotAwaitingPaymentException.class)
    public ProblemDetail handleNotPending(SubscriptionNotAwaitingPaymentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/subscription-not-pending"));
        problem.setTitle("That subscription is not waiting for payment");
        problem.setDetail("Its state changed while this page was open. Reload to see where it is now.");
        problem.setProperty("code", "SUBSCRIPTION_NOT_PENDING");
        problem.setProperty("state", exception.state().name());
        return problem;
    }

    /**
     * 400: the payment is dated in the future.
     *
     * <p>Its own refusal rather than {@code INVALID_PLAN}, because it is not about the
     * plan and the console shows it beside a date field. {@link
     * PaymentNotYetReceivedException} argues why this is refused instead of quietly
     * moved to now.
     */
    @ExceptionHandler(PaymentNotYetReceivedException.class)
    public ProblemDetail handleFuturePayment(PaymentNotYetReceivedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/payment-not-yet-received"));
        problem.setTitle("That date has not happened yet");
        problem.setDetail("A payment cannot be recorded as arriving in the future. Check the date.");
        problem.setProperty("code", "PAYMENT_NOT_YET_RECEIVED");
        return problem;
    }

    /**
     * 400: a revenue period the report will not answer for.
     *
     * <p>Ends the wrong way round, or longer than {@code RevenuePeriod.MAX_DAYS}. Its own
     * code rather than {@code INVALID_PLAN}, because the console shows it beside a date
     * picker — and refused rather than clamped, because a total for a window nobody asked
     * about is a number somebody will act on anyway.
     */
    @ExceptionHandler(InvalidRevenuePeriodException.class)
    public ProblemDetail handleInvalidPeriod(InvalidRevenuePeriodException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-revenue-period"));
        problem.setTitle("That period cannot be reported on");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_REVENUE_PERIOD");
        return problem;
    }

    /**
     * 400: a page cursor this endpoint did not issue.
     *
     * <p>Not the first page again. A client paging wrongly that was quietly handed the top
     * of the list would look like one that had reached the end, and on a revenue list that
     * is a page counted twice.
     */
    @ExceptionHandler(InvalidPaymentCursorException.class)
    public ProblemDetail handleInvalidCursor(InvalidPaymentCursorException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-cursor"));
        problem.setTitle("That page is not available");
        problem.setDetail("The list changed or the link is not one this page issued. Start from the first page.");
        problem.setProperty("code", "INVALID_CURSOR");
        return problem;
    }

    /** 409: two administrators added the same plan code. */
    @ExceptionHandler(PlanCodeTakenException.class)
    public ProblemDetail handleCodeTaken(PlanCodeTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/plan-code-taken"));
        problem.setTitle("That code is in use");
        problem.setDetail("A plan already uses the code " + exception.code()
                + ". If it was retired, list it again rather than adding a second one.");
        problem.setProperty("code", "PLAN_CODE_TAKEN");
        return problem;
    }

    /**
     * 400 for a plan the domain refused: a code of the wrong shape, a negative price, a
     * limit of zero.
     *
     * <p>The entity's constructors throw before the row reaches V62's {@code CHECK}
     * constraints. Both exist, for {@code FeeExceptionHandler}'s reason: the constraint
     * holds against a support script, and the constructor gives an administrator a
     * sentence rather than a stack trace.
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleInvalid(IllegalArgumentException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-plan"));
        problem.setTitle("That plan cannot be saved");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "INVALID_PLAN");
        return problem;
    }
}
