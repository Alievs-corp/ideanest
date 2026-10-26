package az.ideanest.reward.api;

import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;

/**
 * The campaign's reward tiers, in the order the creator dragged them into.
 *
 * <p><strong>Every tier, exactly once.</strong> A list that omits one is refused with
 * {@code REWARD_ORDER_INCOMPLETE} rather than applied to the tiers it does mention —
 * see {@code RewardOrderIncompleteException}. Sending the whole list costs the client
 * nothing, because the whole list is what the creator was dragging.
 *
 * <p>No bean validation. {@code @NotEmpty} would refuse an empty body, and an empty
 * body is the correct request for a campaign with no tiers; the service compares the
 * list against what exists and produces a message that says which identifiers are the
 * problem, which is what a stale client needs to hear.
 */
public record ReorderRewardsRequest(@Size(max = 500) List<UUID> rewardIds) {

    public ReorderRewardsRequest {
        rewardIds = rewardIds == null ? List.of() : rewardIds;
    }
}
