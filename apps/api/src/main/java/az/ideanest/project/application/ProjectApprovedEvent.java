package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code project.approved}: moderation cleared a campaign, announced through §8.3's outbox.
 *
 * <p>The notification module has read this event since §4.11's AD-01 gave the creator a
 * {@code PROJECT_APPROVED} message, and nothing wrote it until #552, so a creator found out
 * about a decision by refreshing a page. Since #552 the approval is also what publishes the
 * campaign, so this is the one message the creator gets about it: approved and live, or
 * approved and opening at the launch time they set. The launch that may follow in the same
 * transaction announces itself to followers through {@link ProjectLaunchedEvent} and says
 * nothing to the creator, so the two never tell the same person different things.
 *
 * <p>A copy of the contract in the sense {@link ProjectLaunchedEvent} is: the notification
 * module declares its own reading of the same JSON, and the field names are the contract.
 *
 * @param projectId which campaign, and the aggregate identifier
 * @param creatorId the recipient
 * @param approvedAt when the decision was taken
 */
public record ProjectApprovedEvent(UUID projectId, UUID creatorId, Instant approvedAt) {

    public static final String AGGREGATE_TYPE = "project";

    public static final String EVENT_TYPE = "project.approved";

    static ProjectApprovedEvent of(Project project, Instant approvedAt) {
        return new ProjectApprovedEvent(project.getId(), project.getCreatorId(), approvedAt);
    }
}
