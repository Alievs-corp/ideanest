package az.ideanest.project.application;

import az.ideanest.project.domain.RevisionContent;
import java.util.UUID;

/**
 * What a backer reads and sees on a reward tier: the part of it that a launched campaign's
 * revision holds until a moderator approves it (#559).
 *
 * <p>The reward module's view of {@link RevisionContent.Reward}, which lives in this module's
 * {@code domain} package and so cannot be named there.
 *
 * @param description null when the tier has none
 * @param imageMediaId the tier's picture, or null
 * @param videoMediaId the tier's clip, or null
 */
public record RewardWriting(String title, String description, UUID imageMediaId, UUID videoMediaId) {

    static RewardWriting of(RevisionContent.Reward reward) {
        return new RewardWriting(reward.title(), reward.description(), reward.imageMediaId(), reward.videoMediaId());
    }

    RevisionContent.Reward held() {
        return new RevisionContent.Reward(title, description, imageMediaId, videoMediaId);
    }
}
