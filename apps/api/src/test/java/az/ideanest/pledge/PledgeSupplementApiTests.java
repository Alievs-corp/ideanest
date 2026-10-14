package az.ideanest.pledge;

import static org.assertj.core.api.Assertions.assertThat;

import az.ideanest.shared.EmailAddress;
import az.ideanest.support.AbstractIntegrationTest;
import az.ideanest.support.Campaigns;
import az.ideanest.support.Pledges;
import az.ideanest.user.infrastructure.UserRepository;
import java.math.BigDecimal;
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
 * §4.8's PM-09, PM-10 and PM-16 (#76): what a backer buys after the campaign closed.
 *
 * <p>The tests that carry the design:
 *
 * <ul>
 *   <li>{@link #anUpgradeLeavesTheCampaignsNumbersAlone()} — the decision the whole
 *       feature is shaped around. §5.1 judged the campaign against those amounts and
 *       V29 froze the comparison; a purchase months later must not move them.
 *   <li>{@link #whileTheCampaignRunsTheEditIsTheWayToDoThis()} — two ways to change one
 *       pledge, and the campaign decides which applies.
 *   <li>{@link #aDowngradeIsRefusedRatherThanRefunded()} — a negative supplement would
 *       be a payment sitting in a table a collection run reads.
 *   <li>{@link #aPostCampaignAddonHoldsItsPlaceOnTheTier()} — a limited add-on cannot
 *       be oversold by being bought late.
 *   <li>{@link #aPostCampaignAddonDoesNotJoinTheCampaignsLines()} — why
 *       {@code supplement_addons} exists at all.
 * </ul>
 */
class PledgeSupplementApiTests extends AbstractIntegrationTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "a-long-enough-password";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private UserRepository users;

    @Autowired
    private DataSource dataSource;

    @AfterEach
    void clear() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("DELETE FROM supplement_addons");
        jdbc.update("DELETE FROM pledge_supplements");
        jdbc.update("DELETE FROM pledge_addons");
        jdbc.update("DELETE FROM pledges");
        jdbc.update("DELETE FROM reward_tiers");
        jdbc.update("DELETE FROM project_state_transitions");
        jdbc.update("DELETE FROM projects");
    }

    // ------------------------------------------------------------------
    // Upgrades
    // ------------------------------------------------------------------

    @Test
    @DisplayName("an upgrade moves the tier, owes the difference, and leaves the campaign's numbers alone")
    void anUpgradeLeavesTheCampaignsNumbersAlone() {
        Account creator = account("sup-creator");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID deluxe = reward(creator, project, "Deluxe", "60.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        ResponseEntity<Map<String, Object>> upgraded = upgrade(pledge, backer, deluxe);

        assertThat(upgraded.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(upgraded.getBody()).containsEntry("rewardTierId", deluxe.toString());

        // What the campaign raised does not move. §5.1 compared this number against
        // the goal at the deadline and V29 froze the comparison; rewriting it now
        // would change what the campaign is reported to have raised.
        assertThat(amount(upgraded.getBody(), "base")).isEqualTo("25.00");
        assertThat(amount(upgraded.getBody(), "total")).isEqualTo("25.00");

        List<Map<String, Object>> supplements = supplementsOf(upgraded.getBody());
        assertThat(supplements).hasSize(1);
        assertThat(supplements.getFirst()).containsEntry("kind", "UPGRADE");
        assertThat(money(supplements.getFirst(), "amount")).isEqualTo("35.00");
        assertThat(supplements.getFirst())
                .containsEntry("fromRewardTierId", standard.toString())
                .containsEntry("toRewardTierId", deluxe.toString());
        assertThat(supplements.getFirst().get("collectedAt"))
                .as("PM-16's charge is epic #59's, and a stub would tell a creator money had arrived")
                .isNull();
    }

    @Test
    @DisplayName("an upgrade moves the claimed place from one tier to the other")
    void anUpgradeMovesTheClaimedPlace() {
        Account creator = account("sup-stock");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID deluxe = reward(creator, project, "Deluxe", "60.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-stock-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        upgrade(pledge, backer, deluxe);

        assertThat(claimed(standard)).isZero();
        assertThat(claimed(deluxe)).isEqualTo(1);
    }

    @Test
    @DisplayName("a downgrade is refused rather than refunded")
    void aDowngradeIsRefusedRatherThanRefunded() {
        Account creator = account("sup-down");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID cheaper = reward(creator, project, "Postcard", "5.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-down-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        ResponseEntity<Map<String, Object>> refused = upgrade(pledge, backer, cheaper);

        // Refunds are #67's, with a reason code and an audit trail behind them. A
        // negative supplement would be a payment in a table a collection run reads.
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT);
        assertThat(refused.getBody()).containsEntry("code", "SUPPLEMENT_NOT_AN_INCREASE");
    }

    @Test
    @DisplayName("while the campaign is running, the edit is the way to change a pledge")
    void whileTheCampaignRunsTheEditIsTheWayToDoThis() {
        Account creator = account("sup-live");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID deluxe = reward(creator, project, "Deluxe", "60.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-live-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");

        ResponseEntity<Map<String, Object>> refused = upgrade(pledge, backer, deluxe);

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "CAMPAIGN_STILL_TAKING_PLEDGES");
        assertThat(meta(refused.getBody()))
                .as("a refusal that does not name the alternative is one a client hides a button over")
                .containsEntry("use", "PATCH /v1/pledges/{id}");
    }

    @Test
    @DisplayName("somebody else's pledge cannot be upgraded")
    void aStrangerCannotUpgradeAPledge() {
        Account creator = account("sup-guard");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID deluxe = reward(creator, project, "Deluxe", "60.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-guard-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        assertThat(upgrade(pledge, account("sup-stranger"), deluxe).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    // ------------------------------------------------------------------
    // The post-campaign add-on store
    // ------------------------------------------------------------------

    @Test
    @DisplayName("a post-campaign add-on is its own purchase and does not join the campaign's lines")
    void aPostCampaignAddonDoesNotJoinTheCampaignsLines() {
        Account creator = account("sup-addon");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID mug = addon(creator, project, "A mug", "10.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-addon-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        ResponseEntity<Map<String, Object>> bought = buyAddons(pledge, backer, Map.of(mug, 2));

        assertThat(bought.getStatusCode()).isEqualTo(HttpStatus.OK);
        // The campaign's own add-on total does not move: V39 argues why a merged line
        // would leave `addons_amount` unable to say what it paid for.
        assertThat(amount(bought.getBody(), "addons")).isEqualTo("0.00");
        assertThat(addonsOf(bought.getBody())).isEmpty();

        List<Map<String, Object>> supplements = supplementsOf(bought.getBody());
        assertThat(supplements).hasSize(1);
        assertThat(supplements.getFirst()).containsEntry("kind", "ADDONS");
        assertThat(money(supplements.getFirst(), "amount")).isEqualTo("20.00");
        assertThat(supplementLines(supplements.getFirst()))
                .containsExactly(Map.of("rewardTierId", mug.toString(), "quantity", 2));
    }

    @Test
    @DisplayName("a post-campaign add-on holds its place on the tier")
    void aPostCampaignAddonHoldsItsPlaceOnTheTier() {
        Account creator = account("sup-limited");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID mug = limitedAddon(creator, project, "A rare mug", "10.00", 1);
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-limited-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        Account second = account("sup-limited-second");
        UUID otherPledge = confirmedPledge(project, second, standard, "25.00");
        closeTheCampaign(project);

        assertThat(buyAddons(pledge, backer, Map.of(mug, 1)).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(claimed(mug)).isEqualTo(1);

        // The second backer is refused by the same stock rule the checkout obeys: a
        // limited add-on cannot be oversold by being bought late.
        ResponseEntity<Map<String, Object>> refused = buyAddons(otherPledge, second, Map.of(mug, 1));
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "REWARD_SOLD_OUT");
        assertThat(claimed(mug)).isEqualTo(1);
    }

    @Test
    @DisplayName("a draft cannot buy anything: the thing to do with a checkout is finish it")
    void aDraftCannotBuyASupplement() {
        Account creator = account("sup-draft");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID mug = addon(creator, project, "A mug", "10.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-draft-backer");
        UUID pledge = draftPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        ResponseEntity<Map<String, Object>> refused = buyAddons(pledge, backer, Map.of(mug, 1));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(refused.getBody()).containsEntry("code", "PLEDGE_NOT_SUPPLEMENTABLE");
        assertThat(meta(refused.getBody())).containsEntry("state", "DRAFT");
    }

    @Test
    @DisplayName("a retried purchase is the same purchase")
    void aRetriedPurchaseIsTheSamePurchase() {
        Account creator = account("sup-idem");
        UUID project = project(creator);
        UUID standard = reward(creator, project, "Standard", "25.00");
        UUID mug = addon(creator, project, "A mug", "10.00");
        Campaigns.launch(dataSource, project);

        Account backer = account("sup-idem-backer");
        UUID pledge = confirmedPledge(project, backer, standard, "25.00");
        closeTheCampaign(project);

        String key = UUID.randomUUID().toString();
        ResponseEntity<Map<String, Object>> first = buyAddons(pledge, backer, Map.of(mug, 1), key);
        ResponseEntity<Map<String, Object>> replayed = buyAddons(pledge, backer, Map.of(mug, 1), key);

        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(replayed.getStatusCode()).isEqualTo(HttpStatus.OK);
        // One purchase, one claimed place. A retry that bought a second mug would be
        // the failure §10.3's key exists to prevent, and it would cost the creator
        // stock as well as the backer money.
        assertThat(supplementsOf(replayed.getBody())).hasSize(1);
        assertThat(claimed(mug)).isEqualTo(1);
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

    private UUID project(Account creator) {
        ResponseEntity<Map<String, Object>> created = exchange(
                "/v1/projects",
                HttpMethod.POST,
                creator.accessToken(),
                Map.of("title", "A campaign with a pledge manager " + SEQUENCE.incrementAndGet()));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID reward(Account creator, UUID project, String title, String price) {
        return tier(creator, project, title, price, false, null);
    }

    private UUID addon(Account creator, UUID project, String title, String price) {
        return tier(creator, project, title, price, true, null);
    }

    private UUID limitedAddon(Account creator, UUID project, String title, String price, int limit) {
        return tier(creator, project, title, price, true, limit);
    }

    private UUID tier(Account creator, UUID project, String title, String price, boolean isAddon, Integer limit) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", title);
        body.put("description", "Something to receive.");
        body.put("price", Map.of("amount", price, "currency", "AZN"));
        body.put("shippingType", "NONE");
        body.put("isAddon", isAddon);
        if (limit != null) {
            body.put("limitQuantity", limit);
        }
        ResponseEntity<Map<String, Object>> created =
                exchange("/v1/projects/" + project + "/rewards", HttpMethod.POST, creator.accessToken(), body);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    private UUID draftPledge(UUID project, Account backer, UUID rewardTierId, String contribution) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("projectId", project.toString());
        body.put("rewardTierId", rewardTierId.toString());
        body.put("contribution", Map.of("amount", contribution, "currency", "AZN"));

        ResponseEntity<Map<String, Object>> created =
                post("/v1/pledges/draft", backer, UUID.randomUUID().toString(), body);
        return UUID.fromString((String) created.getBody().get("id"));
    }

    /** A pledge confirmed the stored-card way, as one made before IDN-EXT-01 is; no route does it since #45. */
    private UUID confirmedPledge(UUID project, Account backer, UUID rewardTierId, String contribution) {
        UUID pledge = draftPledge(project, backer, rewardTierId, contribution);
        Pledges.confirmDraft(dataSource, pledge);
        return pledge;
    }

    /**
     * Closes the campaign the way its deadline would.
     *
     * <p>What the pledge manager asks is whether the campaign is still taking pledges, and a
     * successful campaign past its deadline is already not.
     */
    private void closeTheCampaign(UUID project) {
        new JdbcTemplate(dataSource)
                .update(
                        """
                        UPDATE projects
                           SET state = 'SUCCESSFUL',
                               launched_at = now() - interval '31 days',
                               deadline = now() - interval '1 day'
                         WHERE id = ?
                        """,
                        project);
    }

    private ResponseEntity<Map<String, Object>> upgrade(UUID pledge, Account backer, UUID rewardTierId) {
        return post(
                "/v1/pledges/" + pledge + "/upgrade",
                backer,
                UUID.randomUUID().toString(),
                Map.of("rewardTierId", rewardTierId.toString()));
    }

    private ResponseEntity<Map<String, Object>> buyAddons(UUID pledge, Account backer, Map<UUID, Integer> lines) {
        return buyAddons(pledge, backer, lines, UUID.randomUUID().toString());
    }

    private ResponseEntity<Map<String, Object>> buyAddons(
            UUID pledge, Account backer, Map<UUID, Integer> lines, String key) {

        List<Map<String, Object>> addons = lines.entrySet().stream()
                .map(line -> Map.<String, Object>of(
                        "rewardTierId", line.getKey().toString(), "quantity", line.getValue()))
                .toList();
        return post("/v1/pledges/" + pledge + "/addons", backer, key, Map.of("addons", addons));
    }

    private ResponseEntity<Map<String, Object>> post(String path, Account caller, String key, Object body) {
        HttpHeaders headers = bearer(caller.accessToken());
        headers.set("Idempotency-Key", key);
        return rest.exchange(
                path,
                HttpMethod.POST,
                new HttpEntity<>(body, headers),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private ResponseEntity<Map<String, Object>> exchange(String path, HttpMethod method, String token, Object body) {
        return rest.exchange(
                path,
                method,
                new HttpEntity<>(body, token == null ? jsonHeaders() : bearer(token)),
                new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    private int claimed(UUID rewardTierId) {
        Integer value = new JdbcTemplate(dataSource)
                .queryForObject(
                        "SELECT claimed_quantity FROM reward_tiers WHERE id = ?", Integer.class, rewardTierId);
        return value == null ? 0 : value;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> supplementsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("supplements");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> addonsOf(Map<String, Object> body) {
        return (List<Map<String, Object>>) body.get("addons");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> supplementLines(Map<String, Object> supplement) {
        return (List<Map<String, Object>>) supplement.get("addons");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> meta(Map<String, Object> body) {
        return (Map<String, Object>) body.get("meta");
    }

    @SuppressWarnings("unchecked")
    private static String amount(Map<String, Object> pledge, String part) {
        Map<String, Object> amounts = (Map<String, Object>) pledge.get("amounts");
        return money(amounts, part);
    }

    @SuppressWarnings("unchecked")
    private static String money(Map<String, Object> holder, String key) {
        Map<String, Object> money = (Map<String, Object>) holder.get(key);
        // Money crosses the API as a string, never a number: §7.3 and CLAUDE.md both
        // say so, and this assertion is what would notice if it stopped doing that.
        assertThat(money.get("amount")).isInstanceOf(String.class);
        return new BigDecimal((String) money.get("amount")).toPlainString();
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
