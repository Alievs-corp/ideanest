package az.ideanest.project.api;

import az.ideanest.project.domain.ProjectRevision;
import java.time.Instant;
import java.util.UUID;

/** The outcome of a moderator's decision on an edit to a launched campaign (#558). */
public record RevisionDecisionResponse(UUID id, UUID projectId, String status, Instant decidedAt, String reason) {

    static RevisionDecisionResponse of(ProjectRevision revision) {
        return new RevisionDecisionResponse(
                revision.getId(),
                revision.getProjectId(),
                revision.getStatus().name(),
                revision.getDecidedAt(),
                revision.getReason());
    }
}
