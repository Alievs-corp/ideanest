package az.ideanest.compliance.api;

import az.ideanest.compliance.application.DestinationNameMismatchException;
import az.ideanest.compliance.application.InvalidOverrideWindowException;
import az.ideanest.compliance.application.SelfVerifiedDestinationException;
import az.ideanest.compliance.application.UnknownDestinationProviderException;
import az.ideanest.compliance.application.UnknownPayoutDestinationException;
import az.ideanest.compliance.application.UnknownOverrideException;
import az.ideanest.compliance.domain.MalformedTaxIdentifierException;
import az.ideanest.compliance.domain.SelfGrantedOverrideException;
import az.ideanest.payment.application.PayoutCardsUnavailableException;
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
 * What the override endpoints refuse with — RFC 9457, as everything here is.
 *
 * <p>Scoped to the one controller rather than global, for the reason every advice in this
 * service gives: an advice that catches a broad exception everywhere turns a bug three modules
 * away into a 4xx that looks like the caller's fault.
 *
 * <p><strong>Every refusal carries a {@code code}.</strong> The console branches on it — a
 * client parsing a human sentence to decide what to draw is a client that breaks when the
 * sentence is translated, and §21.1 has four languages.
 */
@RestControllerAdvice(
        assignableTypes = {
            ComplianceOverrideController.class,
            MyLegalSubjectController.class,
            AdminLegalSubjectController.class,
            MyPayoutDestinationController.class,
            AdminPayoutDestinationController.class
        })
