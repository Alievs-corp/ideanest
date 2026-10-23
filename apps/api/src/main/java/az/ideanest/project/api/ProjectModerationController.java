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
 * The three moderation outcomes for a submitted campaign.
 *
 * <p>In the {@code project} module rather than in {@code moderation} because all
 * three do exactly one thing: move this state machine. The moderation module owns
 * the queue, the case, the reports that feed it, and the reviewer's workflow, and
 * when it exists it will call these same transitions. Putting three endpoints there
 * first would mean a module whose only content is a call into another module's
 * service.
 *
 * <p><strong>There is no role model yet, so staff is a configured list of
 * addresses.</strong> Nothing in the schema, the access token, or
 * {@code SecurityConfiguration} distinguishes platform staff from anybody else, and
 * epic #100 owns that. Until it lands, {@code ideanest.project.moderation
 * staff role model (#295) is what these three endpoints check, through
 * {@code ProjectAccess.requireModeratable} — one method, called by all three, rather
 * than an annotation somebody forgets on the fourth. The list is empty by default,
 * which means no account can moderate anything until a deployment says who can.
 *
 * <p>The alternatives were worse. Requiring only a valid access token — which is all
 * the filter chain can enforce on its own — lets a creator approve their own
 * campaign, and moderation exists to prevent exactly that. So does "the creator may
 * not approve their own", one free second account later. A claim carried in the
 * request is not authorisation at all. Configuration is the one option that fails
 * closed and that epic #100 can replace by deleting it.
 */
@RestController
@RequestMapping("/v1/admin/moderation")
public class ProjectModerationController {

    private final ProjectTransitionService transitions;
    private final ProjectEditResponses responses;

    public ProjectModerationController(ProjectTransitionService transitions, ProjectEditResponses responses) {
        this.transitions = transitions;
        this.responses = responses;
    }

    /**
     * Approves a campaign, which publishes it (#552): live now, or at the launch time its
     * creator set. A note is optional commentary.
     */
    @PostMapping("/{id}/approve")
    public ProjectEdit approve(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody(required = false) ModerationDecisionRequest request) {

        return responses.of(transitions.approve(id, moderatorOf(accessToken), noteOf(request)));
    }

    /**
     * Refuses a campaign. Terminal — §5.4 is mostly a list of things that are not
     * fixable — and the note is required because the creator is shown it.
     */
    @PostMapping("/{id}/reject")
    public ProjectEdit reject(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ModerationDecisionRequest request) {

        return responses.of(transitions.reject(id, moderatorOf(accessToken), noteOf(request)));
    }

    /**
     * Sends a campaign back to its creator with a note.
     *
     * <p>Not in §10.2's endpoint list, and required by this epic's definition of
     * done. Without it a moderator's only options are to approve a campaign with a
     * fixable summary or to reject it — and a rejection cannot be undone.
     */
    @PostMapping("/{id}/request-changes")
    public ProjectEdit requestChanges(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID id,
            @Valid @RequestBody ModerationDecisionRequest request) {

        return responses.of(transitions.requestChanges(id, moderatorOf(accessToken), noteOf(request)));
    }

    private static String noteOf(ModerationDecisionRequest request) {
        return request == null ? null : request.note();
    }

    /**
     * Whoever is signed in.
     *
     * <p>Checked against the configured moderator list before anything happens, and
     * recorded as the {@code MODERATOR} on the transition row either way — the audit
     * trail's job is to say which account took the decision, and a refused attempt
     * never reaches the transition.
     */
    private static UUID moderatorOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
