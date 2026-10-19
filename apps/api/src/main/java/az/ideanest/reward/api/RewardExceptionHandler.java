package az.ideanest.reward.api;

import az.ideanest.project.application.CapabilityNotGrantedException;
import az.ideanest.project.application.ProjectNotFoundException;
import az.ideanest.reward.application.ItemInUseException;
import az.ideanest.reward.application.ItemNotFoundException;
import az.ideanest.reward.application.RewardFieldLockedException;
import az.ideanest.reward.application.RewardFieldRejectedException;
import az.ideanest.reward.application.RewardHasBackersException;
import az.ideanest.reward.application.RewardNotFoundException;
import az.ideanest.reward.application.RewardOrderIncompleteException;
import az.ideanest.reward.application.RewardVideoTooLongException;
import az.ideanest.reward.application.TooManyRewardsException;
import java.net.URI;
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
 * The reward module's own failures, as RFC 9457 problem details.
 *
 * <p>Scoped to this module's two controllers rather than applied globally, for the
 * reason {@code ProjectExceptionHandler} gives: an advice that catches a broad type
 * across the whole service turns a bug somewhere else into a tidy 4xx and hides it.
 * Listed separately from the project module's advice, rather than added to its
 * {@code assignableTypes}, because several sibling issues are in flight and that one
 * line is the file they would all conflict in.
 *
 * <p>Every response carries a {@code code} as well as a status, per §10.4. The status
 * tells a client how to behave; the code tells it what happened, and it is what a client
 * branches on. Three different 409s that cannot be told apart would force clients to
 * match on prose.
 */
@RestControllerAdvice(assignableTypes = {ItemController.class, RewardController.class})
public class RewardExceptionHandler {

    /**
     * 404 for a tier that does not exist, and for one under a campaign this caller may
     * not see.
     *
     * <p>Deliberately the same answer. A reward tier is a price on a product nobody has
     * announced, and distinguishing "not yours" from "not there" would turn the endpoint
     * into an oracle for what other people are preparing and what they intend to charge
     * for it.
     */
    @ExceptionHandler(RewardNotFoundException.class)
    public ProblemDetail handleRewardNotFound(RewardNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/reward-not-found"));
        problem.setTitle("No such reward");
        problem.setDetail("That reward tier does not exist.");
        problem.setProperty("code", "REWARD_NOT_FOUND");
        return problem;
    }

    /** 404 for an item, on the same reasoning. */
    @ExceptionHandler(ItemNotFoundException.class)
    public ProblemDetail handleItemNotFound(ItemNotFoundException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setType(URI.create("https://ideanest.az/problems/item-not-found"));
        problem.setTitle("No such item");
        problem.setDetail("That item does not exist.");
        problem.setProperty("code", "ITEM_NOT_FOUND");
        return problem;
    }

