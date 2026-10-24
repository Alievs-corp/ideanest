package az.ideanest.project.api;

import az.ideanest.project.application.ProjectRevisionService;
import java.time.Instant;
import java.util.UUID;

/** Why moderation refused the creator's last edit to a launched campaign (#558). */
public record RevisionRejectionBody(UUID id, String reason, Instant decidedAt) {

    static RevisionRejectionBody of(ProjectRevisionService.Rejection rejection) {
        return new RevisionRejectionBody(rejection.id(), rejection.reason(), rejection.decidedAt());
    }
}
