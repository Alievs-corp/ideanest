package az.ideanest.project.api;

import az.ideanest.project.application.ProjectTransitionService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * §10.2's {@code POST /v1/admin/projects/{id}/suspend} — §4.11's AD-02 (#103).
 *
 * <p><strong>Its own controller rather than a fourth method on
 * {@link ProjectModerationController}</strong>, because §10.2 puts it under a different
 * resource and the difference is real: the three moderation outcomes decide a campaign
 * that is <em>waiting</em> to be published, and this stops one that is already taking
 * money. They share the staff check and nothing else — different edge, different
 * consequences, different audit action.
 *
 * <p><strong>{@code MODERATE_CONTENT}</strong>, through the same
 * {@code ProjectAccess.requireModeratable} the three outcomes use, which
 * {@code ProjectModerationController} argues at length. Halting a campaign that is
 * taking money is a moderator's decision, not any staff member's (#574).
 *
 * <p>{@code POST} rather than {@code DELETE}: nothing is removed. The campaign keeps its
 * page, its history and its pledges — which are cancelled rather than charged — and what
 * is created is the suspension.
 */
@RestController
@RequestMapping("/v1/admin/projects")
public class ProjectSuspensionController {

    private final ProjectTransitionService transitions;
    private final ProjectEditResponses responses;

    public ProjectSuspensionController(ProjectTransitionService transitions, ProjectEditResponses responses) {
        this.transitions = transitions;
        this.responses = responses;
    }

    /**
     * Stops a live campaign. Terminal, and the reason is what everybody is told.
     *
     * <p>Answers the same editor projection the creator's own lifecycle endpoints do, so
     * that an admin client renders one shape whichever endpoint it called — and so that
     * whoever suspended the campaign can see the state it is now in rather than having
     * to read it back.
     */
    @PostMapping("/{id}/suspend")
    public ProjectEdit suspend(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody SuspendProjectRequest request) {

        return responses.of(transitions.suspend(id, moderatorOf(accessToken), request.reason()));
    }

    /** The account making the request, from our own signature and never from the body. */
    private static UUID moderatorOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
