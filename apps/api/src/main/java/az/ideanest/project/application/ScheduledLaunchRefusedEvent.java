package az.ideanest.project.application;

import az.ideanest.project.domain.Project;
import java.time.Instant;
import java.util.UUID;

/**
 * {@code project.scheduled_launch_refused}: a campaign's launch time arrived and it was not
 * opened, because its creator's plan does not cover it (#587). Announced through §8.3's outbox.
 *
 * <p>The scheduled launch clears the launch time when it refuses, so the campaign waits in
 * {@code APPROVED} and nothing will open it on its own again. This is how the creator finds that
 * out — the people they told about the date will find out by the campaign not being there.
 *
 * <p>A copy of the contract in the sense {@link ProjectApprovedEvent} is: the notification module
 * declares its own reading of the same JSON, and the field names are the contract.
 *
 * @param projectId which campaign, and the aggregate identifier
 * @param creatorId the recipient
 * @param scheduledFor the launch time that passed without a launch
 * @param refusedAt when the scheduled launch refused it
 */
public record ScheduledLaunchRefusedEvent(UUID projectId, UUID creatorId, Instant scheduledFor, Instant refusedAt) {

    public static final String AGGREGATE_TYPE = "project";

    public static final String EVENT_TYPE = "project.scheduled_launch_refused";

    static ScheduledLaunchRefusedEvent of(Project project, Instant scheduledFor, Instant refusedAt) {
        return new ScheduledLaunchRefusedEvent(project.getId(), project.getCreatorId(), scheduledFor, refusedAt);
    }
}
