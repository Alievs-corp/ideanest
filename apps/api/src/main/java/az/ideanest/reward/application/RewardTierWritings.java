package az.ideanest.reward.application;

import az.ideanest.media.application.MediaLibrary;
import az.ideanest.project.application.RewardWriting;
import az.ideanest.project.application.RewardWritings;
import az.ideanest.reward.domain.RewardTier;
import az.ideanest.reward.infrastructure.RewardTierRepository;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The reward module's answer to {@link RewardWritings}: a launched campaign's tiers' writing,
 * read for its revision and written when a moderator approves it (#559).
 */
@Service
public class RewardTierWritings implements RewardWritings {

    private final RewardTierRepository rewards;
    private final MediaLibrary media;

    public RewardTierWritings(RewardTierRepository rewards, MediaLibrary media) {
        this.rewards = rewards;
        this.media = media;
    }

    @Override
    @Transactional(readOnly = true)
    public Map<UUID, RewardWriting> liveWritingOf(UUID projectId) {
        Map<UUID, RewardWriting> writings = new LinkedHashMap<>();
        for (RewardTier tier : rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId)) {
            writings.put(tier.getId(), writingOf(tier));
        }
        return writings;
    }

    /**
     * Every tier first and the releases after, so that two tiers trading pictures in one
     * approval each still find the other showing theirs.
     */
    @Override
    @Transactional
    public void publish(UUID projectId, Map<UUID, RewardWriting> approved) {
        List<RewardTier> tiers = rewards.findByProjectIdOrderBySortOrderAscCreatedAtAsc(projectId).stream()
                .filter(tier -> approved.containsKey(tier.getId()))
                .toList();

        Map<UUID, Set<UUID>> replaced = new LinkedHashMap<>();
        for (RewardTier tier : tiers) {
            RewardWriting writing = approved.get(tier.getId());
            Set<UUID> previous = new LinkedHashSet<>();
            if (!Objects.equals(tier.getImageMediaId(), writing.imageMediaId())) {
                previous.add(tier.getImageMediaId());
            }
            if (!Objects.equals(tier.getVideoMediaId(), writing.videoMediaId())) {
                previous.add(tier.getVideoMediaId());
            }
            tier.setTitle(writing.title());
            tier.setDescription(writing.description());
            tier.setImageMediaId(writing.imageMediaId());
            tier.setVideoMediaId(writing.videoMediaId());
            replaced.put(tier.getId(), previous);
        }

        replaced.forEach((tierId, previous) -> previous.stream()
                .filter(Objects::nonNull)
                .filter(mediaId -> !rewards.isMediaShownElsewhere(mediaId, tierId))
                .forEach(media::discardAfterCommit));
    }

    static RewardWriting writingOf(RewardTier tier) {
        return new RewardWriting(
                tier.getTitle(), tier.getDescription(), tier.getImageMediaId(), tier.getVideoMediaId());
    }
}
