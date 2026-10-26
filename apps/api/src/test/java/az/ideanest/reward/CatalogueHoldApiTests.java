package az.ideanest.reward;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
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
 * A launched campaign's items and shipping regions wait for a moderator, as its tiers do (#587).
 *
 * <p>An item's name, picture and weight are what a backer reads in a tier and what a quote
 * charges for, and a region's destinations decide who may pledge and at what price. Each test
 * checks the same three things: the row keeps what the public sees, the creator's editor reads
 * back what they proposed, and approval (or refusal) is what decides.
 */
class CatalogueHoldApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";
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

    @AfterEach
    void clearCampaigns() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM outbox_events");
        jdbc.update("DELETE FROM notifications");
        jdbc.update("DELETE FROM project_state_transitions");
        Campaigns.clear(dataSource);
    }

    @Test
    @DisplayName("an edit to an item a live tier contains waits for a moderator, and its stock code does not")
    void aPublicItemWaitsForApproval() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID mug = createItem(projectId, creator, "Mug");
        createTier(projectId, creator, "Breakfast", mug);
        Campaigns.launch(dataSource, projectId);

        Map<String, Object> edited =
                patchItem(mug, creator, Map.of("name", "Signed mug", "weightGrams", 500, "sku", "MUG-1"));

        // The creator reads back what they proposed, and is told which of it waits.
        assertThat(edited)
                .containsEntry("name", "Signed mug")
                .containsEntry("weightGrams", 500)
                .containsEntry("sku", "MUG-1")
                .containsEntry("revisionChangedFields", List.of("name", "weightGrams"));
        // The public, and every quote, still read the item as it was. The stock code is the
        // creator's own and was written at once.
        assertThat(itemRow(mug))
                .containsEntry("name", "Mug")
                .containsEntry("weight_grams", null)
                .containsEntry("sku", "MUG-1");
        assertThat(items(projectId, creator).getFirst()).containsEntry("name", "Signed mug");
        assertThat(revisionOf(projectEdit(projectId, creator))).containsEntry("changedFields", List.of("items"));

        submit(projectId, creator);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        Map<String, Object> review = get("/v1/admin/moderation/revisions/" + revisionId, moderator).getBody();
        assertThat(review.get("changedFields")).isEqualTo(List.of("items"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> changes = (List<Map<String, Object>>) review.get("items");
        assertThat(changes).singleElement().satisfies(change -> {
            assertThat(change).containsEntry("id", mug.toString());
            assertThat(change).containsEntry("changedFields", List.of("name", "weightGrams"));
            assertThat(mapOf(change, "live")).containsEntry("name", "Mug");
            assertThat(mapOf(change, "proposed")).containsEntry("name", "Signed mug");
        });

        approve(moderator, revisionId);

        assertThat(itemRow(mug)).containsEntry("name", "Signed mug").containsEntry("weight_grams", 500);
        assertThat(items(projectId, creator).getFirst()).containsEntry("revisionChangedFields", List.of());
    }

    @Test
    @DisplayName("an item no approved tier contains is written at once, even on a live campaign")
    void anItemThePublicCannotSeeIsWrittenAtOnce() {
        String creator = signIn();
        UUID projectId = draft(creator);
        createTier(projectId, creator, "Thanks", null);
        Campaigns.launch(dataSource, projectId);
        UUID poster = createItem(projectId, creator, "Poster");

        Map<String, Object> edited = patchItem(poster, creator, Map.of("name", "Signed poster"));

        assertThat(edited).containsEntry("revisionChangedFields", List.of());
        assertThat(itemRow(poster)).containsEntry("name", "Signed poster");
        assertThat(revisionOf(projectEdit(projectId, creator))).isNull();
    }

    @Test
    @DisplayName("a live campaign's shipping regions are replaced only when a moderator approves")
    void regionsWaitForApproval() {
        String creator = signIn();
        UUID projectId = draft(creator);
        Map<String, Object> before = replaceZones(projectId, creator, List.of(zone("EU", "DE", "FR")));
        UUID eu = UUID.fromString((String) zonesIn(before).getFirst().get("id"));
        Campaigns.launch(dataSource, projectId);

        Map<String, Object> proposed =
                replaceZones(projectId, creator, List.of(zone("EU", "DE"), zone("Asia", "JP")));

        // The editor reads the proposed set, marked pending, and EU keeps its identifier, which
        // is what every tier's rate for it names.
        assertThat(proposed).containsEntry("pending", true);
        assertThat(zonesIn(proposed))
                .extracting(zone -> zone.get("name"), zone -> zone.get("countryCodes"))
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("Asia", List.of("JP")),
                        org.assertj.core.groups.Tuple.tuple("EU", List.of("DE")));
        assertThat(zonesIn(proposed).get(1)).containsEntry("id", eu.toString());
        UUID asia = UUID.fromString((String) zonesIn(proposed).getFirst().get("id"));
        // Quotes still read the regions as they were.
        assertThat(destinations(projectId)).containsExactlyInAnyOrder("DE:" + eu, "FR:" + eu);
        assertThat(get("/v1/projects/" + projectId + "/shipping-zones", creator).getBody())
                .containsEntry("pending", true);
        assertThat(revisionOf(projectEdit(projectId, creator)))
                .containsEntry("changedFields", List.of("shippingZones"));

        submit(projectId, creator);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        Map<String, Object> review = get("/v1/admin/moderation/revisions/" + revisionId, moderator).getBody();
        assertThat(mapOf(review, "shippingZones")).containsKeys("live", "proposed");

        approve(moderator, revisionId);

        // Created with the identifier the revision gave it, so the editor's ids stay true.
        assertThat(destinations(projectId)).containsExactlyInAnyOrder("DE:" + eu, "JP:" + asia);
        assertThat(get("/v1/projects/" + projectId + "/shipping-zones", creator).getBody())
                .containsEntry("pending", false);
    }

    @Test
    @DisplayName("a refused revision leaves the regions and the items as they were")
    void aRefusalChangesNothing() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID mug = createItem(projectId, creator, "Mug");
        createTier(projectId, creator, "Breakfast", mug);
        UUID eu = UUID.fromString(
                (String) zonesIn(replaceZones(projectId, creator, List.of(zone("EU", "DE")))).getFirst().get("id"));
        Campaigns.launch(dataSource, projectId);

        patchItem(mug, creator, Map.of("name", "Signed mug"));
        replaceZones(projectId, creator, List.of());
        submit(projectId, creator);
        String moderator = moderator();
        ResponseEntity<Map<String, Object>> refused = post(
                "/v1/admin/moderation/revisions/" + openRevisionId(projectId) + "/reject",
                moderator,
                Map.of("note", "Deleting every region would stop every pledge that ships."));
        assertThat(refused.getStatusCode()).as("reject: %s", refused.getBody()).isEqualTo(HttpStatus.OK);

        assertThat(itemRow(mug)).containsEntry("name", "Mug");
        assertThat(destinations(projectId)).containsExactly("DE:" + eu);
        assertThat(items(projectId, creator).getFirst())
                .containsEntry("name", "Mug")
                .containsEntry("revisionChangedFields", List.of());
        assertThat(get("/v1/projects/" + projectId + "/shipping-zones", creator).getBody())
                .containsEntry("pending", false);
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    private UUID createItem(UUID projectId, String creator, String name) {
        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects/" + projectId + "/items", creator, Map.of("name", name));
        assertThat(created.getStatusCode()).as("item: %s", created.getBody()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private void createTier(UUID projectId, String creator, String title, UUID item) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("price", Map.of("amount", "25.00", "currency", "AZN"));
        if (item != null) {
            body.put("items", List.of(Map.of("itemId", item.toString(), "quantity", 1)));
        }
        ResponseEntity<Map<String, Object>> created = post("/v1/projects/" + projectId + "/rewards", creator, body);
        assertThat(created.getStatusCode()).as("tier: %s", created.getBody()).isEqualTo(HttpStatus.CREATED);
    }

    private Map<String, Object> patchItem(UUID itemId, String creator, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> patched = send(HttpMethod.PATCH, "/v1/items/" + itemId, creator, body);
        assertThat(patched.getStatusCode()).as("patch: %s", patched.getBody()).isEqualTo(HttpStatus.OK);
        return patched.getBody();
    }

    private List<Map<String, Object>> items(UUID projectId, String creator) {
        return rest.exchange(
                        "/v1/projects/" + projectId + "/items",
                        HttpMethod.GET,
                        new HttpEntity<>(null, bearer(creator)),
                        new ParameterizedTypeReference<List<Map<String, Object>>>() {})
                .getBody();
    }

    private Map<String, Object> replaceZones(UUID projectId, String creator, List<Map<String, Object>> zones) {
        ResponseEntity<Map<String, Object>> replaced =
                send(HttpMethod.PUT, "/v1/projects/" + projectId + "/shipping-zones", creator, Map.of("zones", zones));
        assertThat(replaced.getStatusCode()).as("zones: %s", replaced.getBody()).isEqualTo(HttpStatus.OK);
        return replaced.getBody();
    }

    private static Map<String, Object> zone(String name, String... countries) {
        return Map.of("name", name, "countryCodes", List.of(countries));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> zonesIn(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("zones");
    }

    private Map<String, Object> itemRow(UUID itemId) {
        return new JdbcTemplate(dataSource)
                .queryForMap("SELECT name, weight_grams, sku FROM items WHERE id = ?", itemId);
    }

    /** {@code COUNTRY:zone} for every destination the campaign's quotes read now. */
    private List<String> destinations(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForList(
                        "SELECT country_code || ':' || zone_id FROM shipping_zone_countries WHERE project_id = ?",
                        String.class,
                        projectId);
    }

    private UUID openRevisionId(UUID projectId) {
        return new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT id FROM project_revisions WHERE project_id = ? AND status IN ('DRAFT', 'PENDING')",
                        UUID.class,
                        projectId);
    }

    private void submit(UUID projectId, String creator) {
        ResponseEntity<Map<String, Object>> submitted =
                post("/v1/projects/" + projectId + "/revision/submit", creator, null);
        assertThat(submitted.getStatusCode()).as("submit: %s", submitted.getBody()).isEqualTo(HttpStatus.OK);
    }

    private void approve(String moderator, UUID revisionId) {
        ResponseEntity<Map<String, Object>> approved =
                post("/v1/admin/moderation/revisions/" + revisionId + "/approve", moderator, null);
        assertThat(approved.getStatusCode()).as("approve: %s", approved.getBody()).isEqualTo(HttpStatus.OK);
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

    private ResponseEntity<Map<String, Object>> send(HttpMethod method, String path, String accessToken, Object body) {
        return rest.exchange(path, method, new HttpEntity<>(body, bearer(accessToken)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> post(String path, String accessToken, Object body) {
        return send(HttpMethod.POST, path, accessToken, body);
    }

    private ResponseEntity<Map<String, Object>> get(String path, String accessToken) {
        return send(HttpMethod.GET, path, accessToken, null);
    }

    private UUID draft(String accessToken) {
        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects", accessToken, Map.of("title", "A campaign with a catalogue"));
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private String signIn() {
        String email = "catalogue-hold-" + SEQUENCE.incrementAndGet() + "@example.com";
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
