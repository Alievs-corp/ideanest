package az.ideanest.project.api;

import az.ideanest.project.application.ProjectRevisionService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The edit a launched campaign has open, as the editor sees it (#558).
 *
 * @param status {@code DRAFT} while the creator is still working, {@code PENDING} once it is with
 *     the moderators
 * @param changedFields the names of what differs from the public page: {@code title},
 *     {@code blurb}, {@code category}, {@code story}, {@code risks}, {@code coverImage},
 *     {@code videoMediaId}, {@code countries}, and {@code rewards} when it changes the writing of a
 *     reward tier (#559)
 * @param submittedAt null while it is a draft
 */
public record RevisionBody(
        UUID id, String status, List<String> changedFields, Instant submittedAt, Instant updatedAt) {

    static RevisionBody of(ProjectRevisionService.Summary summary) {
        return new RevisionBody(
                summary.id(),
                summary.status().name(),
                summary.changedFields(),
                summary.submittedAt(),
                summary.updatedAt());
    }
}
