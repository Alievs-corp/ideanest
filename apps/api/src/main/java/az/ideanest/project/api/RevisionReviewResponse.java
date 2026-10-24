package az.ideanest.project.api;

import az.ideanest.project.domain.ProjectRevision;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One revision beside the campaign it would change (#558).
 *
 * @param live the campaign as the public sees it
 * @param proposed the same campaign with the revision written on it
 * @param changedFields what differs between the two
 * @param rewards the reward tiers whose writing the revision changes (#559), each as the public
 *     sees it and as proposed; empty when it changes none. {@code rewards} is then one of the
 *     changed fields
 */
public record RevisionReviewResponse(
        UUID id,
        UUID projectId,
        String status,
        UUID authorId,
        Instant submittedAt,
        Instant decidedAt,
        String reason,
        List<String> changedFields,
        ProjectEdit live,
        ProjectEdit proposed,
        List<RevisionRewardBody> rewards) {

    static RevisionReviewResponse of(
            ProjectRevision revision,
            List<String> changed,
            ProjectEdit live,
            ProjectEdit proposed,
            List<RevisionRewardBody> rewards) {
        return new RevisionReviewResponse(
                revision.getId(),
                revision.getProjectId(),
                revision.getStatus().name(),
                revision.getAuthorId(),
                revision.getSubmittedAt(),
                revision.getDecidedAt(),
                revision.getReason(),
                changed,
                live,
                proposed,
                rewards);
    }
}
