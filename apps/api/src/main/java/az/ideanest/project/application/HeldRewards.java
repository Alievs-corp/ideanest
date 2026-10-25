package az.ideanest.project.application;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * What a launched campaign's open revision holds about its reward tiers (#569), read against
 * the tiers: the proposed state of each approved tier it changes, the approved tiers it
 * deletes, the tiers created while it was open, and the order the creator gave them.
 *
 * @param changed by tier, the approved tiers whose proposed state differs from what they show
 * @param deleted approved tiers, in display order
 * @param created the tiers that wait for this revision, in the order they were created
 * @param order every tier in the order the creator wants, or null when they have not moved any
 */
public record HeldRewards(
        Map<UUID, RewardWriting> changed, List<UUID> deleted, List<UUID> created, List<UUID> order) {

    public static final HeldRewards NONE = new HeldRewards(Map.of(), List.of(), List.of(), null);

    public HeldRewards {
        changed = Map.copyOf(changed);
        deleted = List.copyOf(deleted);
        created = List.copyOf(created);
        order = order == null ? null : List.copyOf(order);
    }

    public boolean isEmpty() {
        return changed.isEmpty() && deleted.isEmpty() && created.isEmpty() && order == null;
    }
}
