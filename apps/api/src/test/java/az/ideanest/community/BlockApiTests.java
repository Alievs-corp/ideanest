package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.audit.AuditEntry;
import az.ideanest.audit.AuditEntryRepository;
import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
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
 * #324 over HTTP: blocking another account, and what a block does to the comment paths.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aBlockedAccountsCommentsAreHiddenFromTheBlocker()} — the whole point, and
 *       {@link #theFilterIsInsideTheQuerySoAPageStaysAPage()} for why it is not done after the
 *       read;
 *   <li>{@link #aBlockedAccountCannotReplyToTheBlocker()} — and the refusal never says
 *       "blocked";
 *   <li>{@link #aPagePersonalToItsReaderIsNotPubliclyCacheable()} — a shared cache holding one
 *       reader's filtered page would publish whom they blocked;
 *   <li>{@link #blockingIsIdempotentAndAuditedOnce()} — a double tap is one row and one entry.
 * </ul>
 */
class BlockApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    /** The single address {@code application-test.yml} bootstraps as staff. */
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AuditEntryRepository auditEntries;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM user_blocks");
        jdbc.update("DELETE FROM comments");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Blocking and unblocking
    // ------------------------------------------------------------------

    @Test
    @DisplayName("blocking twice is one row, one answer and one audit entry")
    void blockingIsIdempotentAndAuditedOnce() {
        Account blocker = account("idem-blocker");
        Account blocked = account("idem-blocked");

        ResponseEntity<Map<String, Object>> first = block(blocked.id(), blocker);
        ResponseEntity<Map<String, Object>> again = block(blocked.id(), blocker);

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(first.getBody()).containsEntry("blocked", true);
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(again.getBody()).containsEntry("blocked", true);
        assertThat(blockCount(blocker.id(), blocked.id())).as("one row, not two").isEqualTo(1);

        List<AuditEntry> rows = auditOf(blocked.id(), "account.blocked");
        assertThat(rows).as("only the call that blocked writes an entry").hasSize(1);
        assertThat(rows.getFirst().getActorId()).isEqualTo(blocker.id());
        assertThat(rows.getFirst().getEntityType()).isEqualTo("account");
    }

    @Test
    @DisplayName("unblocking removes the row, unblocking again is still success, and one entry is written")
    void unblockingIsIdempotentAndAuditedOnce() {
        Account blocker = account("unblock-blocker");
        Account blocked = account("unblock-blocked");
        block(blocked.id(), blocker);

        ResponseEntity<Map<String, Object>> removed = unblock(blocked.id(), blocker);
        ResponseEntity<Map<String, Object>> again = unblock(blocked.id(), blocker);

        assertThat(removed.getBody()).containsEntry("blocked", false);
        assertThat(again.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(blockCount(blocker.id(), blocked.id())).isZero();
        assertThat(auditOf(blocked.id(), "account.unblocked")).hasSize(1);
    }

    @Test
    @DisplayName("a profile blocks and unblocks by slug, and reports the state")
    void aProfileBlocksBySlug() {
        Account blocker = account("slug-blocker");
        Account blocked = account("slug-blocked");
        String slug = slugOf(blocked);

        assertThat(get("/v1/users/" + slug + "/block", blocker).getBody()).containsEntry("blocked", false);

        ResponseEntity<Map<String, Object>> blockedNow =
                exchange("/v1/users/" + slug + "/block", HttpMethod.POST, blocker.accessToken(), null);
        assertThat(blockedNow.getBody()).containsEntry("blocked", true);
        assertThat(get("/v1/users/" + slug + "/block", blocker).getBody()).containsEntry("blocked", true);

        exchange("/v1/users/" + slug + "/block", HttpMethod.DELETE, blocker.accessToken(), null);
        assertThat(get("/v1/users/" + slug + "/block", blocker).getBody()).containsEntry("blocked", false);
    }

    @Test
    @DisplayName("blocking yourself is refused")
    void blockingYourselfIsRefused() {
        Account self = account("self-blocker");

        ResponseEntity<Map<String, Object>> refused = block(self.id(), self);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "CANNOT_BLOCK_YOURSELF");
    }

    @Test
    @DisplayName("platform staff cannot be blocked")
    void staffCannotBeBlocked() {
        Account blocker = account("staff-blocker");
        Account moderator = staff();

        ResponseEntity<Map<String, Object>> refused = block(moderator.id(), blocker);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "CANNOT_BLOCK_STAFF");
        assertThat(blockCount(blocker.id(), moderator.id())).isZero();
    }

    @Test
    @DisplayName("an account that does not exist is not found")
    void anUnknownAccountIsNotFound() {
        Account blocker = account("unknown-blocker");

        ResponseEntity<Map<String, Object>> refused = block(UUID.randomUUID(), blocker);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "USER_NOT_FOUND");
    }

    @Test
    @DisplayName("blocking needs a signed-in account")
    void blockingNeedsASession() {
        Account blocked = account("anon-blocked");

        ResponseEntity<Map<String, Object>> refused =
                exchange("/v1/me/blocks/" + blocked.id(), HttpMethod.POST, null, null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ------------------------------------------------------------------
    // The list
    // ------------------------------------------------------------------

    @Test
    @DisplayName("the list names each blocked account, most recent first, and pages without repeating")
    void theListNamesEachAccountAndPages() {
        Account blocker = account("list-blocker");
        Account first = account("list-first");
        Account second = account("list-second");
        Account third = account("list-third");
        block(first.id(), blocker);
        block(second.id(), blocker);
        block(third.id(), blocker);

        Map<String, Object> page = get("/v1/me/blocks?size=2", blocker).getBody();
        List<Map<String, Object>> items = items(page);
        assertThat(items).extracting(item -> item.get("userId")).containsExactly(
                third.id().toString(), second.id().toString());
        assertThat(items.getFirst()).containsEntry("slug", slugOf(third)).containsEntry("name", "Test Person");
        assertThat(items.getFirst()).containsKeys("avatarUrl", "blockedAt");
        assertThat(page.get("nextCursor")).isNotNull();

        Map<String, Object> rest = get("/v1/me/blocks?size=2&cursor=" + page.get("nextCursor"), blocker).getBody();
        assertThat(items(rest)).extracting(item -> item.get("userId")).containsExactly(first.id().toString());
        assertThat(rest.get("nextCursor")).isNull();
    }

    @Test
    @DisplayName("the list is the caller's own: somebody blocked sees nothing of it")
    void theListIsPrivate() {
        Account blocker = account("private-blocker");
        Account blocked = account("private-blocked");
        block(blocked.id(), blocker);

        assertThat(items(get("/v1/me/blocks", blocked).getBody())).isEmpty();
    }

    // ------------------------------------------------------------------
    // What a block does to comments
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a blocked account's comments and replies are hidden from the blocker, and only from them")
    void aBlockedAccountsCommentsAreHiddenFromTheBlocker() {
        Account creator = account("hide-creator");
        Account blocker = account("hide-blocker");
        Account blocked = account("hide-blocked");
        Account bystander = account("hide-bystander");
        UUID project = liveCampaign(creator);

        UUID theirs = idOf(post(project, blocked, "A conversation the blocker will not see"));
        reply(theirs, bystander, "A reply inside it");
        UUID open = idOf(post(project, bystander, "A conversation everybody sees"));
        reply(open, blocked, "A reply the blocker will not see");
        reply(open, bystander, "A reply everybody sees");

        block(blocked.id(), blocker);

        List<Map<String, Object>> forBlocker = threadsIn(get("/v1/projects/" + project + "/comments", blocker));
        assertThat(forBlocker).as("their conversation is left out whole").hasSize(1);
        assertThat(rootOf(forBlocker.getFirst())).containsEntry("id", open.toString());
        assertThat(repliesOf(forBlocker.getFirst()))
                .extracting(reply -> reply.get("authorId"))
                .containsOnly(bystander.id().toString());

        assertThat(threadsIn(get("/v1/projects/" + project + "/comments", bystander)))
                .as("nobody else's page changes")
                .hasSize(2);
        assertThat(threadsIn(get("/v1/projects/" + project + "/comments", null))).hasSize(2);

        assertThat(get("/v1/projects/" + project + "/comments?thread=" + theirs, blocker).getStatusCode())
                .as("opening their conversation directly answers the same")
                .isEqualTo(HttpStatus.NOT_FOUND);
        List<Map<String, Object>> openThread =
                threadsIn(get("/v1/projects/" + project + "/comments?thread=" + open, blocker));
        assertThat(repliesOf(openThread.getFirst()))
                .extracting(reply -> reply.get("authorId"))
                .containsOnly(bystander.id().toString());
    }

    @Test
    @DisplayName("the filter is inside the query, so a page of conversations is still a full page")
    void theFilterIsInsideTheQuerySoAPageStaysAPage() {
        Account creator = account("page-creator");
        Account blocker = account("page-blocker");
        Account blocked = account("page-blocked");
        UUID project = liveCampaign(creator);

        post(project, creator, "Oldest");
        post(project, creator, "Older");
        post(project, blocked, "Newer, from somebody blocked");
        post(project, blocked, "Newest, from somebody blocked");
        block(blocked.id(), blocker);

        ResponseEntity<Map<String, Object>> page = get("/v1/projects/" + project + "/comments?limit=2", blocker);

        assertThat(threadsIn(page)).as("two visible conversations, not zero").hasSize(2);
        assertThat(page.getBody().get("nextCursor")).as("and that is all of them").isNull();
    }

    @Test
    @DisplayName("a page shaped by a block is private to its reader; everybody else's stays public")
    void aPagePersonalToItsReaderIsNotPubliclyCacheable() {
        Account creator = account("cache-creator");
        Account blocker = account("cache-blocker");
        Account blocked = account("cache-blocked");
        Account bystander = account("cache-bystander");
        UUID project = liveCampaign(creator);
        post(project, blocked, "Something");
        block(blocked.id(), blocker);

        assertThat(get("/v1/projects/" + project + "/comments", blocker).getHeaders().getCacheControl())
                .contains("private")
                .doesNotContain("public");
        assertThat(get("/v1/projects/" + project + "/comments", bystander).getHeaders().getCacheControl())
                .contains("public");
    }

    @Test
    @DisplayName("a blocked account cannot reply to the blocker, and is not told why")
    void aBlockedAccountCannotReplyToTheBlocker() {
        Account creator = account("reply-creator");
        Account blocker = account("reply-blocker");
        Account blocked = account("reply-blocked");
        UUID project = liveCampaign(creator);
        UUID comment = idOf(post(project, blocker, "Something the blocked account wants to answer"));

        block(blocked.id(), blocker);
        ResponseEntity<Map<String, Object>> refused = reply(comment, blocked, "An answer");

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(refused.getBody()).containsEntry("code", "COMMENT_REPLY_NOT_PERMITTED");
        assertThat(String.valueOf(refused.getBody().get("detail")).toLowerCase())
                .as("a block is private")
                .doesNotContain("block");
        assertThat(String.valueOf(refused.getBody().get("title")).toLowerCase()).doesNotContain("block");
    }

    @Test
    @DisplayName("the blocker can still reply, and everybody else can reply to the blocker")
    void onlyTheBlockedDirectionIsRefused() {
        Account creator = account("dir-creator");
        Account blocker = account("dir-blocker");
        Account blocked = account("dir-blocked");
        Account bystander = account("dir-bystander");
        UUID project = liveCampaign(creator);
        UUID blockersComment = idOf(post(project, blocker, "The blocker speaks"));
        UUID blockedsComment = idOf(post(project, blocked, "The blocked account speaks"));
        block(blocked.id(), blocker);

        assertThat(reply(blockersComment, bystander, "Fine").getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(reply(blockedsComment, blocker, "Also fine").getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    @Test
    @DisplayName("after unblocking, the comments come back and replies are accepted again")
    void unblockingRestoresTheConversation() {
        Account creator = account("restore-creator");
        Account blocker = account("restore-blocker");
        Account blocked = account("restore-blocked");
        UUID project = liveCampaign(creator);
        post(project, blocked, "Back again");
        UUID comment = idOf(post(project, blocker, "The blocker speaks"));

        block(blocked.id(), blocker);
        unblock(blocked.id(), blocker);

        assertThat(threadsIn(get("/v1/projects/" + project + "/comments", blocker))).hasSize(2);
        assertThat(reply(comment, blocked, "Now I can answer").getStatusCode()).isEqualTo(HttpStatus.CREATED);
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

    /** The bootstrap moderator, registered once and signed in with a token of its own. */
    private Account staff() {
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", email.value(), "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String accessToken = tokens.issue(
                        id, UUID.randomUUID(), new AccessTokenIssuer.AccountStanding(true, false), false, Instant.now())
                .value();
        return new Account(accessToken, id);
    }

    private String slugOf(Account account) {
        return users.findByIdAndDeletedAtIsNull(account.id()).orElseThrow().getSlug();
    }

    private UUID liveCampaign(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign with a block " + SEQUENCE.incrementAndGet()));
        UUID project = UUID.fromString((String) created.getBody().get("id"));
        Campaigns.launch(dataSource, project);
        return project;
    }

    private ResponseEntity<Map<String, Object>> block(UUID target, Account caller) {
        return exchange("/v1/me/blocks/" + target, HttpMethod.POST, caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> unblock(UUID target, Account caller) {
        return exchange("/v1/me/blocks/" + target, HttpMethod.DELETE, caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> post(UUID project, Account author, String body) {
        return exchange(
                "/v1/projects/" + project + "/comments", HttpMethod.POST, author.accessToken(), Map.of("body", body));
    }

    private ResponseEntity<Map<String, Object>> reply(UUID commentId, Account author, String body) {
        return exchange("/v1/comments/" + commentId + "/reply", HttpMethod.POST, author.accessToken(), Map.of("body", body));
    }

    private ResponseEntity<Map<String, Object>> get(String path, Account caller) {
        return exchange(path, HttpMethod.GET, caller == null ? null : caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private static UUID idOf(ResponseEntity<Map<String, Object>> response) {
        return UUID.fromString((String) response.getBody().get("id"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("items");
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

    private long blockCount(UUID blocker, UUID blocked) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?",
                        Long.class,
                        blocker,
                        blocked);
    }

    private List<AuditEntry> auditOf(UUID account, String action) {
        return auditEntries.findByEntityTypeAndEntityIdOrderByOccurredAtDesc("account", account).stream()
                .filter(entry -> entry.getAction().equals(action))
                .toList();
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
}