public class ComplianceExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /**
     * <strong>403: an account may not waive a rule for itself.</strong>
     *
     * <p>403 rather than 400, and the distinction is the usual one: the request is
     * well-formed and a different account could make it. It is the caller who is refused,
     * which is what 403 means.
     *
     * <p>Reached only when the token's subject is the path's account. The database refuses it
     * again — V66's constraint is the guarantee — and this is the readable half.
     */
    @ExceptionHandler(SelfGrantedOverrideException.class)
    public ProblemDetail handleSelfGrant(SelfGrantedOverrideException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/self-granted-override"));
        problem.setTitle("Nobody overrides a rule for their own account");
        problem.setDetail("Ask a colleague who holds the capability to grant this one.");
        problem.setProperty("code", "SELF_GRANTED_OVERRIDE");
        problem.setProperty(
                "meta",
                Map.of(
                        "requirement", exception.requirement().name(),
                        "account", exception.subjectUserId().toString()));
        return problem;
    }

    /**
     * <strong>400: the window is in the past or longer than the ceiling.</strong>
     *
     * <p>400 because it is the request's fault and a different date would be accepted, and
     * {@code meta.longestSeconds} so that the screen can say what would have been — an error
     * that says "no" without saying "up to ninety days" is one the operator answers by
     * guessing.
     */
    @ExceptionHandler(InvalidOverrideWindowException.class)
    public ProblemDetail handleWindow(InvalidOverrideWindowException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/invalid-override-window"));
        problem.setTitle("That is not a window an override may have");
        problem.setDetail("An override ends in the future, and no later than the ceiling below.");
        problem.setProperty("code", "INVALID_OVERRIDE_WINDOW");
        problem.setProperty(
                "meta",
                Map.of(
                        "expiresAt", exception.expiresAt().toString(),
                        "now", exception.now().toString(),
                        "longestSeconds", exception.longest().toSeconds()));
        return problem;
    }

    /**
     * <strong>503: no provider can register a payout card now</strong> — IDN-EXT-01 (#44).
     *
     * <p>Nothing was recorded, so trying again later is the whole answer. The detail does not say
     * which of the three causes it was: a creator can act on none of them.
     */
    @ExceptionHandler(PayoutCardsUnavailableException.class)
    public ProblemDetail handlePayoutCardsUnavailable(PayoutCardsUnavailableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/payout-cards-unavailable"));
        problem.setTitle("A payout card cannot be registered right now");
        problem.setDetail("Nothing was recorded. Try again later.");
        problem.setProperty("code", "PAYOUT_CARDS_UNAVAILABLE");
        return problem;
    }

    /**
     * <strong>400: that is not the shape of a VÖEN.</strong>
     *
     * <p>The refusal repeats what was typed, because a creator who is told only "invalid" has
     * to retype the field to find out what they entered. It says nothing about whether the
     * number names a real company — {@code TaxIdentifier} explains at length why the platform
     * does not know and must not appear to.
     */
    @ExceptionHandler(MalformedTaxIdentifierException.class)
    public ProblemDetail handleMalformedTaxIdentifier(MalformedTaxIdentifierException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/malformed-tax-identifier"));
        problem.setTitle("That is not the shape of a VÖEN");
        problem.setDetail("A VÖEN is ten digits.");
        problem.setProperty("code", "MALFORMED_TAX_IDENTIFIER");
        problem.setProperty("meta", Map.of("typed", exception.typed() == null ? "" : exception.typed()));
        return problem;
    }

    /** <strong>404: no such override.</strong> The console's cue to reload the account. */
    @ExceptionHandler(UnknownOverrideException.class)
    public ProblemDetail handleUnknown(UnknownOverrideException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-override"));
        problem.setTitle("There is no such override");
        problem.setDetail("It may have been withdrawn by somebody else. Reload the account.");
        problem.setProperty("code", "UNKNOWN_OVERRIDE");
        problem.setProperty("meta", Map.of("override", exception.overrideId().toString()));
        return problem;
    }

    /**
     * <strong>404: the creator has filed no payout destination.</strong>
     *
     * <p>Reached when a reviewer acts on a row that is not there, which in practice means a
     * screen left open while the creator replaced or the account was erased. The console's cue
     * is to reload rather than to retry.
     */
    @ExceptionHandler(UnknownPayoutDestinationException.class)
    public ProblemDetail handleUnknownDestination(UnknownPayoutDestinationException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/payout-destination-not-found"));
        problem.setTitle("No payout destination on file");
        problem.setDetail("This creator has not said where they are paid. Reload the account.");
        problem.setProperty("code", "PAYOUT_DESTINATION_NOT_FOUND");
        problem.setProperty("meta", Map.of("creator", exception.creatorId().toString()));
        return problem;
    }

    /**
     * <strong>403: nobody confirms their own bank account.</strong>
     *
     * <p>{@code SELF_GRANTED_OVERRIDE}'s status and its argument, on the control that decides
     * where money goes: the request is well-formed and a colleague could make it, so what is
     * refused is the caller.
     */
    @ExceptionHandler(SelfVerifiedDestinationException.class)
    public ProblemDetail handleSelfVerified(SelfVerifiedDestinationException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/self-verified-destination"));
        problem.setTitle("Nobody confirms their own payout destination");
        problem.setDetail("Ask a colleague who holds the capability to look at this one.");
        problem.setProperty("code", "SELF_VERIFIED_DESTINATION");
        problem.setProperty("meta", Map.of("account", exception.creatorId().toString()));
        return problem;
    }

    /**
     * <strong>409: the account holder is not the creator.</strong>
     *
     * <p>409 rather than 403: the reviewer may do this, and the same request succeeds once the
     * two names agree. What is wrong is the state of the row, which is what 409 means.
     *
     * <p>{@code meta.holderName} travels because the reviewer is deciding which of two names is
     * wrong, and a refusal that withheld the one it refused on would send them to another
     * screen to find it. Both ways past this are in the detail — the creator corrects a name,
     * or an administrator grants #436's override — because a refusal with no route through it
     * is one somebody works around outside the system.
     */
    @ExceptionHandler(DestinationNameMismatchException.class)
    public ProblemDetail handleNameMismatch(DestinationNameMismatchException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/destination-name-mismatch"));
        problem.setTitle("The account is held by a differently named party");
        problem.setDetail("The creator corrects their legal name or their account, or an administrator "
                + "grants a bounded override.");
        problem.setProperty("code", "DESTINATION_NAME_MISMATCH");
        problem.setProperty(
                "meta",
                Map.of(
                        "creator", exception.creatorId().toString(),
                        "holderName", exception.holderName()));
        return problem;
    }

    /**
     * <strong>400: no payment provider is called that.</strong>
     *
     * <p>The value is echoed for {@code MALFORMED_TAX_IDENTIFIER}'s reason: a client told only
     * "invalid" has to reconstruct what it sent.
     */
    @ExceptionHandler(UnknownDestinationProviderException.class)
    public ProblemDetail handleUnknownProvider(UnknownDestinationProviderException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/unknown-payment-provider"));
        problem.setTitle("No payment provider is called that");
        problem.setDetail("The destination names a provider that is not one of §9.3's.");
        problem.setProperty("code", "UNKNOWN_PAYMENT_PROVIDER");
        problem.setProperty("meta", Map.of("provider", exception.provider() == null ? "" : exception.provider()));
        return problem;
    }
}
