package az.ideanest.payout.api;

import az.ideanest.payment.application.NoPayoutProviderException;
import az.ideanest.payment.application.PayoutReferenceTakenException;
import az.ideanest.payout.application.CampaignAlreadyPaidOutException;
import az.ideanest.payout.application.NothingToPayException;
import az.ideanest.payout.application.PayoutAlreadyInFlightException;
import az.ideanest.payout.application.CreatorNotVerifiedException;
import az.ideanest.payout.application.PayoutDestinationNotVerifiedException;
import az.ideanest.payout.application.PayoutDestinationProviderMismatchException;
import az.ideanest.payout.application.PayoutNotApprovableException;
import az.ideanest.payout.application.PayoutNotFoundException;
import az.ideanest.payout.application.PayoutNotSendableException;
import az.ideanest.payout.application.PayoutSendUnconfirmedException;
import az.ideanest.payout.application.PayoutSignaturesShortException;
import az.ideanest.payout.application.UnknownPayoutCampaignException;
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
 * AD-05's payout refusals — issues #69, #306, #398 and #182.
 *
 * <p>One handler per refusal rather than one over a shared supertype, and that is deliberate: each
 * carries a different {@code code} and leads the reader to a different next action. A base
 * class would invite an advice that caught it and flattened all of them into "the payout
 * could not be processed", which is the sentence support tickets are made of.
 */
@RestControllerAdvice(assignableTypes = PayoutController.class)
public class PayoutExceptionHandler {

    @ExceptionHandler(NotAModeratorException.class)
    public ProblemDetail handleNotStaff(NotAModeratorException exception) {
        return StaffRefusals.notStaff(exception);
    }

    @ExceptionHandler(InsufficientStaffCapabilityException.class)
    public ProblemDetail handleInsufficient(InsufficientStaffCapabilityException exception) {
        return StaffRefusals.insufficient(exception);
    }

    /** 404 for a payout identifier that names nothing. */
    @ExceptionHandler(PayoutNotFoundException.class)
    public ProblemDetail handleNotFound(PayoutNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/payout-not-found"));
        problem.setTitle("No such payout");
        problem.setDetail("No payout with that identifier.");
        problem.setProperty("code", "PAYOUT_NOT_FOUND");
        return problem;
    }

    /** 404 for a campaign that does not exist. */
    @ExceptionHandler(UnknownPayoutCampaignException.class)
    public ProblemDetail handleUnknownCampaign(UnknownPayoutCampaignException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-found"));
        problem.setTitle("No such campaign");
        problem.setDetail("No campaign with that identifier.");
        problem.setProperty("code", "PROJECT_NOT_FOUND");
        return problem;
    }

    /**
     * 409 when the campaign already has a payout on its way.
     *
     * <p>The existing payout's identifier travels in {@code meta}, because the next thing
     * the reader wants is to open it rather than to try again.
     */
    @ExceptionHandler(PayoutAlreadyInFlightException.class)
    public ProblemDetail handleInFlight(PayoutAlreadyInFlightException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-already-in-flight"));
        problem.setTitle("A payout is already in flight");
        problem.setDetail("This campaign already has a payout waiting. Open that one rather than starting another.");
        problem.setProperty("code", "PAYOUT_ALREADY_IN_FLIGHT");
        problem.setProperty("meta", Map.of("payoutId", exception.existingPayoutId().toString()));
        return problem;
    }

    /** 409 when the campaign has already been paid out — #182. The payout that paid it travels in {@code meta}. */
    @ExceptionHandler(CampaignAlreadyPaidOutException.class)
    public ProblemDetail handleAlreadyPaidOut(CampaignAlreadyPaidOutException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/campaign-already-paid-out"));
        problem.setTitle("Campaign already paid out");
        problem.setDetail("This campaign has already been paid out. A campaign is paid out once.");
        problem.setProperty("code", "CAMPAIGN_ALREADY_PAID_OUT");
        problem.setProperty("meta", Map.of("payoutId", exception.paidPayoutId().toString()));
        return problem;
    }

