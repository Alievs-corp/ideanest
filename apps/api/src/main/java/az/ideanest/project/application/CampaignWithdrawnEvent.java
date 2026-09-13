package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code project.withdrawn} — IDN-EXT-01 (#41): the campaign is closed by withdrawal.
 *
 * <p>The payout module requests the payout from it, with the hold, and that request is what tells
 * every backer the date until which they may dispute.
 *
 * @param automatic whether the platform withdrew it because the creator had not, 30 days after funding
 */
public record CampaignWithdrawnEvent(UUID projectId, UUID creatorId, Instant withdrawnAt, boolean automatic) {

    public static final String AGGREGATE_TYPE = "project";
    public static final String EVENT_TYPE = "project.withdrawn";

    static CampaignWithdrawnEvent of(Project project, Instant at, boolean automatic) {
        return new CampaignWithdrawnEvent(project.getId(), project.getCreatorId(), at, automatic);
    }
}
