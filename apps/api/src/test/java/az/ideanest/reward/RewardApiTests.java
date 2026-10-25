package az.ideanest.reward;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.user.infrastructure.UserRepository;
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
 * Items and reward tiers, over HTTP.
 *
 * <p>The tests that carry the design are
 * {@link #deletingARewardSomebodyChoseIsRefused()} — §5.3 without exception, and the
 * reason the delete endpoint reads a stock column at all —
 * {@link #duplicatingCopiesTheCompositionAndNotTheCounts()}, and
 * {@link #reorderingNeedsEveryTierExactlyOnce()}, which is what stands between a
 * creator's reward list and an order nobody asked for.
 *
 * <p>{@code claimed_quantity} is written with a {@link JdbcTemplate} where a test needs a
 * claimed tier. That is not a shortcut around the API: no endpoint in the service writes
 * that column, deliberately — epic #50 does, when pledges exist — and the entity does not
 * expose it. Writing it directly is the only way to test the rule before then, and it is
 * exactly what a pledge will do.
 */
class RewardApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clearRewards() {
        // Rewards cascade from campaigns and campaigns do not cascade from users, so a
        // suite that left rows here would break the identity tests' own cleanup. In
        // dependency order rather than by cascade, because that is the cleanup and not
        // the assertion -- RewardSchemaTests is where the cascades are checked.
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM shipping_rules");
        jdbc.update("DELETE FROM reward_tier_items");
        jdbc.update("DELETE FROM reward_tiers");
        jdbc.update("DELETE FROM items");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Fixtures
    // ------------------------------------------------------------------

    /** A registered, signed-in account: its access token and its identifier. */
    private record Creator(String accessToken, UUID id) {
    }

    private Creator creator() {
        EmailAddress email = EmailAddress.of("rewards" + SEQUENCE.incrementAndGet() + "@example.com");
        rest.postForEntity(
                "/v1/auth/register",
                Map.of("email", email.value(), "password", PASSWORD, "name", "Test Creator"),
                String.class);

        ResponseEntity<Map<String, Object>> signedIn = rest.exchange(
                "/v1/auth/login",
                HttpMethod.POST,
                new HttpEntity<>(
                        Map.of("email", email.value(), "password", PASSWORD, "tokenDelivery", "body"), jsonHeaders()),
                new ParameterizedTypeReference<Map<String, Object>>() {});

        UUID id = users.findByEmailAndDeletedAtIsNull(email).orElseThrow().getId();
        return new Creator((String) signedIn.getBody().get("accessToken"), id);
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

    private static final ParameterizedTypeReference<Map<String, Object>> OBJECT =
            new ParameterizedTypeReference<Map<String, Object>>() {};

    private static final ParameterizedTypeReference<List<Map<String, Object>>> ARRAY =
            new ParameterizedTypeReference<List<Map<String, Object>>>() {};

    private ResponseEntity<Map<String, Object>> post(String path, String token, Object body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, bearer(token)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> patch(String path, String token, Object body) {
        return rest.exchange(path, HttpMethod.PATCH, new HttpEntity<>(body, bearer(token)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> put(String path, String token, Object body) {
        return rest.exchange(path, HttpMethod.PUT, new HttpEntity<>(body, bearer(token)), OBJECT);
    }

    private ResponseEntity<Map<String, Object>> delete(String path, String token) {
        return rest.exchange(path, HttpMethod.DELETE, new HttpEntity<>(bearer(token)), OBJECT);
    }

    private ResponseEntity<List<Map<String, Object>>> getList(String path, String token) {
        return rest.exchange(path, HttpMethod.GET, new HttpEntity<>(bearer(token)), ARRAY);
    }

    /**
     * A request whose body is literal JSON.
     *
     * <p>Needed for every test about clearing a field. The application's Jackson is
     * configured with {@code default-property-inclusion: non_null} and
     * {@link TestRestTemplate} shares it, so a {@link Map} containing a null value is
     * serialised with that key <em>omitted</em> — the opposite of what those tests check.
     */
    private ResponseEntity<Map<String, Object>> patchJson(String path, String token, String body) {
        return rest.exchange(path, HttpMethod.PATCH, new HttpEntity<>(body, bearer(token)), OBJECT);
    }

    private ResponseEntity<String> postRaw(String path, String token, Object body) {
        return rest.exchange(path, HttpMethod.POST, new HttpEntity<>(body, bearer(token)), String.class);
    }

    private UUID project(Creator creator) {
        Map<String, Object> created =
                post("/v1/projects", creator.accessToken(), Map.of("title", "A campaign")).getBody();
        return UUID.fromString((String) created.get("id"));
    }

    private Map<String, Object> item(Creator creator, UUID projectId, String name) {
        return post("/v1/projects/" + projectId + "/items", creator.accessToken(), Map.of("name", name))
                .getBody();
    }

    /** A reward tier priced at 19.99 with nothing else set. */
    private Map<String, Object> reward(Creator creator, UUID projectId, String title) {
        return post(
                        "/v1/projects/" + projectId + "/rewards",
                        creator.accessToken(),
                        Map.of("title", title, "price", Map.of("amount", "19.99", "currency", "AZN")))
                .getBody();
    }

    private static UUID idOf(Map<String, Object> resource) {
        return UUID.fromString((String) resource.get("id"));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOf(Map<String, Object> resource, String field) {
        return (List<Map<String, Object>>) resource.get(field);
    }

    /** What a confirmed pledge will do when epic #50 exists. See the class comment. */
    private void claim(UUID rewardId, int places) {
        new JdbcTemplate(dataSource)
                .update("UPDATE reward_tiers SET claimed_quantity = ? WHERE id = ?", places, rewardId);
    }

    /**
     * Takes the campaign live, which is a precondition here rather than a subject.
     *
     * <p>{@link Campaigns} writes the row the launch endpoint would have written. The
     * lifecycle itself — submission, moderation, the audit trail — is asserted in
     * {@code ProjectLifecycleApiTests}, and driving every fixture in this file
     * through it would make each of these tests depend on the moderation
     * configuration for a state they only need to be in.
     */
    private void launch(UUID projectId) {
        Campaigns.launch(dataSource, projectId);
    }

    // ------------------------------------------------------------------
    // Items
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an item is created, listed, edited, and removed")
    void theItemLifecycle() {
        Creator creator = creator();
        UUID projectId = project(creator);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", "A hardcover book");
        body.put("description", "Two hundred pages, cloth bound.");
        body.put("weightGrams", 800);
        body.put("sku", "BOOK-01");

        ResponseEntity<Map<String, Object>> created = post("/v1/projects/" + projectId + "/items", creator.accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        Map<String, Object> item = created.getBody();
        assertThat(item)
                .containsEntry("name", "A hardcover book")
                .containsEntry("weightGrams", 800)
                .containsEntry("sku", "BOOK-01")
                .containsEntry("isDigital", false)
                .containsEntry("projectId", projectId.toString());
        // Present and null rather than absent, so the editor can bind a form to it.
        assertThat(item).containsEntry("imageUrl", null);

        // The list endpoint is what the tier editor offers as "items to include". It is
        // not in the epic's endpoint list; without it the client has no way to obtain
        // one after a reload.
        assertThat(getList("/v1/projects/" + projectId + "/items", creator.accessToken()).getBody())
                .hasSize(1);

        Map<String, Object> edited = patch(
                        "/v1/items/" + idOf(item), creator.accessToken(), Map.of("name", "A signed hardcover book"))
                .getBody();
        assertThat(edited).containsEntry("name", "A signed hardcover book");
        // Autosave sends one field. Everything else survives.
        assertThat(edited).containsEntry("weightGrams", 800).containsEntry("sku", "BOOK-01");

        assertThat(delete("/v1/items/" + idOf(item), creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(getList("/v1/projects/" + projectId + "/items", creator.accessToken()).getBody())
                .isEmpty();
    }

    @Test
    @DisplayName("a digital item cannot carry a shipping weight")
    void aDigitalItemHasNoWeight() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID itemId = idOf(item(creator, projectId, "A wallpaper pack"));

        patch("/v1/items/" + itemId, creator.accessToken(), Map.of("weightGrams", 500));

        // The two columns move together, so the field named is the one to clear. A
        // weight against a file would be summed into a shipping quote for a download.
        ResponseEntity<Map<String, Object>> refused =
                patch("/v1/items/" + itemId, creator.accessToken(), Map.of("isDigital", true));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody()).containsEntry("code", "REWARD_FIELD_INVALID");
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "weightGrams"));

        // Both at once is the edit the creator meant.
        Map<String, Object> digital = patchJson(
                        "/v1/items/" + itemId, creator.accessToken(), "{\"isDigital\": true, \"weightGrams\": null}")
                .getBody();
        assertThat(digital).containsEntry("isDigital", true).containsEntry("weightGrams", null);
    }

    @Test
    @DisplayName("a name is required and a stock code is unique within the campaign")
    void itemFieldsAreValidatedByName() {
        Creator creator = creator();
        UUID projectId = project(creator);

        assertThat(post("/v1/projects/" + projectId + "/items", creator.accessToken(), Map.of("name", "  "))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        post("/v1/projects/" + projectId + "/items", creator.accessToken(), Map.of("name", "A mug", "sku", "MUG-01"));
        Map<String, Object> second = item(creator, projectId, "Another mug");

        ResponseEntity<Map<String, Object>> clash =
                patch("/v1/items/" + idOf(second), creator.accessToken(), Map.of("sku", "MUG-01"));
        assertThat(clash.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // The field name, so the editor can put the message beside the input.
        assertThat(clash.getBody().get("meta")).isEqualTo(Map.of("field", "sku"));
    }

    @Test
    @DisplayName("an item a reward contains cannot be deleted, and the tiers are named")
    void anItemInsideARewardCannotBeDeleted() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID itemId = idOf(item(creator, projectId, "A mug"));
        UUID rewardId = idOf(rewardWithItems(creator, projectId, "The mug tier", itemId, 1));

        ResponseEntity<Map<String, Object>> refused = delete("/v1/items/" + itemId, creator.accessToken());

        // A cascade would have removed the mug from the tier, quietly changing what a
        // backer was promised, in a request that reads as housekeeping in a log.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "ITEM_IN_USE");
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("rewardTierIds", List.of(rewardId.toString())));

        // Taken out of the tier, it can go.
        patchJson("/v1/rewards/" + rewardId, creator.accessToken(), "{\"items\": []}");
        assertThat(delete("/v1/items/" + itemId, creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
    }

    // ------------------------------------------------------------------
    // Reward tiers
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a reward is created with its composition, listed, edited, and removed")
    void theRewardLifecycle() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID book = idOf(item(creator, projectId, "A hardcover book"));
        UUID mug = idOf(item(creator, projectId, "A mug"));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "Book and mug");
        body.put("description", "The book, and something to drink from while reading it.");
        body.put("price", Map.of("amount", "49.00", "currency", "AZN"));
        body.put("estimatedDelivery", "2026-06-01");
        body.put("limitQuantity", 100);
        body.put("shippingType", "DOMESTIC");
        body.put("items", List.of(Map.of("itemId", book.toString(), "quantity", 1),
                Map.of("itemId", mug.toString(), "quantity", 2)));

        ResponseEntity<Map<String, Object>> created =
                post("/v1/projects/" + projectId + "/rewards", creator.accessToken(), body);
        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        Map<String, Object> reward = created.getBody();
        assertThat(reward)
                .containsEntry("title", "Book and mug")
                .containsEntry("estimatedDelivery", "2026-06-01")
                .containsEntry("limitQuantity", 100)
                .containsEntry("claimedQuantity", 0)
                .containsEntry("reservedQuantity", 0)
                // Derived from the three above, so it cannot disagree with them.
                .containsEntry("remainingQuantity", 100)
                .containsEntry("shippingType", "DOMESTIC")
                .containsEntry("isSecret", false)
                .containsEntry("secretToken", null)
                .containsEntry("sortOrder", 0);
        assertThat(listOf(reward, "items"))
                .containsExactlyInAnyOrder(
                        Map.of("itemId", book.toString(), "quantity", 1),
                        Map.of("itemId", mug.toString(), "quantity", 2));

        assertThat(getList("/v1/projects/" + projectId + "/rewards", creator.accessToken()).getBody())
                .hasSize(1);

        // A composition is replaced wholesale: present means "this is what it contains
        // now". A per-line patch would let two tabs each remove a different item and
        // leave a tier containing neither.
        Map<String, Object> recomposed = patch(
                        "/v1/rewards/" + idOf(reward),
                        creator.accessToken(),
                        Map.of("items", List.of(Map.of("itemId", mug.toString(), "quantity", 3))))
                .getBody();
        assertThat(listOf(recomposed, "items")).containsExactly(Map.of("itemId", mug.toString(), "quantity", 3));

        assertThat(delete("/v1/rewards/" + idOf(reward), creator.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(getList("/v1/projects/" + projectId + "/rewards", creator.accessToken()).getBody())
                .isEmpty();
    }

    @Test
    @DisplayName("a price is money: a string on the wire, exact underneath")
    void thePriceIsMoney() {
        Creator creator = creator();
        UUID projectId = project(creator);

        ResponseEntity<String> created = postRaw(
                "/v1/projects/" + projectId + "/rewards",
                creator.accessToken(),
                Map.of("title", "A reward", "price", Map.of("amount", "19.99", "currency", "AZN")));

        // §10.3: a string, never a number, because a JSON number is an IEEE 754 double
        // in every mainstream parser. 19.99 has no exact double, so a client that
        // parsed a number here would charge a card something else.
        assertThat(created.getBody()).contains("\"price\":{\"amount\":\"19.99\",\"currency\":\"AZN\"}");

        // And the flags carry their JSON names, which is the contract the web editor
        // binds its checkboxes to.
        assertThat(created.getBody())
                .contains("\"isSecret\":false")
                .contains("\"isEarlyBird\":false")
                .contains("\"isFeatured\":false")
                .contains("\"isAddon\":false");

        // numeric(14,2) would round a third decimal place silently, and silent rounding
        // of money is how a ledger stops reconciling.
        assertThat(post(
                                "/v1/projects/" + projectId + "/rewards",
                                creator.accessToken(),
                                Map.of("title", "A reward", "price", Map.of("amount", "19.995", "currency", "AZN")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);

        // A price of nothing is not a price, and the field is named so the editor can
        // say so beside the input.
        ResponseEntity<Map<String, Object>> free = post(
                "/v1/projects/" + projectId + "/rewards",
                creator.accessToken(),
                Map.of("title", "A reward", "price", Map.of("amount", "0", "currency", "AZN")));
        assertThat(free.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(free.getBody().get("meta")).isEqualTo(Map.of("field", "price"));
    }

    @Test
    @DisplayName("a shipping rate is a string on the wire too")
    void shippingRatesAreStrings() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A shipped reward"));
        patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("shippingType", "INTERNATIONAL"));

        ResponseEntity<String> replaced = rest.exchange(
                "/v1/rewards/" + rewardId + "/shipping-rules",
                HttpMethod.PUT,
                new HttpEntity<>(
                        Map.of("rules", List.of(Map.of("countryCode", "AZ", "amount", "5", "additionalItemAmount", "1.50"))),
                        bearer(creator.accessToken())),
                String.class);

        // Padded to the scale of the column, so a client comparing what it sent with
        // what it got back is not told the value changed.
        assertThat(replaced.getBody())
                .contains("\"countryCode\":\"AZ\"")
                .contains("\"amount\":\"5.00\"")
                .contains("\"additionalItemAmount\":\"1.50\"");

        // And a third decimal place is refused rather than rounded, exactly as a
        // reward's price is. A shipping line that quietly gains a qəpik is a pledge
        // total that does not add up.
        ResponseEntity<Map<String, Object>> unrepresentable = put(
                "/v1/rewards/" + rewardId + "/shipping-rules",
                creator.accessToken(),
                Map.of("rules", List.of(Map.of("countryCode", "AZ", "amount", "5.005"))));
        assertThat(unrepresentable.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(unrepresentable.getBody().get("meta")).isEqualTo(Map.of("field", "rules"));
    }

    @Test
    @DisplayName("autosaving one field leaves the rest alone, and an explicit null clears one")
    void autosavingOneFieldLeavesTheRestAlone() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID item = idOf(item(creator, projectId, "A mug"));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "A reward");
        body.put("description", "What you get.");
        body.put("price", Map.of("amount", "25.00", "currency", "AZN"));
        body.put("limitQuantity", 50);
        body.put("items", List.of(Map.of("itemId", item.toString(), "quantity", 1)));
        Map<String, Object> created =
                post("/v1/projects/" + projectId + "/rewards", creator.accessToken(), body).getBody();

        Map<String, Object> saved = patch(
                        "/v1/rewards/" + idOf(created), creator.accessToken(), Map.of("title", "A better reward"))
                .getBody();

        assertThat(saved).containsEntry("title", "A better reward");
        // Read as "set the title and clear the rest", this request would have deleted
        // the creator's work, and it would look entirely ordinary in a log.
        assertThat(saved).containsEntry("description", "What you get.");
        assertThat(saved).containsEntry("limitQuantity", 50);
        assertThat(saved.get("price")).isEqualTo(created.get("price"));
        assertThat(listOf(saved, "items")).hasSize(1);

        // RFC 7396: null removes the member. Told apart from absence above, which is
        // the whole reason the request type does not use Optional.
        Map<String, Object> unlimited =
                patchJson("/v1/rewards/" + idOf(created), creator.accessToken(), "{\"limitQuantity\": null}")
                        .getBody();
        assertThat(unlimited).containsEntry("limitQuantity", null).containsEntry("remainingQuantity", null);
    }

    @Test
    @DisplayName("a secret tier appears in the creator's own list, with its link")
    void secretTiersAreInTheCreatorsProjection() {
        Creator creator = creator();
        UUID projectId = project(creator);

        Map<String, Object> secret = post(
                        "/v1/projects/" + projectId + "/rewards",
                        creator.accessToken(),
                        Map.of(
                                "title",
                                "For the mailing list",
                                "price",
                                Map.of("amount", "99.00", "currency", "AZN"),
                                "isSecret",
                                true))
                .getBody();

        assertThat(secret).containsEntry("isSecret", true);
        // The token is in the creator's projection because handing it out is the
        // creator's decision, and it is stored in the clear so they can read it back.
        assertThat((String) secret.get("secretToken")).isNotBlank();

        // A creator who could not see their own secret tier could not edit or withdraw
        // it. What makes it secret is that the public list leaves it out.
        List<Map<String, Object>> list =
                getList("/v1/projects/" + projectId + "/rewards", creator.accessToken()).getBody();
        assertThat(list).extracting(tier -> tier.get("id")).containsExactly(secret.get("id"));

        // A secret tier is not shown on the page, so it cannot be featured there.
        ResponseEntity<Map<String, Object>> both =
                patch("/v1/rewards/" + idOf(secret), creator.accessToken(), Map.of("isFeatured", true));
        assertThat(both.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(both.getBody().get("meta")).isEqualTo(Map.of("field", "isFeatured"));

        // Made public, the link is destroyed rather than left resolving.
        Map<String, Object> published =
                patch("/v1/rewards/" + idOf(secret), creator.accessToken(), Map.of("isSecret", false)).getBody();
        assertThat(published).containsEntry("isSecret", false).containsEntry("secretToken", null);
    }

    @Test
    @DisplayName("an early bird needs a closing date or a limited quantity")
    void anEarlyBirdEnds() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));

        // Without either it is an ordinary tier with a label that hurries a backer for
        // no reason.
        ResponseEntity<Map<String, Object>> refused =
                patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("isEarlyBird", true));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "isEarlyBird"));

        // Both fields in one body, which is what the editor sends. A field-by-field
        // check would refuse this depending on which it read first.
        Map<String, Object> capped = patch(
                        "/v1/rewards/" + rewardId,
                        creator.accessToken(),
                        Map.of("isEarlyBird", true, "limitQuantity", 100))
                .getBody();
        assertThat(capped).containsEntry("isEarlyBird", true).containsEntry("limitQuantity", 100);
    }

    @Test
    @DisplayName("a quantity may be raised freely and lowered only above what is claimed")
    void aLimitCannotFallBelowWhatIsClaimed() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));
        patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 10));
        claim(rewardId, 6);

        // §5.3. The database refuses the row either way; this is what makes it a 400
        // naming the input rather than a constraint violation and a 500.
        ResponseEntity<Map<String, Object>> refused =
                patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 5));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "limitQuantity"));

        // Down to what is taken is permitted: it closes the tier without unselling
        // anybody.
        assertThat(patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 6))
                        .getBody())
                .containsEntry("limitQuantity", 6)
                .containsEntry("remainingQuantity", 0);

        // And raising it is always allowed.
        assertThat(patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 40))
                        .getBody())
                .containsEntry("remainingQuantity", 34);
    }

    @Test
    @DisplayName("a reward somebody chose cannot be deleted")
    void deletingARewardSomebodyChoseIsRefused() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));
        claim(rewardId, 11);

        ResponseEntity<Map<String, Object>> refused = delete("/v1/rewards/" + rewardId, creator.accessToken());

        // §5.3, without exception: a backer whose reward disappeared has been told
        // nothing about what they are now owed. The alternative is withdrawing it from
        // sale, which closes it to new backers and leaves the promise intact.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "REWARD_HAS_BACKERS");
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("claimedQuantity", 11));

        // Still there, and still editable.
        assertThat(getList("/v1/projects/" + projectId + "/rewards", creator.accessToken()).getBody())
                .hasSize(1);

        // Withdrawing it from sale is the permitted alternative, and it is an ordinary
        // edit rather than a special endpoint.
        assertThat(patch(
                                "/v1/rewards/" + rewardId,
                                creator.accessToken(),
                                Map.of("availableUntil", "2020-01-01T00:00:00Z"))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------
    // What launching freezes (§5.3)
    // ------------------------------------------------------------------

    @Test
    @DisplayName("every reward says whether its price is frozen, so the editor can stop offering the edit")
    void aRewardCarriesItsOwnPriceLock() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));

        // Before launch, on both the created tier and the list. The two reads have to
        // agree: an editor that opened its drawer from a list would otherwise disable
        // a control the list had just said was fine.
        assertThat(reward(creator, projectId, "Another")).containsEntry("pricingLocked", false);
        assertThat(getList("/v1/projects/" + projectId + "/rewards", creator.accessToken())
                        .getBody())
                .allSatisfy(tier -> assertThat(tier).containsEntry("pricingLocked", false));

        launch(projectId);

        // §5.3 froze it, and the TIER is where a client reads that. Not the campaign's
        // `lockedFields`: that list is filtered to the campaign's own patch keys, so it
        // can never name `price`, and the editor that asked it anyway silently never
        // matched and left the control enabled on every live campaign (#183).
        assertThat(getList("/v1/projects/" + projectId + "/rewards", creator.accessToken())
                        .getBody())
                .allSatisfy(tier -> assertThat(tier).containsEntry("pricingLocked", true));

        // The flag is advice; the refusal is the rule, and it still holds.
        assertThat(patch(
                                "/v1/rewards/" + rewardId,
                                creator.accessToken(),
                                Map.of("price", Map.of("amount", "29.99", "currency", "AZN")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    @DisplayName("a live campaign's rewards cannot be repriced, and everything else still can")
    void aLiveCampaignsRewardsKeepTheirPrice() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));

        // Before launch the price moves freely: nobody has chosen this tier, and the
        // campaign is not on sale.
        assertThat(patch(
                                "/v1/rewards/" + rewardId,
                                creator.accessToken(),
                                Map.of("price", Map.of("amount", "24.99", "currency", "AZN")))
                        .getBody()
                        .get("price"))
                .isEqualTo(Map.of("amount", "24.99", "currency", "AZN"));

        launch(projectId);

        ResponseEntity<Map<String, Object>> refused = patch(
                "/v1/rewards/" + rewardId,
                creator.accessToken(),
                Map.of("price", Map.of("amount", "29.99", "currency", "AZN")));

        // 409 rather than 400, for the reason the project module's locked fields give:
        // 29.99 is a perfectly good price, and what refuses it is that the campaign is
        // selling this tier at the one it shows.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "REWARD_FIELD_LOCKED");
        // The campaign's state, because a tier does not have one and the campaign is
        // what refused the edit.
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "price", "state", "LIVE"));

        // Sending the price it already has is refused too: merge-patch says a key that
        // is present is a write, and comparing amounts instead would make the rule
        // depend on how the number was serialised.
        assertThat(patch(
                                "/v1/rewards/" + rewardId,
                                creator.accessToken(),
                                Map.of("price", Map.of("amount", "24.99", "currency", "AZN")))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);

        // §5.3 freezes the price and nothing else about a tier. A creator still has to
        // be able to correct a description or withdraw the tier from sale, and the
        // price is untouched by either.
        Map<String, Object> described = patch(
                        "/v1/rewards/" + rewardId,
                        creator.accessToken(),
                        Map.of("title", "A reward, still available", "description", "Now shipping in March."))
                .getBody();
        assertThat(described).containsEntry("description", "Now shipping in March.");
        assertThat(described.get("price")).isEqualTo(Map.of("amount", "24.99", "currency", "AZN"));
    }

    @Test
    @DisplayName("a live campaign's reward quantity may be raised but not lowered")
    void aLiveCampaignsQuantityOnlyGoesUp() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));
        patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 20));

        launch(projectId);

        // Raising is explicitly permitted by §5.3: a creator who found more stock
        // should be able to sell it.
        assertThat(patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 40))
                        .getBody())
                .containsEntry("limitQuantity", 40);

        // Lowering is not, and it is refused above what is claimed as well as below it
        // — the floor after launch is the number the tier already advertises, not the
        // number somebody has taken. What it advertises is what the public sees: a raise
        // that waits for a moderator (#569) can be taken back down as far as that.
        ResponseEntity<Map<String, Object>> lowered =
                patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 10));
        assertThat(lowered.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(lowered.getBody()).containsEntry("code", "REWARD_FIELD_LOCKED");
        assertThat(lowered.getBody().get("meta")).isEqualTo(Map.of("field", "limitQuantity", "state", "LIVE"));
        assertThat(patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 30))
                        .getBody())
                .containsEntry("limitQuantity", 30);

        // The same number is not a decrease, so an autosave that echoes what is stored
        // is not refused for changing nothing.
        assertThat(patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 20))
                        .getStatusCode())
                .isEqualTo(HttpStatus.OK);

        // Clearing the limit only ever adds places, so unlimited is a raise.
        assertThat(patchJson("/v1/rewards/" + rewardId, creator.accessToken(), "{\"limitQuantity\": null}")
                        .getBody())
                .containsEntry("limitQuantity", null);
    }

    @Test
    @DisplayName("a live tier without a limit cannot be given one")
    void aLiveUnlimitedTierStaysUnlimited() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));

        launch(projectId);

        // Putting a limit on a tier takes places away from a page that promised there
        // were always more.
        assertThat(patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("limitQuantity", 100))
                        .getStatusCode())
                .isEqualTo(HttpStatus.CONFLICT);
    }

    @Test
    @DisplayName("duplicating copies the composition and the rates, and not the counts")
    void duplicatingCopiesTheCompositionAndNotTheCounts() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID mug = idOf(item(creator, projectId, "A mug"));

        Map<String, Object> original = rewardWithItems(creator, projectId, "The mug tier", mug, 2);
        UUID originalId = idOf(original);
        patch("/v1/rewards/" + originalId, creator.accessToken(), Map.of("shippingType", "DOMESTIC", "isSecret", true));
        put(
                "/v1/rewards/" + originalId + "/shipping-rules",
                creator.accessToken(),
                Map.of("rules", List.of(Map.of("countryCode", "AZ", "amount", "5.00"))));
        claim(originalId, 4);

        Map<String, Object> copy =
                post("/v1/rewards/" + originalId + "/duplicate", creator.accessToken(), null).getBody();

        assertThat(copy.get("id")).isNotEqualTo(original.get("id"));
        // What the creator wrote is copied, including the rate table -- re-entering one
        // is the reason a creator reaches for duplicate at all.
        assertThat(copy).containsEntry("title", "The mug tier");
        assertThat(listOf(copy, "items")).containsExactly(Map.of("itemId", mug.toString(), "quantity", 2));
        assertThat(listOf(copy, "shippingRules")).hasSize(1);

        // What backers did is not. The counts are not insertable columns, so the copy
        // takes the database's zeroes rather than a rule this endpoint remembers.
        assertThat(copy).containsEntry("claimedQuantity", 0).containsEntry("reservedQuantity", 0);

        // A new link, because one token for two tiers would mean revoking one revokes
        // the other.
        assertThat(copy).containsEntry("isSecret", true);
        assertThat((String) copy.get("secretToken"))
                .isNotBlank()
                .isNotEqualTo(original.get("secretToken"));

        // Appended, not inserted: the creator sees it where they added it.
        assertThat(copy.get("sortOrder")).isEqualTo(1);
    }

    @Test
    @DisplayName("a reorder names every tier exactly once, or it is refused")
    void reorderingNeedsEveryTierExactlyOnce() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID first = idOf(reward(creator, projectId, "First"));
        UUID second = idOf(reward(creator, projectId, "Second"));
        UUID third = idOf(reward(creator, projectId, "Third"));

        // A partial list leaves the tiers it omits where they were, interleaved with
        // the ones that moved -- so the creator sees an order nobody asked for.
        ResponseEntity<Map<String, Object>> partial = patch(
                "/v1/projects/" + projectId + "/rewards/reorder",
                creator.accessToken(),
                Map.of("rewardIds", List.of(third.toString(), first.toString())));
        assertThat(partial.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(partial.getBody()).containsEntry("code", "REWARD_ORDER_INCOMPLETE");
        assertThat(partial.getBody().get("meta"))
                .isEqualTo(Map.of("missing", List.of(second.toString()), "unexpected", List.of()));

        // A repeat is as wrong as a stranger: it gives one tier two positions and
        // leaves another with none.
        ResponseEntity<Map<String, Object>> repeated = patch(
                "/v1/projects/" + projectId + "/rewards/reorder",
                creator.accessToken(),
                Map.of("rewardIds", List.of(first.toString(), first.toString(), second.toString(), third.toString())));
        assertThat(repeated.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(repeated.getBody().get("meta"))
                .isEqualTo(Map.of("missing", List.of(), "unexpected", List.of(first.toString())));

        // The full set, which is what the client was dragging anyway.
        ResponseEntity<List<Map<String, Object>>> reordered = rest.exchange(
                "/v1/projects/" + projectId + "/rewards/reorder",
                HttpMethod.PATCH,
                new HttpEntity<>(
                        Map.of("rewardIds", List.of(third.toString(), first.toString(), second.toString())),
                        bearer(creator.accessToken())),
                ARRAY);
        assertThat(reordered.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(reordered.getBody())
                .extracting(tier -> tier.get("id"))
                .containsExactly(third.toString(), first.toString(), second.toString());
        assertThat(reordered.getBody()).extracting(tier -> tier.get("sortOrder")).containsExactly(0, 1, 2);

        // And the order is what a fresh read returns, not only what the reorder echoed.
        assertThat(getList("/v1/projects/" + projectId + "/rewards", creator.accessToken()).getBody())
                .extracting(tier -> tier.get("id"))
                .containsExactly(third.toString(), first.toString(), second.toString());
    }

    // ------------------------------------------------------------------
    // Shipping
    // ------------------------------------------------------------------

    @Test
    @DisplayName("PUT replaces the whole rate table, and an empty body clears it")
    void shippingRulesAreReplacedWholesale() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A shipped reward"));

        // Rates for a tier that is not shipped are rates nothing will ever read, and a
        // creator who entered them believes shipping is priced.
        ResponseEntity<Map<String, Object>> notShipped = put(
                "/v1/rewards/" + rewardId + "/shipping-rules",
                creator.accessToken(),
                Map.of("rules", List.of(Map.of("countryCode", "AZ", "amount", "5.00"))));
        assertThat(notShipped.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(notShipped.getBody().get("meta")).isEqualTo(Map.of("field", "shippingType"));

        patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("shippingType", "INTERNATIONAL"));

        Map<String, Object> priced = put(
                        "/v1/rewards/" + rewardId + "/shipping-rules",
                        creator.accessToken(),
                        Map.of(
                                "rules",
                                List.of(
                                        Map.of("countryCode", "AZ", "amount", "5.00", "additionalItemAmount", "1.00"),
                                        Map.of("countryCode", "TR", "amount", "12.00"))))
                .getBody();
        assertThat(listOf(priced, "shippingRules"))
                .extracting(rule -> rule.get("countryCode"))
                .containsExactly("AZ", "TR");
        // An omitted additional-item rate is free, which is an offer creators make on
        // purpose -- better a zero they can see than a null the calculation interprets.
        assertThat(listOf(priced, "shippingRules").get(1)).containsEntry("additionalItemAmount", "0.00");

        // Wholesale: Turkey is gone because the body did not mention it. Merging would
        // leave the creator shipping somewhere they believe they no longer do.
        Map<String, Object> narrowed = put(
                        "/v1/rewards/" + rewardId + "/shipping-rules",
                        creator.accessToken(),
                        Map.of("rules", List.of(Map.of("countryCode", "AZ", "amount", "7.50"))))
                .getBody();
        assertThat(listOf(narrowed, "shippingRules"))
                // `perKilogramAmount` arrived with #77 and is zero for a tier priced flat,
                // which is what almost every tier is.
                .containsExactly(Map.of(
                        "countryCode", "AZ",
                        "amount", "7.50",
                        "additionalItemAmount", "0.00",
                        "perKilogramAmount", "0.00"));

        // Two rates for one destination would be two answers to one question.
        ResponseEntity<Map<String, Object>> twice = put(
                "/v1/rewards/" + rewardId + "/shipping-rules",
                creator.accessToken(),
                Map.of(
                        "rules",
                        List.of(
                                Map.of("countryCode", "AZ", "amount", "5.00"),
                                Map.of("countryCode", "az", "amount", "6.00"))));
        assertThat(twice.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(twice.getBody().get("meta")).isEqualTo(Map.of("field", "rules"));

        // An empty table is a legitimate request: it is how a creator stops shipping.
        assertThat(listOf(
                        put(
                                        "/v1/rewards/" + rewardId + "/shipping-rules",
                                        creator.accessToken(),
                                        Map.of("rules", List.of()))
                                .getBody(),
                        "shippingRules"))
                .isEmpty();
    }

    // ------------------------------------------------------------------
    // Who may see and change a reward
    // ------------------------------------------------------------------

    @Test
    @DisplayName("another creator's items and rewards are answered 404, never 403")
    void anotherCreatorsRewardsDoNotExist() {
        Creator owner = creator();
        Creator stranger = creator();
        UUID projectId = project(owner);
        UUID itemId = idOf(item(owner, projectId, "An unannounced product"));
        UUID rewardId = idOf(reward(owner, projectId, "An unannounced price"));

        // 404 rather than 403, deliberately. A reward tier is a price on a product
        // nobody has announced; answering 403 would confirm that both exist, which is
        // exactly what a draft is private to protect.
        ResponseEntity<Map<String, Object>> readReward =
                patch("/v1/rewards/" + rewardId, stranger.accessToken(), Map.of("title", "Mine now"));
        assertThat(readReward.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(readReward.getBody()).containsEntry("code", "REWARD_NOT_FOUND");

        // And identical to an identifier that never existed, so the endpoint is not an
        // oracle for which ones are real.
        assertThat(patch("/v1/rewards/" + UUID.randomUUID(), stranger.accessToken(), Map.of("title", "Anything"))
                        .getBody())
                .containsEntry("code", "REWARD_NOT_FOUND");

        assertThat(delete("/v1/rewards/" + rewardId, stranger.accessToken()).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(post("/v1/rewards/" + rewardId + "/duplicate", stranger.accessToken(), null)
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(put("/v1/rewards/" + rewardId + "/shipping-rules", stranger.accessToken(), Map.of("rules", List.of()))
                        .getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);

        ResponseEntity<Map<String, Object>> readItem =
                patch("/v1/items/" + itemId, stranger.accessToken(), Map.of("name", "Mine now"));
        assertThat(readItem.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(readItem.getBody()).containsEntry("code", "ITEM_NOT_FOUND");

        // The campaign-scoped endpoints answer about the campaign, which is the fact
        // ProjectAccess refused.
        ResponseEntity<Map<String, Object>> listed = rest.exchange(
                "/v1/projects/" + projectId + "/rewards",
                HttpMethod.GET,
                new HttpEntity<>(bearer(stranger.accessToken())),
                OBJECT);
        assertThat(listed.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(listed.getBody()).containsEntry("code", "PROJECT_NOT_FOUND");

        // And nothing was touched.
        assertThat(getList("/v1/projects/" + projectId + "/rewards", owner.accessToken()).getBody())
                .hasSize(1);
    }

    @Test
    @DisplayName("a reward cannot be composed from another campaign's item")
    void compositionCannotCrossCampaigns() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID otherProject = project(creator);
        UUID elsewhere = idOf(item(creator, otherProject, "A mug from the other campaign"));

        // The same creator, deliberately: this is not an authorisation rule but a
        // structural one, and the composite foreign key is what makes it impossible.
        ResponseEntity<Map<String, Object>> refused = post(
                "/v1/projects/" + projectId + "/rewards",
                creator.accessToken(),
                Map.of(
                        "title",
                        "A reward",
                        "price",
                        Map.of("amount", "10.00", "currency", "AZN"),
                        "items",
                        List.of(Map.of("itemId", elsewhere.toString(), "quantity", 1))));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "items"));
    }

    @Test
    @DisplayName("an unauthenticated caller reaches nothing")
    void everythingIsBehindAuthentication() {
        Creator creator = creator();
        UUID projectId = project(creator);

        assertThat(rest.exchange(
                                "/v1/projects/" + projectId + "/rewards",
                                HttpMethod.GET,
                                new HttpEntity<>(jsonHeaders()),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(rest.exchange(
                                "/v1/projects/" + projectId + "/items",
                                HttpMethod.POST,
                                new HttpEntity<>(Map.of("name", "A mug"), jsonHeaders()),
                                String.class)
                        .getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    @Test
    @DisplayName("an unknown shipping scope says which ones exist")
    void anUnknownShippingScopeIsNamed() {
        Creator creator = creator();
        UUID projectId = project(creator);
        UUID rewardId = idOf(reward(creator, projectId, "A reward"));

        ResponseEntity<Map<String, Object>> refused =
                patch("/v1/rewards/" + rewardId, creator.accessToken(), Map.of("shippingType", "FREE"));

        // Jackson's own failure for an unknown constant names a Java type and lists
        // nothing the client can choose from.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(refused.getBody().get("meta")).isEqualTo(Map.of("field", "shippingType"));
        assertThat((String) refused.getBody().get("detail")).contains("LOCAL_PICKUP");
    }

    /** A tier containing one item, which several tests need before they can start. */
    private Map<String, Object> rewardWithItems(Creator creator, UUID projectId, String title, UUID itemId, int qty) {
        return post(
                        "/v1/projects/" + projectId + "/rewards",
                        creator.accessToken(),
                        Map.of(
                                "title",
                                title,
                                "price",
                                Map.of("amount", "19.99", "currency", "AZN"),
                                "items",
                                List.of(Map.of("itemId", itemId.toString(), "quantity", qty))))
                .getBody();
    }
}
