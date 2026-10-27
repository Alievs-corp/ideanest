package az.ideanest.project.api;

import az.ideanest.project.application.ProjectRevisionModeration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The edits to launched campaigns that wait for a moderator, oldest first (#558). */
public record RevisionQueueResponse(List<RevisionQueueEntry> revisions) {

    /**
     * @param title the campaign's title as the public sees it
     * @param creatorName null for an anonymised account
     */
    public record RevisionQueueEntry(
            UUID id,
            UUID projectId,
            String title,
            String slug,
            UUID creatorId,
            String creatorName,
            List<String> changedFields,
            Instant submittedAt) {}

    static RevisionQueueResponse of(List<ProjectRevisionModeration.QueuedRevision> queued) {
        return new RevisionQueueResponse(queued.stream()
                .map(entry -> new RevisionQueueEntry(
                        entry.revision().getId(),
                        entry.revision().getProjectId(),
                        entry.title(),
                        entry.slug(),
                        entry.creatorId(),
                        entry.creatorName(),
                        entry.changedFields(),
                        entry.revision().getSubmittedAt()))
                .toList());
    }
}
