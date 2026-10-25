package az.ideanest.reward;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import az.ideanest.auth.application.AccessTokenIssuer;
import az.ideanest.media.application.MediaLibrary;
import az.ideanest.media.application.MediaProcessingJob;
import az.ideanest.project.application.RewardFacts;
import az.ideanest.reward.application.RewardStock;
import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.LocalObjectStore;
import az.ideanest.support.ScriptedImageTranscoder;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import org.assertj.core.api.InstanceOfAssertFactories;
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
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Every change to a launched campaign's reward tiers waits for a moderator (#569), over HTTP.
 *
 * <p>A tier created after launch is a row the public must not reach by any road: the public
 * catalogue, a secret link, a pledge, an add-on, the alternatives offered for a sold-out tier,
 * the stock statements and the checklist's prices each get an assertion here. A deletion, a new
 * order and every field of an approved tier wait in the revision, and approval applies them.
 */
class RewardHoldApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";
    private static final String MODERATOR_EMAIL = "moderator@ideanest.test";
    private static final byte[] BYTES = "....a picture".getBytes(StandardCharsets.ISO_8859_1);
    private static final ObjectMapper JSON = new ObjectMapper();
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

    @Autowired
    private RewardStock stock;

    @Autowired
    private RewardFacts facts;

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
        jdbc.update("DELETE FROM pledge_addons");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM project_state_transitions");
        Campaigns.clear(dataSource);
    }

    @Test
    @DisplayName("a tier created on a live campaign is the creator's draft until a moderator approves it")
    void aCreatedTierWaitsForApproval() {
        String creator = signIn();
        UUID projectId = draft(creator);
        create(projectId, creator, tier("Mug"));
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<Map<String, Object>> created = create(projectId, creator, tier("Poster"));
        UUID poster = idOf(created.getBody());
        assertThat(created.getBody())
                .containsEntry("pending", "created")
                .containsEntry("revisionChangedFields", List.of());
        assertThat(approved(poster)).isFalse();
        assertThat(list(projectId, creator))
                .extracting(entry -> entry.get("title"), entry -> entry.get("pending"))
                .containsExactly(
                        tuple("Mug", null),
                        tuple("Poster", "created"));
        assertThat(publicTitles(projectId, null)).containsExactly("Mug");
        assertThat(revisionOf(projectEdit(projectId, creator))).containsEntry("changedFields", List.of("rewards"));

        Map<String, Object> renamed = patch(poster, creator, Map.of("title", "Signed poster")).getBody();
        assertThat(renamed).containsEntry("title", "Signed poster").containsEntry("pending", "created");
        assertThat(publicTitles(projectId, null)).containsExactly("Mug");

        submit(projectId, creator);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        Map<String, Object> change = singleChange(moderator, revisionId);
        assertThat(change)
                .containsEntry("id", poster.toString())
                .containsEntry("changes", List.of("created"))
                .containsEntry("livePosition", null)
                .containsEntry("proposedPosition", 1)
                .containsEntry("live", null);
        assertThat(mapOf(change, "price")).containsEntry("amount", "25.00");
        assertThat(mapOf(change, "proposed")).containsEntry("title", "Signed poster");

        approve(moderator, revisionId);

        assertThat(approved(poster)).isTrue();
        assertThat(publicTitles(projectId, null)).containsExactly("Mug", "Signed poster");
        assertThat(list(projectId, creator)).allSatisfy(entry -> assertThat(entry).containsEntry("pending", null));
    }

    @Test
    @DisplayName("no road a backer or a visitor has reaches a tier that waits for approval")
    void noPublicReaderReachesAnUnapprovedTier() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID open = idOf(create(projectId, creator, tier("Open")).getBody());
        Campaigns.launch(dataSource, projectId);

        UUID hidden = idOf(create(projectId, creator, tier("Hidden")).getBody());
        Map<String, Object> secretBody = tier("Hidden secret");
        secretBody.put("isSecret", true);
        Map<String, Object> secret = create(projectId, creator, secretBody).getBody();
        String token = (String) secret.get("secretToken");
        assertThat(token).isNotBlank();
        Map<String, Object> addonBody = tier("Hidden add-on");
        addonBody.put("isAddon", true);
        UUID addon = idOf(create(projectId, creator, addonBody).getBody());

        // The campaign page's list, with and without the secret link.
        assertThat(publicTitles(projectId, null)).containsExactly("Open");
        assertThat(publicTitles(projectId, token)).containsExactly("Open");
        assertThat(publicAddons(projectId)).isEmpty();

        // Pricing, checkout's selection, the alternatives to a full tier, the checklist.
        assertThat(stock.priceOf(projectId, hidden)).isEmpty();
        assertThat(stock.priceOf(projectId, open)).isPresent();
        assertThat(stock.selectionOf(projectId, List.of(open, hidden, addon), null))
                .extracting(RewardStock.SelectableTier::rewardTierId)
                .containsExactly(open);
        assertThat(stock.alternativesTo(projectId, open, Instant.now())).isEmpty();
        assertThat(facts.pricesOf(projectId)).containsExactly(new BigDecimal("25.00"));

        // The stock statements themselves.
        assertThat(stock.reservePlaces(hidden, 1)).isFalse();
        assertThat(stock.claimPlaces(hidden, 1)).isFalse();
        assertThat(new JdbcTemplate(dataSource)
                        .queryForObject(
                                "SELECT claimed_quantity + reserved_quantity FROM reward_tiers WHERE id = ?",
                                Integer.class,
                                hidden))
                .isZero();

        // A pledge, and an add-on to a pledge.
        String backer = signIn();
        ResponseEntity<Map<String, Object>> pledged = pledge(backer, projectId, hidden, List.of());
        assertThat(pledged.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(pledged.getBody()).containsEntry("code", "REWARD_NOT_FOUND");
        ResponseEntity<Map<String, Object>> withAddon =
                pledge(backer, projectId, open, List.of(Map.of("rewardTierId", addon.toString(), "quantity", 1)));
        assertThat(withAddon.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(pledgeCount(projectId)).isZero();

        submit(projectId, creator);
        String moderator = moderator();
        approve(moderator, openRevisionId(projectId));

        assertThat(publicTitles(projectId, null)).containsExactly("Open", "Hidden");
        assertThat(publicTitles(projectId, token)).containsExactly("Open", "Hidden", "Hidden secret");
        assertThat(stock.priceOf(projectId, hidden)).isPresent();
        assertThat(pledge(backer, projectId, hidden, List.of()).getStatusCode()).isEqualTo(HttpStatus.CREATED);
    }

    @Test
    @DisplayName("refusing or discarding the revision deletes the tiers created for it, and their pictures")
    void refusalAndDiscardDeleteCreatedTiers() {
        String creator = signIn();
        UUID projectId = draft(creator);
        Campaigns.launch(dataSource, projectId);

        UUID picture = uploadImage(creator);
        Map<String, Object> body = tier("Refused");
        body.put("imageMediaId", picture.toString());
        UUID refused = idOf(create(projectId, creator, body).getBody());
        submit(projectId, creator);
        ResponseEntity<Map<String, Object>> rejected = post(
                "/v1/admin/moderation/revisions/" + openRevisionId(projectId) + "/reject",
                moderator(),
                Map.of("note", "This tier promises what the campaign cannot deliver."));
        assertThat(rejected.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(tierExists(refused)).isFalse();
        assertThat(list(projectId, creator)).isEmpty();
        assertThat(store.has("media/" + picture + ".jpg")).isFalse();

        UUID discarded = idOf(create(projectId, creator, tier("Discarded")).getBody());
        assertThat(send(HttpMethod.DELETE, "/v1/projects/" + projectId + "/revision", creator, null).getStatusCode())
                .isEqualTo(HttpStatus.OK);
        assertThat(tierExists(discarded)).isFalse();
        assertThat(openRevisionCount(projectId)).isZero();
    }

    @Test
    @DisplayName("deleting a public tier waits for approval, can be undone, and is still refused once it has backers")
    void aDeletionWaitsAndCanBeUndone() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID first = idOf(create(projectId, creator, tier("First")).getBody());
        UUID second = idOf(create(projectId, creator, tier("Second")).getBody());
        Campaigns.launch(dataSource, projectId);

        assertThat(send(HttpMethod.DELETE, "/v1/rewards/" + first, creator, null).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(tierExists(first)).isTrue();
        assertThat(publicTitles(projectId, null)).containsExactly("First", "Second");
        assertThat(list(projectId, creator).get(0)).containsEntry("pending", "deleted");

        Map<String, Object> restored = post("/v1/rewards/" + first + "/restore", creator, null).getBody();
        assertThat(restored).containsEntry("pending", null);
        assertThat(openRevisionCount(projectId)).as("nothing left to review").isZero();

        send(HttpMethod.DELETE, "/v1/rewards/" + first, creator, null);
        submit(projectId, creator);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        Map<String, Object> change = singleChange(moderator, revisionId);
        assertThat(change)
                .containsEntry("id", first.toString())
                .containsEntry("changes", List.of("deleted"))
                .containsEntry("livePosition", 0)
                .containsEntry("proposedPosition", null)
                .containsEntry("proposed", null);
        assertThat(mapOf(change, "live")).containsEntry("title", "First");

        approve(moderator, revisionId);
        assertThat(tierExists(first)).isFalse();
        assertThat(publicTitles(projectId, null)).containsExactly("Second");

        new JdbcTemplate(dataSource).update("UPDATE reward_tiers SET claimed_quantity = 1 WHERE id = ?", second);
        ResponseEntity<Map<String, Object>> backed = send(HttpMethod.DELETE, "/v1/rewards/" + second, creator, null);
        assertThat(backed.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(backed.getBody()).containsEntry("code", "REWARD_HAS_BACKERS");
        assertThat(openRevisionCount(projectId)).isZero();
    }

    @Test
    @DisplayName("an approved deletion keeps a tier somebody backed in the meantime")
    void anApprovedDeletionKeepsATierBackedSince() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID tier = idOf(create(projectId, creator, tier("Popular")).getBody());
        Campaigns.launch(dataSource, projectId);
        send(HttpMethod.DELETE, "/v1/rewards/" + tier, creator, null);
        submit(projectId, creator);

        new JdbcTemplate(dataSource).update("UPDATE reward_tiers SET claimed_quantity = 1 WHERE id = ?", tier);
        approve(moderator(), openRevisionId(projectId));

        assertThat(tierExists(tier)).isTrue();
        assertThat(publicTitles(projectId, null)).containsExactly("Popular");
        assertThat(new JdbcTemplate(dataSource).queryForList(
                        "SELECT detail FROM audit_logs WHERE action = 'project.revision_approved' AND entity_id = ?",
                        String.class,
                        projectId))
                .singleElement()
                .asString()
                .contains("kept backed tiers [" + tier + "]");
    }

    @Test
    @DisplayName("a new order waits for approval, and the review names the tiers it moves")
    void aNewOrderWaitsForApproval() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID a = idOf(create(projectId, creator, tier("A")).getBody());
        UUID b = idOf(create(projectId, creator, tier("B")).getBody());
        UUID c = idOf(create(projectId, creator, tier("C")).getBody());
        Campaigns.launch(dataSource, projectId);

        ResponseEntity<Map<String, Object>> incomplete = send(
                HttpMethod.PATCH,
                "/v1/projects/" + projectId + "/rewards/reorder",
                creator,
                Map.of("rewardIds", List.of(c, a)));
        assertThat(incomplete.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

        List<Map<String, Object>> reordered = reorder(projectId, creator, List.of(c, a, b)).getBody();
        assertThat(reordered)
                .extracting(entry -> entry.get("title"), entry -> entry.get("sortOrder"))
                .containsExactly(
                        tuple("C", 0),
                        tuple("A", 1),
                        tuple("B", 2));
        assertThat(list(projectId, creator)).extracting(entry -> entry.get("title")).containsExactly("C", "A", "B");
        assertThat(publicTitles(projectId, null)).containsExactly("A", "B", "C");

        submit(projectId, creator);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        List<Map<String, Object>> changes = changesOf(moderator, revisionId);
        assertThat(changes)
                .extracting(
                        change -> change.get("id"),
                        change -> change.get("changes"),
                        change -> change.get("livePosition"),
                        change -> change.get("proposedPosition"))
                .containsExactly(
                        tuple(c.toString(), List.of("reordered"), 2, 0),
                        tuple(a.toString(), List.of("reordered"), 0, 1),
                        tuple(b.toString(), List.of("reordered"), 1, 2));

        approve(moderator, revisionId);
        assertThat(publicTitles(projectId, null)).containsExactly("C", "A", "B");
    }

    @Test
    @DisplayName("every editable field of a public tier, its items and its rates wait for approval and are applied by it")
    void everyFieldOfAPublicTierWaits() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID item = idOf(post("/v1/projects/" + projectId + "/items", creator, Map.of("name", "Enamel mug")).getBody());
        Map<String, Object> body = tier("Mug");
        body.put("shippingType", "DOMESTIC");
        body.put("limitQuantity", 10);
        UUID rewardId = idOf(create(projectId, creator, body).getBody());
        Campaigns.launch(dataSource, projectId);

        Instant until = Instant.now().plus(10, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("items", List.of(Map.of("itemId", item.toString(), "quantity", 2)));
        edit.put("isEarlyBird", true);
        edit.put("availableUntil", until.toString());
        edit.put("estimatedDelivery", "2027-05-01");
        edit.put("isSecret", true);
        Map<String, Object> saved = patch(rewardId, creator, edit).getBody();
        assertThat(saved)
                .containsEntry("pending", "changed")
                .containsEntry("isSecret", true)
                .containsEntry("revisionChangedFields", List.of(
                        "estimatedDelivery", "isEarlyBird", "isSecret", "availableUntil", "items"));
        String token = (String) saved.get("secretToken");
        assertThat(token).isNotBlank();

        ResponseEntity<Map<String, Object>> rates = send(
                HttpMethod.PUT,
                "/v1/rewards/" + rewardId + "/shipping-rules",
                creator,
                Map.of("rules", List.of(Map.of("countryCode", "AZ", "amount", "5.00"))));
        assertThat(rates.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(rates.getBody()).extracting("shippingRules").asInstanceOf(InstanceOfAssertFactories.LIST).hasSize(1);
        assertThat(rowCount("SELECT count(*) FROM shipping_rules WHERE reward_tier_id = ?", rewardId)).isZero();
        assertThat(rowCount("SELECT count(*) FROM reward_tier_items WHERE reward_tier_id = ?", rewardId)).isZero();

        Map<String, Object> shown = publicCatalogue(projectId, null).get(0);
        assertThat(shown).containsEntry("isEarlyBird", false).containsEntry("estimatedDelivery", null);
        assertThat(shown).extracting("items").asInstanceOf(InstanceOfAssertFactories.LIST).isEmpty();
        assertThat(shown).extracting("shippingRates").asInstanceOf(InstanceOfAssertFactories.LIST).isEmpty();

        submit(projectId, creator);
        String moderator = moderator();
        UUID revisionId = openRevisionId(projectId);
        Map<String, Object> change = singleChange(moderator, revisionId);
        assertThat(change)
                .containsEntry("changes", List.of("changed"))
                .containsEntry("changedFields", List.of(
                        "estimatedDelivery", "isEarlyBird", "isSecret", "availableUntil", "items", "shippingRules"));
        Map<String, Object> proposed = mapOf(change, "proposed");
        assertThat(proposed).containsEntry("isSecret", true).containsEntry("limitQuantity", 10);
        assertThat(proposed)
                .extracting("items")
                .asInstanceOf(InstanceOfAssertFactories.LIST)
                .singleElement()
                .isEqualTo(Map.of("itemId", item.toString(), "name", "Enamel mug", "quantity", 2));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> proposedRules = (List<Map<String, Object>>) proposed.get("shippingRules");
        assertThat(proposedRules).singleElement().satisfies(rule -> assertThat(rule)
                .containsEntry("countryCode", "AZ")
                .containsEntry("amount", "5.00"));
        assertThat(mapOf(change, "live")).containsEntry("isSecret", false);

        approve(moderator, revisionId);

        assertThat(publicTitles(projectId, null)).as("secret now").isEmpty();
        Map<String, Object> unlocked = publicCatalogue(projectId, token).get(0);
        assertThat(unlocked).containsEntry("isEarlyBird", true).containsEntry("estimatedDelivery", "2027-05-01");
        assertThat(unlocked).extracting("items").asInstanceOf(InstanceOfAssertFactories.LIST).hasSize(1);
        assertThat(unlocked).extracting("shippingRates").asInstanceOf(InstanceOfAssertFactories.LIST).hasSize(1);
        assertThat(rowCount("SELECT count(*) FROM reward_tier_items WHERE reward_tier_id = ?", rewardId)).isOne();
        assertThat(list(projectId, creator).get(0))
                .containsEntry("pending", null)
                .containsEntry("secretToken", token)
                .containsEntry("revisionChangedFields", List.of());
    }

    @Test
    @DisplayName("a tier duplicated on a live campaign is a created tier copied from the draft")
    void aDuplicateOnALiveCampaignIsCreated() {
        String creator = signIn();
        UUID projectId = draft(creator);
        UUID original = idOf(create(projectId, creator, tier("Original")).getBody());
        Campaigns.launch(dataSource, projectId);
        patch(original, creator, Map.of("title", "Renamed"));

        ResponseEntity<Map<String, Object>> copied = post("/v1/rewards/" + original + "/duplicate", creator, null);

        assertThat(copied.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(copied.getBody()).containsEntry("title", "Renamed").containsEntry("pending", "created");
        assertThat(approved(idOf(copied.getBody()))).isFalse();
        assertThat(publicTitles(projectId, null)).containsExactly("Original");
    }

    @Test
    @DisplayName("a revision saved before every reward change was held still reads, and is approved as it was")
    void aRevisionSavedBefore569StillWorks() {
        String creator = signIn();
        UUID projectId = draft(creator);
        Map<String, Object> body = tier("Mug");
        body.put("limitQuantity", 10);
        UUID rewardId = idOf(create(projectId, creator, body).getBody());
        Campaigns.launch(dataSource, projectId);
        writeRevisionAsBefore569(projectId, rewardId, "Old held title");

        Map<String, Object> draft = list(projectId, creator).get(0);
        assertThat(draft)
                .containsEntry("title", "Old held title")
                .containsEntry("limitQuantity", 10)
                .containsEntry("pending", "changed")
                .containsEntry("revisionChangedFields", List.of("title"));

        assertThat(patch(rewardId, creator, Map.of("limitQuantity", 12)).getStatusCode()).isEqualTo(HttpStatus.OK);
        submit(projectId, creator);
        approve(moderator(), openRevisionId(projectId));

        assertThat(publicCatalogue(projectId, null).get(0))
                .containsEntry("title", "Old held title")
                .containsEntry("limitQuantity", 12);
    }

    // ------------------------------------------------------------------

    /** A revision row exactly as #559 wrote it: the campaign's writing, and the tier's four fields. */
    private void writeRevisionAsBefore569(UUID projectId, UUID rewardId, String title) {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Map<String, Object> project = jdbc.queryForMap(
                "SELECT title, blurb, risks, story::text AS story, array_to_json(countries)::text AS countries,"
                        + " creator_id FROM projects WHERE id = ?",
                projectId);
        ObjectNode content = JSON.createObjectNode();
        content.put("title", (String) project.get("title"));
        content.put("blurb", (String) project.get("blurb"));
        content.putNull("categoryId");
        content.putNull("subcategoryId");
        if (project.get("story") == null) {
            content.putNull("story");
        } else {
            content.set("story", JSON.readTree((String) project.get("story")));
        }
        content.put("risks", (String) project.get("risks"));
        content.putNull("coverImage");
        content.putNull("videoMediaId");
        content.set("countries", JSON.readTree((String) project.get("countries")));
        ObjectNode reward = content.putObject("rewards").putObject(rewardId.toString());
        reward.put("title", title);
        reward.putNull("description");
        reward.putNull("imageMediaId");
        reward.putNull("videoMediaId");
        jdbc.update(
                "INSERT INTO project_revisions (id, project_id, status, content, author_id)"
                        + " VALUES (?, ?, 'DRAFT', CAST(? AS jsonb), ?)",
                UUID.randomUUID(),
                projectId,
                content.toString(),
                project.get("creator_id"));
    }

    private boolean approved(UUID rewardId) {
        return new JdbcTemplate(dataSource)
                .queryForObject("SELECT approved FROM reward_tiers WHERE id = ?", Boolean.class, rewardId);
    }

    private boolean tierExists(UUID rewardId) {
        return rowCount("SELECT count(*) FROM reward_tiers WHERE id = ?", rewardId) == 1;
    }

    private int rowCount(String sql, UUID id) {
        return new JdbcTemplate(dataSource).queryForObject(sql, Integer.class, id);
    }

    private int pledgeCount(UUID projectId) {
        return rowCount("SELECT count(*) FROM pledges WHERE project_id = ?", projectId);
    }

    private int openRevisionCount(UUID projectId) {
        return rowCount(
                "SELECT count(*) FROM project_revisions WHERE project_id = ? AND status IN ('DRAFT', 'PENDING')",
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

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> changesOf(String moderator, UUID revisionId) {
        Map<String, Object> review = get("/v1/admin/moderation/revisions/" + revisionId, moderator).getBody();
        return (List<Map<String, Object>>) review.get("rewards");
    }

    private Map<String, Object> singleChange(String moderator, UUID revisionId) {
        List<Map<String, Object>> changes = changesOf(moderator, revisionId);
        assertThat(changes).hasSize(1);
        return changes.get(0);
    }

    private ResponseEntity<Map<String, Object>> pledge(
            String backer, UUID projectId, UUID rewardId, List<Map<String, Object>> addons) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", projectId.toString());
        body.put("rewardTierId", rewardId.toString());
        body.put("addons", addons);
        body.put("contribution", Map.of("amount", "25.00", "currency", "AZN"));
        HttpHeaders headers = bearer(backer);
        headers.set("Idempotency-Key", UUID.randomUUID().toString());
        return rest.exchange("/v1/pledges/draft", HttpMethod.POST, new HttpEntity<>(body, headers), OBJECT);
    }

    private List<String> publicTitles(UUID projectId, String token) {
        return publicCatalogue(projectId, token).stream()
                .map(entry -> (String) entry.get("title"))
                .toList();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> publicCatalogue(UUID projectId, String token) {
        ResponseEntity<Map<String, Object>> offered = rest.exchange(
                "/v1/projects/" + projectId + "/rewards/public" + (token == null ? "" : "?token=" + token),
                HttpMethod.GET,
                new HttpEntity<>(new HttpHeaders()),
                OBJECT);
        assertThat(offered.getStatusCode()).isEqualTo(HttpStatus.OK);
        return (List<Map<String, Object>>) offered.getBody().get("rewards");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> publicAddons(UUID projectId) {
        ResponseEntity<Map<String, Object>> offered = rest.exchange(
                "/v1/projects/" + projectId + "/rewards/public",
                HttpMethod.GET,
                new HttpEntity<>(new HttpHeaders()),
                OBJECT);
        return (List<Map<String, Object>>) offered.getBody().get("addons");
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

    private ResponseEntity<List<Map<String, Object>>> reorder(UUID projectId, String accessToken, List<UUID> order) {
        return rest.exchange(
                "/v1/projects/" + projectId + "/rewards/reorder",
                HttpMethod.PATCH,
                new HttpEntity<>(Map.of("rewardIds", order), bearer(accessToken)),
                new ParameterizedTypeReference<List<Map<String, Object>>>() {});
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
        String email = "reward-hold-" + SEQUENCE.incrementAndGet() + "@example.com";
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
