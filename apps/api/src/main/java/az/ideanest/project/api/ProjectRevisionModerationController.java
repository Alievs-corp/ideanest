package az.ideanest.project.api;

import az.ideanest.project.application.ProjectRevisionModeration;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Edits to launched campaigns, for the moderators who publish them (#558).
 *
 * <p>Beside the campaign outcomes in {@code ProjectModerationController} and the submission
 * queue, under {@code /v1/admin/moderation/revisions}. Reading asks for
 * {@code MODERATE_CONTENT}; deciding goes through {@code ProjectAccess.requireModeratable},
 * as the campaign outcomes do.
 */
@RestController
@RequestMapping("/v1/admin/moderation/revisions")
public class ProjectRevisionModerationController {

    private final ProjectRevisionModeration moderation;
    private final ProjectEditResponses responses;

    public ProjectRevisionModerationController(ProjectRevisionModeration moderation, ProjectEditResponses responses) {
        this.moderation = moderation;
        this.responses = responses;
    }

    /** The submitted edits, oldest first. {@code limit} is clamped, not refused. */
    @GetMapping
    public RevisionQueueResponse queue(
            @AuthenticationPrincipal Jwt accessToken, @RequestParam(required = false) Integer limit) {
        return RevisionQueueResponse.of(moderation.queue(moderatorOf(accessToken), limit));
    }

    /** One edit beside the campaign as the public sees it. */
    @GetMapping("/{id}")
    public RevisionReviewResponse review(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        ProjectRevisionModeration.Review review = moderation.review(moderatorOf(accessToken), id);
        return RevisionReviewResponse.of(
                review.revision(),
                review.changedFields(),
                responses.of(review.live()),
                responses.of(review.proposed()),
                responses.rewardsOf(review.rewards()));
    }

    /** Publishes the edit. The note is optional. */
    @PostMapping("/{id}/approve")
    public RevisionDecisionResponse approve(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody(required = false) ModerationDecisionRequest request) {

        return RevisionDecisionResponse.of(
                moderation.approve(id, moderatorOf(accessToken), request == null ? null : request.note()));
    }

    /** Refuses the edit. The campaign is unchanged and the creator is shown the reason. */
    @PostMapping("/{id}/reject")
    public RevisionDecisionResponse reject(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ModerationDecisionRequest request) {

        return RevisionDecisionResponse.of(moderation.reject(id, moderatorOf(accessToken), request.note()));
    }

    private static UUID moderatorOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
