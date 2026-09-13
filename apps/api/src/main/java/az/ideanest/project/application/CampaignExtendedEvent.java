package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code project.extended} — the creator extended the deadline once. IDN-EXT-01 (#34).
 *
 * <p>Recorded from the row after the transition, so the instants are the ones the campaign now
 * carries. The notification module reads it as {@code NotificationEvents.CampaignExtended} and
 * tells every backer; §5.1 says a backer is notified of the new deadline and asked nothing.
 *
 * @param deadline the first deadline, which the extension does not move
 * @param extendedUntil where the campaign now ends
 * @param extendedAt when the creator extended
 */
public record CampaignExtendedEvent(
        UUID projectId, UUID creatorId, Instant deadline, Instant extendedUntil, Instant extendedAt) {

    public static final String AGGREGATE_TYPE = "project";

    public static final String EVENT_TYPE = "project.extended";

    static CampaignExtendedEvent of(Project project) {
        return new CampaignExtendedEvent(
                project.getId(),
                project.getCreatorId(),
                project.getDeadline(),
                project.getExtendedUntil(),
                project.getExtensionUsedAt());
    }
}
