package az.ideanest.project.application;

import java.util.Map;
import java.util.UUID;

/**
 * The reward tiers' writing, read and published for a launched campaign's revision (#559).
 *
 * <p>A port for {@link RewardFacts}' reason: the reward module already depends on this one, so
 * this module declares the question and the reward module answers it. A revision holds a
 * tier's title, description, picture and clip; what the tier shows now has to be read to
 * compare against, and approval has to write it back, and both are the reward module's rows.
 */
public interface RewardWritings {

    /** Every tier's writing as the public sees it now, by tier, in display order. */
    Map<UUID, RewardWriting> liveWritingOf(UUID projectId);

    /**
     * Writes approved writing onto the campaign's tiers, in the caller's transaction. A tier
     * that no longer exists is skipped. A picture or clip a tier stops showing is released once
     * nothing else shows it.
     */
    void publish(UUID projectId, Map<UUID, RewardWriting> approved);
}
