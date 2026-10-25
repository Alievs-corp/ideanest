package az.ideanest.reward.api;

import az.ideanest.reward.application.RewardDetail;
import az.ideanest.reward.application.RewardService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * A creator's reward tiers: writing them, ordering them, pricing their shipping, and
 * copying them.
 *
 * <p>Seven endpoints, one response type. {@link RewardResponse} is the creator's
 * projection and carries what no public response may — the reservation counts and the
 * secret token — which is why the campaign page's reward list is a different response
 * owned by a different issue.
 *
 * <p>Authorisation is not decided here. Every method passes the caller's identifier
 * down to {@code RewardAccess}, which finds the campaign and asks {@code ProjectAccess}:
 * one place, so that #38 widening it to collaborators changes one file.
 *
 * <p>A tier under somebody else's campaign is answered {@code 404 REWARD_NOT_FOUND},
 * identically to an identifier that never existed. See {@code RewardNotFoundException}:
 * a reward tier is a price on an unreleased product, and telling a stranger that one
 * exists is the disclosure a draft is private to prevent.
 *
 * <p><strong>No {@code Location} header on create or duplicate.</strong> There is no
 * single-tier read endpoint — the editor reads the campaign's list — and a header
 * pointing at a URL that answers 404 is worse than no header.
 */
@RestController
public class RewardController {

    private final RewardService rewards;

    public RewardController(RewardService rewards) {
        this.rewards = rewards;
    }

    /**
     * The campaign's reward list, in display order, <strong>including secret tiers</strong>.
     *
     * <p>A creator who cannot see a secret tier in their own editor cannot edit or
     * withdraw it. What makes it secret is that the public list leaves it out.
     */
    @GetMapping("/v1/projects/{projectId}/rewards")
    public List<RewardResponse> list(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID projectId) {
        return responses(rewards.list(projectId, callerOf(accessToken)));
    }

    @PostMapping("/v1/projects/{projectId}/rewards")
    @ResponseStatus(HttpStatus.CREATED)
    public RewardResponse create(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Valid @RequestBody CreateRewardRequest request) {

        return RewardResponse.of(rewards.create(projectId, callerOf(accessToken), request.toDraft()));
    }

    /**
     * Applies a partial edit and returns the whole tier.
     *
     * <p>The whole tier rather than the fields that changed: an edit can change a field
     * the client did not send — making a tier public destroys its secret token — and a
     * client that merged a partial response would keep a link that no longer resolves.
     */
    @PatchMapping("/v1/rewards/{id}")
    public RewardResponse edit(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id, @RequestBody RewardPatchRequest request) {

        return RewardResponse.of(rewards.edit(id, callerOf(accessToken), request.toPatch()));
    }

    /**
     * Removes a tier that nobody has claimed.
     *
     * <p>{@code 409 REWARD_HAS_BACKERS} once somebody has. §5.3 permits no exception and
     * gives the alternative: the tier is withdrawn from sale rather than deleted, so that
     * the people who chose it still have a description of what they are owed.
     *
     * <p>On a launched campaign the deletion of a tier the public sees waits for a moderator
     * (#569): the tier stays public, and in the creator's list with {@code pending: "deleted"},
     * until the campaign's revision is approved. A tier created since launch is deleted at once.
     */
    @DeleteMapping("/v1/rewards/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        rewards.delete(id, callerOf(accessToken));
    }

    /**
     * Withdraws a deletion that waits for a moderator (#569), and answers with the tier.
     *
     * <p>A tier with no deletion waiting is answered as it is, so a client that sends this
     * twice is not refused.
     */
    @PostMapping("/v1/rewards/{id}/restore")
    public RewardResponse restore(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return RewardResponse.of(rewards.restore(id, callerOf(accessToken)));
    }

    /**
     * Copies a tier to the end of the list.
     *
     * <p>The wording, the price, the composition, and the shipping rates. Not the claimed
     * or reserved counts: those belong to the people who backed the original.
     */
    @PostMapping("/v1/rewards/{id}/duplicate")
    @ResponseStatus(HttpStatus.CREATED)
    public RewardResponse duplicate(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        return RewardResponse.of(rewards.duplicate(id, callerOf(accessToken)));
    }

    /**
     * Puts the tiers in the order given, and answers with the list in that order.
     *
     * <p>{@code PATCH} on the collection rather than a field on each tier: the order is a
     * property of the list, and a per-tier position would let two requests both claim
     * position three.
     *
     * <p>The body names every tier of the campaign exactly once or the request is a
     * {@code 400 REWARD_ORDER_INCOMPLETE}. A partial list would leave the tiers it omits
     * where they were, interleaved with the ones that moved.
     */
    @PatchMapping("/v1/projects/{projectId}/rewards/reorder")
    public List<RewardResponse> reorder(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @RequestBody ReorderRewardsRequest request) {

        return responses(rewards.reorder(projectId, callerOf(accessToken), request.rewardIds()));
    }

    /**
     * Replaces the tier's whole shipping rate table.
     *
     * <p>{@code PUT} because it is a replacement: a country the body leaves out is a
     * country the creator has removed, and an empty list clears the table. Merging would
     * leave a creator shipping somewhere they believe they no longer do, which is
     * discovered by a backer selecting it.
     *
     * <p>Answers with the tier rather than with the rates alone, so that a client applies
     * the same update after this call as after any other.
     */
    @PutMapping("/v1/rewards/{id}/shipping-rules")
    public RewardResponse replaceShippingRules(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @RequestBody ShippingRulesRequest request) {

        return RewardResponse.of(rewards.replaceShippingRules(
                id, callerOf(accessToken), request.toRates(), request.toZoneRates()));
    }

    private static List<RewardResponse> responses(List<RewardDetail> details) {
        return details.stream().map(RewardResponse::of).toList();
    }

    /** The account making the request, as our own signature establishes it. */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
