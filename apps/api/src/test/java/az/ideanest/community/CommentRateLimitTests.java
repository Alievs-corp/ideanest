package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import az.ideanest.community.api.CommentController;
import az.ideanest.community.api.PostCommentRequest;
import az.ideanest.community.application.CommentService;
import az.ideanest.community.domain.Comment;
import az.ideanest.shared.ratelimit.InMemoryRateLimiter;
import az.ideanest.shared.ratelimit.RateLimitExceededException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.context.request.ServletWebRequest;

/**
 * §17.3's shape applied to the comment box, at the boundary.
 *
 * <p><strong>Not an integration test, and deliberately not one</strong>, for
 * {@code SearchRateLimitTests}' and {@code ReportRateLimitTests}' reason: the suite
 * shares a single Spring context and therefore a single limiter, and every request in
 * it comes from {@code 127.0.0.1} — so a per-address budget small enough to exhaust in
 * a test is a budget {@code CommentApiTests} would exhaust for it. Driving the
 * controller directly keeps the assertion exact: ten comments are accepted, the
 * eleventh is not, and it is not the ninth.
 *
 * <p>The numbers are not the point. Three claims {@code CommentController} makes in
 * prose are, and none of them was previously executed anywhere:
 *
 * <ul>
 *   <li><strong>Both budgets are spent.</strong> A per-account limit alone does not
 *       bound somebody with fifty accounts, and a per-address limit alone would refuse
 *       a whole office because one person behind its NAT is arguing on a campaign page.
 *   <li><strong>One budget across both writes.</strong> Posting and replying share it,
 *       so an author who has spent their allowance on top-level comments cannot spend a
 *       second one on replies — which would be the same flood one level down.
 *   <li><strong>Deleting is not counted.</strong> §17.3's control exists to stop a
 *       spam flood; a creator clearing one must not be stopped part way through by it.
 * </ul>
 */
class CommentRateLimitTests {

    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-08-18T12:00:00Z"), ZoneOffset.UTC);

    /** As {@code CommunityProperties} defaults it; §17.3 names no number for commenting. */
    private static final int PER_AUTHOR = CommunityProperties.defaults().comments().perAuthor();

    private static final int PER_CLIENT = CommunityProperties.defaults().comments().perClient();

    private CommentController comments;
    private MockHttpServletRequest request;

    @BeforeEach
    void buildTheEndpoint() {
        comments = new CommentController(
                new AcceptingCommentService(), new InMemoryRateLimiter(FIXED), CommunityProperties.defaults());
        bindARequest("198.51.100.7");
    }

