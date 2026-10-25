package az.ideanest.project.application;

import az.ideanest.shared.money.Money;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The reward tiers, read and published for a launched campaign's revision (#559, #569).
 *
 * <p>A port for {@link RewardFacts}' reason: the reward module already depends on this one, so
 * this module declares the question and the reward module answers it. A revision holds what a
 * creator changed about the tiers; what the tiers show now has to be read to compare against,
 * a moderator has to see the tiers the revision created, and approval or refusal has to write
 * them, and all of those are the reward module's rows.
 */
public interface RewardWritings {

    /** A tier: its price, which a revision never changes, and everything a revision may. */
    record Tier(UUID id, Money price, RewardWriting writing) {}

    /** Every approved tier as the public sees it now, in display order. */
    List<Tier> liveTiersOf(UUID projectId);

    /** The tiers created on the campaign that wait for its revision, in display order. */
    List<Tier> createdTiersOf(UUID projectId);

    /** The names of the campaign's items and shipping zones, by identifier, for a moderator to read. */
    Map<UUID, String> namesOf(UUID projectId);

    /**
     * Applies an approved revision to the campaign's tiers, in the caller's transaction:
     * approves the created ones, writes the changed ones, deletes the deleted ones and puts
     * them in order. A tier that no longer exists is skipped, and so is the deletion of a tier
     * somebody has backed since. A picture or clip a tier stops showing is released once
     * nothing else shows it.
     *
     * @return the tiers the revision deleted that are kept because they have backers now
     */
    List<UUID> publish(UUID projectId, HeldRewards approved);

    /**
     * Deletes the tiers created on the campaign that wait for a revision which will now not be
     * approved, and releases their media once nothing else shows it.
     */
    void discardCreated(UUID projectId);
}
