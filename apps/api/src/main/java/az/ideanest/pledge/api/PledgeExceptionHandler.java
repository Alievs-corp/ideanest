package az.ideanest.pledge.api;

import az.ideanest.pledge.application.CampaignStillTakingPledgesException;
import az.ideanest.pledge.application.ContributionBelowRewardPriceException;
import az.ideanest.pledge.application.PledgeAlreadyExistsException;
import az.ideanest.pledge.application.PledgeNotDraftException;
import az.ideanest.pledge.application.BackerAgreementRequiredException;
import az.ideanest.pledge.application.PledgeCannotBeCancelledException;
import az.ideanest.pledge.application.PledgeDecreaseNotAllowedException;
import az.ideanest.pledge.application.PledgeNotEditableException;
import az.ideanest.pledge.application.PledgeNotFoundException;
import az.ideanest.pledge.application.PledgeNotSupplementableException;
import az.ideanest.pledge.application.PaymentPageUnavailableException;
import az.ideanest.pledge.application.ReservationExpiredException;
import az.ideanest.pledge.application.RewardSoldOutException;
import az.ideanest.pledge.application.ShippingDestinationUnpricedException;
import az.ideanest.pledge.application.SupplementNotAnIncreaseException;
import az.ideanest.pledge.application.UnknownRewardTierException;
import az.ideanest.project.application.ProjectNotAcceptingPledgesException;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.reward.application.RewardStock;
import java.net.URI;
import java.time.Clock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * The checkout's refusals, as RFC 9457 problem details.
 *
 * <p>Scoped to this module's controller rather than applied globally, for the reason
 * {@code RewardExceptionHandler} gives: an advice that catches a broad type across
 * the whole service turns a bug somewhere else into a tidy 4xx and hides it.
 *
 * <p>Every response carries a {@code code} as well as a status (§10.4). The status
 * tells a client how to behave and the code tells it what happened — this file
 * answers six different 409s, and a client that had to tell them apart by prose
 * would be matching on English.
 *
 * <p><strong>The idempotency refusals are deliberately not here.</strong>
 * {@code IDEMPOTENCY_KEY_REUSED} and its siblings belong to {@code shared}, which is
 * where the machinery lives, and they are answered by
 * {@code ApiExceptionHandler} — because #56's edits and epic #59's charges will raise
 * exactly the same four and must get exactly the same four bodies.
 */
@RestControllerAdvice(assignableTypes = PledgeController.class)
public class PledgeExceptionHandler {

    private final RewardStock stock;
    private final Clock clock;

    public PledgeExceptionHandler(RewardStock stock, Clock clock) {
        this.stock = stock;
        this.clock = clock;
    }