    @AfterEach
    void unbindTheRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    @DisplayName("the tenth comment from one account is accepted and the eleventh is refused")
    void refusesPastTheAuthorBudget() {
        UUID author = UUID.randomUUID();

        for (int attempt = 0; attempt < PER_AUTHOR; attempt++) {
            assertThatCode(() -> post(author)).doesNotThrowAnyException();
        }

        assertThatThrownBy(() -> post(author)).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("one account's exhausted budget does not refuse another account")
    void theAuthorBudgetIsPerAccount() {
        UUID first = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_AUTHOR; attempt++) {
            post(first);
        }

        // Otherwise one person commenting a lot would silence everybody else on the
        // campaign, which is a denial of service against the conversation rather than
        // protection for it.
        assertThatCode(() -> post(UUID.randomUUID())).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a source address is bounded across accounts, which is what the per-account limit cannot do")
    void theAddressBudgetSpansAccounts() {
        // A fresh account per comment, so the per-author limit never fires and the only
        // thing that can refuse this is the address budget.
        for (int attempt = 0; attempt < PER_CLIENT; attempt++) {
            post(UUID.randomUUID());
        }

        assertThatThrownBy(() -> post(UUID.randomUUID())).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("the author's budget is spent before the address's")
    void theTighterBudgetIsCheckedFirst() {
        UUID author = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_AUTHOR; attempt++) {
            post(author);
        }
        assertThatThrownBy(() -> post(author)).isInstanceOf(RateLimitExceededException.class);

        // A client over its own budget must not also spend a unit of the address
        // budget, which belongs to whoever else is behind the same NAT. Ten comments
        // have been written from this address and the eleventh was refused before it
        // was counted, so exactly the address budget less ten is left for everybody
        // else -- and a fresh account per attempt keeps the per-author limit out of the
        // way, so the address budget is the only thing that could refuse one of them.
        for (int attempt = 0; attempt < PER_CLIENT - PER_AUTHOR; attempt++) {
            assertThatCode(() -> post(UUID.randomUUID())).doesNotThrowAnyException();
        }
        assertThatThrownBy(() -> post(UUID.randomUUID())).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("a reply spends the same budget as a comment, so the flood cannot move one level down")
    void repliesShareTheAuthorBudget() {
        UUID author = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_AUTHOR; attempt++) {
            post(author);
        }

        assertThatThrownBy(() -> reply(author)).isInstanceOf(RateLimitExceededException.class);
    }

    @Test
    @DisplayName("removing a comment is not counted, so a creator clearing a flood is not stopped by the flood control")
    void deletingSpendsNothing() {
        UUID actor = UUID.randomUUID();
        for (int attempt = 0; attempt < PER_AUTHOR; attempt++) {
            post(actor);
        }
        assertThatThrownBy(() -> post(actor)).isInstanceOf(RateLimitExceededException.class);

        // CD-14 is the answer to spam, so the answer cannot be rationed by the same
        // budget the spam exhausted. Deleting writes one column on a row the caller
        // already owns or moderates.
        for (int attempt = 0; attempt < PER_AUTHOR * 2; attempt++) {
            assertThatCode(() -> comments.delete(accessTokenFor(actor), UUID.randomUUID()))
                    .doesNotThrowAnyException();
        }
    }

    @Test
    @DisplayName("the response says how much of the allowance is left before it runs out")
    void theAllowanceIsReported() {
        MockHttpServletResponse response = currentResponse();

        post(UUID.randomUUID());

        // A client that can see its allowance shrinking can slow down; one that cannot
        // only finds out by being refused. §10.3's convention, and RateLimits reports
        // the tightest of the two budgets.
        assertThat(response.getHeader("X-RateLimit-Remaining")).isNotNull();
        assertThat(response.getHeader("X-RateLimit-Limit")).isNotNull();
    }

    private void post(UUID authorId) {
        comments.post(
                accessTokenFor(authorId),
                UUID.randomUUID(),
                new PostCommentRequest("Looks good."),
                request);
    }

    private void reply(UUID authorId) {
        comments.reply(
                accessTokenFor(authorId),
                UUID.randomUUID(),
                new PostCommentRequest("So does this."),
                request);
    }

    private static Jwt accessTokenFor(UUID accountId) {
        return Jwt.withTokenValue("access-token")
                .header("alg", "none")
                .subject(accountId.toString())
                .claim("sub", accountId.toString())
                .build();
    }

    /**
     * A bound request and response, which is what {@code RateLimits} writes the
     * allowance onto. Without it the headers have nowhere to go and the limiter's
     * refusal would be the only thing this test could observe.
     */
    private void bindARequest(String address) {
        request = new MockHttpServletRequest();
        request.setRemoteAddr(address);
        RequestContextHolder.setRequestAttributes(new ServletWebRequest(request, new MockHttpServletResponse()));
    }

    private static MockHttpServletResponse currentResponse() {
        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return (MockHttpServletResponse) attributes.getResponse();
    }

    /**
     * A comment service that always succeeds.
     *
     * <p>The limiter is what is being tested, so the work behind it is replaced rather
     * than mocked, following {@code ReportRateLimitTests}: a stub with three overridden
     * methods is a stub whose behaviour a reader can see, and it cannot drift from the
     * real signatures without failing to compile. Its collaborators are null and none
     * is reachable — every method that would touch one is overridden here.
     */
    private static final class AcceptingCommentService extends CommentService {

        private AcceptingCommentService() {
            super(null, null, null, null, null, null, null, null, null);
        }

        @Override
        public Comment post(UUID projectId, UUID authorId, String body) {
            return Comment.root(projectId, authorId, body, false);
        }

        @Override
        public Comment reply(UUID parentId, UUID authorId, String body) {
            Comment parent = Comment.root(UUID.randomUUID(), authorId, "The parent.", false);
            return Comment.replyTo(parent, authorId, body, false);
        }

        @Override
        public Comment delete(UUID commentId, UUID actorId) {
            Comment comment = Comment.root(UUID.randomUUID(), actorId, "Withdrawn.", false);
            comment.deleteBy(actorId, Instant.now(FIXED));
            return comment;
        }
    }
}