    /**
     * 404 for a campaign that does not exist, and for one this caller may not see.
     *
     * <p>Raised by {@code ProjectAccess}, which is the only place that decision is made,
     * and answered here with the same body and the same code the project module uses —
     * the endpoint being called is different, the fact being reported is identical, and a
     * client that already handles {@code PROJECT_NOT_FOUND} should not need a second
     * branch for it.
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
     * 403 for a collaborator who works on the campaign and was not granted
     * {@code EDIT_REWARDS}.
     *
     * <p>Not a 404: they were invited and can already see the campaign, so the
     * confidentiality {@code ProjectNotFoundException} protects has nothing left to
     * protect here. The body names what would have authorised the request and what the
     * caller holds, so the editor can hide the rewards tab rather than let somebody
     * price a tier and be refused at the end of it.
     *
     * <p><strong>This refusal had no handler until #236.</strong> While this module
     * asked the coarse "may this account edit this campaign at all", every collaborator
     * who could reach these endpoints at all held one of the editing capabilities that
     * question accepts, so the only refusals in practice were the 404s above and this
     * exception escaped as a 500 — a permission failure reported as a broken server.
     * Asking for {@link az.ideanest.shared.access.ProjectCapability#EDIT_REWARDS} by
     * name makes it the ordinary refusal, which is what surfaced the gap.
     */
    @ExceptionHandler(CapabilityNotGrantedException.class)
    public ProblemDetail handleCapabilityNotGranted(CapabilityNotGrantedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setType(URI.create("https://ideanest.az/problems/capability-not-granted"));
        problem.setTitle("Not permitted on this campaign");
        problem.setDetail("Your collaborator access on this campaign does not include that.");
        problem.setProperty("code", "CAPABILITY_NOT_GRANTED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("requiredAnyOf", exception.requiredAnyOf());
        meta.put("held", exception.held());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 for deleting a tier somebody has claimed. §5.3.
     *
     * <p>Not a 403: the caller is entitled to delete their own tiers. What refuses it is
     * that somebody has already chosen this one, and the {@code meta} says how many, so
     * the editor can say "eleven backers chose this" rather than only refusing.
     */
    @ExceptionHandler(RewardHasBackersException.class)
    public ProblemDetail handleRewardHasBackers(RewardHasBackersException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/reward-has-backers"));
        problem.setTitle("Reward has backers");
        problem.setDetail("Backers have chosen this reward, so it cannot be deleted. Withdraw it from sale instead.");
        problem.setProperty("code", "REWARD_HAS_BACKERS");
        problem.setProperty("meta", Map.of("claimedQuantity", exception.claimedQuantity()));
        return problem;
    }

    /**
     * 409 for deleting an item a tier contains.
     *
     * <p>The tiers are in {@code meta} so the editor can link to each of them. Refusing
     * and naming them is the alternative to a cascade, which would have changed what a
     * backer was promised in a request that reads as housekeeping.
     */
    @ExceptionHandler(ItemInUseException.class)
    public ProblemDetail handleItemInUse(ItemInUseException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/item-in-use"));
        problem.setTitle("Item is part of a reward");
        problem.setDetail("Remove this item from the rewards that contain it before deleting it.");
        problem.setProperty("code", "ITEM_IN_USE");
        problem.setProperty("meta", Map.of("rewardTierIds", identifiers(exception.rewardTierIds())));
        return problem;
    }

    /**
     * 400 for a reorder that is not the full set.
     *
     * <p>Both halves of the disagreement are in {@code meta}: what the request left out,
     * and what it named that does not belong. A client whose list is stale learns which,
     * which is the difference between reloading and guessing.
     */
    @ExceptionHandler(RewardOrderIncompleteException.class)
    public ProblemDetail handleOrderIncomplete(RewardOrderIncompleteException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/reward-order-incomplete"));
        problem.setTitle("Incomplete reward order");
        problem.setDetail("A reorder lists every reward of the campaign exactly once.");
        problem.setProperty("code", "REWARD_ORDER_INCOMPLETE");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("missing", identifiers(exception.missing()));
        meta.put("unexpected", identifiers(exception.unexpected()));
        problem.setProperty("meta", meta);
        return problem;
    }

    /** 409 for the hundred-and-first tier. §5.3. */
    @ExceptionHandler(TooManyRewardsException.class)
    public ProblemDetail handleTooManyRewards(TooManyRewardsException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/too-many-rewards"));
        problem.setTitle("Too many rewards");
        problem.setDetail("A campaign offers at most " + exception.limit() + " reward tiers.");
        problem.setProperty("code", "TOO_MANY_REWARDS");
        problem.setProperty("meta", Map.of("limit", exception.limit()));
        return problem;
    }

    /**
     * 409 for an edit to something §5.3 froze when the campaign launched.
     *
     * <p>The same status and the same {@code meta} shape as the project module's
     * {@code PROJECT_FIELD_LOCKED}, with this module's code: a creator repricing a
     * live tier and a creator moving a live campaign's goal are one rule, and a
     * client should not have to handle them in two different ways because the
     * request went to a different path. Not a 400 — the value is a perfectly good
     * price, and the campaign's state is what refuses it.
     */
    @ExceptionHandler(RewardFieldLockedException.class)
    public ProblemDetail handleFieldLocked(RewardFieldLockedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/reward-field-locked"));
        problem.setTitle("Field locked");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "REWARD_FIELD_LOCKED");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("field", exception.field());
        // The campaign's state, not the tier's: a tier has none, and what refused
        // the edit is the campaign having gone live.
        meta.put("state", exception.state());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 400 for one field of an item or a tier.
     *
     * <p>The field name is in {@code meta} so that the editor can put the message beside
     * the input rather than in a banner above a form with twenty of them — which is the
     * difference between a creator fixing it and a creator writing to support.
     */
    @ExceptionHandler(RewardFieldRejectedException.class)
    public ProblemDetail handleFieldRejected(RewardFieldRejectedException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setType(URI.create("https://ideanest.az/problems/reward-field-invalid"));
        problem.setTitle("Invalid field");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "REWARD_FIELD_INVALID");
        problem.setProperty("meta", Map.of("field", exception.field()));
        return problem;
    }

    /**
     * 422 for a reward clip longer than the limit.
     *
     * <p>Both lengths are in {@code meta}, so the editor can say "6.2 seconds; at most 5"
     * beside the video rather than only refusing it.
     */
    @ExceptionHandler(RewardVideoTooLongException.class)
    public ProblemDetail handleVideoTooLong(RewardVideoTooLongException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.UNPROCESSABLE_CONTENT);
        problem.setType(URI.create("https://ideanest.az/problems/reward-video-too-long"));
        problem.setTitle("Reward video too long");
        problem.setDetail(exception.getMessage());
        problem.setProperty("code", "REWARD_VIDEO_TOO_LONG");

        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("field", "videoMediaId");
        meta.put("durationMs", exception.durationMs());
        meta.put("maxDurationMs", exception.maxDurationMs());
        problem.setProperty("meta", meta);
        return problem;
    }

    /**
     * 409 when two writers changed one tier at once.
     *
     * <p>{@code reward_tiers.version} is mapped as {@code @Version}, so the loser of a
     * concurrent write is refused rather than silently overwriting. The client re-reads
     * and retries — which is the useful outcome, and is why this is optimistic locking
     * rather than the row lock the project module takes for a state transition.
     *
     * <p><strong>No endpoint accepts a version yet.</strong> This is reachable today only
     * from two of the creator's own requests overlapping. It becomes the ordinary case
     * when #51 reserves stock during checkout, and the reason the column exists now is
     * that retrofitting it later would mean a migration that rewrites every row.
     */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ProblemDetail handleConcurrentModification(ObjectOptimisticLockingFailureException exception) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setType(URI.create("https://ideanest.az/problems/reward-modified"));
        problem.setTitle("Reward changed underneath");
        problem.setDetail("This reward was changed by another request. Reload it and try again.");
        problem.setProperty("code", "REWARD_MODIFIED");
        return problem;
    }

    /**
     * The value objects refuse what they cannot represent — an amount with three decimal
     * places, a currency that is not a currency, a country code that is not a country.
     * Reaching here means input the binding accepted and the type did not, which is still
     * the client's problem.
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
        return ids.stream().map(id -> id == null ? null : id.toString()).toList();
    }
}
