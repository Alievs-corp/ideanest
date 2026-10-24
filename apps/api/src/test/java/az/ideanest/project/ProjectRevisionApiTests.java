package az.ideanest.project;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.project.infrastructure.CategoryRepository;
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
 * An edit to a launched campaign waits for a moderator (#558), over HTTP.
 *
 * <p>The test that carries the design is {@link #anEditToALiveCampaignIsNotPublicUntilApproved()}:
 * what the public reads is {@code projects}, so the assertions on the title go to the table and
 * not to the editor's view, which shows the draft.
 */
class ProjectRevisionApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private CategoryRepository categories;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private AccessTokenIssuer tokens;

    @AfterEach
    void clearProjects() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    private record Creator(String accessToken, UUID id) {}

    private Creator register(String email, String name) {
        EmailAddress address = EmailAddress.of(email);
        rest.postForEntity(
                "/v1/auth/register", Map.of("email", email, "password", PASSWORD, "name", name), String.class);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), json()),
                new ParameterizedTypeReference<Map<String, Object>>() {});
        UUID id = users.findByEmailAndDeletedAtIsNull(address).orElseThrow().getId();
        return new Creator((String) signedIn.getBody().get("accessToken"), id);
    }

    private Creator creator() {
        Creator creator = register("creator" + SEQUENCE.incrementAndGet() + "@example.com", "Test Creator");
        Campaigns.mayPublish(dataSource, creator.id());
        return creator;
    }

    /**
     * A token is minted rather than signed in for: a dozen suites share this account and
     * sign-ins per email are limited to five.
     */
    private Creator moderator() {
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", MODERATOR_EMAIL, "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        String token = tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
        return new Creator(token, id);
    }

    private static HttpHeaders json() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return headers;
    }

    private static HttpHeaders bearer(String accessToken) {
        HttpHeaders headers = json();
        headers.setBearerAuth(accessToken);
        return headers;
    }

    private ResponseEntity<Map<String, Object>> send(HttpMethod method, String path, String accessToken, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, bearer(accessToken)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return send(HttpMethod.POST, path, accessToken, body);
    }

    private ResponseEntity<Map<String, Object>> patch(String path, String accessToken, Map<String, Object> body) {
        return send(HttpMethod.PATCH, path, accessToken, body);
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return send(HttpMethod.GET, path, accessToken, null);
    }

    private UUID liveCampaign(Creator creator, Creator moderator, String title) {
        Map<String, Object> draft = post("/v1/projects", creator.accessToken(), Map.of("title", title)).getBody();
        UUID id = UUID.fromString((String) draft.get("id"));
        patch("/v1/projects/" + id, creator.accessToken(), Campaigns.completeBasics(categories));
        ResponseEntity<Map<String, Object>> submitted = post("/v1/projects/" + id + "/submit", creator.accessToken(), null);
        assertThat(submitted.getStatusCode()).as("submit: %s", submitted.getBody()).isEqualTo(HttpStatus.OK);
        ResponseEntity<Map<String, Object>> approved =
                post("/v1/admin/moderation/" + id + "/approve", moderator.accessToken(), null);
        assertThat(approved.getStatusCode()).as("approve: %s", approved.getBody()).isEqualTo(HttpStatus.OK);
        return id;
    }

    private String publicTitle(UUID id) {
        return new JdbcTemplate(dataSource).queryForObject("SELECT title FROM projects WHERE id = ?", String.class, id);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> revisionOf(Map<String, Object> edit) {
        return (Map<String, Object>) edit.get("revision");
    }

    private Map<String, Object> submittedEdit(Creator creator, UUID id, String title) {
        patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", title));
        return post("/v1/projects/" + id + "/revision/submit", creator.accessToken(), null).getBody();
    }

    private UUID openRevisionId(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT id FROM project_revisions WHERE project_id = ? AND status IN ('DRAFT', 'PENDING')",
                        UUID.class,
                        projectId);
    }

    @Test
    @DisplayName("an edit to a live campaign is not public until a moderator approves it")
    void anEditToALiveCampaignIsNotPublicUntilApproved() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "Original title");

        ResponseEntity<Map<String, Object>> saved =
                patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Better title"));
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody().get("title")).isEqualTo("Better title");
        assertThat(revisionOf(saved.getBody()).get("status")).isEqualTo("DRAFT");
        assertThat(revisionOf(saved.getBody()).get("changedFields")).isEqualTo(List.of("title"));
        assertThat(publicTitle(id)).isEqualTo("Original title");

        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody().get("title"))
                .isEqualTo("Better title");

        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + id + "/revision/submit", creator.accessToken(), null);
        assertThat(revisionOf(submitted.getBody()).get("status")).isEqualTo("PENDING");
        assertThat(publicTitle(id)).isEqualTo("Original title");

        UUID revisionId = openRevisionId(id);
        ResponseEntity<Map<String, Object>> approved =
                post("/v1/admin/moderation/revisions/" + revisionId + "/approve", moderator.accessToken(), null);
        assertThat(approved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(approved.getBody().get("status")).isEqualTo("APPROVED");

        assertThat(publicTitle(id)).isEqualTo("Better title");
        Map<String, Object> after = get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody();
        assertThat(after.get("title")).isEqualTo("Better title");
        assertThat(after.get("revision")).isNull();

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        assertThat(jdbc.queryForList(
                        "SELECT detail FROM audit_logs WHERE action = 'project.revision_approved' AND entity_id = ?",
                        String.class,
                        id))
                .singleElement()
                .asString()
                .contains(revisionId.toString())
                .endsWith("title");
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM outbox_events WHERE event_type = 'project.revision_decided'"
                                + " AND aggregate_id = ?",
                        Integer.class,
                        id))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("approval copies the story, risks, cover and countries, and keeps the story's history")
    void approvalAppliesEveryEditedField() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "Several fields");
        String risks = "A new risk section. ".repeat(12);

        ResponseEntity<Map<String, Object>> saved = patch(
                "/v1/projects/" + id,
                creator.accessToken(),
                Map.of(
                        "story", Campaigns.story(700),
                        "risks", risks,
                        "coverImage", Map.of("url", "https://cdn.example.com/new.jpg", "width", 1920, "height", 1080),
                        "countries", List.of("AZ", "TR")));
        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(revisionOf(saved.getBody()).get("changedFields"))
                .isEqualTo(List.of("story", "risks", "coverImage", "countries"));

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        assertThat(jdbc.queryForObject("SELECT risks FROM projects WHERE id = ?", String.class, id))
                .isNotEqualTo(risks.trim());
        assertThat(jdbc.queryForObject("SELECT cover_image_url FROM projects WHERE id = ?", String.class, id))
                .isEqualTo("https://cdn.example.com/cover.jpg");

        post("/v1/projects/" + id + "/revision/submit", creator.accessToken(), null);
        post("/v1/admin/moderation/revisions/" + openRevisionId(id) + "/approve", moderator.accessToken(), null);

        assertThat(jdbc.queryForObject("SELECT risks FROM projects WHERE id = ?", String.class, id))
                .isEqualTo(risks.trim());
        assertThat(jdbc.queryForObject("SELECT cover_image_url FROM projects WHERE id = ?", String.class, id))
                .isEqualTo("https://cdn.example.com/new.jpg");
        assertThat(jdbc.queryForObject("SELECT array_to_string(countries, ',') FROM projects WHERE id = ?", String.class, id))
                .isEqualTo("AZ,TR");
        assertThat(jdbc.queryForObject("SELECT length(story::text) FROM projects WHERE id = ?", Integer.class, id))
                .isGreaterThan(700);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM project_story_versions WHERE project_id = ?", Integer.class, id))
                .as("the approved story is kept as a version")
                .isPositive();
    }

    @Test
    @DisplayName("the fields frozen at launch still answer 409, and no revision is opened")
    void lockedFieldsAreStillRefused() {
        Creator creator = creator();
        UUID id = liveCampaign(creator, moderator(), "Locked");

        ResponseEntity<Map<String, Object>> refused = patch(
                "/v1/projects/" + id,
                creator.accessToken(),
                Map.of("title", "Changed", "goal", Map.of("amount", "9000.00", "currency", "AZN")));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody().get("code")).isEqualTo("PROJECT_FIELD_LOCKED");
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody().get("revision")).isNull();
    }

    @Test
    @DisplayName("a campaign that has not launched is still edited in place")
    void aDraftIsEditedInPlace() {
        Creator creator = creator();
        Map<String, Object> draft =
                post("/v1/projects", creator.accessToken(), Map.of("title", "Just a draft")).getBody();
        UUID id = UUID.fromString((String) draft.get("id"));

        patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Renamed draft"));

        assertThat(publicTitle(id)).isEqualTo("Renamed draft");
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody().get("revision")).isNull();
    }

    @Test
    @DisplayName("a rejected edit leaves the campaign alone and tells the creator why")
    void aRejectionKeepsTheLiveVersionAndGivesTheReason() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "Keep me");
        submittedEdit(creator, id, "Spammy title");
        UUID revisionId = openRevisionId(id);

        ResponseEntity<Map<String, Object>> noReason =
                post("/v1/admin/moderation/revisions/" + revisionId + "/reject", moderator.accessToken(), Map.of());
        assertThat(noReason.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        ResponseEntity<Map<String, Object>> rejected = post(
                "/v1/admin/moderation/revisions/" + revisionId + "/reject",
                moderator.accessToken(),
                Map.of("note", "The title promises more than the campaign delivers."));
        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(publicTitle(id)).isEqualTo("Keep me");
        Map<String, Object> edit = get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody();
        assertThat(edit.get("title")).isEqualTo("Keep me");
        assertThat(edit.get("revision")).isNull();
        @SuppressWarnings("unchecked")
        Map<String, Object> rejection = (Map<String, Object>) edit.get("rejectedRevision");
        assertThat(rejection.get("reason")).isEqualTo("The title promises more than the campaign delivers.");

        patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Honest title"));
        assertThat(get("/v1/projects/" + id + "/edit", creator.accessToken()).getBody().get("rejectedRevision"))
                .isNull();
    }

    @Test
    @DisplayName("editing a submitted revision sends it back to a draft, so it cannot be approved")
    void editingASubmittedRevisionWithdrawsTheSubmission() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "Before");
        submittedEdit(creator, id, "First attempt");
        UUID revisionId = openRevisionId(id);

        ResponseEntity<Map<String, Object>> edited =
                patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Second attempt"));
        assertThat(revisionOf(edited.getBody()).get("status")).isEqualTo("DRAFT");

        ResponseEntity<Map<String, Object>> approved =
                post("/v1/admin/moderation/revisions/" + revisionId + "/approve", moderator.accessToken(), null);
        assertThat(approved.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(approved.getBody().get("code")).isEqualTo("REVISION_NOT_AVAILABLE");
        assertThat(publicTitle(id)).isEqualTo("Before");
    }

    @Test
    @DisplayName("editing back to what the campaign shows closes the revision")
    void revertingClosesTheRevision() {
        Creator creator = creator();
        UUID id = liveCampaign(creator, moderator(), "Same as ever");
        patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Different"));

        ResponseEntity<Map<String, Object>> reverted =
                patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Same as ever"));

        assertThat(reverted.getBody().get("revision")).isNull();
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject("SELECT count(*) FROM project_revisions WHERE project_id = ?", Integer.class, id))
                .isZero();

        ResponseEntity<Map<String, Object>> nothingToSend =
                post("/v1/projects/" + id + "/revision/submit", creator.accessToken(), null);
        assertThat(nothingToSend.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(nothingToSend.getBody().get("code")).isEqualTo("REVISION_NOT_AVAILABLE");
    }

    @Test
    @DisplayName("the creator can discard an edit")
    void discardingAnEdit() {
        Creator creator = creator();
        UUID id = liveCampaign(creator, moderator(), "Untouched");
        submittedEdit(creator, id, "Changed my mind");

        ResponseEntity<Map<String, Object>> discarded =
                send(HttpMethod.DELETE, "/v1/projects/" + id + "/revision", creator.accessToken(), null);

        assertThat(discarded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(discarded.getBody().get("title")).isEqualTo("Untouched");
        assertThat(discarded.getBody().get("revision")).isNull();
        assertThat(get("/v1/admin/moderation/revisions", moderator().accessToken()).getBody().get("revisions"))
                .isEqualTo(List.of());
    }

    @Test
    @DisplayName("a moderator sees the submitted edit beside the live campaign")
    void theQueueAndTheReview() {
        Creator creator = creator();
        Creator moderator = moderator();
        UUID id = liveCampaign(creator, moderator, "Live version");
        patch("/v1/projects/" + id, creator.accessToken(), Map.of("title", "Draft version"));
        assertThat(get("/v1/admin/moderation/revisions", moderator.accessToken()).getBody().get("revisions"))
                .as("a draft is not in the queue")
                .isEqualTo(List.of());
        post("/v1/projects/" + id + "/revision/submit", creator.accessToken(), null);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> queue = (List<Map<String, Object>>)
                get("/v1/admin/moderation/revisions", moderator.accessToken()).getBody().get("revisions");
        assertThat(queue).hasSize(1);
        assertThat(queue.get(0).get("title")).isEqualTo("Live version");
        assertThat(queue.get(0).get("changedFields")).isEqualTo(List.of("title"));

        Map<String, Object> review = get(
                        "/v1/admin/moderation/revisions/" + queue.get(0).get("id"), moderator.accessToken())
                .getBody();
        @SuppressWarnings("unchecked")
        Map<String, Object> live = (Map<String, Object>) review.get("live");
        @SuppressWarnings("unchecked")
        Map<String, Object> proposed = (Map<String, Object>) review.get("proposed");
        assertThat(live.get("title")).isEqualTo("Live version");
        assertThat(proposed.get("title")).isEqualTo("Draft version");
        assertThat(publicTitle(id)).isEqualTo("Live version");
    }

    @Test
    @DisplayName("only staff can read the queue or decide")
    void decisionsAreForStaff() {
        Creator creator = creator();
        UUID id = liveCampaign(creator, moderator(), "Mine");
        submittedEdit(creator, id, "Mine, edited");
        UUID revisionId = openRevisionId(id);

        assertThat(get("/v1/admin/moderation/revisions", creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(post("/v1/admin/moderation/revisions/" + revisionId + "/approve", creator.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(publicTitle(id)).isEqualTo("Mine");
    }
}