    /**
     * 409 when a payout whose send went unanswered is cancelled, or its campaign priced again — #184's
     * review.
     */
    @ExceptionHandler(PayoutSendUnconfirmedException.class)
    public ProblemDetail handleSendUnconfirmed(PayoutSendUnconfirmedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-send-unconfirmed"));
        problem.setTitle("This payout may already have been sent");
        problem.setDetail(
                "The provider did not answer a send, so the money may have moved. Send it again under the same"
                        + " key, or settle it from the provider's statement as sent or not sent.");
        problem.setProperty("code", "PAYOUT_SEND_UNCONFIRMED");
        return problem;
    }

    /** 409 when the statement's reference is already on a settled transaction — #184's review. */
    @ExceptionHandler(PayoutReferenceTakenException.class)
    public ProblemDetail handleReferenceTaken(PayoutReferenceTakenException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-reference-taken"));
        problem.setTitle("That provider reference is already recorded");
        problem.setDetail("Another settled transaction carries this reference. Check the statement's reference again.");
        problem.setProperty("code", "PAYOUT_REFERENCE_TAKEN");
        return problem;
    }

    /** 409 when there is nothing left to pay. */
    @ExceptionHandler(NothingToPayException.class)
    public ProblemDetail handleNothingToPay(NothingToPayException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/nothing-to-pay"));
        problem.setTitle("Nothing to pay out");
        problem.setDetail("After fees and refunds this campaign has nothing left to send.");
        problem.setProperty("code", "NOTHING_TO_PAY");
        return problem;
    }

    /**
     * 409 when the payout is not waiting for a signature.
     *
     * <p>The state travels, because the two causes lead somewhere different: still inside
     * its hold is a payout to come back to, and already sent is one somebody else handled.
     */
    /**
     * <strong>409: the platform has not verified who this creator is.</strong>
     *
     * <p>409 rather than 403, and the distinction is worth having. 403 would say the operator
     * may not do this; they may, and on a different day the same request from the same person
     * succeeds. What is wrong is the state of something else, which is what 409 means.
     *
     * <p>{@code meta.standing} carries which of #431's eight standings, because a screen that
     * said only "not verified" would leave a finance operator unable to tell a creator who has
     * never been asked from one whose documents are sitting in their own queue. The creator has
     * already been asked for whatever is missing by the time this is thrown.
     */
    @ExceptionHandler(CreatorNotVerifiedException.class)
    public ProblemDetail handleCreatorNotVerified(CreatorNotVerifiedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/creator-not-verified"));
        problem.setTitle("This creator's identity has not been verified");
        problem.setDetail("The payout waits until it is. The creator has been asked for what is missing.");
        problem.setProperty("code", "CREATOR_NOT_VERIFIED");
        problem.setProperty(
                "meta",
                Map.of(
                        "standing", exception.standing().name(),
                        "creator", exception.creatorId().toString()));
        return problem;
    }

    /**
     * <strong>409: nobody has confirmed where this creator is paid</strong> — part of #432.
     *
     * <p>{@code CREATOR_NOT_VERIFIED}'s status and its argument, one question along: the
     * operator may do this, and the same request from the same person succeeds once the
     * destination is confirmed. What is wrong is the state of something else.
     *
     * <p>Its own code rather than a second {@code CREATOR_NOT_VERIFIED}, because the two send
     * the reader to different screens. Identity is a document queue; this is a creator who has
     * not said where they bank, or an account waiting on a reviewer, and
     * {@code meta.standing} says which.
     */
    @ExceptionHandler(PayoutDestinationNotVerifiedException.class)
    public ProblemDetail handleDestinationNotVerified(PayoutDestinationNotVerifiedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-destination-not-verified"));
        problem.setTitle("This creator's payout destination is not confirmed");
        problem.setDetail("Money goes only to an account the creator supplied and somebody confirmed.");
        problem.setProperty("code", "PAYOUT_DESTINATION_NOT_VERIFIED");
        problem.setProperty(
                "meta",
                Map.of(
                        "standing", exception.standing().name(),
                        "creator", exception.creatorId().toString()));
        return problem;
    }

