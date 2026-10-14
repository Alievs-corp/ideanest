package az.ideanest.community.api;

import az.ideanest.community.application.CommentPage;
import az.ideanest.community.application.CommentService;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;

/**
 * The Comments tab. §10.2's {@code GET /v1/projects/{id}/comments}, listed under
 * "Project — public".
 *
 * <p><strong>Public, and still identity-aware</strong>, exactly as
 * {@code PublicProjectUpdateController} is: the filter chain permits this path without
 * a token, and when one is presented the resource server still validates it — which is
 * what lets a creator read the comments on a campaign the public cannot see yet.
 *
 * <p><strong>Two reads on one route.</strong> Without {@code thread} it is the tab: a
 * page of conversations, each with a preview of its replies. With it, one conversation
 * and a page of its replies — what the "show more replies" control asks for. A query
 * parameter rather than a second route, because it is the same resource with a narrower
 * question, and a second route would need its own cache policy and its own security
 * rule to be kept in step with this one.
 *
 * <h2>Caching</h2>
 *
 * <p>§10.3 asks for {@code ETag} and {@code Cache-Control} on a public read.
 * {@code public, no-cache} for everybody — "keep this body and ask before you use it
 * again". Unlike the Updates tab there is no private variant, because there is no
 * private content: a comment has no {@code BACKERS_ONLY} and no scheduling, so the
 * campaign's own team is served the same page as a visitor and the body is shareable.
 *
 * <p><strong>Except for a reader who has blocked somebody</strong> — #324. Their page leaves
 * out the blocked accounts' comments, so it is theirs alone, and it is served
 * {@code private, no-cache}: a shared cache holding it would show one person's blocks to the
 * next reader, and whom somebody blocked is exactly what a block keeps private. Every other
 * reader, signed in or not, still gets the public page.
 *
 * <p>A {@code max-age} is deliberately not offered. This is the one surface on the
 * campaign page where a person is waiting for an answer to the question they just
 * asked, and buying throughput by making exactly that request the stale one is the
 * wrong trade. The policy is written on the raw response rather than on the
 * {@code ResponseEntity}, because {@code checkNotModified} writes the 304 itself and
 * never passes through one.
 */
@RestController
public class PublicCommentController {

    private final CommentService comments;

    public PublicCommentController(CommentService comments) {
        this.comments = comments;
    }

    /**
     * One page of the campaign's conversations, or one conversation's replies.
     *
     * @param thread absent for the tab; a root comment's identifier to page that one
     *     conversation's replies
     * @param cursor the {@code nextCursor} from the previous page — or the
     *     {@code nextReplyCursor} of the thread being expanded. Absent for the first
     * @param limit how many to return, capped by the service. Absent means the default
     * @return {@code 404} for a campaign that does not exist and for one whose state is
     *     not public, identically, unless the caller is on its team; {@code 304} when
     *     the caller already holds this exact page
     */
    @GetMapping("/v1/projects/{projectId}/comments")
    public ResponseEntity<CommentListResponse> list(
            WebRequest request,
            HttpServletResponse response,
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @RequestParam(name = "thread", required = false) UUID thread,
            @RequestParam(name = "cursor", required = false) UUID cursor,
            @RequestParam(name = "limit", required = false) Integer limit) {

        UUID viewerId = callerOf(accessToken);
        CommentPage page = thread == null
                ? comments.list(projectId, viewerId, cursor, limit)
                : comments.thread(projectId, thread, viewerId, cursor, limit);

        CommentListResponse body = CommentListResponse.of(page);
        response.setHeader(
                HttpHeaders.CACHE_CONTROL,
                (page.personal() ? CacheControl.noCache().cachePrivate() : CacheControl.noCache().cachePublic())
                        .getHeaderValue());

        String etag = body.etag();
        if (request.checkNotModified(etag)) {
            return null;
        }
        return ResponseEntity.ok().eTag(etag).body(body);
    }

    /**
     * The account making the request, or null when nobody signed in.
     *
     * <p>Taken from our own signature and never from a parameter: a viewer identifier a
     * client could choose would let anybody read the comments under another person's
     * unlaunched campaign by naming its creator.
     */
    private static UUID callerOf(Jwt accessToken) {
        return accessToken == null ? null : UUID.fromString(accessToken.getSubject());
    }
}
