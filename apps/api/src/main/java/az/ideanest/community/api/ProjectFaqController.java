package az.ideanest.community.api;

import az.ideanest.community.application.ProjectFaqService;
import az.ideanest.community.domain.ProjectFaq;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Managing the FAQ tab. §10.2's {@code POST /v1/projects/{id}/faqs},
 * {@code PATCH /v1/faqs/{id}}, {@code DELETE /v1/faqs/{id}} and
 * {@code PATCH /v1/projects/{id}/faqs/reorder}. §4.7's CD-15.
 *
 * <p><strong>A separate controller from {@link PublicProjectFaqController}, on the same
 * path.</strong> Spring routes on the method and the filter chain permits only the
 * {@code GET} — the same split {@code ProjectUpdateController} makes for
 * {@code /v1/projects/{id}/updates}, and for the same reason: one class here requires a
 * bearer token and the other must not, and a reader should be able to tell which is
 * which without opening the security configuration.
 *
 * <p><strong>Two addressing shapes, as the reward module has.</strong> The collection
 * hangs off the campaign — a create needs to say which campaign, and an order is a
 * property of the list rather than of any entry — while a single entry is addressed by
 * its own identifier on a flat path. Repeating the campaign in
 * {@code /v1/projects/{id}/faqs/{faqId}} would be a second, redundant statement of where
 * the entry lives, and one a client could get wrong: nothing stops it naming a campaign
 * the entry does not belong to, and the endpoint would then have to decide which of the
 * two it believed.
 *
 * <p>Authorisation is not decided here. Every method passes the caller's identifier down
 * to {@code ProjectFaqService}, which asks {@code ProjectAccess} — the one place in the
 * service where "who may act on this campaign" is settled.
 *
 * <p><strong>No {@code Idempotency-Key} on any of these.</strong> §10.3 requires one on
 * payment mutations, and none of these is one. A retried create writes a second entry,
 * which is visible on the tab and something the creator can see and delete — unlike a
 * second charge.
 */
@RestController
public class ProjectFaqController {

    private final ProjectFaqService faqs;

    public ProjectFaqController(ProjectFaqService faqs) {
        this.faqs = faqs;
    }

    /**
     * Adds an entry to the end of the campaign's list.
     *
     * <p><strong>201 with the entry, and no {@code Location} header.</strong> §10.2 gives
     * an FAQ entry a flat address — {@code /v1/faqs/{id}} — but no {@code GET} on it: the
     * tab and the editor both read the campaign's list. A {@code Location} pointing at a
     * URL that answers 405 would be worse than no header, and the identifier a client
     * needs in order to edit or reorder the entry is in the body.
     */
    @PostMapping("/v1/projects/{projectId}/faqs")
    @ResponseStatus(HttpStatus.CREATED)
    public ProjectFaqResponse create(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @RequestBody CreateFaqRequest request) {

        return ProjectFaqResponse.of(faqs.add(projectId, callerOf(accessToken), request.toCommand()));
    }

    /**
     * Applies a partial edit and returns the whole entry.
     *
     * <p>The whole entry rather than the fields that changed, for
     * {@code RewardController#edit}'s reason: a client that merged a partial response
     * would be holding a body it never received in full, and the two fields here are
     * small enough that sending both is free.
     */
    @PatchMapping("/v1/faqs/{id}")
    public ProjectFaqResponse edit(
            @AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id, @RequestBody FaqPatchRequest request) {

        return ProjectFaqResponse.of(faqs.edit(id, callerOf(accessToken), request.toPatch()));
    }

    /**
     * Removes an entry.
     *
     * <p>204 and no body. A hard delete: nothing references an FAQ entry, so there is no
     * row whose meaning depends on this one surviving — see
     * {@code ProjectFaqService#remove} for why that is not the platform's usual soft
     * delete.
     */
    @DeleteMapping("/v1/faqs/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID id) {
        faqs.remove(id, callerOf(accessToken));
    }

    /**
     * Puts the entries in the order given, and answers with the list in that order.
     *
     * <p>{@code PATCH} on the collection rather than a position on each entry: the order
     * is a property of the list, and a per-entry position would let two requests both
     * claim position three.
     *
     * <p>The body names every entry of the campaign exactly once or the request is a
     * {@code 400 FAQ_ORDER_INCOMPLETE}. A partial list would leave the entries it omits
     * where they were, interleaved with the ones that moved.
     *
     * <p>Answered with the same {@link ProjectFaqListResponse} the public read uses, so a
     * client that has just reordered holds exactly what the tab would have served it.
     */
    @PatchMapping("/v1/projects/{projectId}/faqs/reorder")
    public ResponseEntity<ProjectFaqListResponse> reorder(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Valid @RequestBody ReorderFaqsRequest request) {

        List<ProjectFaq> reordered = faqs.reorder(projectId, callerOf(accessToken), request.faqIds());
        return ResponseEntity.ok(new ProjectFaqListResponse(
                reordered.stream().map(ProjectFaqResponse::of).toList()));
    }

    /**
     * The account making the request, as our own signature establishes it.
     *
     * <p>Not read from anything the caller could choose.
     */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