    /**
     * <strong>409: the destination on file belongs to a different provider</strong> — #432.
     *
     * <p>Separate from the refusal above because nobody has done anything wrong and there is
     * nothing for a reviewer to look at. A token is readable only by the provider that issued
     * it, so a deployment that changed provider needs the creator to file the account again —
     * and {@code meta.sendingThrough} names the one it has to be filed with.
     */
    @ExceptionHandler(PayoutDestinationProviderMismatchException.class)
    public ProblemDetail handleDestinationProvider(PayoutDestinationProviderMismatchException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-destination-provider-mismatch"));
        problem.setTitle("The destination was issued by a different provider");
        problem.setDetail("This creator has to file their account again with the provider now in use.");
        problem.setProperty("code", "PAYOUT_DESTINATION_PROVIDER_MISMATCH");
        problem.setProperty(
                "meta",
                Map.of(
                        "sendingThrough", exception.sendingThrough(),
                        "creator", exception.creatorId().toString()));
        return problem;
    }

    @ExceptionHandler(PayoutNotApprovableException.class)
    public ProblemDetail handleNotApprovable(PayoutNotApprovableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-not-approvable"));
        problem.setTitle("Not waiting for approval");
        problem.setDetail("This payout is " + exception.state() + " and is not waiting for a signature.");
        problem.setProperty("code", "PAYOUT_NOT_APPROVABLE");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 409 when the payout cannot be sent.
     *
     * <p>Also the answer when the figures moved underneath it — a refund issued since the
     * calculation. The payout has been cancelled by then, so the console's next step is to
     * calculate a fresh one, and the state in {@code meta} says so.
     */
    @ExceptionHandler(PayoutNotSendableException.class)
    public ProblemDetail handleNotSendable(PayoutNotSendableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-not-sendable"));
        problem.setTitle("Cannot be sent");
        problem.setDetail("This payout is " + exception.state()
                + ". If the figures changed since it was calculated, work out a new one.");
        problem.setProperty("code", "PAYOUT_NOT_SENDABLE");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 409 when the row says approved and the signatures do not reach the bar - issue #398.
     *
     * <p>Separate from {@code PAYOUT_NOT_SENDABLE} because it is separately actionable:
     * the payout needs a signature, not a recalculation, and the counts travel in
     * {@code meta} so the console can say which of the two it is short by.
     */
    @ExceptionHandler(PayoutSignaturesShortException.class)
    public ProblemDetail handleSignaturesShort(PayoutSignaturesShortException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/payout-signatures-short"));
        problem.setTitle("Not enough signatures");
        problem.setDetail("This payout has " + exception.signatures() + " of the "
                + exception.required() + " signatures it requires, and cannot be sent.");
        problem.setProperty("code", "PAYOUT_SIGNATURES_SHORT");
        problem.setProperty(
                "meta",
                Map.of(
                        "signatures", String.valueOf(exception.signatures()),
                        "required", String.valueOf(exception.required())));
        return problem;
    }

    /**
     * 503 when the deployment has no provider that can send money.
     *
     * <p>Not 500: it is a deployment fact rather than a defect, and it becomes untrue the
     * moment an adapter is configured.
     */
    @ExceptionHandler(NoPayoutProviderException.class)
    public ProblemDetail handleNoProvider(NoPayoutProviderException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/no-payout-provider"));
        problem.setTitle("No provider configured");
        problem.setDetail("This deployment has no payment provider configured to send a payout.");
        problem.setProperty("code", "NO_PAYOUT_PROVIDER");
        return problem;
    }
}