    /**
     * 409 for a tier with no places left, <strong>with what is left instead</strong>.
     *
     * <p>§10.4's example carries {@code availableAlternatives} and this is why: a
     * backer who reached the checkout has decided to give money, and a bare refusal
     * at that moment is a dead end. The alternatives are read here rather than in the
     * service because the service's transaction is being rolled back — the place it
     * tried to take has to go back — and a read inside it would be discarded with
     * everything else.
     */
    @ExceptionHandler(RewardSoldOutException.class)
    public ProblemDetail handleSoldOut(RewardSoldOutException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/reward-sold-out"));
        problem.setTitle("Reward tier exhausted");
        problem.setDetail("That reward has no remaining places.");
        problem.setProperty("code", "REWARD_SOLD_OUT");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("rewardTierId", exception.rewardTierId().toString());
        meta.put(
                "availableAlternatives",
                identifiers(stock.alternativesTo(exception.projectId(), exception.rewardTierId(), clock.instant())));
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 404 for a tier this campaign does not have, whether it was named as the reward
     * or as an add-on.
     *
     * <p>The same code the reward module answers with, because the fact is identical
     * and a client that already handles {@code REWARD_NOT_FOUND} should not need a
     * second branch for it. Not {@code REWARD_SOLD_OUT}: there is nothing to offer
     * instead of a tier that was never there, and telling a client the tier is full
     * would send it to poll for a place that will never appear.
     */
    @ExceptionHandler(UnknownRewardTierException.class)
    public ProblemDetail handleUnknownTier(UnknownRewardTierException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/reward-not-found"));
        problem.setTitle("No such reward");
        problem.setDetail("That reward tier is not part of this campaign.");
        problem.setProperty("code", "REWARD_NOT_FOUND");
        problem.setProperty("meta", Map.of("rewardTierId", exception.rewardTierId().toString()));
        return problem;
    }

    /**
     * 409 for a backer who already has a pledge on this campaign. §7.2's unique index.
     *
     * <p>The pledge they already have is in {@code meta}, because the client's next
     * move is to open it rather than to start a second checkout — and its state
     * decides which sentence to show: "you have a draft" and "you have already backed
     * this" are the same rule and very different things to be told.
     */
    @ExceptionHandler(PledgeAlreadyExistsException.class)
    public ProblemDetail handleAlreadyPledged(PledgeAlreadyExistsException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-already-exists"));
        problem.setTitle("Already backed");
        problem.setDetail("You already have a pledge on this campaign.");
        problem.setProperty("code", "PLEDGE_ALREADY_EXISTS");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("pledgeId", exception.pledgeId().toString());
        meta.put("state", exception.state().name());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 for a campaign that is not taking pledges.
     *
     * <p>Not a 404, unlike a draft campaign: this one launched, so its existence is
     * public and pretending otherwise would break every link anybody shared to it.
     * The state and the deadline are what let a client say "this ended on Tuesday"
     * rather than "not available".
     */
    @ExceptionHandler(ProjectNotAcceptingPledgesException.class)
    public ProblemDetail handleNotLive(ProjectNotAcceptingPledgesException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-live"));
        problem.setTitle("Campaign is not taking pledges");
        problem.setDetail("This campaign is not accepting pledges.");
        problem.setProperty("code", "PROJECT_NOT_LIVE");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("state", exception.state());
        meta.put("deadline", exception.deadline() == null ? null : exception.deadline().toString());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 404 for a campaign that does not exist, and for one this caller may not see.
     *
     * <p>Raised by the project module, which is the only place that decision is made,
     * and answered here with the body and the code that module uses.
     */
    @ExceptionHandler(ProjectNotFoundException.class)
    public ProblemDetail handleProjectNotFound(ProjectNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/project-not-found"));
        problem.setTitle("No such project");
        problem.setDetail("That project does not exist.");
        problem.setProperty("code", "PROJECT_NOT_FOUND");
        return problem;
    }

    /**
     * 422 for something posted to a country the creator never priced.
     *
     * <p>A 422 rather than a 400: every field is well formed and it is the
     * combination — this tier, to this country — that cannot be served. The
     * distinction is what lets a client put the message beside the destination
     * selector instead of reporting the whole checkout as malformed.
     */
    @ExceptionHandler(ShippingDestinationUnpricedException.class)
    public ProblemDetail handleUnpricedDestination(ShippingDestinationUnpricedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/shipping-destination-unpriced"));
        problem.setTitle("Destination not priced");
        problem.setDetail(exception.destinationCountry() == null
                ? "This selection has to be posted somewhere, so it needs a destination."
                : "The creator does not ship this reward to " + exception.destinationCountry() + ".");
        problem.setProperty("code", "SHIPPING_DESTINATION_UNPRICED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("rewardTierId", exception.rewardTierId().toString());
        meta.put("shippingCountry", exception.destinationCountry());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 422 for a contribution below the price of the reward it is for.
     *
     * <p>Both amounts are in {@code meta}, as {@code Money}, so the client can reload
     * the tier and say what it now costs. §4.5's PL-03 is support <em>above</em> the
     * price, so this is a client working from one that changed underneath it.
     */
    @ExceptionHandler(ContributionBelowRewardPriceException.class)
    public ProblemDetail handleContributionTooLow(ContributionBelowRewardPriceException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/contribution-below-reward-price"));
        problem.setTitle("Contribution below the reward's price");
        problem.setDetail("This reward costs more than the amount offered.");
        problem.setProperty("code", "CONTRIBUTION_BELOW_REWARD_PRICE");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("contribution", exception.contribution());
        meta.put("rewardPrice", exception.rewardPrice());
        problem.setProperty("meta", meta);
        return problem;
    }

    /** 404 for a pledge that does not exist, and for somebody else's. See {@code PledgeNotFoundException}. */
    @ExceptionHandler(PledgeNotFoundException.class)
    public ProblemDetail handlePledgeNotFound(PledgeNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-not-found"));
        problem.setTitle("No such pledge");
        problem.setDetail("That pledge does not exist.");
        problem.setProperty("code", "PLEDGE_NOT_FOUND");
        return problem;
    }

    /**
     * 409 for confirming a pledge that has moved on from {@code DRAFT}.
     *
     * <p>A retried confirmation with the same key never reaches here — it is replayed
     * with its original answer. This is a different request asking for a transition
     * §6.2 does not have, and the state is in {@code meta} because the client's next
     * move depends on it: a confirmed pledge is shown, an expired one is started
     * again.
     */
    @ExceptionHandler(PledgeNotDraftException.class)
    public ProblemDetail handleNotDraft(PledgeNotDraftException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-not-draft"));
        problem.setTitle("Pledge is not a draft");
        problem.setDetail("This pledge is " + exception.state() + " and cannot be confirmed.");
        problem.setProperty("code", "PLEDGE_NOT_DRAFT");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 409 for a pledge whose state has moved past editing or cancelling. §4.5's PL-09
     * and PL-10.
     *
     * <p><strong>The pledge's own state, and never the campaign's.</strong> A campaign
     * past its deadline is answered {@code PROJECT_NOT_LIVE} by the handler above —
     * the same code, body and {@code meta.deadline} that {@code POST /v1/pledges/draft}
     * gives — so that one fact has one answer wherever it is asked, and a client can
     * say "this campaign ended on Tuesday" rather than "you cannot do that". This code
     * is left to mean the thing only it can mean. See {@code PledgeService#requireEditable},
     * which composes the two.
     *
     * <p>The state is in {@code meta} because the client's next move depends on it: an
     * {@code EXPIRED} draft is started again, a {@code COLLECTED} pledge is a
     * conversation with the creator rather than a button.
     */
    /**
     * 409: IDN-EXT-01 (#35) — a backer cannot cancel a pledge. Only an unpaid checkout can be
     * abandoned. The state is on the body so a client can tell which one it is holding.
     */
    @ExceptionHandler(PledgeCannotBeCancelledException.class)
    public ProblemDetail handleCannotBeCancelled(PledgeCannotBeCancelledException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-cannot-be-cancelled"));
        problem.setTitle("A pledge cannot be cancelled");
        problem.setDetail("A confirmed pledge can be raised, but not withdrawn. Refunds happen only if the campaign ends"
                + " below its success threshold, is suspended, or is cancelled by its creator.");
        problem.setProperty("code", "PLEDGE_CANNOT_BE_CANCELLED");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 409: IDN-EXT-01 (#35) — a confirmed pledge may only be raised. Both amounts are on the body,
     * as strings, so a client can say what the pledge is and what the edit would have made it.
     */
    @ExceptionHandler(PledgeDecreaseNotAllowedException.class)
    public ProblemDetail handleDecreaseNotAllowed(PledgeDecreaseNotAllowedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-decrease-not-allowed"));
        problem.setTitle("A confirmed pledge can only be raised");
        problem.setDetail("This pledge is confirmed, and an edit may raise it but not lower it.");
        problem.setProperty("code", "PLEDGE_DECREASE_NOT_ALLOWED");
        problem.setProperty(
                "meta",
                Map.of(
                        "current", exception.current().toPlainString(),
                        "requested", exception.requested().toPlainString()));
        return problem;
    }

    @ExceptionHandler(PledgeNotEditableException.class)
    public ProblemDetail handleNotEditable(PledgeNotEditableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-not-editable"));
        problem.setTitle("Pledge can no longer be changed");
        problem.setDetail("This pledge is " + exception.state() + " and can no longer be changed.");
        problem.setProperty("code", "PLEDGE_NOT_EDITABLE");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 409 for a pledge that cannot buy anything more — §4.8's PM-09 and PM-10.
     *
     * <p>A different set of states from {@link PledgeNotEditableException}'s, and a
     * different code for that reason: a {@code DRAFT} may be edited and may not buy a
     * supplement, and a {@code COLLECTED} pledge is the other way round. A client
     * showing one message for both would tell a backer they cannot do the thing they
     * can.
     */
    @ExceptionHandler(PledgeNotSupplementableException.class)
    public ProblemDetail handleNotSupplementable(PledgeNotSupplementableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-not-supplementable"));
        problem.setTitle("Nothing more can be added to this pledge");
        problem.setDetail("This pledge is " + exception.state() + ", so nothing further can be bought against it.");
        problem.setProperty("code", "PLEDGE_NOT_SUPPLEMENTABLE");
        problem.setProperty("meta", Map.of("state", exception.state().name()));
        return problem;
    }

    /**
     * 409 while the campaign is still taking pledges — §4.8's PM-09 and PM-10.
     *
     * <p><strong>The refusal names the alternative.</strong> Until the deadline, §4.5's
     * PL-09 edit is how a backer changes a pledge, and it re-quotes the whole thing
     * because nothing has been charged. A client that could only read "409" would hide
     * the upgrade button and never learn that the edit is the same feature under
     * another name.
     */
    @ExceptionHandler(CampaignStillTakingPledgesException.class)
    public ProblemDetail handleStillTakingPledges(CampaignStillTakingPledgesException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/campaign-still-taking-pledges"));
        problem.setTitle("The campaign is still running");
        problem.setDetail("While this campaign is taking pledges, change your pledge instead of buying an upgrade.");
        problem.setProperty("code", "CAMPAIGN_STILL_TAKING_PLEDGES");
        problem.setProperty("meta", Map.of("use", "PATCH /v1/pledges/{id}"));
        return problem;
    }

    /**
     * 422 for a purchase that would cost nothing more — §4.8's PM-09 and PM-10.
     *
     * <p>The body is well formed and the tier exists; what is wrong is the relationship
     * between the two, which is what 422 is for. A downgrade is a refund and refunds are
     * #67's, so this is a refusal rather than a negative supplement — V39's
     * {@code pledge_supplements_amount_is_positive} would refuse the row anyway.
     */
    @ExceptionHandler(SupplementNotAnIncreaseException.class)
    public ProblemDetail handleNotAnIncrease(SupplementNotAnIncreaseException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/supplement-not-an-increase"));
        problem.setTitle("That is not an upgrade");
        problem.setDetail("This costs no more than what the pledge already has. A refund is a separate request.");
        problem.setProperty("code", "SUPPLEMENT_NOT_AN_INCREASE");
        return problem;
    }

    /**
     * <strong>409 for a confirmation that did not acknowledge the backer agreement</strong>
     * — #427, and §22.3's requirement that the risk is stated within the pledge flow.
     *
     * <p>409 rather than 403. The backer is permitted to confirm this pledge; what is wrong
     * is the state of the page they are confirming from — either it showed no risk statement
     * at all, or it showed one that has since been superseded. That is the same distinction
     * {@code RESERVATION_EXPIRED} draws and the same recovery: reload, read, confirm.
     *
     * <p>{@code meta.version} is what the client must show and send back, and
     * {@code meta.acknowledged} is what it sent — so a client meeting this can tell a stale
     * page apart from a missing field, which are the two ways to arrive here and have
     * different fixes.
     */
    /**
     * 503: IDN-EXT-01 (#39) — no payment page can be opened now. Nothing was charged, and the draft
     * keeps its places until its hold ends, so trying again shortly is the right move.
     */
    @ExceptionHandler(PaymentPageUnavailableException.class)
    public ProblemDetail handlePaymentPageUnavailable(PaymentPageUnavailableException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.SERVICE_UNAVAILABLE);
        problem.setType(URI.create("https://ideanest.az/problems/payment-unavailable"));
        problem.setTitle("Payments are not available right now");
        problem.setDetail("Nothing was charged. Your pledge is still held; try again in a moment.");
        problem.setProperty("code", "PAYMENT_UNAVAILABLE");
        return problem;
    }

    @ExceptionHandler(BackerAgreementRequiredException.class)
    public ProblemDetail handleAgreementRequired(BackerAgreementRequiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/agreement-required"));
        problem.setTitle("Read what backing means first");
        problem.setDetail("A pledge is not a purchase and a reward is not guaranteed. Confirming records that you"
                + " were told so.");
        problem.setProperty("code", "AGREEMENT_REQUIRED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("document", exception.agreement().kind().name());
        meta.put("documentId", exception.agreement().documentId());
        meta.put("version", exception.agreement().version());
        meta.put("acknowledged", exception.offered());
        problem.setProperty("meta", meta);
        return problem;
    }

    /** 409 for a draft whose five minutes ran out. §4.5's PL-13. */
    @ExceptionHandler(ReservationExpiredException.class)
    public ProblemDetail handleReservationExpired(ReservationExpiredException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/reservation-expired"));
        problem.setTitle("Reservation expired");
        problem.setDetail("This checkout took too long and the reward's place was released.");
        problem.setProperty("code", "RESERVATION_EXPIRED");

        Map<String, Object> meta = new LinkedHashMap<>();
        // Never null on a draft — pledges_drafts_are_time_bounded refuses one without
        // an expiry — but a map literal cannot hold a null, and this is the map.
        meta.put("expiredAt", exception.expiredAt() == null ? null : exception.expiredAt().toString());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 when two writers changed one pledge at once.
     *
     * <p><strong>Today there is exactly one way to reach this</strong>, and it is
     * worth naming: §8.4's sweep expiring a draft in the moment its backer confirms
     * it. {@code PledgeRepository#expireLapsedDraft} increments {@code version}
     * precisely so that the confirming transaction loses rather than committing
     * against a tier that has already given the place away.
     *
     * <p>The honest instruction is therefore "re-read and look again", and a client
     * that does will find the pledge {@code EXPIRED}. It is not answered as
     * {@code RESERVATION_EXPIRED} even though that is what it usually means:
     * {@code ObjectOptimisticLockingFailureException} is a broad type, and reporting
     * a cause we have inferred rather than observed would be a lie the first time
     * something else writes to a pledge.
     */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ProblemDetail handleConcurrentModification(ObjectOptimisticLockingFailureException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/pledge-modified"));
        problem.setTitle("Pledge changed underneath");
        problem.setDetail("This pledge was changed by another request. Reload it and try again.");
        problem.setProperty("code", "PLEDGE_MODIFIED");
        return problem;
    }

    /**
     * The value objects refuse what they cannot represent — an amount with three
     * decimal places, a country code that is not a country, an add-on selected twice.
     * Reaching here means input the binding accepted and the type did not, which is
     * still the client's problem.
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

    /** Identifiers as strings, because that is what they are in JSON and what a client compares. */
    private static List<String> identifiers(List<UUID> ids) {
        return ids.stream().map(UUID::toString).toList();
    }
}
