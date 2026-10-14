package az.ideanest.community.api;

import az.ideanest.community.domain.ProjectUpdate;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/**
 * One update, as the Updates tab and the creator's own list read it.
 *
 * <p><strong>An identifier since #255, for the one endpoint an update has.</strong> This
 * record carried none while §10.2 gave an update no route of its own. #297 published
 * {@code POST /v1/updates/{id}/report}, and no client could call it: the only read that
 * lists updates did not say which one was which. {@link #id} is that handle, for the same
 * reason {@code CommentResponse} carries one. What a person says out loud, and what a
 * link into the tab carries, is still the {@link #number}.
 *
 * <p><strong>No {@code scheduled} flag.</strong> {@link #publishedAt} in the future
 * <em>is</em> scheduled, and a second field saying so is a second thing that can
 * disagree with the first — it would have to be computed against a clock, and the
 * client already holds one.
 *
 * @param id what {@code POST /v1/updates/{id}/report} is addressed to. Nothing else
 *     takes it; a client keys and links an update by its number
 * @param authorId who published it. Present so that #38's collaborators are
 *     distinguishable from the creator in a list; the name behind it is the profile
 *     endpoint's to serve, because a body that carried names would need a join per row
 *     and a decision about what a deleted account is called
 */
@JsonInclude(JsonInclude.Include.ALWAYS)
public record ProjectUpdateResponse(
        UUID id, int number, String title, String body, String visibility, Instant publishedAt, UUID authorId) {

    public static ProjectUpdateResponse of(ProjectUpdate update) {
        return new ProjectUpdateResponse(
                update.getId(),
                update.getNumber(),
                update.getTitle(),
                update.getBody(),
                update.getVisibility().name(),
                update.getPublishedAt(),
                update.getAuthorId());
    }
}
