package az.ideanest.reward;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaProcessingJob;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedImageTranscoder;
import az.ideanest.user.infrastructure.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
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
 * A launched campaign's reward tier text and media wait for a moderator (#559), over HTTP.
 *
 * <p>What backers read is {@code reward_tiers} through the public catalogue, so the assertions
 * about what is public go there and to the table; the creator's editor shows the draft.
 */
class RewardRevisionApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";
    private static final byte[] BYTES = "....a picture".getBytes(StandardCharsets.ISO_8859_1);
    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private AccessTokenIssuer tokens;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private LocalObjectStore store;

    @Autowired
    private ScriptedImageTranscoder images;

    @Autowired
    private MediaProcessingJob imageProcessing;

    @BeforeEach
    void clean() {
        store.clear();
        images.reset();
    }

    @AfterEach
    void clearCampaigns() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM project_state_transitions");
        Campaigns.clear(dataSource);
    }

    @Test
    @DisplayName("a live campaign's reward title and description are not public until a moderator approves them")
    void rewardTextWaitsForApproval() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID rewardId = idOf(create(projectId, creator, tier("Mug")).getBody());
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<Map<String, Object>> saved =
                patch(rewardId, creator, Map.of("title", "Signed mug", "description", "Signed by the team."));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(saved.getBody())
                .containsEntry("title", "Signed mug")
                .containsEntry("description", "Signed by the team.")
                .containsEntry("revisionChangedFields", List.of("title", "description"));
        assertThat(list(projectId, creator).get(0)).containsEntry("title", "Signed mug");
        assertThat(publicTitle(rewardId)).isEqualTo("Mug");
        assertThat(publicCatalogue(projectId).get(0)).containsEntry("title", "Mug").containsEntry("description", null);

        Map<String, Object> edit = projectEdit(projectId, creator);
        assertThat(revisionOf(edit)).containsEntry("status", "DRAFT").containsEntry("changedFields", List.of("rewards"));

        assertThat(post("/v1/projects/" + projectId + "/revision/submit", creator, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        String moderator = moderator();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> queue =
                (List<Map<String, Object>>) get("/v1/admin/moderation/revisions", moderator).getBody().get("revisions");
        assertThat(queue).singleElement().satisfies(entry -> assertThat(entry)
                .containsEntry("changedFields", List.of("rewards")));

        Map<String, Object> review = get("/v1/admin/moderation/revisions/" + queue.get(0).get("id"), moderator).getBody();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rewards = (List<Map<String, Object>>) review.get("rewards");
        assertThat(rewards).singleElement().satisfies(change -> {
            assertThat(change).containsEntry("id", rewardId.toString());
            assertThat(mapOf(change, "live")).containsEntry("title", "Mug").containsEntry("description", null);
            assertThat(mapOf(change, "proposed"))
                    .containsEntry("title", "Signed mug")
                    .containsEntry("description", "Signed by the team.");
        });
        assertThat(publicTitle(rewardId)).isEqualTo("Mug");

        ResponseEntity<Map<String, Object>> approved =
                post("/v1/admin/moderation/revisions/" + queue.get(0).get("id") + "/approve", moderator, null);
        assertThat(approved.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(publicTitle(rewardId)).isEqualTo("Signed mug");
        assertThat(publicCatalogue(projectId).get(0))
                .containsEntry("title", "Signed mug")
                .containsEntry("description", "Signed by the team.");
        assertThat(list(projectId, creator).get(0)).containsEntry("revisionChangedFields", List.of());
        assertThat(projectEdit(projectId, creator).get("revision")).isNull();
        assertThat(new JdbcTemplate(dataSource).queryForList(
                        "SELECT detail FROM audit_logs WHERE action = 'project.revision_approved' AND entity_id = ?",
                        String.class,
                        projectId))
                .singleElement()
                .asString()
                .endsWith("rewards");
    }

    @Test
    @DisplayName("a live campaign's reward picture is replaced only on approval, and the old file only then deleted")
    void rewardImageWaitsForApproval() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID first = uploadImage(creator);
        Map<String, Object> body = tier("Poster");
        body.put("imageMediaId", first.toString());
        UUID rewardId = idOf(create(projectId, creator, body).getBody());
        Campaigns.launch(dataSource, projectId);

        UUID second = uploadImage(creator);
        ResponseEntity<Map<String, Object>> saved = patch(rewardId, creator, Map.of("imageMediaId", second.toString()));

        assertThat(saved.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(mapOf(saved.getBody(), "image")).containsEntry("mediaId", second.toString());
        assertThat(saved.getBody()).containsEntry("revisionChangedFields", List.of("imageMediaId"));
        assertThat(mapOf(publicCatalogue(projectId).get(0), "image")).containsEntry("mediaId", first.toString());
        assertThat(store.has("media/" + first + ".jpg")).isTrue();

        post("/v1/projects/" + projectId + "/revision/submit", creator, null);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        Map<String, Object> review = get("/v1/admin/moderation/revisions/" + revisionId, moderator).getBody();
        @SuppressWarnings("unchecked")
        Map<String, Object> change = ((List<Map<String, Object>>) review.get("rewards")).get(0);
        assertThat(mapOf(mapOf(change, "live"), "image")).containsEntry("mediaId", first.toString());
        assertThat(mapOf(mapOf(change, "proposed"), "image")).containsEntry("mediaId", second.toString());

        post("/v1/admin/moderation/revisions/" + revisionId + "/approve", moderator, null);

        assertThat(mapOf(publicCatalogue(projectId).get(0), "image")).containsEntry("mediaId", second.toString());
        assertThat(store.has("media/" + first + ".jpg")).isFalse();
        assertThat(store.has("media/" + second + ".jpg")).isTrue();
    }

    @Test
    @DisplayName("the price and a lower quantity are still refused, and the rest of a tier waits for review too (#569)")
    void lockedFieldsAreRefusedAndTheRestIsHeld() {
        String creator = signIn();
        UUID projectId = draft(creator);
        Map<String, Object> body = tier("Limited");
        body.put("limitQuantity", 10);
        UUID rewardId = idOf(create(projectId, creator, body).getBody());
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<Map<String, Object>> repriced = patch(
                rewardId, creator, Map.of("title", "Cheaper", "price", Map.of("amount", "20.00", "currency", "AZN")));
        assertThat(repriced.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(repriced.getBody()).containsEntry("code", "REWARD_FIELD_LOCKED");
        ResponseEntity<Map<String, Object>> lowered = patch(rewardId, creator, Map.of("limitQuantity", 5));
        assertThat(lowered.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(openRevisionCount(projectId)).as("a refused edit opens no revision").isZero();

        ResponseEntity<Map<String, Object>> raised =
                patch(rewardId, creator, Map.of("limitQuantity", 20, "shippingType", "DOMESTIC"));
        assertThat(raised.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(raised.getBody())
                .containsEntry("limitQuantity", 20)
                .containsEntry("shippingType", "DOMESTIC")
                .containsEntry("pending", "changed")
                .containsEntry("revisionChangedFields", List.of("limitQuantity", "shippingType"));
        assertThat(publicCatalogue(projectId).get(0))
                .containsEntry("limitQuantity", 10)
                .containsEntry("shippingType", "NONE");
        assertThat(openRevisionCount(projectId)).isOne();

        ResponseEntity<Map<String, Object>> backDown = patch(rewardId, creator, Map.of("limitQuantity", 15));
        assertThat(backDown.getStatusCode())
                .as("a waiting raise can be taken back as far as what the public sees")
                .isEqualTo(HttpStatus.OK);
        assertThat(patch(rewardId, creator, Map.of("limitQuantity", 9)).getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    @DisplayName("tier writing and the campaign's own fields share the one revision, and a reverted tier leaves it")
    void tiersAndCampaignShareOneRevision() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID rewardId = idOf(create(projectId, creator, tier("Sticker")).getBody());
        Campaigns.launch(dataSource, projectId);

        patch(rewardId, creator, Map.of("title", "Sticker pack"));
        ResponseEntity<Map<String, Object>> project =
                send(HttpMethod.PATCH, "/v1/projects/" + projectId, creator, Map.of("blurb", "A better summary."));
        assertThat(project.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(revisionOf(project.getBody())).containsEntry("changedFields", List.of("blurb", "rewards"));
        assertThat(openRevisionCount(projectId)).isOne();
        assertThat(list(projectId, creator).get(0)).containsEntry("title", "Sticker pack");

        Map<String, Object> reverted = patch(rewardId, creator, Map.of("title", "Sticker")).getBody();
        assertThat(reverted).containsEntry("revisionChangedFields", List.of());
        assertThat(revisionOf(projectEdit(projectId, creator))).containsEntry("changedFields", List.of("blurb"));

        send(HttpMethod.PATCH, "/v1/projects/" + projectId, creator, "{\"blurb\": null}");
        assertThat(openRevisionCount(projectId)).as("nothing left to review").isZero();
    }

    @Test
    @DisplayName("editing a tier sends a submitted revision back to a draft, and an unchanged autosave does not")
    void editingATierWithdrawsTheSubmission() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID rewardId = idOf(create(projectId, creator, tier("Badge")).getBody());
        Campaigns.launch(dataSource, projectId);
        patch(rewardId, creator, Map.of("title", "Enamel badge"));
        post("/v1/projects/" + projectId + "/revision/submit", creator, null);

        patch(rewardId, creator, Map.of("title", "Enamel badge"));
        assertThat(revisionOf(projectEdit(projectId, creator))).containsEntry("status", "PENDING");

        patch(rewardId, creator, Map.of("description", "Gold plated."));
        assertThat(revisionOf(projectEdit(projectId, creator))).containsEntry("status", "DRAFT");
    }

    @Test
    @DisplayName("a rejected tier edit leaves the tier as the public saw it")
    void aRejectionLeavesTheTier() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID rewardId = idOf(create(projectId, creator, tier("Book")).getBody());
        Campaigns.launch(dataSource, projectId);
        patch(rewardId, creator, Map.of("title", "Free book for everyone"));
        post("/v1/projects/" + projectId + "/revision/submit", creator, null);

        ResponseEntity<Map<String, Object>> rejected = post(
                "/v1/admin/moderation/revisions/" + openRevisionId(projectId) + "/reject",
                moderator(),
                Map.of("note", "The title promises something the tier does not include."));

        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(publicTitle(rewardId)).isEqualTo("Book");
        assertThat(list(projectId, creator).get(0))
                .containsEntry("title", "Book")
                .containsEntry("revisionChangedFields", List.of());
    }

    @Test
    @DisplayName("a tier created and deleted again leaves nothing to review")
    void aCreatedTierDeletedAgainLeavesNothingToSubmit() {
        String creator = signIn();
        UUID projectId = draft(creator);
        Campaigns.launch(dataSource, projectId);
        UUID rewardId = idOf(create(projectId, creator, tier("Temporary")).getBody());
        patch(rewardId, creator, Map.of("title", "Still temporary"));
        assertThat(openRevisionCount(projectId)).isOne();

        assertThat(send(HttpMethod.DELETE, "/v1/rewards/" + rewardId, creator, null).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(openRevisionCount(projectId)).isZero();
        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + projectId + "/revision/submit", creator, null);
        assertThat(submitted.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(submitted.getBody()).containsEntry("code", "REVISION_NOT_AVAILABLE");
        assertThat(mapOf(submitted.getBody(), "meta")).containsEntry("reason", "NO_OPEN_REVISION");
    }

    @Test
    @DisplayName("a picture replaced inside the draft is deleted, and the live one is kept (#568)")
    void aPictureReplacedInTheDraftIsDeleted() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID live = uploadImage(creator);
        Map<String, Object> body = tier("Poster");
        body.put("imageMediaId", live.toString());
        UUID rewardId = idOf(create(projectId, creator, body).getBody());
        Campaigns.launch(dataSource, projectId);

        UUID proposed = uploadImage(creator);
        patch(rewardId, creator, Map.of("imageMediaId", proposed.toString()));
        UUID instead = uploadImage(creator);
        patch(rewardId, creator, Map.of("imageMediaId", instead.toString()));

        assertThat(store.has("media/" + proposed + ".jpg")).as("named by nothing any more").isFalse();
        assertThat(store.has("media/" + instead + ".jpg")).isTrue();
        assertThat(store.has("media/" + live + ".jpg")).as("the public still sees it").isTrue();
    }

    @Test
    @DisplayName("a refused or discarded revision's proposed picture is deleted, and the live one is kept (#568)")
    void aClosedRevisionsPictureIsDeleted() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID live = uploadImage(creator);
        Map<String, Object> body = tier("Poster");
        body.put("imageMediaId", live.toString());
        UUID rewardId = idOf(create(projectId, creator, body).getBody());
        Campaigns.launch(dataSource, projectId);

        UUID refused = uploadImage(creator);
        patch(rewardId, creator, Map.of("imageMediaId", refused.toString()));
        post("/v1/projects/" + projectId + "/revision/submit", creator, null);
        post(
                "/v1/admin/moderation/revisions/" + openRevisionId(projectId) + "/reject",
                moderator(),
                Map.of("note", "The picture shows a different product."));

        assertThat(store.has("media/" + refused + ".jpg")).isFalse();
        assertThat(store.has("media/" + live + ".jpg")).isTrue();

        UUID discarded = uploadImage(creator);
        patch(rewardId, creator, Map.of("imageMediaId", discarded.toString()));
        assertThat(send(HttpMethod.DELETE, "/v1/projects/" + projectId + "/revision", creator, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(store.has("media/" + discarded + ".jpg")).isFalse();
        assertThat(store.has("media/" + live + ".jpg")).isTrue();
    }

    @Test
    @DisplayName("deleting a draft tier keeps a picture another tier's waiting edit names (#568)")
    void aPictureAWaitingEditNamesIsKept() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID approvedTier = idOf(create(projectId, creator, tier("Mug")).getBody());
        Campaigns.launch(dataSource, projectId);

        UUID shared = uploadImage(creator);
        Map<String, Object> body = tier("Poster");
        body.put("imageMediaId", shared.toString());
        UUID draftTier = idOf(create(projectId, creator, body).getBody());
        assertThat(patch(approvedTier, creator, Map.of("imageMediaId", shared.toString())).getStatusCode())
                .isEqualTo(HttpStatus.OK);

        assertThat(send(HttpMethod.DELETE, "/v1/rewards/" + draftTier, creator, null).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);

        assertThat(store.has("media/" + shared + ".jpg"))
                .as("the open revision proposes it for the mug")
                .isTrue();
    }

    @Test
    @DisplayName("a tier on a campaign that has not launched is still edited in place")
    void aDraftTierIsEditedInPlace() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID rewardId = idOf(create(projectId, creator, tier("Draft tier")).getBody());

        Map<String, Object> saved = patch(rewardId, creator, Map.of("title", "Renamed tier")).getBody();

        assertThat(saved).containsEntry("title", "Renamed tier").containsEntry("revisionChangedFields", List.of());
        assertThat(publicTitle(rewardId)).isEqualTo("Renamed tier");
        assertThat(openRevisionCount(projectId)).isZero();
    }

    // ------------------------------------------------------------------

    private String publicTitle(UUID rewardId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT title FROM reward_tiers WHERE id = ?", String.class, rewardId);
    }

    private int openRevisionCount(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT count(*) FROM project_revisions WHERE project_id = ? AND status IN ('DRAFT', 'PENDING')",
                        Integer.class,
                        projectId);
    }

    private UUID openRevisionId(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT id FROM project_revisions WHERE project_id = ? AND status IN ('DRAFT', 'PENDING')",
                        UUID.class,
                        projectId);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> publicCatalogue(UUID projectId) {
        ResponseEntity<Map<String, Object>> offered = rest.exchange(
                "/v1/projects/" + projectId + "/rewards/public",
                HttpMethod.GET,
                new HttpEntity<>(new HttpHeaders()),
                OBJECT);
        assertThat(offered.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (List<Map<String, Object>>) offered.getBody().get("rewards");
    }

    private Map<String, Object> projectEdit(UUID projectId, String accessToken) {
        return get("/v1/projects/" + projectId + "/edit", accessToken).getBody();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> revisionOf(Map<String, Object> edit) {
        return (Map<String, Object>) edit.get("revision");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapOf(Map<String, Object> body, String field) {
        return (Map<String, Object>) body.get(field);
    }

    private static Map<String, Object> tier(String title) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("price", Map.of("amount", "25.00", "currency", "AZN"));
        return body;
    }

    private static UUID idOf(Map<String, Object> resource) {
        return UUID.fromString((String) resource.get("id"));
    }

    private ResponseEntity<Map<String, Object>> send(HttpMethod method, String path, String accessToken, Object body) {
        return rest.exchange(path, method, new HttpEntity<>(body, bearer(accessToken)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return send(HttpMethod.POST, path, accessToken, body);
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return send(HttpMethod.GET, path, accessToken, null);
    }

    private ResponseEntity<Map<String, Object>> create(UUID projectId, String accessToken, Object body) {
        ResponseEntity<Map<String, Object>> created = post("/v1/projects/" + projectId + "/rewards", accessToken, body);
        assertThat(created.getStatusCode()).as("create: %s", created.getBody()).isEqualTo(HttpStatus.CREATED);
        return created;
    }

    private ResponseEntity<Map<String, Object>> patch(UUID rewardId, String accessToken, Object body) {
        return send(HttpMethod.PATCH, "/v1/rewards/" + rewardId, accessToken, body);
    }

    private List<Map<String, Object>> list(UUID projectId, String accessToken) {
        return rest.exchange(
                        "/v1/projects/" + projectId + "/rewards",
                        HttpMethod.GET,
                        new HttpEntity<>(null, bearer(accessToken)),
                        new ParameterizedTypeReference<List<Map<String, Object>>>() {})
                .getBody();
    }

    private UUID uploadImage(String accessToken) {
        ResponseEntity<Map<String, Object>> issued = post(
                "/v1/media/uploads", accessToken, Map.of("contentType", "image/jpeg", "byteSize", BYTES.length));
        assertThat(issued.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        UUID mediaId = UUID.fromString((String) issued.getBody().get("mediaId"));
        store.put(MediaLibrary.rawKeyOf(mediaId), BYTES);
        post("/v1/media/" + mediaId + "/complete", accessToken, null);
        imageProcessing.run();
        return mediaId;
    }

    private UUID draft(String accessToken) {
        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects", accessToken, Map.of("title", "A campaign with rewards"));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private String signIn() {
        String email = "reward-revision-" + SEQUENCE.incrementAndGet() + "@example.com";
        rest.postForEntity(
                "/v1/auth/register", Map.of("email", email, "password", PASSWORD, "name", "Test Creator"), String.class);
        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(Map.of("email", email, "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                OBJECT);
        return (String) signedIn.getBody().get("accessToken");
    }

    /** Minted rather than signed in for, as {@code ProjectRevisionApiTests} explains. */
    private String moderator() {
        EmailAddress email = EmailAddress.of(MODERATOR_EMAIL);
        if (users.findByEmailAndDeletedAtIsNull(email).isEmpty()) {
            rest.postForEntity(
                    "/v1/auth/register",
                    Map.of("email", MODERATOR_EMAIL, "password", PASSWORD, "name", "Test Moderator"),
                    String.class);
        }
        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return tokens.issue(
                        id,
                        UUID.randomUUID(),
                        new AccessTokenIssuer.AccountStanding(true, false),
                        false,
                        Instant.now())
                .value();
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
