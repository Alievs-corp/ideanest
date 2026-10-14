package az.ideanest.community.api;

import az.ideanest.community.CommunityProperties;
import az.ideanest.community.application.CommentAuthors;
import az.ideanest.community.application.CommentService;
import az.ideanest.community.domain.Comment;
import az.ideanest.shared.ratelimit.ClientAddress;
import az.ideanest.shared.ratelimit.RateLimiter;
import az.ideanest.shared.ratelimit.RateLimits;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Writing and removing comments. §10.2's three community writes:
 * {@code POST /v1/projects/{id}/comments}, {@code POST /v1/comments/{id}/reply} and
 * {@code DELETE /v1/comments/{id}}.
 *
 * <p><strong>A separate controller from {@link PublicCommentController}, sharing a
 * path.</strong> Spring routes on the method and the filter chain permits only the
 * {@code GET} — the same split {@code ProjectUpdateController} already makes, and for
 * the same reason: one class here requires a bearer token and the other must not, and a
 * reader should be able to tell which is which without opening the security
 * configuration.
 *
 * <p><strong>None of these three appears in {@code SecurityConfiguration}</strong>, so
 * all three fall through to the catch-all rule and require a bearer token from an
 * account that is not inside §17.4's deletion grace period. That is the enforceable
 * half of §3.1's "only backers of that project and its creator may comment"; the other
 * half, and why this release cannot ask it, is in {@code CommentService}.
 *
 * <p><strong>Rate limiting is here rather than in the service</strong>, following
 * {@code ContentReportController} and {@code AuthController}: it is about the transport
 * — a source address, a 429, a {@code Retry-After} — and the service should not have to
 * know it is being reached over HTTP.
 *
 * <p><strong>The two budgets are spent by posting and replying and not by
 * deleting.</strong> A comment box is the abuse surface (§17.3's "bot traffic:
 * challenge on registration and comment"); removing a comment writes one column on a
 * row the caller already owns or moderates, and rate limiting it would mean a creator
 * clearing a spam flood being stopped part way through by the control that exists to
 * stop the flood.
 *
 * <p><strong>One budget across both writes, not one each.</strong> Splitting them would
 * mean somebody who had spent their allowance on top-level comments could then spend a
 * second one on replies, which is the same flood arriving one level down.
 *
 * <p>Authorisation is not decided here. The caller's identifier goes down to
 * {@code CommentService}, which asks {@code ProjectAccess} — the one place in the
 * module where "who may act on this campaign" is settled.
 */
@RestController
public class CommentController {

    private final CommentService comments;
    private final CommentAuthors authors;
    private final RateLimiter rateLimiter;
    private final CommunityProperties properties;

    public CommentController(
            CommentService comments,
            CommentAuthors authors,
            RateLimiter rateLimiter,
            CommunityProperties properties) {
        this.comments = comments;
        this.authors = authors;
        this.rateLimiter = rateLimiter;
        this.properties = properties;
    }

    /**
     * Says something under a campaign. §4.9's C-01.
     *
     * <p><strong>201 with the comment, and no {@code Location} header.</strong> The
     * comment has an identifier and three endpoints of its own, but no address to
     * {@code GET} — §10.2 gives it no read route of its own, only the tab it appears
     * in — so a {@code Location} would be a header pointing at nothing.
     *
     * <p><strong>No {@code Idempotency-Key}.</strong> §10.3 requires one on payment
     * mutations and this is not one. A retried post creates a second comment, which is
     * visible on the page and which its author can remove — unlike a second charge.
     */
    @PostMapping("/v1/projects/{projectId}/comments")
    public ResponseEntity<CommentResponse> post(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID projectId,
            @Valid @RequestBody PostCommentRequest request,
            HttpServletRequest httpRequest) {

        UUID authorId = callerOf(accessToken);
        spendWritingBudget(authorId, httpRequest);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(named(comments.post(projectId, authorId, request.body())));
    }

    /**
     * Answers a comment. §4.9's C-03.
     *
     * <p>The campaign is not in the path and is not accepted from the body: it is the
     * parent's, which is what makes a reply belong to its parent's conversation by
     * construction rather than by the client agreeing to say so.
     *
     * <p>Replying to a reply is a 422 naming the bound — see
     * {@code ReplyDepthExceededException} and {@code CommentResponse#acceptsReplies},
     * which is on every row so a client can place the control rather than discover the
     * rule by being refused.
     */
    @PostMapping("/v1/comments/{commentId}/reply")
    public ResponseEntity<CommentResponse> reply(
            @AuthenticationPrincipal Jwt accessToken,
            @PathVariable UUID commentId,
            @Valid @RequestBody PostCommentRequest request,
            HttpServletRequest httpRequest) {

        UUID authorId = callerOf(accessToken);
        spendWritingBudget(authorId, httpRequest);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(named(comments.reply(commentId, authorId, request.body())));
    }

    /**
     * Removes a comment: its author withdrawing it, the campaign's team moderating it
     * (CD-14), or platform staff (AD-09).
     *
     * <p><strong>200 with the tombstone, not 204.</strong> Deleting a comment does not
     * remove it from the page — V25's header is why — so the client has a row to
     * re-render, and a 204 would leave it guessing whether to strike the comment out or
     * take it away. The body is the same {@code CommentResponse} the tab serves, with
     * no text in it.
     *
     * <p>Deleting an already-removed comment succeeds and changes nothing, so a double
     * tap and a retry are both harmless.
     */
    @DeleteMapping("/v1/comments/{commentId}")
    public CommentResponse delete(@AuthenticationPrincipal Jwt accessToken, @PathVariable UUID commentId) {
        // A tombstone names nobody, so there is no name to look up.
        return CommentResponse.of(comments.delete(commentId, callerOf(accessToken)), Map.of());
    }

    /**
     * A comment just written, with its author named as the tab will name them (#255) — so the
     * row a client draws from this answer is the row the next read of the tab draws.
     */
    private CommentResponse named(Comment comment) {
        return CommentResponse.of(comment, authors.on(comment.getProjectId(), List.of(comment)));
    }

    /**
     * Counts this write against both budgets, before anything is stored.
     *
     * <p>The author's own budget is counted first: it is the tighter of the two and the
     * one an attacker actually has to spend, so a client that is already over it should
     * not also take a unit of the address budget from whoever shares its NAT.
     */
    private void spendWritingBudget(UUID authorId, HttpServletRequest httpRequest) {
        CommunityProperties.Comments limits = properties.comments();
        RateLimits.enforce(
                rateLimiter.recordAttempt("comment:account:" + authorId, limits.perAuthor(), limits.window()));
        RateLimits.enforce(rateLimiter.recordAttempt(
                "comment:ip:" + ClientAddress.of(httpRequest), limits.perClient(), limits.window()));
    }

    /**
     * The account making the request, as our own signature establishes it.
     *
     * <p>Not read from anything the caller could choose. It decides whose name is on the
     * comment and, through {@code ProjectAccess}, whether the comment is marked as the
     * campaign's.
     */
    private static UUID callerOf(Jwt accessToken) {
        return UUID.fromString(accessToken.getSubject());
    }
}
