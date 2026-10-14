package az.ideanest.community;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.project.infrastructure.CategoryRepository;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
import java.util.LinkedHashMap;
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
 * #137's {@code GET /v1/projects/{projectId}/viewer}: the reader's own state on one campaign.
 *
 * <p>Each flag is asserted both ways, and each through the write that sets it rather than a
 * row written by hand where an honest route exists — the endpoint's promise is that it agrees
 * with those writes, and a test that seeded the table would be checking the table. The one
 * exception is {@code backed}: a confirmed pledge is reached through a card verification, so it
 * is written with {@link Pledges}, which writes what confirmation writes.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #aDraftPledgeIsNotABacking()} — a checkout in progress is not a backing, and a
 *       page that said it was would hide the button that finishes it.
 *   <li>{@link #theStateIsTheCallersOwn()} — one reader's saves are never another's answer.
 *   <li>{@link #theAnswerIsNeverCached()} — this is private state on a public page, and a shared
 *       cache holding it would show it to the next reader.
 * </ul>
 */
class CampaignViewerApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        // Pledges cascade from projects. Reminders do too, and go first anyway for
        // PrelaunchApiTests' reason: the launch sweep looks for any row still owed a notice.
        jdbc.update("DELETE FROM reminders");
        jdbc.update("DELETE FROM saves");
        jdbc.update("DELETE FROM follows");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    @Test
    @DisplayName("without a session the answer is 401")
    void signedOutIsUnauthorised() {
        Account creator = account("anon-creator");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> refused = exchange(viewerOf(project), HttpMethod.GET, null, null);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("a reader who has done nothing is told so, in four falses")
    void aNewReaderHasNoState() {
        Account creator = account("fresh-creator");
        Account reader = account("fresh-reader");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> state = viewer(project, reader);

        assertThat(state.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(state.getBody())
                .containsEntry("saved", false)
                .containsEntry("reminded", false)
                .containsEntry("followingCreator", false)
                .containsEntry("backed", false);
    }

    @Test
    @DisplayName("the answer is never cached")
    void theAnswerIsNeverCached() {
        Account creator = account("cache-creator");
        Account reader = account("cache-reader");
        UUID project = liveCampaign(creator);

        ResponseEntity<Map<String, Object>> state = viewer(project, reader);

        assertThat(state.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test
    @DisplayName("saved follows the save and the un-save")
    void savedFollowsTheWrites() {
        Account creator = account("saved-creator");
        Account reader = account("saved-reader");
        UUID project = liveCampaign(creator);

        exchange("/v1/projects/" + project + "/save", HttpMethod.POST, reader.accessToken(), null);
        assertThat(viewer(project, reader).getBody()).containsEntry("saved", true);

        exchange("/v1/projects/" + project + "/save", HttpMethod.DELETE, reader.accessToken(), null);
        assertThat(viewer(project, reader).getBody()).containsEntry("saved", false);
    }

    @Test
    @DisplayName("reminded follows the signed-in reminder and its withdrawal")
    void remindedFollowsTheWrites() {
        Account creator = account("remind-creator");
        Account reader = account("remind-reader");
        UUID project = prelaunching(creator);

        ResponseEntity<Map<String, Object>> registered =
                exchange("/v1/projects/" + project + "/remind", HttpMethod.POST, reader.accessToken(), null);
        assertThat(registered.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(viewer(project, reader).getBody()).containsEntry("reminded", true);

        exchange("/v1/projects/" + project + "/remind", HttpMethod.DELETE, reader.accessToken(), null);
        assertThat(viewer(project, reader).getBody()).containsEntry("reminded", false);
    }

    /**
     * An address row is somebody's reminder, but not this account's to switch off.
     *
     * <p>{@code PrelaunchService#withdraw} removes an account's row and nothing else, so a
     * "reminded" drawn from the address row would be a control the reader cannot turn off.
     */
    @Test
    @DisplayName("a reminder registered with a bare address is not the account's")
    void anAddressReminderIsNotTheAccounts() {
        Account creator = account("address-creator");
        Account reader = account("address-reader");
        UUID project = prelaunching(creator);

        exchange("/v1/projects/" + project + "/remind", HttpMethod.POST, null, Map.of("email", reader.email()));

        assertThat(viewer(project, reader).getBody()).containsEntry("reminded", false);
    }

    @Test
    @DisplayName("followingCreator follows the follow and the unfollow")
    void followingCreatorFollowsTheWrites() {
        Account creator = account("follow-creator");
        Account reader = account("follow-reader");
        UUID project = liveCampaign(creator);
        String slug = users.findByIdAndDeletedAtIsNull(creator.id()).orElseThrow().getSlug();

        exchange("/v1/users/" + slug + "/follow", HttpMethod.POST, reader.accessToken(), null);
        assertThat(viewer(project, reader).getBody()).containsEntry("followingCreator", true);

        exchange("/v1/users/" + slug + "/follow", HttpMethod.DELETE, reader.accessToken(), null);
        assertThat(viewer(project, reader).getBody()).containsEntry("followingCreator", false);
    }

    @Test
    @DisplayName("backed is true for a confirmed pledge and false once it is cancelled")
    void backedFollowsThePledge() {
        Account creator = account("backed-creator");
        Account reader = account("backed-reader");
        UUID project = liveCampaign(creator);

        UUID pledge = Pledges.confirmedFor(dataSource, project, reader.id(), "25.00");
        assertThat(viewer(project, reader).getBody()).containsEntry("backed", true);

        new JdbcTemplate(dataSource)
                .update("UPDATE pledges SET state = 'CANCELED_BY_BACKER', canceled_at = now() WHERE id = ?", pledge);
        assertThat(viewer(project, reader).getBody()).containsEntry("backed", false);
    }

    /**
     * A reservation is not a backing.
     *
     * <p>{@code BackedPledges} answers about backings and never about drafts, and this endpoint
     * inherits that: a reader half-way through a checkout who was told they had backed the
     * campaign would not be offered the button that finishes it.
     */
    @Test
    @DisplayName("a draft pledge is not a backing")
    void aDraftPledgeIsNotABacking() {
        Account creator = account("draft-pledge-creator");
        Account reader = account("draft-pledge-reader");
        UUID project = liveCampaign(creator);

        new JdbcTemplate(dataSource)
                .update(
                        """
                        INSERT INTO pledges (id, project_id, backer_id, state, base_amount, currency,
                                             reservation_expires_at)
                        VALUES (?, ?, ?, 'DRAFT', 25.00, 'AZN', now() + interval '20 minutes')
                        """,
                        UUID.randomUUID(),
                        project,
                        reader.id());

        assertThat(viewer(project, reader).getBody()).containsEntry("backed", false);
    }

    @Test
    @DisplayName("the state is the caller's own")
    void theStateIsTheCallersOwn() {
        Account creator = account("own-creator");
        Account reader = account("own-reader");
        Account other = account("own-other");
        UUID project = liveCampaign(creator);

        exchange("/v1/projects/" + project + "/save", HttpMethod.POST, reader.accessToken(), null);
        Pledges.confirmedFor(dataSource, project, reader.id(), "10.00");

        assertThat(viewer(project, other).getBody())
                .containsEntry("saved", false)
                .containsEntry("backed", false);
    }

    @Test
    @DisplayName("a campaign the public may not see is not found, and neither is one that does not exist")
    void anUnpublishedCampaignIsNotFound() {
        Account creator = account("hidden-creator");
        Account reader = account("hidden-reader");
        UUID draft = draft(creator);

        ResponseEntity<Map<String, Object>> refused = viewer(draft, reader);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(refused.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");
        assertThat(viewer(UUID.randomUUID(), reader).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private record Account(String accessToken, UUID id, String email) {
    }

    private Account account(String prefix) {
        EmailAddress email = EmailAddress.of(prefix + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Person"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                null,
                Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"));

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Account((String) signedIn.getBody().get("accessToken"), id, email.value());
    }

    private UUID draft(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign somebody is reading " + SEQUENCE.incrementAndGet()));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID liveCampaign(Account creator) {
        UUID project = draft(creator);
        Campaigns.launch(dataSource, project);
        return project;
    }

    /** A campaign with an open pre-launch page, reached the way a creator reaches it. */
    private UUID prelaunching(Account creator) {
        UUID project = draft(creator);
        exchange(
                "/v1/projects/" + project,
                HttpMethod.PATCH,
                creator.accessToken(),
                new LinkedHashMap<>(Campaigns.completeBasics(categories)));

        ResponseEntity<Map<String, Object>> opened =
                exchange("/v1/projects/" + project + "/prelaunch", HttpMethod.POST, creator.accessToken(), null);
        assertThat(opened.getBody()).containsEntry("state", "PRELAUNCH");
        return project;
    }

    private static String viewerOf(UUID project) {
        return "/v1/projects/" + project + "/viewer";
    }

    private ResponseEntity<Map<String, Object>> viewer(UUID project, Account caller) {
        return exchange(viewerOf(project), HttpMethod.GET, caller.accessToken(), null);
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            headers.setBearerAuth(token);
        }
        return rest.exchange(
                path, method, new HttpEntity<>(body, headers), new ParameterizedTypeReference<Map<String, Object>>() {});
    }
}
