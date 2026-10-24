package az.ideanest.project.application;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code project.revision_decided}: moderation approved or rejected an edit to a launched
 * campaign, announced through §8.3's outbox (#558).
 *
 * <p>Recorded for the notification module to read, as {@link ProjectApprovedEvent} is. The
 * field names are the contract.
 *
 * @param outcome {@code APPROVED} or {@code REJECTED}
 * @param note the moderator's explanation; always present for a rejection
 */
public record ProjectRevisionDecidedEvent(
        UUID projectId, UUID creatorId, UUID revisionId, String outcome, String note, Instant decidedAt) {

    public static final String AGGREGATE_TYPE = "project";

    public static final String EVENT_TYPE = "project.revision_decided";
}
