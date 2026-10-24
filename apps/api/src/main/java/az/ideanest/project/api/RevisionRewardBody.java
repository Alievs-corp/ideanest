package az.ideanest.project.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

/**
 * A reward tier whose writing a revision changes (#559), as the public sees it and as the
 * creator proposes it. The tier's price, stock and shipping are not part of a revision.
 *
 * @param id the reward tier
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record RevisionRewardBody(UUID id, RevisionRewardWriting live, RevisionRewardWriting proposed) {

    /**
     * @param description null when the tier has none
     * @param image null when the tier has no picture, or it is not servable
     * @param video null when the tier has no clip, or it is not servable
     */
    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record RevisionRewardWriting(
            String title, String description, RevisionRewardImage image, CampaignVideoBody video) {}

    public record RevisionRewardImage(UUID mediaId, String url, int width, int height, String blurDataUrl) {}
}
