package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Comments over HTTP: who may write one, what a reply may hang under, who is marked as
 * the campaign, who may remove one, and what a removal leaves behind.
 *
 * <p>The tests that carry the design are
 * {@link #theCreatorHighlightIsDecidedByTheServerAndNotByTheClient()},
 * {@link #removingARootLeavesItsRepliesReadable()} and
 * {@link #aReplyToAReplyIsRefusedWithTheBound()}. The first is C-02 being a fact rather
 * than a claim — a client that could set it could impersonate the campaign on the page
 * where people decide to send money. The second is the whole argument for the
 * tombstone. The third is the depth rule reaching the person who would otherwise build
 * an infinitely nesting UI against it.
 *
 * <p>Reporting a comment is here rather than in {@code ContentReportApiTests}, because
 * what it proves is about <em>this</em> issue: that C-07 goes through the moderation
 * module's existing intake and inherits V23's deduplication rather than growing a
 * second one.
 */
class CommentApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private DataSource dataSource;

    /** Pledges this class wrote, so the cleanup removes exactly those. */
    private final List<UUID> pledgesMade = new ArrayList<>();

    @AfterEach
    void clearCampaigns() {
        // Comments cascade from projects; deleted explicitly anyway, because a
        // cleanup that relies on a cascade stops working the day the cascade is
        // reconsidered and nothing says why. Reports deliberately cascade from
        // nothing -- a report outlives what it was about -- so they go by hand. The
        // audit rows are left: `audit_logs` refuses DELETE, which is the property it
        // exists for, so every assertion here is scoped to its own campaign.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM content_reports");
        jdbc.update("DELETE FROM comments");
        // The anonymous-backer fixture (#255) writes pledges, which refer to their campaign.
        // Only those: another suite's rows are that suite's to clear.
        for (UUID pledge : pledgesMade) {
            jdbc.update("DELETE FROM pledges WHERE id = ?", pledge);
        }
        pledgesMade.clear();
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id) {
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id);
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = jsonHeaders();
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> get(String path, String token) {
        return exchange(path, HttpMethod.GET, token, null);
    }

    /** A campaign in DRAFT, owned by this account. */
    private UUID draft(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign with comments " + SEQUENCE.incrementAndGet()));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** A campaign the public can read: LIVE, which is one of §6.1's nine public states. */
    private UUID liveCampaign(Account creator) {
        UUID project = draft(creator);
        // Written directly rather than driven through moderation: this suite is not
        // testing the campaign lifecycle, and driving every fixture through the
        // approval path would make each of these tests depend on it.
        Campaigns.launch(dataSource, project);
        return project;
    }

    private ResponseEntity<Map<String, Object>> post(UUID project, Account author, String body) {
        return exchange(
                "/v1/projects/" + project + "/comments", HttpMethod.POST, author.accessToken(), Map.of("body", body));
    }

    private ResponseEntity<Map<String, Object>> reply(UUID commentId, Account author, String body) {
        return exchange("/v1/comments/" + commentId + "/reply", HttpMethod.POST, author.accessToken(), Map.of("body", body));
    }

    private ResponseEntity<Map<String, Object>> delete(UUID commentId, Account actor) {
        return exchange("/v1/comments/" + commentId, HttpMethod.DELETE, actor.accessToken(), null);
    }

    private static UUID idOf(ResponseEntity<Map<String, Object>> response) {
        return UUID.fromString((String) response.getBody().get("id"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> threadsIn(ResponseEntity<Map<String, Object>> response) {
        return (List<Map<String, Object>>) response.getBody().get("threads");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> rootOf(Map<String, Object> thread) {
        return (Map<String, Object>) thread.get("root");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> repliesOf(Map<String, Object> thread) {
        return (List<Map<String, Object>>) thread.get("replies");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> metaOf(Map<String, Object> problem) {
        return (Map<String, Object>) problem.get("meta");
    }

    // ------------------------------------------------------------------
    // Writing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a signed-in account can comment on a campaign it can see")
    void aSignedInAccountCanComment() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> posted = post(project, backer, "Will this ship to Baku?");

        assertThat(posted.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(posted.getBody().get("body")).isEqualTo("Will this ship to Baku?");
        assertThat(posted.getBody().get("depth")).isEqualTo(0);
        assertThat(posted.getBody().get("byCreator")).isEqualTo(false);
        assertThat(posted.getBody().get("acceptsReplies")).isEqualTo(true);
        // A root heads its own thread, which is what makes the replies query find it.
        assertThat(posted.getBody().get("threadId")).isEqualTo(posted.getBody().get("id"));
        assertThat(posted.getBody().get("parentId")).isNull();
    }

    @Test
    @DisplayName("a comment names its author as their public profile does, when written and when read (#255)")
    void aCommentNamesItsAuthor() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> posted = post(project, backer, "Will this ship to Baku?");
        assertThat(authorOf(posted.getBody())).containsEntry("name", "Test Person").containsKey("avatarUrl");

        Map<String, Object> listed = rootOf(threadsIn(get("/v1/projects/" + project + "/comments", null)).getFirst());
        assertThat(authorOf(listed)).containsEntry("name", "Test Person");
        // The identifier stays: it is what a reader's block list is matched against.
        assertThat(listed.get("authorId")).isEqualTo(backer.id().toString());
    }

    @Test
    @DisplayName("an author whose profile is private is not named under their comment")
    void aPrivateProfileIsNotNamed() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        new JdbcTemplate(dataSource).update("UPDATE users SET profile_visibility = 'PRIVATE' WHERE id = ?", backer.id());

        ResponseEntity<Map<String, Object>> posted = post(project, backer, "Quietly asking.");
        assertThat(posted.getBody()).containsKey("author");
        assertThat(posted.getBody().get("author")).isNull();

        Map<String, Object> listed = rootOf(threadsIn(get("/v1/projects/" + project + "/comments", null)).getFirst());
        assertThat(listed.get("author")).isNull();
    }

    @Test
    @DisplayName("a backer who backed this campaign anonymously is not named under their comment")
    void anAnonymousBackerIsNotNamed() {
        Account creator = account("creator");
        Account hidden = account("hidden");
        Account open = account("open");
        UUID project = liveCampaign(creator);
        UUID pledge = Pledges.confirmedFor(dataSource, project, hidden.id(), "25.00");
        pledgesMade.add(pledge);
        new JdbcTemplate(dataSource).update("UPDATE pledges SET is_anonymous = true WHERE id = ?", pledge);
        pledgesMade.add(Pledges.confirmedFor(dataSource, project, open.id(), "25.00"));

        post(project, hidden, "From somebody who asked not to be named.");
        post(project, open, "From somebody who did not.");

        List<Map<String, Object>> threads = threadsIn(get("/v1/projects/" + project + "/comments", null));
        Map<String, Object> newest = rootOf(threads.get(0));
        Map<String, Object> older = rootOf(threads.get(1));
        assertThat(newest.get("authorId")).isEqualTo(open.id().toString());
        assertThat(authorOf(newest)).containsEntry("name", "Test Person");
        assertThat(older.get("authorId")).isEqualTo(hidden.id().toString());
        assertThat(older.get("author")).isNull();
    }

    @Test
    @DisplayName("a removed comment names nobody")
    void aRemovedCommentNamesNobody() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID comment = idOf(post(project, backer, "Withdrawn in a moment."));

        assertThat(delete(comment, backer).getBody().get("author")).isNull();
        Map<String, Object> listed = rootOf(threadsIn(get("/v1/projects/" + project + "/comments", null)).getFirst());
        assertThat(listed.get("author")).isNull();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> authorOf(Map<String, Object> comment) {
        assertThat(comment.get("author")).as("a named author").isInstanceOf(Map.class);
        return (Map<String, Object>) comment.get("author");
    }

    @Test
    @DisplayName("an anonymous caller cannot comment, though it can read")
    void anonymousCallersCannotComment() {
        Account creator = account("creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> anonymous =
                exchange("/v1/projects/" + project + "/comments", HttpMethod.POST, null, Map.of("body", "Hello."));

        // §3.1's Guest row. The write falls through SecurityConfiguration to the
        // catch-all rule; the read beside it is explicitly permitted.
        assertThat(anonymous.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get("/v1/projects/" + project + "/comments", null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a campaign the public cannot see answers 404 to a stranger and serves its creator")
    void aDraftIsNotCommentable() {
        Account creator = account("creator");
        Account stranger = account("stranger");
        UUID project = draft(creator);

        // The same 404 for "no such campaign" and "not yours to see", so the
        // endpoint cannot be used to find out what somebody is preparing.
        assertThat(post(project, stranger, "Interesting.").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(get("/v1/projects/" + project + "/comments", stranger.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        // The creator reads their own unlaunched campaign, which is why the team is
        // asked about before PublicProjects is.
        assertThat(get("/v1/projects/" + project + "/comments", creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a comment of whitespace is refused, naming the field")
    void blankCommentsAreRefused() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = post(project, backer, "   ");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("code")).isEqualTo("COMMENT_CONTENT_INVALID");
        assertThat(metaOf(refused.getBody()).get("field")).isEqualTo("body");
    }

    // ------------------------------------------------------------------
    // Threading
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reply joins its parent's thread without being told which")
    void aReplyJoinsItsParentsThread() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Will this ship to Baku?"));

        ResponseEntity<Map<String, Object>> answered = reply(root, creator, "Yes, from March.");

        assertThat(answered.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(answered.getBody().get("depth")).isEqualTo(1);
        assertThat(answered.getBody().get("parentId")).isEqualTo(root.toString());
        assertThat(answered.getBody().get("threadId")).isEqualTo(root.toString());
        // The end of the line, and the response says so rather than making a client
        // find out by being refused.
        assertThat(answered.getBody().get("acceptsReplies")).isEqualTo(false);
    }

    @Test
    @DisplayName("a reply to a reply is refused with the bound")
    void aReplyToAReplyIsRefusedWithTheBound() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Will this ship to Baku?"));
        UUID answer = idOf(reply(root, creator, "Yes, from March."));

        ResponseEntity<Map<String, Object>> refused = reply(answer, backer, "Thanks.");

        // 422 and not 400: the request is well formed and every field in it is
        // valid; what is wrong is the state of the comment it names.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody().get("code")).isEqualTo("REPLY_DEPTH_EXCEEDED");
        assertThat(metaOf(refused.getBody()).get("maxDepth")).isEqualTo(1);
    }

    @Test
    @DisplayName("the tab returns conversations newest first, each with its replies oldest first")
    void theTabIsOrderedForReading() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);

        UUID first = idOf(post(project, backer, "First question."));
        idOf(post(project, backer, "Second question."));
        reply(first, creator, "First answer.");
        reply(first, backer, "Second answer.");

        List<Map<String, Object>> threads = threadsIn(get("/v1/projects/" + project + "/comments", null));

        // Conversations newest first -- nobody opens a busy campaign to read the
        // oldest thing anybody said -- and a conversation forwards, because that is
        // the only order in which an answer follows its question.
        assertThat(threads).hasSize(2);
        assertThat(rootOf(threads.get(0)).get("body")).isEqualTo("Second question.");
        assertThat(rootOf(threads.get(1)).get("body")).isEqualTo("First question.");
        assertThat(repliesOf(threads.get(1)))
                .extracting(replyRow -> replyRow.get("body"))
                .containsExactly("First answer.", "Second answer.");
    }

    @Test
    @DisplayName("a busy thread is previewed in the list and paged on its own")
    void aBusyThreadIsPreviewedAndThenPaged() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Will this ship to Baku?"));
        for (int i = 1; i <= 8; i++) {
            reply(root, backer, "Reply " + i);
        }

        List<Map<String, Object>> threads = threadsIn(get("/v1/projects/" + project + "/comments", null));

        // The preview is bounded per thread, so one long argument cannot decide the
        // size of every response the tab ever serves. `nextReplyCursor` is how the
        // client asks for the rest -- a count of what is left would be a second
        // aggregate over rows already read.
        assertThat(repliesOf(threads.getFirst())).hasSize(5);
        Object cursor = threads.getFirst().get("nextReplyCursor");
        assertThat(cursor).isNotNull();

        List<Map<String, Object>> rest = threadsIn(
                get("/v1/projects/" + project + "/comments?thread=" + root + "&cursor=" + cursor, null));

        assertThat(rest).hasSize(1);
        assertThat(rootOf(rest.getFirst()).get("id")).isEqualTo(root.toString());
        assertThat(repliesOf(rest.getFirst()))
                .extracting(replyRow -> replyRow.get("body"))
                .containsExactly("Reply 6", "Reply 7", "Reply 8");
    }

    @Test
    @DisplayName("the conversation list pages by cursor without repeating or skipping a row")
    void theListPagesByCursor() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        for (int i = 1; i <= 5; i++) {
            post(project, backer, "Question " + i);
        }

        ResponseEntity<Map<String, Object>> firstPage = get("/v1/projects/" + project + "/comments?limit=2", null);
        Object cursor = firstPage.getBody().get("nextCursor");
        assertThat(cursor).isNotNull();

        ResponseEntity<Map<String, Object>> secondPage =
                get("/v1/projects/" + project + "/comments?limit=2&cursor=" + cursor, null);

        // Keyset, not offset: a comment posted between the two requests would shift
        // every offset page and show one row twice while hiding another.
        assertThat(threadsIn(firstPage))
                .extracting(thread -> rootOf(thread).get("body"))
                .containsExactly("Question 5", "Question 4");
        assertThat(threadsIn(secondPage))
                .extracting(thread -> rootOf(thread).get("body"))
                .containsExactly("Question 3", "Question 2");
    }

    // ------------------------------------------------------------------
    // The creator highlight
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the creator highlight is decided by the server and not by the client")
    void theCreatorHighlightIsDecidedByTheServerAndNotByTheClient() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);

        // The backer claims the campaign wrote it. The request type has no such
        // field, so the claim is dropped by the message converter -- and even if a
        // field existed, CommentService takes the answer from ProjectAccess.
        ResponseEntity<Map<String, Object>> impersonation = exchange(
                "/v1/projects/" + project + "/comments",
                HttpMethod.POST,
                backer.accessToken(),
                Map.of("body", "Trust me, I am the creator.", "byCreator", true));

        assertThat(impersonation.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(impersonation.getBody().get("byCreator")).isEqualTo(false);

        // And the actual creator is marked without asking to be.
        ResponseEntity<Map<String, Object>> fromTheCampaign = post(project, creator, "Shipping starts in March.");
        assertThat(fromTheCampaign.getBody().get("byCreator")).isEqualTo(true);
    }

    @Test
    @DisplayName("the highlight is on the reply the campaign wrote and on nothing else in the thread")
    void theHighlightTravelsWithTheAuthor() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Will this ship to Baku?"));
        reply(root, creator, "Yes, from March.");
        reply(root, backer, "Thanks.");

        List<Map<String, Object>> threads = threadsIn(get("/v1/projects/" + project + "/comments", null));

        // C-02: "creator replies visually distinguished". The page needs it per row,
        // and it is stored per row rather than derived from a join that would answer
        // differently after a collaborator's grant was revoked.
        assertThat(rootOf(threads.getFirst()).get("byCreator")).isEqualTo(false);
        assertThat(repliesOf(threads.getFirst()))
                .extracting(replyRow -> replyRow.get("byCreator"))
                .containsExactly(true, false);
    }

    // ------------------------------------------------------------------
    // Removing
    // ------------------------------------------------------------------

    @Test
    @DisplayName("removing a root leaves its replies readable")
    void removingARootLeavesItsRepliesReadable() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Something regrettable."));
        reply(root, creator, "We have answered this by email.");

        ResponseEntity<Map<String, Object>> removed = delete(root, backer);

        // 200 with the tombstone rather than 204: the comment is still on the page,
        // so the client has a row to re-render.
        assertThat(removed.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(removed.getBody().get("deleted")).isEqualTo(true);
        assertThat(removed.getBody().get("body")).isNull();

        List<Map<String, Object>> threads = threadsIn(get("/v1/projects/" + project + "/comments", null));

        // The requirement: a deleted comment with replies must not orphan the
        // thread. The root keeps its place, loses its text and its author, and the
        // answer under it is untouched.
        assertThat(threads).hasSize(1);
        assertThat(rootOf(threads.getFirst()).get("deleted")).isEqualTo(true);
        assertThat(rootOf(threads.getFirst()).get("body")).isNull();
        assertThat(rootOf(threads.getFirst()).get("authorId")).isNull();
        assertThat(rootOf(threads.getFirst()).get("acceptsReplies")).isEqualTo(false);
        assertThat(repliesOf(threads.getFirst()))
                .extracting(replyRow -> replyRow.get("body"))
                .containsExactly("We have answered this by email.");
    }

    @Test
    @DisplayName("a removed comment takes no new replies")
    void aTombstoneTakesNoReplies() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Something regrettable."));
        delete(root, backer);

        // 404 rather than a distinct refusal: a removed comment is frequently one
        // trust and safety has just acted on, and telling "removed" apart from
        // "never existed" would confirm to whoever wrote it that somebody took it
        // down.
        assertThat(reply(root, creator, "Answering anyway.").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    @DisplayName("a stranger cannot remove somebody else's comment")
    void aStrangerCannotRemoveAComment() {
        Account creator = account("creator");
        Account backer = account("backer");
        Account stranger = account("stranger");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Will this ship to Baku?"));

        ResponseEntity<Map<String, Object>> refused = delete(root, stranger);

        // 403 and not 404: the caller is looking at this comment on a public page,
        // so there is nothing left to hide from them.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody().get("code")).isEqualTo("COMMENT_DELETION_NOT_PERMITTED");
    }

    @Test
    @DisplayName("the campaign can moderate a comment on it, and the removal is audited")
    void theCampaignCanModerateAndItIsAudited() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Buy cheap watches at example.com"));

        assertThat(delete(root, creator).getStatusCode()).isEqualTo(HttpStatus.OK);

        // CD-14. CLAUDE.md: every privileged action is audited -- and removing
        // somebody else's speech from a public page is the privileged one. The
        // detail names the comment and its author and deliberately not the text.
        List<AuditEntry> rows = auditEntries.findAll().stream()
                .filter(entry -> project.equals(entry.getEntityId()))
                .filter(entry -> "project.comment_removed".equals(entry.getAction()))
                .toList();
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().getActorId()).isEqualTo(creator.id());
        assertThat(rows.getFirst().getDetail()).contains(root.toString()).contains(backer.id().toString());
    }

    @Test
    @DisplayName("an author withdrawing their own comment is not audited")
    void anAuthorsOwnWithdrawalIsNotAudited() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Never mind."));

        delete(root, backer);

        // The line the audit action's comment draws: deleting what you wrote is the
        // ordinary use of a button, and recording it would bury the removals that
        // matter under a million that do not.
        assertThat(auditEntries.findAll().stream()
                        .filter(entry -> project.equals(entry.getEntityId()))
                        .filter(entry -> "project.comment_removed".equals(entry.getAction()))
                        .toList())
                .isEmpty();
    }

    @Test
    @DisplayName("removing an already-removed comment succeeds and changes nothing")
    void removalIsIdempotent() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Something regrettable."));

        delete(root, backer);
        ResponseEntity<Map<String, Object>> again = delete(root, backer);

        // A double tap and a retry are both harmless, and the second call does not
        // rewrite who removed it -- which the audit row from the first would then
        // contradict.
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(again.getBody().get("deleted")).isEqualTo(true);
    }

    // ------------------------------------------------------------------
    // Reporting (C-07), through the moderation module that already exists
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a comment is reportable through the existing moderation intake")
    void aCommentIsReportable() {
        Account creator = account("creator");
        Account backer = account("backer");
        Account reporter = account("reporter");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Buy cheap watches at example.com"));

        ResponseEntity<Map<String, Object>> reported = exchange(
                "/v1/comments/" + root + "/report", HttpMethod.POST, reporter.accessToken(), Map.of("reason", "SPAM"));

        // 202: the platform has the complaint and has created nothing the reporter
        // can go and read. No new table, no new endpoint shape, no second queue --
        // the row lands in `content_reports` with COMMENT as its target type, which
        // V23's check constraint already allowed.
        assertThat(reported.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(reportsOn(root)).isEqualTo(1L);
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT target_type FROM content_reports WHERE target_id = ?", String.class, root))
                .isEqualTo("COMMENT");
    }

    @Test
    @DisplayName("reporting the same comment twice does not multiply it")
    void reportingTheSameCommentTwiceDoesNotMultiplyIt() {
        Account creator = account("creator");
        Account backer = account("backer");
        Account reporter = account("reporter");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Buy cheap watches at example.com"));

        exchange("/v1/comments/" + root + "/report", HttpMethod.POST, reporter.accessToken(), Map.of("reason", "SPAM"));
        ResponseEntity<Map<String, Object>> second = exchange(
                "/v1/comments/" + root + "/report",
                HttpMethod.POST,
                reporter.accessToken(),
                Map.of("reason", "OFFENSIVE", "detail", "Trying again with a different reason."));

        // Deduplicated by V23's partial unique index, exactly as a report about a
        // campaign is -- this issue adds no deduplication of its own. A repeat is a
        // success carrying the report already on file, unchanged, so nobody can
        // re-order the queue by reporting the same thing again.
        assertThat(second.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        assertThat(reportsOn(root)).isEqualTo(1L);
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject("SELECT reason FROM content_reports WHERE target_id = ?", String.class, root))
                .isEqualTo("SPAM");
    }

    @Test
    @DisplayName("two people reporting one comment are two reports, because the count is the triage signal")
    void twoReportersAreTwoReports() {
        Account creator = account("creator");
        Account backer = account("backer");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Buy cheap watches at example.com"));

        exchange(
                "/v1/comments/" + root + "/report",
                HttpMethod.POST,
                account("reporter-a").accessToken(),
                Map.of("reason", "SPAM"));
        exchange(
                "/v1/comments/" + root + "/report",
                HttpMethod.POST,
                account("reporter-b").accessToken(),
                Map.of("reason", "SPAM"));

        assertThat(reportsOn(root)).isEqualTo(2L);
    }

    @Test
    @DisplayName("a comment that has been removed is no longer reportable")
    void aRemovedCommentIsNotReportable() {
        Account creator = account("creator");
        Account backer = account("backer");
        Account reporter = account("reporter");
        UUID project = liveCampaign(creator);
        UUID root = idOf(post(project, backer, "Buy cheap watches at example.com"));
        delete(root, creator);

        ResponseEntity<Map<String, Object>> reported = exchange(
                "/v1/comments/" + root + "/report", HttpMethod.POST, reporter.accessToken(), Map.of("reason", "SPAM"));

        // The same argument ReportTargets makes about a suspended campaign: the
        // comment is already off the page, so a further report adds a row to the
        // queue and no information. A report filed *before* the removal stays open,
        // which is why V25 keeps the row and its text.
        assertThat(reported.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(reportsOn(root)).isZero();
    }

    @Test
    @DisplayName("a comment under a campaign the reporter cannot see is not reportable either")
    void aCommentUnderAnUnseenCampaignIsNotReportable() {
        Account creator = account("creator");
        Account reporter = account("reporter");
        UUID project = draft(creator);
        // The creator may comment on their own unlaunched campaign -- see
        // aDraftIsNotCommentable -- so the comment exists and the campaign does not
        // exist as far as a stranger is concerned.
        UUID root = idOf(post(project, creator, "A note to myself before we launch."));

        ResponseEntity<Map<String, Object>> reported = exchange(
                "/v1/comments/" + root + "/report", HttpMethod.POST, reporter.accessToken(), Map.of("reason", "SPAM"));

        // Otherwise the safety endpoint is an oracle: a caller who reported an
        // identifier and was told "accepted" would learn that it names a comment, and
        // therefore that there is a campaign being prepared behind it -- which is
        // exactly what ProjectAccess spends its class comment refusing to say. The
        // check belongs to PublicComments, which asks PublicProjects rather than
        // keeping a second copy of "which campaigns may a stranger see".
        assertThat(reported.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(reportsOn(root)).isZero();
    }

    @Test
    @DisplayName("an invented comment identifier cannot be reported")
    void anInventedCommentCannotBeReported() {
        Account reporter = account("reporter");

        ResponseEntity<Map<String, Object>> reported = exchange(
                "/v1/comments/" + UUID.randomUUID() + "/report",
                HttpMethod.POST,
                reporter.accessToken(),
                Map.of("reason", "SPAM"));

        // Without the check the endpoint fills the queue with rows a moderator opens,
        // finds nothing behind, and closes -- which is the reason #102 refused to
        // publish this route before there was a `comments` table.
        assertThat(reported.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    private long reportsOn(UUID targetId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT count(*) FROM content_reports WHERE target_id = ?", Long.class, targetId);
    }
}
